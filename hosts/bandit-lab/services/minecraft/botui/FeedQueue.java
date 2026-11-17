package botui;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Bookkeeping between Paper's block events/snapshots and the hub's long poll: dirty marks with settle and debounce,
 * the order of snapshot work, a bounded outbox and acked batch frames. Pure (no Bukkit) and thread-safe.
 * Ticks passed to {@link #done} are the ticks the snapshots were taken at, not when the encoder finished.
 */
final class FeedQueue {
    static final int OUTBOX_MAX = 4096, SETTLE_TICKS = 5, DEBOUNCE_TICKS = 40, BATCH_RECORDS = 256, BATCH_BYTES = 1 << 20;

    enum Kind { DIRTY, IMPORT, SWEEP }

    record Work(int cx, int cz, Kind kind) {}

    /** kind 0 section (hash, blob) or 1 ungenerated chunk (sy 0, no hash, no blob). */
    record Rec(int kind, int cx, int sy, int cz, byte[] hash, byte[] blob) {}

    private final long boot;
    private int ax1 = 1, az1 = 1, ax2 = 0, az2 = 0; // empty until setArea
    private long imported; // imports are handed out row by row, so a big area costs no memory
    private final HashMap<Long, Long> dirtyAt = new HashMap<>(); // chunk -> tick of its newest mark
    private final HashMap<Long, Long> lastSnap = new HashMap<>(); // chunk -> tick of its last snapshot
    private final LinkedHashSet<Long> sweeps = new LinkedHashSet<>();
    private final HashMap<Long, Long> newest = new HashMap<>(); // section -> hash of the newest record accepted, queued or sent
    private final HashSet<Long> ungenerated = new HashSet<>();
    // Records not yet in a frame; at most OUTBOX_MAX + 24 (done() adds a whole chunk). The one frame in flight is bounded by BATCH_BYTES.
    private final LinkedHashMap<Long, Rec> outbox = new LinkedHashMap<>();
    private long nextId;
    private long flightId;
    private byte[] flight;

    FeedQueue(long boot) {
        this.boot = boot;
        this.nextId = 1 + Math.floorMod(boot, 1 << 30);
    }

    /** Block coordinate to chunk coordinate; the only way callers convert. */
    static int chunkOf(int block) {
        return block >> 4;
    }

    private static int cxOf(long chunk) {
        return (int) (chunk >> 32);
    }

    private static int czOf(long chunk) {
        return (int) chunk;
    }

    private boolean in(int cx, int cz) {
        return cx >= ax1 && cx <= ax2 && cz >= az1 && cz <= az2;
    }

    /** True when the area changed: every chunk is queued for IMPORT again, hashes already accepted are kept. */
    synchronized boolean setArea(int cx1, int cz1, int cx2, int cz2) {
        int x1 = Math.min(cx1, cx2), x2 = Math.max(cx1, cx2), z1 = Math.min(cz1, cz2), z2 = Math.max(cz1, cz2);
        if (x1 == ax1 && x2 == ax2 && z1 == az1 && z2 == az2) return false;
        ax1 = x1; ax2 = x2; az1 = z1; az2 = z2;
        imported = 0;
        dirtyAt.keySet().removeIf(k -> !in(cxOf(k), czOf(k)));
        lastSnap.keySet().removeIf(k -> !in(cxOf(k), czOf(k)));
        sweeps.removeIf(k -> !in(cxOf(k), czOf(k)));
        return true;
    }

    synchronized boolean inArea(int cx, int cz) {
        return in(cx, cz);
    }

    synchronized void mark(int cx, int cz, long tick) {
        if (in(cx, cz)) dirtyAt.put(SectionCodec.chunkKey(cx, cz), tick);
    }

    synchronized void offerSweep(int cx, int cz) {
        if (in(cx, cz)) sweeps.add(SectionCodec.chunkKey(cx, cz));
    }

    /** DIRTY (oldest settled mark whose chunk was not snapshotted for DEBOUNCE_TICKS), then IMPORT, then SWEEP; null when nothing is due or the outbox is full. */
    synchronized Work next(long tick) {
        if (outbox.size() >= OUTBOX_MAX) return null;
        Long due = null;
        for (Map.Entry<Long, Long> e : dirtyAt.entrySet()) {
            Long snap = lastSnap.get(e.getKey());
            if (tick - e.getValue() >= SETTLE_TICKS && (snap == null || tick - snap >= DEBOUNCE_TICKS)
                && (due == null || e.getValue() < dirtyAt.get(due))) due = e.getKey();
        }
        if (due != null) {
            lastSnap.put(due, tick); // also keeps a drain loop from getting this chunk twice before done()
            return new Work(cxOf(due), czOf(due), Kind.DIRTY);
        }
        if (imported < total()) {
            long width = ax2 - ax1 + 1, i = imported++;
            return new Work(ax1 + (int) (i % width), az1 + (int) (i / width), Kind.IMPORT);
        }
        Iterator<Long> s = sweeps.iterator();
        if (s.hasNext()) {
            long k = s.next();
            s.remove();
            return new Work(cxOf(k), czOf(k), Kind.SWEEP);
        }
        return null;
    }

    /**
     * Takes the records of a snapshot taken at tick. A record whose hash equals the newest one accepted for its section is dropped,
     * a newer record replaces a queued one; kind 1 is kept once per chunk. Marks older than the snapshot are cleared, newer ones stay.
     */
    synchronized void done(Work w, long tick, List<Rec> recs) {
        if (!in(w.cx(), w.cz())) return; // the area moved while the snapshot was made
        long chunk = SectionCodec.chunkKey(w.cx(), w.cz());
        lastSnap.put(chunk, tick);
        dirtyAt.computeIfPresent(chunk, (k, mark) -> mark < tick ? null : mark);
        for (Rec r : recs) {
            long rc = SectionCodec.chunkKey(r.cx(), r.cz());
            if (r.kind() == 1) {
                // sy -128 never names a real section, so this key cannot collide with a kind 0 record
                if (ungenerated.add(rc)) outbox.put(SectionCodec.sectionKey(r.cx(), -128, r.cz()), r);
                continue;
            }
            long key = SectionCodec.sectionKey(r.cx(), r.sy(), r.cz()), hash = ByteBuffer.wrap(r.hash()).getLong();
            Long old = newest.put(key, hash);
            if (old != null && old == hash) continue;
            ungenerated.remove(rc);
            outbox.put(key, r);
        }
    }

    synchronized boolean dirty(int cx, int cz) {
        return dirtyAt.containsKey(SectionCodec.chunkKey(cx, cz));
    }

    /**
     * The hub's ack of the frame in flight drops it; any other ack returns that same frame again. Otherwise the next frame is built
     * from the outbox. Every frame returned gets a fresh id, empty ones too, and an empty one is never kept in flight.
     */
    synchronized byte[] batch(long ack) {
        if (flight != null) {
            if (ack != flightId) return flight;
            flight = null;
        }
        List<byte[]> recs = new ArrayList<>();
        int size = 15;
        for (Iterator<Rec> it = outbox.values().iterator(); it.hasNext() && recs.size() < BATCH_RECORDS; ) {
            Rec r = it.next();
            byte[] b = SectionCodec.record(r.kind(), r.cx(), r.sy(), r.cz(), r.hash(), r.blob());
            if (!recs.isEmpty() && size + b.length > BATCH_BYTES) break;
            recs.add(b);
            size += b.length;
            it.remove();
        }
        byte[] frame = SectionCodec.frame(boot, (int) nextId, recs);
        if (!recs.isEmpty()) {
            flight = frame;
            flightId = nextId;
        }
        nextId++;
        return frame;
    }

    private long total() {
        return (long) (ax2 - ax1 + 1) * (az2 - az1 + 1);
    }

    synchronized int importLeft() {
        return (int) Math.min(total() - imported, Integer.MAX_VALUE);
    }

    synchronized int dirtyCount() {
        return dirtyAt.size();
    }

    synchronized int outboxSize() {
        return outbox.size();
    }
}
