package botui;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Set;

/**
 * World model wire format: one 16x16x16 section as a palette blob, and batch frames of section records.
 * Pure (no Bukkit). Byte for byte the same layout as the hub's worldsection.js; the formats are in the world-model plan.
 */
final class SectionCodec {
    private SectionCodec() {}

    static final int CELLS = 4096;
    // Block-state properties that flip with redstone activity and are not part of the build.
    private static final Set<String> NOISE = Set.of("power", "powered", "lit", "triggered");

    /** Drops the noise properties from a block state string; the block name is never touched. */
    static String strip(String state) {
        int open = state.indexOf('[');
        if (open < 0) return state;
        StringBuilder props = new StringBuilder();
        for (String p : state.substring(open + 1, state.length() - 1).split(",")) {
            if (NOISE.contains(p.substring(0, p.indexOf('=')))) continue;
            if (props.length() > 0) props.append(',');
            props.append(p);
        }
        return props.length() == 0 ? state.substring(0, open) : state.substring(0, open + 1) + props + "]";
    }

    /** Section blob v1 from 4096 stripped states in cell order ((y << 8) | (z << 4) | x). */
    static byte[] encode(String[] cells) {
        if (cells.length != CELLS) throw new IllegalArgumentException("need " + CELLS + " cells");
        HashMap<String, Integer> index = new HashMap<>();
        List<byte[]> palette = new ArrayList<>(); // first appearance in cell order: equal content must give equal bytes
        int[] idx = new int[CELLS];
        int size = 4;
        for (int i = 0; i < CELLS; i++) {
            Integer at = index.get(cells[i]);
            if (at == null) {
                at = palette.size();
                index.put(cells[i], at);
                byte[] s = cells[i].getBytes(StandardCharsets.UTF_8);
                palette.add(s);
                size += 2 + s.length;
            }
            idx[i] = at;
        }
        int n = palette.size();
        int bits = n < 2 ? 0 : 32 - Integer.numberOfLeadingZeros(n - 1); // ceil(log2(n))
        ByteBuffer out = ByteBuffer.allocate(size + (CELLS * bits >> 3)).order(ByteOrder.LITTLE_ENDIAN);
        out.put((byte) 1).put((byte) bits).putShort((short) n);
        for (byte[] s : palette) out.putShort((short) s.length).put(s);
        long acc = 0;
        int nb = 0;
        if (bits > 0) for (int i = 0; i < CELLS; i++) {
            acc |= (long) idx[i] << nb;
            nb += bits;
            while (nb >= 8) {
                out.put((byte) acc);
                acc >>>= 8;
                nb -= 8;
            }
        }
        return out.array();
    }

    /** First 8 bytes of SHA-256(blob). */
    static byte[] hash(byte[] blob) {
        try {
            return Arrays.copyOf(MessageDigest.getInstance("SHA-256").digest(blob), 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** One batch record: kind 0 section (hash, blob), 1 ungenerated chunk, 2 unknown chunk; only kind 0 carries hash and blob. */
    static byte[] record(int kind, int cx, int sy, int cz, byte[] hash, byte[] blob) {
        if (kind < 0 || kind > 2 || (kind == 0 && hash.length != 8)) throw new IllegalArgumentException("bad record");
        ByteBuffer r = ByteBuffer.allocate(kind == 0 ? 22 + blob.length : 10).order(ByteOrder.LITTLE_ENDIAN);
        r.put((byte) kind).putInt(cx).put((byte) sy).putInt(cz);
        if (kind == 0) r.put(hash).putInt(blob.length).put(blob);
        return r.array();
    }

    /** Batch frame v1. */
    static byte[] frame(long boot, int batch, List<byte[]> records) {
        if (records.size() > 0xFFFF) throw new IllegalArgumentException("too many records");
        int size = 15;
        for (byte[] r : records) size += r.length;
        ByteBuffer out = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        out.put((byte) 1).putLong(boot).putInt(batch).putShort((short) records.size());
        for (byte[] r : records) out.put(r);
        return out.array();
    }

    /** Map key for a section: 28 bits cx, 28 bits cz, 8 bits sy (the world border is 1.9 million chunks). */
    static long sectionKey(int cx, int sy, int cz) {
        return ((long) (cx & 0xFFFFFFF) << 36) | ((long) (cz & 0xFFFFFFF) << 8) | (sy & 0xFF);
    }

    static long chunkKey(int cx, int cz) {
        return ((long) cx << 32) | (cz & 0xFFFFFFFFL);
    }
}
