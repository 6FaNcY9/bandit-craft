package botui;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;
import javax.imageio.ImageIO;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.MapMeta;
import org.bukkit.map.MapCanvas;
import org.bukkit.map.MapCursor;
import org.bukkit.map.MapCursorCollection;
import org.bukkit.map.MapRenderer;
import org.bukkit.map.MapView;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * The live map item: one map per viewer, painted from BlueMap's low-res tiles with the bots as named cursors.
 * Everything slow (HTTP, PNG decoding, palette matching) runs off the main thread; renderers only copy a prepared frame.
 */
final class BotMap {
  record Marker(double x, double z, String dim, String kind, String label) {}

  /** dim may be null: the viewer's own world. */
  record Center(double x, double z, String dim) {}

  /** center null follows the player. */
  record View(int zoom, Center center, List<Marker> markers) {}

  private record Cur(byte x, byte y, byte dir, MapCursor.Type type, String caption) {}

  private record Frame(int[] px, BufferedImage img, List<Cur> cur, long version) {}

  private record Snap(double x, double z, float yaw, String dim) {}

  private static final class Slot {
    volatile View view;
    volatile Frame frame;
    volatile boolean holding;
    final AtomicBoolean busy = new AtomicBoolean();
    // touched only by that viewer's renderer
    MapCanvas drawnOn;
    long drawn = -1;
  }

  private static final int SIZE = 128;
  private static final int TILE_PX = 500;
  static final int MAX_MARKERS = 64;
  private static final long TILE_TTL_MS = 5 * 60_000, MISS_TTL_MS = 60_000;
  private static final int TILE_CACHE = 64;
  private static final Map<String, String> MAPS = Map.of("overworld", "world", "the_nether", "world_the_nether", "the_end", "world_the_end");
  private static final Map<String, MapCursor.Type> KINDS = Map.of("work", MapCursor.Type.BANNER_LIME, "idle", MapCursor.Type.BANNER_LIGHT_GRAY,
      "bad", MapCursor.Type.BANNER_RED, "off", MapCursor.Type.BANNER_GRAY);

  private final JavaPlugin plugin;
  private final Predicate<String> viewer;
  private final String base;
  private final NamespacedKey tag;
  private final Path idsFile;
  private final Properties ids = new Properties();
  private final Map<String, Slot> slots = new ConcurrentHashMap<>();
  private final Set<String> online = ConcurrentHashMap.newKeySet();
  private final ExecutorService pool = Executors.newFixedThreadPool(2, r -> {
    Thread t = new Thread(r, "botui-map");
    t.setDaemon(true);
    return t;
  });
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  private final AtomicBoolean fetchWarned = new AtomicBoolean();
  private final AtomicLong versions = new AtomicLong();
  // shortcut: 64 decoded tiles are up to 64 MB of heap (1 MB each), lower TILE_CACHE if the server's heap gets tight.
  /** Decoded tiles as ARGB (0 = blank); null data is a tile that is missing. */
  private final Map<String, Tile> tiles = new LinkedHashMap<>(16, 0.75f, true) {
    @Override
    protected boolean removeEldestEntry(Map.Entry<String, Tile> e) {
      return size() > TILE_CACHE;
    }
  };

  private record Tile(int[] data, long until) {}

  BotMap(JavaPlugin plugin, Predicate<String> viewer, String base) {
    this.plugin = plugin;
    this.viewer = viewer;
    this.base = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    this.tag = new NamespacedKey(plugin, "botkarte");
    this.idsFile = plugin.getDataFolder().toPath().resolve("maps.properties");
  }

  /** Main thread. */
  void start() {
    try (InputStream in = Files.newInputStream(idsFile)) {
      ids.load(in);
    } catch (IOException e) {
      // first run: no maps yet
    }
    for (Player p : Bukkit.getOnlinePlayers()) join(p);
    Bukkit.getScheduler().runTaskTimer(plugin, () -> slots.keySet().forEach(this::step), 40, 40);
  }

  void stop() {
    pool.shutdownNow();
  }

  /** Main thread: a viewer's map gets our renderer back after a restart or reload. */
  void join(Player p) {
    String name = key(p);
    online.add(name);
    MapView v = known(name);
    if (v != null && v.getRenderers().stream().noneMatch(r -> r instanceof Renderer)) setup(v, name);
  }

  void quit(Player p) {
    String name = key(p);
    online.remove(name);
    slots.remove(name);
  }

  /** The hub replaced the viewer list: forget everyone who may no longer see a map. */
  void retain(Set<String> names) {
    slots.keySet().retainAll(names);
  }

  boolean isMap(ItemStack item) {
    return item != null && item.hasItemMeta() && item.getItemMeta().getPersistentDataContainer().has(tag, PersistentDataType.BYTE);
  }

  /** Any thread. Offline players and unchanged views cost nothing. */
  void set(String name, View v) {
    String k = name.toLowerCase(Locale.ROOT);
    if (!online.contains(k) || !viewer.test(k)) return;
    Slot s = slots.computeIfAbsent(k, x -> new Slot());
    if (v.equals(s.view)) return;
    s.view = v;
    if (s.holding) Bukkit.getScheduler().runTask(plugin, () -> step(k));
  }

  // ---- give ------------------------------------------------------------------------------

  /** Main thread. Puts the viewer's map into their hand without ever dropping an item; returns an error text or null. */
  String give(Player p) {
    PlayerInventory inv = p.getInventory();
    int held = inv.getHeldItemSlot();
    int at = -1;
    for (int i = 0; i < 41 && at < 0; i++) if ((i < 36 || i == 40) && isMap(inv.getItem(i))) at = i;
    if (at >= 0) { // the existing one comes to the hand, what was there takes its slot
      ItemStack map = inv.getItem(at), cur = inv.getItem(held);
      inv.setItem(held, map);
      inv.setItem(at, cur);
      step(key(p));
      return null;
    }
    ItemStack cur = inv.getItem(held);
    boolean handFree = cur == null || cur.isEmpty();
    int free = handFree ? held : inv.firstEmpty();
    if (free < 0) return "Inventar voll";
    ItemStack map = new ItemStack(Material.FILLED_MAP);
    MapMeta meta = (MapMeta) map.getItemMeta();
    meta.setMapView(viewOf(p));
    meta.displayName(Component.text("Bot-Karte"));
    meta.getPersistentDataContainer().set(tag, PersistentDataType.BYTE, (byte) 1);
    map.setItemMeta(meta);
    if (handFree) inv.setItem(held, map);
    else if (free < 9) { // an empty hotbar slot can be selected
      inv.setItem(free, map);
      inv.setHeldItemSlot(free);
    } else { // the held item moves out of the way instead
      inv.setItem(free, cur);
      inv.setItem(held, map);
    }
    step(key(p));
    return null;
  }

  private static String key(Player p) {
    return p.getName().toLowerCase(Locale.ROOT);
  }

  private MapView known(String name) {
    String id = ids.getProperty(name);
    return id == null ? null : Bukkit.getMap(Integer.parseInt(id));
  }

  private synchronized MapView viewOf(Player p) {
    String name = key(p);
    MapView v = known(name);
    if (v == null) {
      v = Bukkit.createMap(p.getWorld());
      ids.setProperty(name, Integer.toString(v.getId()));
      try {
        Files.createDirectories(idsFile.getParent());
        try (OutputStream out = Files.newOutputStream(idsFile)) {
          ids.store(out, null);
        }
      } catch (IOException e) {
        plugin.getLogger().warning("cannot save maps.properties: " + e);
      }
    }
    setup(v, name);
    return v;
  }

  private void setup(MapView v, String name) {
    for (MapRenderer r : new ArrayList<>(v.getRenderers())) v.removeRenderer(r);
    v.addRenderer(new Renderer(name));
    v.setTrackingPosition(false);
    v.setUnlimitedTracking(false);
    v.setLocked(true);
  }

  // ---- render ----------------------------------------------------------------------------

  private final class Renderer extends MapRenderer {
    private final String owner;

    Renderer(String owner) {
      super(true);
      this.owner = owner;
    }

    @Override
    public void render(MapView map, MapCanvas canvas, Player p) {
      if (!key(p).equals(owner)) return; // somebody else holding this map sees nothing of it
      Slot s = slots.get(owner);
      if (s == null || !s.holding || !viewer.test(owner)) return;
      Frame f = s.frame;
      if (f == null || (s.drawnOn == canvas && s.drawn == f.version)) return;
      canvas.drawImage(0, 0, f.img);
      MapCursorCollection cc = canvas.getCursors();
      while (cc.size() > 0) cc.removeCursor(cc.getCursor(0));
      for (Cur c : f.cur) cc.addCursor(new MapCursor(c.x, c.y, c.dir, c.type, true, c.caption == null ? null : Component.text(c.caption)));
      canvas.setCursors(cc);
      s.drawnOn = canvas;
      s.drawn = f.version;
    }
  }

  /** Main thread: is the viewer holding their map, and if so, queue a new frame. */
  private void step(String name) {
    Slot s = slots.get(name);
    Player p = Bukkit.getPlayerExact(name);
    if (s == null || p == null) return;
    PlayerInventory inv = p.getInventory();
    s.holding = isMap(inv.getItemInMainHand()) || isMap(inv.getItemInOffHand());
    View v = s.view;
    if (!s.holding || v == null || !s.busy.compareAndSet(false, true)) return;
    Location l = p.getLocation();
    Snap sn = new Snap(l.getX(), l.getZ(), l.getYaw(), p.getWorld().getKey().getKey());
    try {
      pool.execute(() -> {
        try {
          compose(s, v, sn);
        } catch (RuntimeException e) {
          plugin.getLogger().warning("map frame failed: " + e);
        } finally {
          s.busy.set(false);
        }
      });
    } catch (RejectedExecutionException e) { // shutting down
      s.busy.set(false);
    }
  }

  private void compose(Slot s, View v, Snap sn) {
    double cx = v.center() == null ? sn.x() : v.center().x(), cz = v.center() == null ? sn.z() : v.center().z();
    String dim = v.center() != null && v.center().dim() != null ? v.center().dim() : sn.dim();
    int zoom = v.zoom(), lod = zoom <= 2 ? 1 : zoom <= 10 ? 2 : 3;
    int div = lod == 1 ? 1 : lod == 2 ? 5 : 25, size = TILE_PX * div;
    String map = MAPS.get(dim);
    int[] px = new int[SIZE * SIZE];
    Map<String, int[]> local = new HashMap<>();
    if (map != null) {
      for (int y = 0; y < SIZE; y++) {
        for (int x = 0; x < SIZE; x++) {
          long bx = (long) Math.floor(cx + (x - SIZE / 2) * zoom), bz = (long) Math.floor(cz + (y - SIZE / 2) * zoom);
          long tx = Math.floorDiv(bx, size), tz = Math.floorDiv(bz, size);
          String id = map + "/" + lod + "/x" + tx + "/z" + tz;
          int[] tile = local.containsKey(id) ? local.get(id) : fetch(id, map, lod, tx, tz);
          local.put(id, tile);
          if (tile != null) px[y * SIZE + x] = tile[(int) ((bz - tz * size) / div) * TILE_PX + (int) ((bx - tx * size) / div)];
        }
      }
    }
    List<Cur> cur = new ArrayList<>();
    for (Marker m : v.markers()) {
      if (!dim.equals(m.dim())) continue;
      Cur c = cursor(m.x() - cx, m.z() - cz, zoom, (byte) 0, KINDS.get(m.kind()), m.label());
      if (c != null) cur.add(c);
    }
    if (sn.dim().equals(dim)) {
      Cur c = cursor(sn.x() - cx, sn.z() - cz, zoom, (byte) (((int) Math.floor((((sn.yaw() % 360) + 360) % 360) / 22.5 + 0.5)) & 15), MapCursor.Type.PLAYER, null);
      if (c != null) cur.add(c);
    }
    Frame old = s.frame;
    if (old != null && Arrays.equals(old.px(), px) && old.cur().equals(cur)) return; // nothing changed: no redraw
    BufferedImage img = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
    img.setRGB(0, 0, SIZE, SIZE, px, 0, SIZE);
    s.frame = new Frame(px, img, cur, versions.incrementAndGet());
  }

  /** A cursor unit is half a pixel; null when it falls off the map. */
  private static Cur cursor(double dx, double dz, int zoom, byte dir, MapCursor.Type type, String label) {
    long cx = Math.round(dx / zoom * 2), cz = Math.round(dz / zoom * 2);
    if (cx < -128 || cx > 127 || cz < -128 || cz > 127) return null;
    return new Cur((byte) cx, (byte) cz, dir, type, label);
  }

  /** Marker captions: no colour codes, no control characters, plain letters, digits, space, _ and -, at most 16. */
  static String caption(String s) {
    String t = s.replaceAll("§.?", "").replaceAll("[^\\p{L}\\p{N}_ -]", "").strip();
    return t.length() > 16 ? t.substring(0, 16) : t;
  }

  // ---- tiles -----------------------------------------------------------------------------

  /** Compose thread. A missing, broken or slow tile is blank pixels, and is not asked for again for a minute. */
  private int[] fetch(String id, String map, int lod, long tx, long tz) {
    long now = System.currentTimeMillis();
    synchronized (tiles) {
      Tile t = tiles.get(id);
      if (t != null && t.until() > now) return t.data();
    }
    int[] data = null;
    long ttl = MISS_TTL_MS;
    try {
      HttpResponse<byte[]> r = http.send(HttpRequest.newBuilder(URI.create(base + "/maps/" + map + "/tiles/" + lod + "/x" + tx + "/z" + tz + ".png"))
          .timeout(Duration.ofSeconds(5)).build(), HttpResponse.BodyHandlers.ofByteArray());
      if (r.statusCode() == 200) {
        data = decode(r.body());
        if (data != null) ttl = TILE_TTL_MS;
      }
      fetchWarned.set(false);
    } catch (IOException | RuntimeException e) {
      if (fetchWarned.compareAndSet(false, true)) plugin.getLogger().warning("BlueMap tile fetch failed: " + e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return null;
    }
    synchronized (tiles) {
      tiles.put(id, new Tile(data, System.currentTimeMillis() + ttl));
    }
    return data;
  }

  /** Top 500x500 of the PNG (BlueMap's colour half); a pixel with little alpha stays blank. */
  private static int[] decode(byte[] png) throws IOException {
    BufferedImage img = ImageIO.read(new ByteArrayInputStream(png));
    if (img == null) return null;
    int[] out = new int[TILE_PX * TILE_PX];
    for (int y = 0; y < Math.min(TILE_PX, img.getHeight()); y++) {
      for (int x = 0; x < Math.min(TILE_PX, img.getWidth()); x++) {
        int argb = img.getRGB(x, y);
        if ((argb >>> 24) >= 128) out[y * TILE_PX + x] = argb | 0xFF000000;
      }
    }
    return out;
  }
}
