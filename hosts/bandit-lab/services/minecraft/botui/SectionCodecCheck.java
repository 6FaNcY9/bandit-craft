package botui;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

/** Derivation check for SectionCodec: `--write <path>` writes the golden fixture, `<path>` asserts it (run with -ea). Not part of the jar. */
final class SectionCodecCheck {
    private SectionCodecCheck() {}

    private static int cell(int x, int y, int z) {
        return (y << 8) | (z << 4) | x;
    }

    private static String[] fill(String state) {
        String[] cells = new String[SectionCodec.CELLS];
        Arrays.fill(cells, state);
        return cells;
    }

    private static byte[] sectionRecord(int cx, int sy, int cz, String[] cells) {
        byte[] blob = SectionCodec.encode(cells);
        return SectionCodec.record(0, cx, sy, cz, SectionCodec.hash(blob), blob);
    }

    static byte[] fixture() {
        String[] two = fill("minecraft:stone");
        two[cell(1, 2, 3)] = "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]";
        two[cell(15, 15, 15)] = SectionCodec.strip("minecraft:redstone_lamp[lit=true]");
        String[] three = new String[SectionCodec.CELLS];
        for (int i = 0; i < three.length; i++) three[i] = "minecraft:t" + (i % 17);
        return SectionCodec.frame(1, 7, List.of(
            sectionRecord(-17, 5, -2, fill("minecraft:air")),
            sectionRecord(-1, -4, 0, two),
            sectionRecord(3, 19, 18, three),
            SectionCodec.record(1, 40, 0, -41, null, null)));
    }

    public static void main(String[] args) throws IOException {
        boolean ea = false;
        assert ea = true;
        if (!ea) throw new AssertionError("run with -ea");
        if (args.length == 2 && args[0].equals("--write")) {
            Path out = Path.of(args[1]);
            Files.createDirectories(out.toAbsolutePath().getParent());
            Files.write(out, fixture());
            return;
        }
        assert SectionCodec.strip("minecraft:redstone_lamp[lit=true]").equals("minecraft:redstone_lamp");
        assert SectionCodec.strip("minecraft:redstone_wire[east=side,north=none,power=7,south=none,west=up]")
            .equals("minecraft:redstone_wire[east=side,north=none,south=none,west=up]");
        assert SectionCodec.strip("minecraft:lever[face=wall,facing=north,powered=true]").equals("minecraft:lever[face=wall,facing=north]");
        assert SectionCodec.strip("minecraft:dispenser[facing=up,triggered=false]").equals("minecraft:dispenser[facing=up]");
        assert SectionCodec.strip("minecraft:stone").equals("minecraft:stone");
        assert SectionCodec.strip("minecraft:powered_rail[powered=true,shape=north_south,waterlogged=false]")
            .equals("minecraft:powered_rail[shape=north_south,waterlogged=false]"); // name untouched
        assert SectionCodec.sectionKey(-1, -4, 0) != SectionCodec.sectionKey(0, -4, -1);
        assert SectionCodec.chunkKey(-1, 0) != SectionCodec.chunkKey(0, -1);
        assert Arrays.equals(fixture(), Files.readAllBytes(Path.of(args[0])));
    }
}
