# Generates the event datapack's structure templates (gzip NBT) from code, and prints each one layer by
# layer so a layout can be reviewed without a client. Run after changing a design; the .nbt files are
# committed:
#   uv run --with nbtlib python tools/minecraft-public-events/gen.py [--print]
import pathlib
import sys

from nbtlib import Compound, File, Int, List, String

OUT = pathlib.Path(__file__).resolve().parents[2] / "hosts/bandit-lab/services/minecraft-public/events/data/bev/structure"
DATA_VERSION = 4903  # Minecraft 26.2 (version.json in the server jar)
AIR = "minecraft:air"


class Grid:
    """Blocks of one template; cells never set are left out, so the world keeps what was there."""

    def __init__(self, w, h, l):
        self.size = (w, h, l)
        self.cells = {}

    def set(self, x, y, z, name, props=None, nbt=None):
        self.cells[(x, y, z)] = (name, tuple(sorted((props or {}).items())), nbt)

    def box(self, x0, y0, z0, x1, y1, z1, pick):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    self.set(x, y, z, pick(x, y, z) if callable(pick) else pick)

    def shell(self, x0, y0, z0, x1, y1, z1, pick):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    if x in (x0, x1) or y in (y0, y1) or z in (z0, z1):
                        self.set(x, y, z, pick(x, y, z) if callable(pick) else pick)
                    else:
                        self.set(x, y, z, AIR)

    def save(self, name):
        palette, index, blocks = [], {}, []
        for (x, y, z), (block, props, nbt) in sorted(self.cells.items()):
            key = (block, props)
            if key not in index:
                index[key] = len(palette)
                entry = {"Name": String(block)}
                if props:
                    entry["Properties"] = Compound({k: String(v) for k, v in props})
                palette.append(Compound(entry))
            cell = {"pos": List[Int]([Int(x), Int(y), Int(z)]), "state": Int(index[key])}
            if nbt:
                cell["nbt"] = nbt
            blocks.append(Compound(cell))
        File(
            {
                "DataVersion": Int(DATA_VERSION),
                "size": List[Int]([Int(v) for v in self.size]),
                "palette": List[Compound](palette),
                "blocks": List[Compound](blocks),
                "entities": List[Compound]([]),
            },
            gzipped=True,
        ).save(OUT / f"{name}.nbt")

    def show(self, name):
        glyph = {"air": ".", "spawner": "S", "chest": "C", "ladder": "H", "tnt": "T", "stone_pressure_plate": "_", "ancient_debris": "D", "magma_block": "m", "obsidian": "o", "crying_obsidian": "o", "raw_gold_block": "g", "iron_bars": "|"}
        w, h, l = self.size
        print(f"== {name} {w}x{h}x{l}")
        for y in range(h):
            print(f"y={y}")
            for z in range(l):
                print("".join(" " if (x, y, z) not in self.cells else glyph.get(self.cells[(x, y, z)][0].split(":")[1], "#") for x in range(w)))


def bricks(x, y, z):
    """Stone bricks with moss and cracks, the same every run."""
    return ["minecraft:stone_bricks", "minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:stone_bricks", "minecraft:cracked_stone_bricks"][(x * 7 + y * 13 + z * 5) % 5]


def spawner(mob):
    return Compound({"id": String("minecraft:mob_spawner"), "SpawnData": Compound({"entity": Compound({"id": String(mob)})})})


def chest(table):
    return Compound({"id": String("minecraft:chest"), "LootTable": String(table)})


def tower():
    """Above ground: three floors joined by a ladder, a spawner on each lower floor, the chest at the top."""
    g = Grid(9, 17, 9)
    g.shell(0, 0, 0, 8, 15, 8, bricks)
    for floor in (5, 10):
        g.box(1, floor, 1, 7, floor, 7, bricks)
    for y in (1, 2):
        g.set(4, y, 0, AIR)  # the door
    for y in range(1, 16):
        g.set(7, y, 4, "minecraft:ladder", {"facing": "west"})  # up the east wall, through both floors and the roof
    for y, x in ((7, 0), (7, 8), (12, 0), (12, 8)):
        g.set(x, y, 4, "minecraft:iron_bars")  # slits: light for players, none that stops a spawner
    g.set(4, 6, 4, "minecraft:spawner", nbt=spawner("minecraft:zombie"))
    g.set(4, 11, 4, "minecraft:spawner", nbt=spawner("minecraft:skeleton"))
    g.set(1, 11, 1, "minecraft:chest", {"facing": "south"}, chest("bev:dungeon"))
    for x in range(9):
        for z in range(9):
            if (x in (0, 8) or z in (0, 8)) and (x + z) % 2 == 0:
                g.set(x, 16, z, bricks(x, 16, z))  # battlements
    return g


def crypt():
    """Below ground: a hall with four pillars, two spawners, and a chest with a pressure plate and TNT before it."""
    g = Grid(13, 7, 13)
    g.shell(0, 0, 0, 12, 6, 12, bricks)
    for x, z in ((3, 3), (3, 9), (9, 3), (9, 9)):
        g.box(x, 1, z, x, 5, z, "minecraft:chiseled_stone_bricks")
    for y in range(1, 7):
        g.set(1, y, 1, "minecraft:ladder", {"facing": "east"})  # the way in: a hole in the roof at the corner
    g.set(6, 1, 3, "minecraft:spawner", nbt=spawner("minecraft:cave_spider"))
    g.set(6, 1, 9, "minecraft:spawner", nbt=spawner("minecraft:zombie"))
    g.set(11, 1, 6, "minecraft:chest", {"facing": "west"}, chest("bev:dungeon"))
    g.set(10, 1, 6, "minecraft:stone_pressure_plate")
    g.set(10, 0, 6, "minecraft:tnt")  # under the plate, in the floor
    return g


def meteor():
    """The core left in the crater: a ball of obsidian and magma around ancient debris and raw gold."""
    g = Grid(5, 5, 5)
    for x in range(5):
        for y in range(5):
            for z in range(5):
                d = (x - 2) ** 2 + (y - 2) ** 2 + (z - 2) ** 2
                if d <= 1:
                    g.set(x, y, z, "minecraft:ancient_debris")
                elif d <= 3:
                    g.set(x, y, z, "minecraft:raw_gold_block" if (x + y + z) % 3 == 0 else "minecraft:magma_block")
                elif d <= 5:
                    g.set(x, y, z, "minecraft:crying_obsidian" if (x * 3 + y + z * 5) % 4 == 0 else "minecraft:obsidian")
    return g


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build in (("tower", tower), ("crypt", crypt), ("meteor", meteor)):
        grid = build()
        grid.save(name)
        if "--print" in sys.argv:
            grid.show(name)
        print(f"{name}: {len(grid.cells)} blocks -> {OUT / (name + '.nbt')}", file=sys.stderr)
