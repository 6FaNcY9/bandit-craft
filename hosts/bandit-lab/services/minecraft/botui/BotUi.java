package botui;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
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
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandException;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.EquipmentSlot;
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
  private static final long MAP_CLICK_COOLDOWN_MS = 500;

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
        Bukkit.dispatchCommand(Bukkit.createCommandSender(c -> {}), "dialog clear " + p.getName());
      }
      return null;
    });
    reply(x, 200, ok());
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
      String err = viewers.contains(p.getName().toLowerCase(Locale.ROOT)) ? map.give(p) : "Nicht freigeschaltet";
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

  private void onMain(Runnable r) {
    if (Bukkit.isPrimaryThread()) r.run();
    else Bukkit.getScheduler().runTask(this, r);
  }

  private void tryOpen(Player p, String type) {
    if (!viewers.contains(p.getName().toLowerCase(Locale.ROOT))) {
      p.sendMessage(Component.text("Nicht freigeschaltet"));
    } else if (System.currentTimeMillis() - lastPoll > HUB_TIMEOUT_MS) {
      p.sendMessage(Component.text("Hub nicht erreichbar"));
    } else {
      emit(type, p, null);
    }
  }

  @Override
  public boolean onCommand(CommandSender s, Command c, String label, String[] args) {
    if (s instanceof Player p) tryOpen(p, "open");
    return true;
  }

  @EventHandler
  public void onSwap(PlayerSwapHandItemsEvent e) {
    Player p = e.getPlayer();
    if (p.isSneaking() && viewers.contains(p.getName().toLowerCase(Locale.ROOT))) {
      e.setCancelled(true);
      tryOpen(p, "open");
    }
  }

  /** Deprecated as only an approximation of what a click does, but the API offers no replacement. */
  @SuppressWarnings("deprecation")
  private static boolean usable(org.bukkit.block.Block b) {
    return b.getType().isInteractable();
  }

  /** Right click with the tagged map in the main hand: the map dialog instead of the vanilla use; every other map is left alone. */
  @EventHandler
  public void onUse(PlayerInteractEvent e) {
    Player p = e.getPlayer();
    if (e.getHand() != EquipmentSlot.HAND || (e.getAction() != Action.RIGHT_CLICK_AIR && e.getAction() != Action.RIGHT_CLICK_BLOCK)
        || !viewers.contains(p.getName().toLowerCase(Locale.ROOT)) || !map.isMap(p.getInventory().getItemInMainHand())) return;
    // As in vanilla, a click on something usable (door, chest) uses it; sneaking or any other block opens the dialog.
    if (e.getAction() == Action.RIGHT_CLICK_BLOCK && !p.isSneaking() && usable(e.getClickedBlock())) return;
    e.setCancelled(true);
    // Holding the button repeats the click every few ticks.
    long now = System.currentTimeMillis();
    if (now - lastMapClick.getOrDefault(p.getUniqueId(), 0L) < MAP_CLICK_COOLDOWN_MS) return;
    lastMapClick.put(p.getUniqueId(), now);
    tryOpen(p, "mapclick");
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent e) {
    map.join(e.getPlayer());
  }

  @EventHandler
  public void onClick(PlayerCustomClickEvent e) {
    if (!(e.getCommonConnection() instanceof PlayerGameConnection g) || !e.getIdentifier().namespace().equals("botui")) return;
    Player p = g.getPlayer();
    // A modified client can send these without any dialog; each would raytrace on main and push a real event out of the queue.
    if (!viewers.contains(p.getName().toLowerCase(Locale.ROOT))) return;
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
