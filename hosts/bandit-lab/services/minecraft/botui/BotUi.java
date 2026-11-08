package botui;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.destroystokyo.paper.event.player.PlayerRecipeBookClickEvent;
import io.papermc.paper.connection.PlayerGameConnection;
import io.papermc.paper.event.player.PlayerCustomClickEvent;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandException;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryCreativeEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.InventoryView;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MenuType;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.inventory.view.FurnaceView;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.RayTraceResult;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.JSONValue;

/**
 * Bridges dialogs, clicks and gaze between Paper and the bot hub over a loopback HTTP API.
 * JSON uses json-simple (raw collections): it ships with Paper, while Gson is not on the compile classpath.
 */
@SuppressWarnings({"rawtypes", "unchecked"})
public class BotUi extends JavaPlugin implements Listener {
  private static final Pattern NAME = Pattern.compile("^\\w{1,16}$");
  private static final int MAX_BODY = 256 * 1024;
  private static final int MAX_QUEUE = 256;
  private static final int MAX_PAYLOAD = 8192;
  private static final long HUB_TIMEOUT_MS = 40_000;

  /** An outline box in the world it was set in; max corner is inclusive of its block. */
  private record Box(World world, double x1, double y1, double z1, double x2, double y2, double z2) {}

  private final Set<String> viewers = ConcurrentHashMap.newKeySet();
  private final Set<UUID> open = ConcurrentHashMap.newKeySet();
  private final Map<UUID, Box> outlines = new ConcurrentHashMap<>();
  private final ArrayDeque<JSONObject> queue = new ArrayDeque<>();
  private final Object lock = new Object();
  private final AtomicLong ids = new AtomicLong();
  private final String boot = Long.toString(System.currentTimeMillis());
  private volatile long lastPoll = 0;
  private byte[] token;
  private HttpServer http;
  private ExecutorService pool;
  private BotMap map;
  private final Map<UUID, Long> lastMapClick = new HashMap<>(); // main thread only
  private final Map<UUID, Long> lastStaffLog = new HashMap<>(); // main thread only
  private static final long MAP_CLICK_COOLDOWN_MS = 500;
  private NamespacedKey staffKey;

  @Override
  public void onEnable() {
    String pw = "";
    try (InputStream in = Files.newInputStream(Path.of("server.properties"))) {
      Properties p = new Properties();
      p.load(in);
      pw = p.getProperty("rcon.password", "");
    } catch (IOException e) {
      getLogger().severe("cannot read server.properties: " + e);
    }
    if (pw.isEmpty()) {
      getLogger().severe("rcon.password is empty, BotUi stays disabled");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }
    token = pw.getBytes(StandardCharsets.UTF_8);
    int port;
    try {
      port = Integer.parseInt(System.getenv().getOrDefault("BOTUI_PORT", "8101"));
    } catch (NumberFormatException e) {
      getLogger().severe("BOTUI_PORT is not a number, BotUi stays disabled");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }
    try {
      http = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
    } catch (IOException e) {
      getLogger().severe("cannot bind 127.0.0.1:" + port + ": " + e);
      getServer().getPluginManager().disablePlugin(this);
      return;
    }
    http.createContext("/", this::handle);
    pool = Executors.newFixedThreadPool(4);
    http.setExecutor(pool);
    http.start();
    staffKey = new NamespacedKey(this, "staff");
    map = new BotMap(this, viewers::contains, System.getenv().getOrDefault("BOTUI_BLUEMAP", "http://127.0.0.1:8100"));
    map.start();
    getServer().getPluginManager().registerEvents(this, this);
    Bukkit.getScheduler().runTaskTimer(this, this::drawOutlines, 10, 10);
  }

  @Override
  public void onDisable() {
    if (http != null) http.stop(0);
    if (pool != null) pool.shutdownNow();
    if (map != null) map.stop();
  }

  // ---- HTTP -------------------------------------------------------------------------------

  private <T> T sync(Callable<T> c) throws Exception {
    return Bukkit.getScheduler().callSyncMethod(this, c).get(5, TimeUnit.SECONDS);
  }

  private static void reply(HttpExchange x, int status, Object body) throws IOException {
    byte[] b = JSONValue.toJSONString(body).getBytes(StandardCharsets.UTF_8);
    x.getResponseHeaders().set("Content-Type", "application/json");
    x.sendResponseHeaders(status, b.length);
    x.getResponseBody().write(b);
  }

  private static JSONObject error(String msg) {
    JSONObject o = new JSONObject();
    o.put("error", msg);
    return o;
  }

  private static JSONObject ok() {
    JSONObject o = new JSONObject();
    o.put("ok", true);
    return o;
  }

  private void handle(HttpExchange x) throws IOException {
    try (x) {
      String auth = x.getRequestHeaders().getFirst("Authorization");
      if (auth == null
          || !MessageDigest.isEqual(auth.getBytes(StandardCharsets.UTF_8), ("Bearer " + new String(token, StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8))) {
        reply(x, 401, error("unauthorized"));
        return;
      }
      String path = x.getRequestURI().getPath();
      boolean get = x.getRequestMethod().equals("GET");
      if (path.equals("/events") && get) {
        events(x);
        return;
      }
      if (get || !x.getRequestMethod().equals("POST")) {
        reply(x, 404, error("not found"));
        return;
      }
      byte[] raw = x.getRequestBody().readNBytes(MAX_BODY + 1);
      if (raw.length > MAX_BODY || !(JSONValue.parse(new String(raw, StandardCharsets.UTF_8)) instanceof JSONObject body)) {
        reply(x, 400, error("bad body"));
        return;
      }
      switch (path) {
        case "/viewers" -> viewers(x, body);
        case "/show" -> show(x, body);
        case "/close" -> close(x, body);
        case "/menu" -> menu(x, body);
        case "/actionbar" -> actionbar(x, body);
        case "/outline" -> outline(x, body);
        case "/map" -> map(x, body);
        case "/map/give" -> give(x, body);
        default -> reply(x, 404, error("not found"));
      }
    } catch (Exception e) {
      getLogger().warning("request failed: " + e);
      try {
        reply(x, 500, error("internal"));
      } catch (IOException ignored) {
        // connection already gone
      }
    }
  }

  private static String str(JSONObject b, String key) {
    return b.get(key) instanceof String s ? s : null;
  }

  private void viewers(HttpExchange x, JSONObject b) throws IOException {
    List<String> names = new ArrayList<>();
    if (b.get("names") instanceof JSONArray a) {
      for (Object e : a) {
        if (!(e instanceof String n) || !NAME.matcher(n).matches()) {
          reply(x, 400, error("bad name"));
          return;
        }
        names.add(n.toLowerCase(Locale.ROOT));
      }
    } else {
      reply(x, 400, error("names must be an array"));
      return;
    }
    viewers.clear();
    viewers.addAll(names);
    map.retain(viewers);
    reply(x, 200, ok());
  }

  private void show(HttpExchange x, JSONObject b) throws Exception {
    String name = str(b, "player"), dialog = str(b, "dialog");
    if (name == null || dialog == null || !NAME.matcher(name).matches()) {
      reply(x, 400, error("bad player or dialog"));
      return;
    }
    JSONObject res = sync(() -> {
      Player p = Bukkit.getPlayerExact(name);
      if (p == null) return null;
      if (Boolean.TRUE.equals(b.get("refresh")) && !open.contains(p.getUniqueId())) { // a hub refresh must never re-open a closed dialog
        JSONObject closed = new JSONObject();
        closed.put("ok", false);
        closed.put("feedback", "closed");
        return closed;
      }
      boolean wasMenu = closeMenu(p); // a switch, not a close: no event for the hub
      pending.remove(p.getUniqueId());
      List<String> feedback = new ArrayList<>();
      CommandSender s = Bukkit.createCommandSender(c -> feedback.add(PlainTextComponentSerializer.plainText().serialize(c)));
      boolean ran;
      try {
        ran = Bukkit.dispatchCommand(s, "dialog show " + p.getName() + " " + dialog);
      } catch (CommandException e) { // a parse failure throws instead of returning false
        ran = false;
        feedback.add(String.valueOf(e.getCause() != null ? e.getCause().getMessage() : e.getMessage()));
      }
      // A real success prints exactly "Displayed dialog to <name>" (English server locale); anything else is a failure.
      boolean shown = ran && feedback.size() == 1 && feedback.get(0).startsWith("Displayed dialog");
      JSONObject o = new JSONObject();
      o.put("ok", shown);
      o.put("feedback", String.join("\n", feedback));
      if (shown) open.add(p.getUniqueId());
      else if (wasMenu) emit("closed", p, null); // the menu is gone and no dialog replaced it
      return o;
    });
    if (res == null) reply(x, 400, error("player not online"));
    else reply(x, 200, res);
  }

  private void close(HttpExchange x, JSONObject b) throws Exception {
    String name = str(b, "player");
    if (name == null || !NAME.matcher(name).matches()) {
      reply(x, 400, error("bad player"));
      return;
    }
    sync(() -> {
      Player p = Bukkit.getPlayerExact(name);
      if (p != null) {
        open.remove(p.getUniqueId());
        pending.remove(p.getUniqueId());
        closeMenu(p);
        Bukkit.dispatchCommand(Bukkit.createCommandSender(c -> {}), "dialog clear " + p.getName());
      }
      return null;
    });
    reply(x, 200, ok());
  }

  // ---- menus ------------------------------------------------------------------------------

  /** Holder of a hub menu: its top inventory is the marker every handler below checks. */
  private static final class MenuHolder implements InventoryHolder {
    final String type, title;
    final int rows;
    Map<Integer, JSONObject> payloads = new HashMap<>();
    Inventory inv;

    MenuHolder(String type, int rows, String title) {
      this.type = type;
      this.rows = rows;
      this.title = title;
    }

    @Override
    public Inventory getInventory() {
      return inv;
    }
  }

  private final Map<UUID, JSONObject> pending = new ConcurrentHashMap<>(); // a menu waiting for the next tick behind a cleared dialog
  private final Set<UUID> switching = ConcurrentHashMap.newKeySet(); // menus the plugin closes itself: no "closed" event

  private final Map<UUID, MenuHolder> menus = new ConcurrentHashMap<>(); // the menu each player has open: a furnace view has no holder to mark it

  private MenuHolder menuOf(Player p) {
    return menuOf(p.getOpenInventory());
  }

  private MenuHolder menuOf(InventoryView v) {
    MenuHolder h = menus.get(v.getPlayer().getUniqueId());
    return h != null && h.inv == v.getTopInventory() ? h : null;
  }

  private boolean closeMenu(Player p) {
    if (menuOf(p) == null) return false;
    menus.remove(p.getUniqueId());
    switching.add(p.getUniqueId());
    try {
      p.closeInventory();
    } finally {
      switching.remove(p.getUniqueId());
    }
    return true;
  }

  private static boolean whole(Object o, int min, int max) {
    return o instanceof Number n && n.doubleValue() == n.intValue() && n.intValue() >= min && n.intValue() <= max;
  }

  private static boolean textOk(Object o, int max) {
    return o instanceof String t && t.length() <= max;
  }

  private static ItemStack menuItem(JSONObject s) {
    Material m = Material.matchMaterial(str(s, "item"));
    if (m == null || !m.isItem() || m.isAir()) m = Material.PAPER; // an unknown id never fails the whole menu
    ItemStack it = new ItemStack(m);
    ItemMeta meta = it.getItemMeta();
    meta.displayName(Component.text(str(s, "name")).decoration(TextDecoration.ITALIC, false));
    if (s.get("lore") instanceof JSONArray a) {
      List<Component> lore = new ArrayList<>();
      for (Object l : a) lore.add(Component.text((String) l).decoration(TextDecoration.ITALIC, false));
      meta.lore(lore);
    }
    int count = s.get("count") instanceof Number n ? n.intValue() : 1;
    if (s.get("maxDamage") instanceof Number md && md.intValue() > 0 && meta instanceof Damageable d) {
      d.setMaxDamage(md.intValue());
      d.setDamage(Math.max(0, Math.min(md.intValue(), s.get("damage") instanceof Number dm ? dm.intValue() : 0)));
      meta.setMaxStackSize(1);
      count = 1;
    } else if (count > m.getMaxStackSize()) {
      meta.setMaxStackSize(count);
    }
    if (s.get("glint") instanceof Boolean g) meta.setEnchantmentGlintOverride(g);
    if (str(s, "head") instanceof String h && NAME.matcher(h).matches() && meta instanceof SkullMeta sm) {
      Player owner = Bukkit.getPlayerExact(h);
      if (owner != null) sm.setPlayerProfile(owner.getPlayerProfile());
    }
    it.setItemMeta(meta);
    it.setAmount(count);
    return it;
  }

  /** Validated /menu body: update the open menu in place, or open a new one (replacing another menu is a switch, no "closed"). */
  private void applyMenu(Player p, JSONObject b) {
    String type = str(b, "type"), title = str(b, "title");
    boolean hopper = "hopper".equals(type), furnace = "furnace".equals(type);
    int rows = hopper ? 1 : furnace ? 0 : b.get("rows") == null ? 3 : ((Number) b.get("rows")).intValue();
    int size = hopper ? 5 : rows * 9;
    MenuHolder cur = menuOf(p);
    boolean same = cur != null && cur.type.equals(type) && cur.rows == rows && cur.title.equals(title);
    MenuHolder h = same ? cur : new MenuHolder(type, rows, title);
    FurnaceView fv = furnace && !same ? MenuType.FURNACE.builder().title(Component.text(title)).build(p) : null;
    Inventory inv = same ? cur.inv : furnace ? fv.getTopInventory() : hopper ? Bukkit.createInventory(h, InventoryType.HOPPER, Component.text(title)) : Bukkit.createInventory(h, size, Component.text(title));
    h.inv = inv;
    inv.clear();
    Map<Integer, JSONObject> payloads = new HashMap<>();
    for (Object o : (JSONArray) b.get("slots")) {
      JSONObject s = (JSONObject) o;
      int slot = ((Number) s.get("slot")).intValue();
      inv.setItem(slot, menuItem(s));
      payloads.put(slot, (JSONObject) s.get("payload"));
    }
    h.payloads = payloads;
    if (same) return;
    menus.put(p.getUniqueId(), h);
    switching.add(p.getUniqueId());
    try {
      if (fv != null) p.openInventory(fv);
      else p.openInventory(inv);
    } finally {
      switching.remove(p.getUniqueId());
    }
  }

  private void menu(HttpExchange x, JSONObject b) throws Exception {
    String name = str(b, "player"), type = str(b, "type"), title = str(b, "title");
    boolean hopper = "hopper".equals(type), furnace = "furnace".equals(type);
    int rows = hopper ? 1 : furnace ? 3 : b.get("rows") == null ? 3 : whole(b.get("rows"), 1, 6) ? ((Number) b.get("rows")).intValue() : 0;
    int size = hopper ? 5 : furnace ? 3 : rows * 9;
    boolean good = name != null && NAME.matcher(name).matches() && (hopper || furnace || "chest".equals(type)) && rows > 0 && textOk(title, 128) && b.get("slots") instanceof JSONArray;
    if (good) {
      for (Object o : (JSONArray) b.get("slots")) {
        good = o instanceof JSONObject s && whole(s.get("slot"), 0, size - 1) && textOk(s.get("item"), 64) && textOk(s.get("name"), 256)
            && s.get("payload") instanceof JSONObject && (s.get("count") == null || whole(s.get("count"), 1, 99)) && (s.get("head") == null || textOk(s.get("head"), 16))
            && (s.get("lore") == null || s.get("lore") instanceof JSONArray l && l.size() <= 20 && l.stream().allMatch(e -> textOk(e, 256)));
        if (!good) break;
      }
    }
    if (!good) {
      reply(x, 400, error("bad menu"));
      return;
    }
    JSONObject res = sync(() -> {
      Player p = Bukkit.getPlayerExact(name);
      if (p == null) return null;
      UUID id = p.getUniqueId();
      if (Boolean.TRUE.equals(b.get("refresh")) && menuOf(p) == null && !pending.containsKey(id)) { // a hub refresh must never re-open a closed menu
        JSONObject closed = new JSONObject();
        closed.put("ok", false);
        closed.put("feedback", "closed");
        return closed;
      }
      if (pending.containsKey(id)) { // a dialog is being replaced: the newest content wins, the one scheduled open stays the only one
        pending.put(id, b);
      } else if (open.remove(id)) {
        Bukkit.dispatchCommand(Bukkit.createCommandSender(c -> {}), "dialog clear " + p.getName()); // a switch: no "closed" event
        pending.put(id, b);
        Bukkit.getScheduler().runTask(this, () -> {
          JSONObject pb = pending.remove(id);
          if (pb != null && p.isOnline()) applyMenu(p, pb);
        });
      } else {
        applyMenu(p, b);
      }
      return ok();
    });
    if (res == null) reply(x, 400, error("player not online"));
    else reply(x, 200, res);
  }

  private void actionbar(HttpExchange x, JSONObject b) throws Exception {
    String name = str(b, "player");
    if (name == null || !NAME.matcher(name).matches() || !textOk(b.get("text"), 256)) {
      reply(x, 400, error("bad player or text"));
      return;
    }
    boolean found = sync(() -> {
      Player p = Bukkit.getPlayerExact(name);
      if (p != null) p.sendActionBar(Component.text(str(b, "text")));
      return p != null;
    });
    if (found) reply(x, 200, ok());
    else reply(x, 400, error("player not online"));
  }

  // A menu shows display items: nothing may ever move, in either half of the view. Handled even when another plugin cancelled first.
  @EventHandler(priority = EventPriority.HIGHEST)
  public void onMenuClick(InventoryClickEvent e) {
    MenuHolder h = menuOf(e.getView());
    if (h == null) return;
    e.setCancelled(true);
    ClickType t = e.getClick();
    if (e.getClickedInventory() != e.getView().getTopInventory()) return;
    if (t != ClickType.LEFT && t != ClickType.RIGHT && t != ClickType.SHIFT_LEFT && t != ClickType.SHIFT_RIGHT) return;
    JSONObject payload = h.payloads.get(e.getSlot());
    if (payload == null || !(e.getWhoClicked() instanceof Player p)) return;
    JSONObject data = new JSONObject(payload);
    data.put("shift", t.isShiftClick());
    emit("click", p, data);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void onMenuCreative(InventoryCreativeEvent e) {
    if (menuOf(e.getView()) != null) e.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void onMenuDrag(InventoryDragEvent e) {
    if (menuOf(e.getView()) != null) e.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void onRecipeBook(PlayerRecipeBookClickEvent e) {
    if (menuOf(e.getPlayer()) != null) e.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onMenuClose(InventoryCloseEvent e) {
    MenuHolder h = menuOf(e.getView());
    if (h == null || !(e.getPlayer() instanceof Player p)) return;
    menus.remove(p.getUniqueId(), h);
    if (switching.contains(p.getUniqueId()) || e.getReason() == InventoryCloseEvent.Reason.DISCONNECT) return; // OPEN_NEW from anything but our own switch is another plugin's
    emit("closed", p, null);
  }

  private void outline(HttpExchange x, JSONObject b) throws Exception {
    String name = str(b, "player");
    if (name == null || !NAME.matcher(name).matches()) {
      reply(x, 400, error("bad player"));
      return;
    }
    if (!b.containsKey("box")) {
      reply(x, 400, error("bad box"));
      return;
    }
    double[] box6 = null;
    if (b.get("box") != null) {
      box6 = new double[6];
      String[] keys = {"x1", "y1", "z1", "x2", "y2", "z2"};
      for (int i = 0; i < 6; i++) {
        if (!(b.get("box") instanceof JSONObject o) || !(o.get(keys[i]) instanceof Number n)) {
          reply(x, 400, error("bad box"));
          return;
        }
        box6[i] = n.doubleValue();
      }
    }
    double[] fixed = box6;
    boolean found = sync(() -> {
      Player p = Bukkit.getPlayerExact(name);
      if (p == null) return false;
      if (fixed == null) outlines.remove(p.getUniqueId());
      else outlines.put(p.getUniqueId(), new Box(p.getWorld(),
          Math.min(fixed[0], fixed[3]), Math.min(fixed[1], fixed[4]), Math.min(fixed[2], fixed[5]),
          Math.max(fixed[0], fixed[3]) + 1, Math.max(fixed[1], fixed[4]) + 1, Math.max(fixed[2], fixed[5]) + 1));
      return true;
    });
    if (found) reply(x, 200, ok());
    else reply(x, 400, error("player not online"));
  }

  private static final Set<Integer> ZOOMS = Set.of(1, 2, 5, 10, 25, 50);
  private static final Set<String> KINDS = Set.of("work", "idle", "bad", "off");

  /** The viewer's whole map view; a repeat of the last one, or one for an offline player, costs nothing. */
  private void map(HttpExchange x, JSONObject b) throws IOException {
    String name = str(b, "player");
    if (name == null || !NAME.matcher(name).matches() || !(b.get("zoom") instanceof Number z) || !ZOOMS.contains(z.intValue()) || z.doubleValue() != z.intValue()
        || !(b.get("markers") instanceof JSONArray ms)) {
      reply(x, 400, error("bad map"));
      return;
    }
    BotMap.Center center = null;
    if (b.get("center") != null) {
      if (!(b.get("center") instanceof JSONObject c) || !(c.get("x") instanceof Number cx) || !(c.get("z") instanceof Number cz)
          || !(c.get("dim") == null || c.get("dim") instanceof String)) {
        reply(x, 400, error("bad center"));
        return;
      }
      center = new BotMap.Center(cx.doubleValue(), cz.doubleValue(), (String) c.get("dim"));
    }
    List<BotMap.Marker> markers = new ArrayList<>();
    for (Object o : ms) {
      if (!(o instanceof JSONObject m) || !(m.get("x") instanceof Number mx) || !(m.get("z") instanceof Number mz) || !(m.get("dim") instanceof String dim)
          || !(m.get("kind") instanceof String kind) || !KINDS.contains(kind) || !(m.get("label") instanceof String label)) {
        reply(x, 400, error("bad marker"));
        return;
      }
      if (markers.size() < BotMap.MAX_MARKERS) markers.add(new BotMap.Marker(mx.doubleValue(), mz.doubleValue(), dim, kind, BotMap.caption(label)));
    }
    map.set(name, new BotMap.View(z.intValue(), center, markers));
    reply(x, 200, ok());
  }

  private void give(HttpExchange x, JSONObject b) throws Exception {
    String name = str(b, "player");
    if (name == null || !NAME.matcher(name).matches()) {
      reply(x, 400, error("bad player"));
      return;
    }
    JSONObject res = sync(() -> {
      Player p = Bukkit.getPlayerExact(name);
      if (p == null) return null;
      JSONObject o = new JSONObject();
      String err = isViewer(p) ? map.give(p) : "Nicht freigeschaltet";
      o.put("ok", err == null);
      if (err != null) o.put("error", err);
      return o;
    });
    if (res == null) reply(x, 400, error("player not online"));
    else reply(x, 200, res);
  }

  private void events(HttpExchange x) throws Exception {
    Map<String, String> q = new HashMap<>();
    String rawQuery = x.getRequestURI().getRawQuery();
    if (rawQuery != null) {
      for (String kv : rawQuery.split("&")) {
        String[] p = kv.split("=", 2);
        if (p.length == 2) q.put(p[0], URLDecoder.decode(p[1], StandardCharsets.UTF_8));
      }
    }
    long since, waitS;
    try {
      since = Long.parseLong(q.getOrDefault("since", "0"));
      waitS = Math.min(25, Math.max(0, Long.parseLong(q.getOrDefault("wait", "0"))));
    } catch (NumberFormatException e) {
      reply(x, 400, error("bad query"));
      return;
    }
    lastPoll = System.currentTimeMillis();
    JSONArray out = new JSONArray();
    long last;
    synchronized (lock) {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(waitS);
      if (since > ids.get()) since = 0; // hub is ahead of us: we restarted, hand over everything
      while (ids.get() <= since) {
        long left = deadline - System.nanoTime();
        if (left <= 0) break;
        lock.wait(left / 1_000_000, (int) (left % 1_000_000));
      }
      last = ids.get();
      for (JSONObject e : queue) if ((Long) e.get("id") > since) out.add(e);
    }
    lastPoll = System.currentTimeMillis();
    JSONObject o = new JSONObject();
    o.put("boot", boot);
    o.put("last", last);
    o.put("events", out);
    reply(x, 200, o);
  }

  // ---- events -----------------------------------------------------------------------------

  /** Queue an event for the hub; must run on the main thread (reads the world). */
  private void emit(String type, Player p, JSONObject data) {
    JSONObject e = new JSONObject();
    Location l = p.getLocation();
    JSONArray pos = new JSONArray();
    pos.add(l.getBlockX());
    pos.add(l.getBlockY());
    pos.add(l.getBlockZ());
    RayTraceResult r = p.rayTraceBlocks(128, FluidCollisionMode.NEVER);
    JSONObject gaze = null;
    if (r != null && r.getHitBlock() != null) {
      JSONObject g = new JSONObject();
      g.put("x", r.getHitBlock().getX());
      g.put("y", r.getHitBlock().getY());
      g.put("z", r.getHitBlock().getZ());
      g.put("block", blockKey(r.getHitBlock().getBlockData().getAsString(false)));
      gaze = g;
    }
    Entity t = p.getTargetEntity(32);
    if (t != null) {
      JSONObject en = new JSONObject();
      en.put("type", t.getType().getKey().getKey());
      en.put("name", t instanceof Player tp ? tp.getName() : null);
      en.put("x", t.getLocation().getBlockX());
      en.put("y", t.getLocation().getBlockY());
      en.put("z", t.getLocation().getBlockZ());
      if (gaze == null) { // the hub reads a gaze only with a block string
        gaze = new JSONObject();
        gaze.put("x", en.get("x"));
        gaze.put("y", en.get("y"));
        gaze.put("z", en.get("z"));
        gaze.put("block", "air");
      }
      gaze.put("entity", en);
    }
    synchronized (lock) {
      e.put("id", ids.incrementAndGet());
      e.put("type", type);
      e.put("player", p.getName());
      e.put("pos", pos);
      e.put("dim", p.getWorld().getKey().getKey());
      e.put("yaw", l.getYaw());
      e.put("gaze", gaze);
      if (data != null) e.put("data", data);
      queue.add(e);
      while (queue.size() > MAX_QUEUE) queue.poll();
      lock.notifyAll();
    }
  }

  /** "minecraft:oak_log[axis=y]" -> "oak_log" (Material's annotations do not compile without jetbrains-annotations). */
  private static String blockKey(String data) {
    int b = data.indexOf('[');
    String id = b < 0 ? data : data.substring(0, b);
    return id.substring(id.indexOf(':') + 1);
  }

  private boolean isViewer(Player p) {
    return viewers.contains(p.getName().toLowerCase(Locale.ROOT));
  }

  private void onMain(Runnable r) {
    if (Bukkit.isPrimaryThread()) r.run();
    else Bukkit.getScheduler().runTask(this, r);
  }

  private void tryOpen(Player p, String type) {
    if (!isViewer(p)) {
      p.sendMessage(Component.text("Nicht freigeschaltet"));
    } else if (System.currentTimeMillis() - lastPoll > HUB_TIMEOUT_MS) {
      p.sendMessage(Component.text("Hub nicht erreichbar"));
    } else {
      emit(type, p, null);
    }
  }

  @Override
  public boolean onCommand(CommandSender s, Command c, String label, String[] args) {
    if (!(s instanceof Player p)) return true;
    if (!c.getName().equals("zauberstab")) tryOpen(p, "lage"); // /bots is the overview; the staff and Shift + F open what they point at
    else if (!isViewer(p)) p.sendMessage(Component.text("Nicht freigeschaltet"));
    else {
      PlayerInventory inv = p.getInventory();
      int slot = inv.getHeldItemSlot();
      ItemStack cur = inv.getItem(slot);
      boolean occupied = cur != null && !cur.getType().isAir();
      if (occupied && isStaff(cur)) {
        p.sendMessage(Component.text(HAND_HINT));
      } else if (occupied && inv.firstEmpty() == -1) {
        p.sendMessage(Component.text("Inventar voll"));
      } else {
        if (occupied) inv.addItem(cur); // lands in a free slot, the hand slot is still taken
        inv.setItem(slot, staff());
        p.sendMessage(Component.text(HAND_HINT));
      }
    }
    return true;
  }

  private static final String HAND_HINT = "Der Zauberstab ist jetzt in deiner Hand. Linksklick: Übersicht · Rechtsklick: auf etwas zeigen";

  /** Why a click with this hand does not count as a staff click, or null when it does (main-hand staff, or off-hand staff with none in the main hand). */
  private String staffReject(Player p, EquipmentSlot hand) {
    if (!isViewer(p)) return "not viewer";
    ItemStack main = p.getInventory().getItemInMainHand();
    if (hand == EquipmentSlot.HAND) return isStaff(main) ? null : "no staff in main hand (" + main.getType() + ", tagged=" + isStaff(main) + ")";
    return hand == EquipmentSlot.OFF_HAND && !isStaff(main) && isStaff(p.getInventory().getItemInOffHand()) ? null : "offhand";
  }

  private boolean holdsStick(Player p, EquipmentSlot hand) {
    // the main-hand event of an off-hand-only staff click is not a failure: the off-hand event follows and opens
    if (hand == EquipmentSlot.HAND && isStaff(p.getInventory().getItemInOffHand())) return false;
    return p.getInventory().getItemInMainHand().getType() == Material.STICK || p.getInventory().getItemInOffHand().getType() == Material.STICK;
  }

  /** Ignored lines: one per player per 2 s. Opened lines always log (so an open is never hidden) and restart the window. */
  private void staffLog(Player p, Action a, EquipmentSlot hand, String what) {
    long now = System.currentTimeMillis();
    boolean opened = what.startsWith("opened");
    if (!opened && now - lastStaffLog.getOrDefault(p.getUniqueId(), 0L) < 2000) return;
    lastStaffLog.put(p.getUniqueId(), now);
    getLogger().info("staff: " + p.getName() + " " + a + " " + hand + " " + what);
  }

  private ItemStack staff() {
    ItemStack i = new ItemStack(Material.STICK);
    ItemMeta m = i.getItemMeta();
    m.displayName(Component.text("Zauberstab", NamedTextColor.DARK_PURPLE).decoration(TextDecoration.ITALIC, false));
    m.lore(List.of(Component.text("Linksklick: Übersicht · Rechtsklick: auf etwas zeigen", NamedTextColor.GRAY).decoration(TextDecoration.ITALIC, false)));
    m.getPersistentDataContainer().set(staffKey, PersistentDataType.BYTE, (byte) 1);
    i.setItemMeta(m);
    return i;
  }

  private boolean isStaff(ItemStack i) {
    return i != null && i.hasItemMeta() && i.getItemMeta().getPersistentDataContainer().has(staffKey, PersistentDataType.BYTE);
  }

  @EventHandler
  public void onSwap(PlayerSwapHandItemsEvent e) {
    Player p = e.getPlayer();
    if (p.isSneaking() && isViewer(p)) {
      e.setCancelled(true);
      tryOpen(p, "open");
    }
  }

  /** Deprecated as only an approximation of what a click does, but the API offers no replacement. */
  @SuppressWarnings("deprecation")
  private static boolean usable(org.bukkit.block.Block b) {
    return b.getType().isInteractable();
  }

  /** Left click with the staff: the situation report. */
  @EventHandler
  public void onLeft(PlayerInteractEvent e) {
    Player p = e.getPlayer();
    if (e.getAction() != Action.LEFT_CLICK_AIR && e.getAction() != Action.LEFT_CLICK_BLOCK) return;
    String why = staffReject(p, e.getHand());
    if (why != null) {
      if (holdsStick(p, e.getHand())) staffLog(p, e.getAction(), e.getHand(), "ignored: " + why);
      return;
    }
    e.setCancelled(true);
    staffLog(p, e.getAction(), e.getHand(), "opened lage");
    tryOpen(p, "lage");
  }

  /** Right click with the tagged map or the staff in the main hand: the dialog instead of the vanilla use; every other map is left alone. */
  @EventHandler
  public void onUse(PlayerInteractEvent e) {
    Player p = e.getPlayer();
    ItemStack held = p.getInventory().getItemInMainHand();
    if (e.getAction() != Action.RIGHT_CLICK_AIR && e.getAction() != Action.RIGHT_CLICK_BLOCK) return;
    boolean isMap = e.getHand() == EquipmentSlot.HAND && map.isMap(held);
    String why = isMap && isViewer(p) ? null : staffReject(p, e.getHand());
    if (why != null) {
      if (holdsStick(p, e.getHand())) staffLog(p, e.getAction(), e.getHand(), "ignored: " + why);
      return;
    }
    // As in vanilla, a click on something usable (door, chest) uses it; sneaking or any other block opens the dialog.
    if (e.getAction() == Action.RIGHT_CLICK_BLOCK && !p.isSneaking() && usable(e.getClickedBlock())) return;
    e.setCancelled(true);
    // Holding the button repeats the click every few ticks.
    long now = System.currentTimeMillis();
    if (now - lastMapClick.getOrDefault(p.getUniqueId(), 0L) < MAP_CLICK_COOLDOWN_MS) return;
    lastMapClick.put(p.getUniqueId(), now);
    if (!isMap) staffLog(p, e.getAction(), e.getHand(), "opened open");
    tryOpen(p, isMap ? "mapclick" : "open");
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent e) {
    map.join(e.getPlayer());
    if (isViewer(e.getPlayer())) emit("join", e.getPlayer(), null);
  }

  @EventHandler
  public void onClick(PlayerCustomClickEvent e) {
    if (!(e.getCommonConnection() instanceof PlayerGameConnection g) || !e.getIdentifier().namespace().equals("botui")) return;
    Player p = g.getPlayer();
    // A modified client can send these without any dialog; each would raytrace on main and push a real event out of the queue.
    if (!isViewer(p)) return;
    JSONObject data = new JSONObject();
    if (e.getTag() != null) {
      String snbt = e.getTag().string();
      if (snbt.length() > MAX_PAYLOAD) return;
      try {
        flatten(snbt, data);
      } catch (RuntimeException ex) {
        // malformed tail: keep what was read so far
      }
    }
    if ("close".equals(data.get("a"))) open.remove(p.getUniqueId());
    onMain(() -> emit("click", p, data));
  }

  /**
   * Flat SNBT compound to JSON: strings stay strings, numbers and bytes become numbers, nested values are dropped.
   * (adventure-nbt is not on the compile classpath, so this is a small hand parser.)
   */
  static void flatten(String s, JSONObject out) {
    int i = s.indexOf('{') + 1;
    while (i > 0 && i < s.length()) {
      while (i < s.length() && (s.charAt(i) == ',' || s.charAt(i) == ' ')) i++;
      if (i >= s.length() || s.charAt(i) == '}') return;
      int[] end = new int[1];
      String key = token(s, i, end);
      i = end[0];
      if (i >= s.length() || s.charAt(i) != ':') return;
      char c = s.charAt(++i);
      if (c == '{' || c == '[') { // skip a nested value, honouring quotes
        int depth = 0;
        for (; i < s.length(); i++) {
          char d = s.charAt(i);
          if (d == '"' || d == '\'') {
            token(s, i, end); // jump over the string
            i = end[0] - 1;
          } else if (d == '{' || d == '[') depth++;
          else if (d == '}' || d == ']') { if (--depth == 0) { i++; break; } }
        }
        continue;
      }
      boolean quoted = c == '"' || c == '\'';
      String v = token(s, i, end);
      i = end[0];
      if (quoted) out.put(key, v);
      else if (v.equals("true") || v.equals("false")) out.put(key, v.equals("true") ? 1L : 0L);
      else {
        try {
          char last = v.charAt(v.length() - 1);
          boolean fp = "fFdD".indexOf(last) >= 0;
          String num = fp || "bBsSlL".indexOf(last) >= 0 ? v.substring(0, v.length() - 1) : v;
          if (fp || num.contains(".")) out.put(key, Double.parseDouble(num));
          else out.put(key, Long.parseLong(num));
        } catch (RuntimeException ex) {
          out.put(key, v); // an unquoted word: keep it as a string
        }
      }
    }
  }

  /** Reads a quoted (backslash escapes) or bare token starting at i; end[0] is the index after it. */
  private static String token(String s, int i, int[] end) {
    StringBuilder b = new StringBuilder();
    char q = s.charAt(i);
    if (q == '"' || q == '\'') {
      for (i++; i < s.length() && s.charAt(i) != q; i++) {
        if (s.charAt(i) == '\\' && i + 1 < s.length()) i++;
        b.append(s.charAt(i));
      }
      end[0] = i + 1;
    } else {
      while (i < s.length() && ",:}] ".indexOf(s.charAt(i)) < 0) b.append(s.charAt(i++));
      end[0] = i;
    }
    return b.toString();
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onMove(PlayerMoveEvent e) {
    Player p = e.getPlayer();
    if (!open.contains(p.getUniqueId())) return;
    Location a = e.getFrom(), b = e.getTo();
    if (a.getBlockX() != b.getBlockX() || a.getBlockY() != b.getBlockY() || a.getBlockZ() != b.getBlockZ()
        || a.getYaw() != b.getYaw() || a.getPitch() != b.getPitch()) {
      open.remove(p.getUniqueId());
      emit("closed", p, null);
    }
  }

  // These take a dialog off the screen without its exit action and the move handler never sees them, so without this the next refresh would bring it back.
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onDeath(PlayerDeathEvent e) {
    gone(e.getEntity());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onTeleport(PlayerTeleportEvent e) {
    gone(e.getPlayer());
  }

  @EventHandler
  public void onWorldChange(PlayerChangedWorldEvent e) {
    gone(e.getPlayer());
  }

  private void gone(Player p) {
    if (open.remove(p.getUniqueId())) emit("closed", p, null);
  }

  @EventHandler
  public void onQuit(PlayerQuitEvent e) {
    open.remove(e.getPlayer().getUniqueId());
    pending.remove(e.getPlayer().getUniqueId());
    menus.remove(e.getPlayer().getUniqueId());
    outlines.remove(e.getPlayer().getUniqueId());
    map.quit(e.getPlayer());
    lastMapClick.remove(e.getPlayer().getUniqueId());
    emit("quit", e.getPlayer(), null);
  }

  // ---- outline ----------------------------------------------------------------------------

  private void drawOutlines() {
    outlines.forEach((id, b) -> {
      Player p = Bukkit.getPlayer(id);
      if (p == null || !p.getWorld().equals(b.world())) return;
      Location l = p.getLocation();
      double dx = Math.max(Math.max(b.x1() - l.getX(), l.getX() - b.x2()), 0);
      double dy = Math.max(Math.max(b.y1() - l.getY(), l.getY() - b.y2()), 0);
      double dz = Math.max(Math.max(b.z1() - l.getZ(), l.getZ() - b.z2()), 0);
      if (dx * dx + dy * dy + dz * dz > 96 * 96) return;
      double[] xs = {b.x1(), b.x2()}, ys = {b.y1(), b.y2()}, zs = {b.z1(), b.z2()};
      for (double y : ys) for (double z : zs) edge(p, b.world(), xs[0], y, z, xs[1], y, z);
      for (double x : xs) for (double z : zs) edge(p, b.world(), x, ys[0], z, x, ys[1], z);
      for (double x : xs) for (double y : ys) edge(p, b.world(), x, y, zs[0], x, y, zs[1]);
    });
  }

  private static void edge(Player p, World w, double x1, double y1, double z1, double x2, double y2, double z2) {
    double len = Math.abs(x2 - x1) + Math.abs(y2 - y1) + Math.abs(z2 - z1);
    int n = (int) Math.min(32, Math.floor(len) + 1); // a full-size box stays near 400 particles per draw
    for (int i = 0; i < n; i++) {
      double t = n == 1 ? 0 : (double) i / (n - 1);
      p.spawnParticle(Particle.END_ROD, new Location(w, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t), 1, 0, 0, 0, 0);
    }
  }
}
