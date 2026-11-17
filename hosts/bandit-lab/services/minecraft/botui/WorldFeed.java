package botui;

import com.sun.net.httpserver.HttpExchange;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.ChunkSnapshot;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockState;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.event.block.BlockFormEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockGrowEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPistonEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.BlockSpreadEvent;
import org.bukkit.event.block.LeavesDecayEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.world.ChunkUnloadEvent;
import org.bukkit.event.world.StructureGrowEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * Feeds the hub's world model from the main world: block events mark chunks in a {@link FeedQueue}, a 1-tick drain takes
 * ChunkSnapshots on the main thread, one encoder thread turns them into section records, and the hub long-polls the frames.
 * Threads: events, drain and load callbacks on the main thread; the encoder "botui-world"; HTTP handlers on BotUi's pool.
 */
final class WorldFeed implements Listener {
    static final long TICK_BUDGET_NANOS = 1_000_000;
    static final int SWEEP_PER_SEC = 6, IMPORT_PER_SEC = 20;
    private static final int ENCODER_BACKLOG = 64; // ChunkSnapshots are large: the drain hands out no work while this many wait
    private static final int SY_MIN = -4, SY_MAX = 19, Y_MIN = -64, Y_MAX = 319, PULL_WAIT_MAX_S = 25, DIRTY_MAX_CHUNKS = 4096;
    private static final int SAMPLE_MAX = 2000, SAMPLE_SECTIONS = 25, SAMPLE_TIMEOUT_S = 30, MAX_BODY = 4096;
    private static final String[] BOX_KEYS = {"x1", "y1", "z1", "x2", "y2", "z2"};

    private final Plugin plugin;
    private final World world;
    private final long boot;
    private final FeedQueue queue;
    private final ExecutorService encoder = Executors.newSingleThreadExecutor(Thread.ofPlatform().name("botui-world").daemon().factory());
    private final HashMap<String, String> stripped = new HashMap<>(); // encoder thread only
    private final AtomicInteger waiting = new AtomicInteger(); // snapshots handed to the encoder and not finished
    private final AtomicLong encodeNanos = new AtomicLong(), failed = new AtomicLong(), sent = new AtomicLong();
    private volatile boolean stopped;
    private volatile int[] area; // cx1, cz1, cx2, cz2 of the last pull; null before the first
    // Written by the main thread only, read by the stats handler.
    private volatile long snapshots;
    private volatile int loadedInArea;
    private volatile double mainMsLastMinute, maxTickMs, encodeMsLastMinute;
    // Main thread only.
    private BukkitTask task;
    private FeedQueue.Work parked; // an unloaded chunk waiting for the next second's load budget
    private int loadWindow, loads, sweepAt;
    private long minuteAt, mainNanos, maxTickNanos;

    WorldFeed(Plugin plugin, World world, long boot) {
        this.plugin = plugin;
        this.world = world;
        this.boot = boot;
        this.queue = new FeedQueue(boot);
    }

    void start() {
        Bukkit.getPluginManager().registerEvents(this, plugin);
        minuteAt = System.nanoTime();
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1, 1);
    }

    /** Main thread (onDisable). Waits at most 2 s for the encoder to finish the chunk it is on. */
    void stop() {
        stopped = true;
        if (task != null) task.cancel();
        HandlerList.unregisterAll(this);
        encoder.shutdownNow();
        try {
            encoder.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // ---- main thread ------------------------------------------------------------------------

    private void tick() {
        long t0 = System.nanoTime();
        int tick = Bukkit.getCurrentTick();
        if (tick - loadWindow >= 20) {
            loadWindow = tick;
            loads = 0;
            sweep();
        }
        while (System.nanoTime() - t0 < TICK_BUDGET_NANOS && waiting.get() < ENCODER_BACKLOG) {
            FeedQueue.Work w = parked != null ? parked : queue.next(tick);
            parked = null;
            if (w == null) break;
            if (world.isChunkLoaded(w.cx(), w.cz())) snapshot(w, world.getChunkAt(w.cx(), w.cz()));
            else if (loads >= IMPORT_PER_SEC) {
                parked = w;
                break;
            } else {
                loads++;
                load(w);
            }
        }
        long now = System.nanoTime(), dt = now - t0;
        mainNanos += dt;
        maxTickNanos = Math.max(maxTickNanos, dt);
        if (now - minuteAt >= 60_000_000_000L) {
            minuteAt = now;
            mainMsLastMinute = mainNanos / 1e6;
            maxTickMs = maxTickNanos / 1e6;
            encodeMsLastMinute = encodeNanos.getAndSet(0) / 1e6;
            mainNanos = 0;
            maxTickNanos = 0;
        }
    }

    /** Once a second: SWEEP_PER_SEC loaded chunks of the area, round-robin, so a change no event saw heals. */
    private void sweep() {
        List<Chunk> in = new ArrayList<>();
        for (Chunk c : world.getLoadedChunks()) if (queue.inArea(c.getX(), c.getZ())) in.add(c);
        loadedInArea = in.size();
        for (int i = 0; i < Math.min(SWEEP_PER_SEC, in.size()); i++) {
            sweepAt = (sweepAt + 1) % in.size();
            queue.offerSweep(in.get(sweepAt).getX(), in.get(sweepAt).getZ());
        }
    }

    /** Paper completes the future on the main thread, so the snapshot is taken in the callback and the chunk needs no ticket. */
    private void load(FeedQueue.Work w) {
        world.getChunkAtAsync(w.cx(), w.cz(), false).whenComplete((c, err) -> {
            if (stopped) return;
            long t0 = System.nanoTime();
            int tick = Bukkit.getCurrentTick();
            if (err != null) fail(w, err);
            else if (c == null) encoder.execute(() -> queue.done(w, tick, List.of(new FeedQueue.Rec(1, w.cx(), 0, w.cz(), null, null))));
            else snapshot(w, c);
            mainNanos += System.nanoTime() - t0;
        });
    }

    private void snapshot(FeedQueue.Work w, Chunk c) {
        int tick = Bukkit.getCurrentTick(); // done() needs the tick the snapshot was taken at, not when the encoder finished
        ChunkSnapshot s;
        try {
            s = c.getChunkSnapshot(false, false, false);
        } catch (RuntimeException e) {
            fail(w, e);
            return;
        }
        snapshots++;
        waiting.incrementAndGet();
        encoder.execute(() -> {
            try {
                encode(w, tick, s);
            } catch (RuntimeException e) {
                fail(w, e);
            } finally {
                waiting.decrementAndGet();
            }
        });
    }

    /** Never done() on a failure: a newer tick with no records would hide an older real snapshot. The chunk comes back as a sweep. */
    private void fail(FeedQueue.Work w, Throwable e) {
        if (failed.incrementAndGet() <= 10) plugin.getLogger().warning("world feed: chunk " + w.cx() + "," + w.cz() + " failed: " + e);
        queue.offerSweep(w.cx(), w.cz());
    }

    // ---- encoder thread ---------------------------------------------------------------------

    private void encode(FeedQueue.Work w, int tick, ChunkSnapshot s) {
        long t0 = System.nanoTime();
        List<FeedQueue.Rec> recs = new ArrayList<>(SY_MAX - SY_MIN + 1);
        String[] cells = new String[SectionCodec.CELLS];
        for (int sy = SY_MIN; sy <= SY_MAX; sy++) {
            for (int i = 0; i < SectionCodec.CELLS; i++) // cell i = (y << 8) | (z << 4) | x, local 0..15; the snapshot takes world y
                cells[i] = stripped.computeIfAbsent(s.getBlockData(i & 15, sy * 16 + (i >> 8), (i >> 4) & 15).getAsString(), SectionCodec::strip);
            byte[] blob = SectionCodec.encode(cells);
            recs.add(new FeedQueue.Rec(0, w.cx(), sy, w.cz(), SectionCodec.hash(blob), blob));
        }
        queue.done(w, tick, recs);
        encodeNanos.addAndGet(System.nanoTime() - t0);
    }

    // ---- events (main thread): only marks ---------------------------------------------------

    private void mark(Block b) {
        if (world.equals(b.getWorld())) queue.mark(FeedQueue.chunkOf(b.getX()), FeedQueue.chunkOf(b.getZ()), Bukkit.getCurrentTick());
    }

    private void mark(BlockState b) {
        if (world.equals(b.getWorld())) queue.mark(FeedQueue.chunkOf(b.getX()), FeedQueue.chunkOf(b.getZ()), Bukkit.getCurrentTick());
    }

    /** A block and both neighbours on the piston's axis: covers the destination whichever way the event names the direction. */
    private void markAxis(Block b, BlockFace f) {
        mark(b);
        mark(b.getRelative(f));
        mark(b.getRelative(f.getOppositeFace()));
    }

    private void piston(BlockPistonEvent e, List<Block> moved) {
        markAxis(e.getBlock(), e.getDirection());
        for (Block b : moved) markAxis(b, e.getDirection());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockPlaceEvent e) {
        mark(e.getBlock());
        if (e instanceof BlockMultiPlaceEvent m) for (BlockState b : m.getReplacedBlockStates()) mark(b); // a bed's other half can sit in the next chunk
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockBreakEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockExplodeEvent e) {
        mark(e.getBlock());
        for (Block b : e.blockList()) mark(b);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(EntityExplodeEvent e) {
        for (Block b : e.blockList()) mark(b);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockPistonExtendEvent e) {
        piston(e, e.getBlocks());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockPistonRetractEvent e) {
        piston(e, e.getBlocks());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockFromToEvent e) {
        mark(e.getBlock());
        mark(e.getToBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockGrowEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockFormEvent e) {
        mark(e.getBlock());
    }

    // BlockSpreadEvent has a HandlerList of its own, so the BlockFormEvent handler never sees it.
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockSpreadEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockFadeEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(BlockBurnEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(LeavesDecayEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(EntityChangeBlockEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(StructureGrowEvent e) {
        mark(e.getLocation().getBlock());
        for (BlockState b : e.getBlocks()) mark(b);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(PlayerBucketEmptyEvent e) {
        mark(e.getBlock());
        mark(e.getBlockClicked());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void on(PlayerBucketFillEvent e) {
        mark(e.getBlock());
        mark(e.getBlockClicked());
    }

    /** A dirty chunk leaving memory is snapshotted now when the queue would take it; otherwise its mark stays and the drain loads it later. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void on(ChunkUnloadEvent e) {
        Chunk c = e.getChunk();
        if (!world.equals(e.getWorld()) || !queue.dirty(c.getX(), c.getZ()) || queue.outboxSize() >= FeedQueue.OUTBOX_MAX || waiting.get() >= ENCODER_BACKLOG) return;
        long t0 = System.nanoTime();
        snapshot(new FeedQueue.Work(c.getX(), c.getZ(), FeedQueue.Kind.DIRTY), c);
        mainNanos += System.nanoTime() - t0;
    }

    // ---- HTTP (BotUi's pool) ----------------------------------------------------------------

    void handle(HttpExchange x, String path) throws Exception {
        String method;
        switch (path) {
            case "/world/pull", "/world/sample", "/world/stats" -> method = "GET";
            case "/world/dirty" -> method = "POST";
            default -> {
                BotUi.reply(x, 404, BotUi.error("not found"));
                return;
            }
        }
        if (!x.getRequestMethod().equals(method)) {
            BotUi.reply(x, 405, BotUi.error("method not allowed"));
            return;
        }
        Map<String, String> q = new HashMap<>();
        String raw = x.getRequestURI().getRawQuery();
        try {
            if (raw != null) for (String kv : raw.split("&")) {
                String[] p = kv.split("=", 2);
                if (p.length == 2) q.put(p[0], URLDecoder.decode(p[1], StandardCharsets.UTF_8));
            }
            switch (path) {
                case "/world/pull" -> pull(x, Long.parseLong(q.get("ack")), Integer.parseInt(q.get("wait")), ints(q.get("area"), 4));
                case "/world/sample" -> sample(x, Integer.parseInt(q.get("n")), q.containsKey("seed") ? Long.parseLong(q.get("seed")) : System.nanoTime(),
                    q.containsKey("box") ? ints(q.get("box"), 6) : null);
                case "/world/dirty" -> dirty(x);
                default -> stats(x);
            }
        } catch (IllegalArgumentException e) { // NumberFormatException included; thrown before any reply is sent
            BotUi.reply(x, 400, BotUi.error("bad query: " + e.getMessage()));
        }
    }

    private static int[] ints(String s, int n) {
        String[] p = s == null ? new String[0] : s.split(",", -1);
        if (p.length != n) throw new IllegalArgumentException("need " + n + " comma-separated ints");
        int[] v = new int[n];
        for (int i = 0; i < n; i++) v[i] = Integer.parseInt(p[i].trim());
        return v;
    }

    private void pull(HttpExchange x, long ack, int wait, int[] a) throws Exception {
        if (a[0] > a[2] || a[1] > a[3]) throw new IllegalArgumentException("area needs cx1 <= cx2 and cz1 <= cz2");
        queue.setArea(a[0], a[1], a[2], a[3]);
        area = a;
        byte[] f = queue.batch(ack);
        if (f.length == 15) { // empty frame: wait without a lock, then build one more (every batch() call takes a batch id)
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(Math.max(0, Math.min(wait, PULL_WAIT_MAX_S)));
            while (queue.outboxSize() == 0 && System.nanoTime() < end) Thread.sleep(100);
            f = queue.batch(ack);
        }
        sent.addAndGet((f[13] & 0xFF) | (f[14] & 0xFF) << 8); // u16 record count of the frame header
        x.getResponseHeaders().set("Content-Type", "application/octet-stream");
        x.sendResponseHeaders(200, f.length);
        x.getResponseBody().write(f);
    }

    private void dirty(HttpExchange x) throws Exception {
        byte[] raw = x.getRequestBody().readNBytes(MAX_BODY + 1);
        int[] v = new int[6];
        if (raw.length > MAX_BODY || !(org.json.simple.JSONValue.parse(new String(raw, StandardCharsets.UTF_8)) instanceof Map<?, ?> body)) {
            BotUi.reply(x, 400, BotUi.error("bad body"));
            return;
        }
        for (int i = 0; i < 6; i++) {
            if (!(body.get(BOX_KEYS[i]) instanceof Long l) || l != (int) (long) l) {
                BotUi.reply(x, 400, BotUi.error("need integer " + String.join(", ", BOX_KEYS)));
                return;
            }
            v[i] = (int) (long) l;
        }
        int cx1 = FeedQueue.chunkOf(Math.min(v[0], v[3])), cx2 = FeedQueue.chunkOf(Math.max(v[0], v[3]));
        int cz1 = FeedQueue.chunkOf(Math.min(v[2], v[5])), cz2 = FeedQueue.chunkOf(Math.max(v[2], v[5]));
        long chunks = (long) (cx2 - cx1 + 1) * (cz2 - cz1 + 1);
        if (chunks > DIRTY_MAX_CHUNKS) {
            BotUi.reply(x, 400, BotUi.error("box covers " + chunks + " chunks, at most " + DIRTY_MAX_CHUNKS));
            return;
        }
        int tick = Bukkit.getCurrentTick();
        for (int cx = cx1; cx <= cx2; cx++) for (int cz = cz1; cz <= cz2; cz++) queue.mark(cx, cz, tick);
        BotUi.reply(x, 200, Map.of("chunks", chunks));
    }

    private record Probe(int cx, int cz, List<int[]> cells, CompletableFuture<List<String>> states) {}

    /** Random cells of up to 25 random sections of the box (else the area), read on the main thread; ungenerated chunks are skipped, never generated. */
    private void sample(HttpExchange x, int n, long seed, int[] box) throws Exception {
        int[] b = box, a = area;
        if (b == null && a == null) throw new IllegalArgumentException("no box and no area yet");
        if (b == null) b = new int[] {a[0] * 16, Y_MIN, a[1] * 16, a[2] * 16 + 15, Y_MAX, a[3] * 16 + 15};
        b = new int[] {Math.min(b[0], b[3]), Math.min(b[1], b[4]), Math.min(b[2], b[5]), Math.max(b[0], b[3]), Math.max(b[1], b[4]), Math.max(b[2], b[5])};
        if (n < 1 || n > SAMPLE_MAX || b[1] < Y_MIN || b[4] > Y_MAX) throw new IllegalArgumentException("n must be 1.." + SAMPLE_MAX + ", y " + Y_MIN + ".." + Y_MAX);
        Random r = new Random(seed);
        int sections = Math.min(SAMPLE_SECTIONS, n), per = n / sections;
        Map<Long, Probe> probes = new LinkedHashMap<>();
        for (int i = 0; i < sections; i++) {
            int sx = pick(r, FeedQueue.chunkOf(b[0]), FeedQueue.chunkOf(b[3])), sy = pick(r, FeedQueue.chunkOf(b[1]), FeedQueue.chunkOf(b[4])),
                sz = pick(r, FeedQueue.chunkOf(b[2]), FeedQueue.chunkOf(b[5]));
            Probe p = probes.computeIfAbsent(SectionCodec.chunkKey(sx, sz), k -> new Probe(sx, sz, new ArrayList<>(), new CompletableFuture<>()));
            for (int j = 0; j < per; j++)
                p.cells().add(new int[] {pick(r, Math.max(b[0], sx * 16), Math.min(b[3], sx * 16 + 15)), pick(r, Math.max(b[1], sy * 16), Math.min(b[4], sy * 16 + 15)),
                    pick(r, Math.max(b[2], sz * 16), Math.min(b[5], sz * 16 + 15))});
        }
        Bukkit.getScheduler().runTask(plugin, () -> {
            for (Probe p : probes.values()) world.getChunkAtAsync(p.cx(), p.cz(), false).whenComplete((c, err) -> {
                if (err != null) p.states().completeExceptionally(err);
                else if (c == null) p.states().complete(null);
                else {
                    List<String> states = new ArrayList<>(p.cells().size());
                    for (int[] cell : p.cells()) states.add(world.getBlockAt(cell[0], cell[1], cell[2]).getBlockData().getAsString());
                    p.states().complete(states);
                }
            });
        });
        try {
            CompletableFuture.allOf(probes.values().stream().map(Probe::states).toArray(CompletableFuture<?>[]::new)).get(SAMPLE_TIMEOUT_S, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            BotUi.reply(x, 504, BotUi.error("sample took longer than " + SAMPLE_TIMEOUT_S + " s"));
            return;
        }
        List<List<Object>> samples = new ArrayList<>();
        int skipped = 0;
        for (Probe p : probes.values()) {
            List<String> states = p.states().join();
            if (states == null) {
                skipped++;
                continue;
            }
            for (int i = 0; i < states.size(); i++) {
                int[] cell = p.cells().get(i);
                samples.add(List.of(cell[0], cell[1], cell[2], SectionCodec.strip(states.get(i))));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("samples", samples);
        out.put("skipped", skipped);
        BotUi.reply(x, 200, out);
    }

    private static int pick(Random r, int lo, int hi) {
        return (int) r.nextLong(lo, hi + 1L);
    }

    private void stats(HttpExchange x) throws Exception {
        int[] a = area;
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("boot", Long.toString(boot)); // a string: JSON numbers lose a 63-bit value in JavaScript
        o.put("area", a == null ? null : List.of(a[0], a[1], a[2], a[3]));
        o.put("importLeft", queue.importLeft());
        o.put("dirty", queue.dirtyCount());
        o.put("outbox", queue.outboxSize());
        o.put("loadedInArea", loadedInArea);
        o.put("snapshots", snapshots);
        o.put("mainMsLastMinute", mainMsLastMinute);
        o.put("maxTickMs", maxTickMs);
        o.put("encodeMsLastMinute", encodeMsLastMinute);
        o.put("sent", sent.get());
        o.put("failed", failed.get());
        o.put("encoderWaiting", waiting.get());
        BotUi.reply(x, 200, o);
    }
}
