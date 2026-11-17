package botui;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Derivation check for FeedQueue (run with -ea). Not part of the jar. */
final class FeedQueueCheck {
    private FeedQueueCheck() {}

    private static FeedQueue.Rec rec(int cx, int cz, int sy, String tag) {
        byte[] blob = tag.getBytes(StandardCharsets.UTF_8);
        return new FeedQueue.Rec(0, cx, sy, cz, SectionCodec.hash(blob), blob);
    }

    private static List<FeedQueue.Rec> sections24(int cx, int cz, int seed) {
        List<FeedQueue.Rec> out = new ArrayList<>();
        for (int sy = -4; sy < 20; sy++) out.add(rec(cx, cz, sy, "s" + cx + "," + cz + "," + sy + "," + seed));
        return out;
    }

    private static FeedQueue.Rec big(int sy, int size, int fill) {
        byte[] blob = new byte[size];
        Arrays.fill(blob, (byte) fill);
        return new FeedQueue.Rec(0, 0, sy, 0, SectionCodec.hash(blob), blob);
    }

    private static byte[] wire(FeedQueue.Rec r) {
        return SectionCodec.record(r.kind(), r.cx(), r.sy(), r.cz(), r.hash(), r.blob());
    }

    private static long batchId(byte[] frame) {
        return ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN).getInt(9) & 0xFFFFFFFFL;
    }

    private static int count(byte[] frame) {
        return ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN).getShort(13) & 0xFFFF;
    }

    public static void main(String[] args) {
        boolean ea = false;
        assert ea = true;
        if (!ea) throw new AssertionError("run with -ea");

        assert FeedQueue.chunkOf(-1) == -1 && FeedQueue.chunkOf(-16) == -1 && FeedQueue.chunkOf(-17) == -2
            && FeedQueue.chunkOf(15) == 0 && FeedQueue.chunkOf(16) == 1;

        FeedQueue q = new FeedQueue(1);
        assert q.setArea(-37, -22, 3, 18) && !q.setArea(-37, -22, 3, 18) && q.importLeft() == 1681;
        q.mark(100, 100, 0); assert q.dirtyCount() == 0;                          // outside the area
        q.mark(-1, 0, 10);
        assert q.next(14).kind() == FeedQueue.Kind.IMPORT;                        // mark not settled yet
        FeedQueue.Work w = q.next(15); assert w.kind() == FeedQueue.Kind.DIRTY && w.cx() == -1;
        q.done(w, 15, java.util.List.of(rec(-1, 0, 0, "a")));
        for (int t = 16; t < 55; t++) q.mark(-1, 0, t);                           // storm on one chunk
        for (int t = 16; t < 55; t++) assert q.next(t).kind() != FeedQueue.Kind.DIRTY;   // debounced, import goes on
        assert q.next(60).kind() == FeedQueue.Kind.DIRTY;
        // same hash again: nothing new to send
        q.done(new FeedQueue.Work(-1, 0, FeedQueue.Kind.SWEEP), 100, java.util.List.of(rec(-1, 0, 0, "a")));
        assert q.outboxSize() == 1;
        // hub down: outbox fills, marks stay, memory bounded
        FeedQueue f = new FeedQueue(1); f.setArea(0, 0, 40, 40);
        for (int i = 0; i < 300; i++) { FeedQueue.Work x = f.next(i); if (x == null) break; f.done(x, i, sections24(x.cx(), x.cz(), i)); }
        assert f.outboxSize() <= FeedQueue.OUTBOX_MAX + 24 && f.next(1000) == null && f.importLeft() > 0;
        f.mark(0, 0, 1000); assert f.dirty(0, 0);
        // batches and acks
        byte[] b1 = f.batch(0), again = f.batch(0); assert java.util.Arrays.equals(b1, again);     // not acked: same frame
        byte[] b2 = f.batch(batchId(b1)); assert batchId(b2) == batchId(b1) + 1 && count(b1) == 256;
        int left = f.outboxSize(); assert left <= FeedQueue.OUTBOX_MAX + 24 - 256 && f.next(1001) != null;   // room again

        // batch ids: every frame gets a fresh one, empty ones too, so the ack of an empty frame cannot ack a later real one
        FeedQueue e = new FeedQueue(7);
        byte[] e1 = e.batch(0), e2 = e.batch(batchId(e1)), e3 = e.batch(batchId(e2));
        assert count(e1) == 0 && batchId(e1) == 8 && batchId(e2) == 9 && batchId(e3) == 10;
        assert batchId(new FeedQueue(-1).batch(0)) == 1 << 30 && batchId(new FeedQueue((1L << 30) + 5).batch(0)) == 6;
        e.setArea(0, 0, 3, 3);
        e.done(new FeedQueue.Work(0, 0, FeedQueue.Kind.SWEEP), 1, List.of(rec(0, 0, 0, "x")));
        byte[] real = e.batch(batchId(e3));                                       // the hub acks the empty frame 10
        assert count(real) == 1 && batchId(real) == 11;
        assert Arrays.equals(real, e.batch(batchId(e3)));                         // 10 does not ack frame 11
        assert Arrays.equals(real, e.batch(0));
        assert count(e.batch(batchId(real))) == 0 && e.outboxSize() == 0;

        // kind 1: no hash, one record per chunk, never again once sent
        FeedQueue u = new FeedQueue(1); u.setArea(0, 0, 3, 3);
        FeedQueue.Rec gone = new FeedQueue.Rec(1, 2, 0, 3, null, null);
        u.done(new FeedQueue.Work(2, 3, FeedQueue.Kind.IMPORT), 0, List.of(gone));
        u.done(new FeedQueue.Work(2, 3, FeedQueue.Kind.SWEEP), 1, List.of(gone));
        assert u.outboxSize() == 1;
        assert Arrays.equals(u.batch(0), SectionCodec.frame(1, 2, List.of(wire(gone))));
        assert count(u.batch(2)) == 0;
        u.done(new FeedQueue.Work(2, 3, FeedQueue.Kind.SWEEP), 2, List.of(gone));
        assert u.outboxSize() == 0;

        // a -> b -> a while b still waits: the newest wins, a is not dropped as "already sent"
        FeedQueue r = new FeedQueue(1); r.setArea(0, 0, 0, 0);
        FeedQueue.Work sw = new FeedQueue.Work(0, 0, FeedQueue.Kind.SWEEP);
        r.done(sw, 1, List.of(rec(0, 0, 0, "a")));
        assert count(r.batch(0)) == 1;                                            // a in flight as frame 2
        r.done(sw, 2, List.of(rec(0, 0, 0, "b")));
        r.done(sw, 3, List.of(rec(0, 0, 0, "a")));
        assert r.outboxSize() == 1;
        assert Arrays.equals(r.batch(2), SectionCodec.frame(1, 3, List.of(wire(rec(0, 0, 0, "a")))));

        // frame limits: bytes cap a frame, but one record always goes out
        FeedQueue g = new FeedQueue(1); g.setArea(0, 0, 0, 0);
        g.done(sw, 1, List.of(big(0, 300_000, 1), big(1, 300_000, 2), big(2, 300_000, 3), big(3, 300_000, 4), big(4, 300_000, 5)));
        byte[] g1 = g.batch(0); assert count(g1) == 3 && g1.length <= FeedQueue.BATCH_BYTES;
        byte[] g2 = g.batch(batchId(g1)); assert count(g2) == 2;
        g.done(sw, 2, List.of(big(0, 2 << 20, 9)));
        byte[] g3 = g.batch(batchId(g2)); assert count(g3) == 1 && g3.length > FeedQueue.BATCH_BYTES;

        // area: corners normalise, a change re-imports and drops what is outside, sent hashes are kept
        FeedQueue a = new FeedQueue(1);
        assert a.setArea(2, 2, 0, 0) && a.inArea(1, 1) && !a.inArea(3, 0) && !a.setArea(0, 0, 2, 2);
        a.mark(2, 2, 0); a.offerSweep(0, 0); a.offerSweep(0, 0); a.offerSweep(9, 9);   // sweep twice = once, outside ignored
        assert a.next(3).kind() == FeedQueue.Kind.IMPORT;                         // dirty (2, 2) not settled yet
        FeedQueue.Work ad = a.next(5); assert ad.kind() == FeedQueue.Kind.DIRTY && ad.cx() == 2 && ad.cz() == 2;
        for (int i = 0; i < 8; i++) assert a.next(6).kind() == FeedQueue.Kind.IMPORT;
        assert a.importLeft() == 0 && a.next(6).kind() == FeedQueue.Kind.SWEEP && a.next(6) == null;   // (2, 2) debounced
        assert a.next(45).kind() == FeedQueue.Kind.DIRTY;                         // and handed out once until then
        a.done(new FeedQueue.Work(0, 0, FeedQueue.Kind.SWEEP), 46, List.of(rec(0, 0, 0, "k")));
        assert count(a.batch(0)) == 1 && count(a.batch(2)) == 0;                  // sent and acked
        assert a.setArea(0, 0, 1, 1) && a.dirtyCount() == 0 && a.importLeft() == 4;
        a.done(new FeedQueue.Work(0, 0, FeedQueue.Kind.IMPORT), 47, List.of(rec(0, 0, 0, "k")));
        assert a.outboxSize() == 0;

        // a mark made after the snapshot survives done(); one before it does not
        FeedQueue m = new FeedQueue(1); m.setArea(0, 0, 0, 0);
        m.mark(0, 0, 10);
        FeedQueue.Work mw = m.next(15); assert mw.kind() == FeedQueue.Kind.DIRTY;
        m.mark(0, 0, 16);
        m.done(mw, 15, List.of()); assert m.dirty(0, 0);
        m.done(mw, 17, List.of()); assert !m.dirty(0, 0);

        // starvation: a chunk marked on every tick (clock, flowing water) still gets a snapshot per debounce window
        FeedQueue s = new FeedQueue(1); s.setArea(0, 0, 0, 0);
        s.done(s.next(0), 0, List.of());                                          // imported at tick 0, long before the marks
        List<Integer> shots = new ArrayList<>();
        for (int t = 200; t <= 450; t++) {
            if (t <= 400) s.mark(0, 0, t);
            FeedQueue.Work sw2 = s.next(t);
            if (sw2 == null) continue;
            assert sw2.kind() == FeedQueue.Kind.DIRTY;
            shots.add(t);
            s.done(sw2, t, List.of());
        }
        assert !shots.isEmpty() && shots.get(0) <= 200 + FeedQueue.SETTLE_TICKS + FeedQueue.DEBOUNCE_TICKS;
        for (int i = 1; i < shots.size(); i++) assert shots.get(i) - shots.get(i - 1) >= FeedQueue.DEBOUNCE_TICKS
            && shots.get(i) - shots.get(i - 1) <= FeedQueue.DEBOUNCE_TICKS + FeedQueue.SETTLE_TICKS;
        assert shots.size() >= 5 && shots.get(shots.size() - 1) > 400 && !s.dirty(0, 0);   // the last marks were snapshotted too
    }
}
