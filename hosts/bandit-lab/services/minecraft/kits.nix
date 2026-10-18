# /kit: the admins' kit menus (CommandPanels), generated from the lists below. Left click puts a kit
# into the inventory, right click gives it as one named shulker box (for the ender chest); the lore
# lists what is inside. The menus open only with bandit.admin.menu; the OP category is hidden and
# locked without bandit.owner (its gear is owner.yml, /owner). A [console] give runs as the server,
# so these permissions are the only gate. tools/minecraft-kit-check tries every command on the
# server against a target that matches nobody (docs/runbooks/minecraft/ADMIN.md).
# Returns { <panel name> = <panel>; }; default.nix writes each as <name>.yml (JSON is YAML).
{lib}: let
  inherit (lib) concatStringsSep concatMapStringsSep mapAttrsToList imap0 toUpper;
  admin = "%player_name% $HASPERM bandit.admin.menu";
  owner = "%player_name% $HASPERM bandit.owner";
  # minecraft-data 26.1: stack sizes below 64, what each item can be enchanted with, every enchantment's survival
  # level and exclusions. Regenerate from mcbots' node_modules (minecraft-data) when the server version moves.
  limits = builtins.fromJSON (builtins.readFile ./item-limits.json);

  # An item: id without "minecraft:", count, data components (rendered as SNBT); `max` is the stack
  # size when below 64 (item-limits.json), so the shulker box splits the count over several slots.
  i = id: n:
    {
      inherit id n;
      c = {};
    }
    // lib.optionalAttrs (limits.stack ? ${id}) {max = limits.stack.${id};};
  ic = id: n: c: i id n // {inherit c;};
  ench = id: e: ic id 1 {enchantments = e;};
  potion = kind: p: n: ic kind n {potion_contents = {potion = "minecraft:${p}";};} // {max = 1;};
  few = id: n: max: i id n // {inherit max;};
  maxed = {
    unbreaking = 3;
    mending = 1;
  };
  rocket = n: ic "firework_rocket" n {fireworks = {flight_duration = 3;};};

  snbtKey = k:
    if builtins.match "[A-Za-z0-9_.+-]+" k != null
    then k
    else builtins.toJSON k;
  snbt = v:
    if builtins.isAttrs v
    then "{" + concatStringsSep "," (mapAttrsToList (k: x: "${snbtKey k}:${snbt x}") v) + "}"
    else if builtins.isList v
    then "[" + concatMapStringsSep "," snbt v + "]"
    else if builtins.isString v
    then builtins.toJSON v
    else if builtins.isBool v
    then lib.boolToString v
    else toString v;

  give = it:
    "[console] give %player_name% minecraft:${it.id}"
    + lib.optionalString (it.c != {}) ("[" + concatStringsSep "," (mapAttrsToList (k: v: "${k}=${snbt v}") it.c) + "]")
    + " ${toString it.n}";
  stacksOf = it: let
    m = it.max or 64;
  in
    if it.n <= m
    then [it]
    else [(it // {n = m;})] ++ stacksOf (it // {n = it.n - m;});
  # Each category has its shulker colour, the box name that colour in text (owner 2026-10-18: "in shulkers mit farbe").
  textColor = {
    white = "white";
    orange = "gold";
    magenta = "light_purple";
    light_blue = "aqua";
    yellow = "yellow";
    lime = "green";
    pink = "light_purple";
    gray = "dark_gray";
    light_gray = "gray";
    cyan = "dark_aqua";
    purple = "dark_purple";
    blue = "blue";
    brown = "gold";
    green = "dark_green";
    red = "red";
    black = "dark_red";
  };
  box = color: kit: let
    stacks = lib.concatMap stacksOf kit.items;
  in
    assert lib.assertMsg (builtins.length stacks <= 27) "kit ${kit.name}: more than 27 stacks do not fit a shulker box"; let
      slot = s: it: {
        slot = s;
        item =
          {
            id = "minecraft:${it.id}";
            count = it.n;
          }
          // lib.optionalAttrs (it.c != {}) {components = it.c;};
      };
      name = snbt {
        text = kit.name;
        color = textColor.${color};
        italic = false;
      };
    in "[console] give %player_name% minecraft:${color}_shulker_box[custom_name=${name},container=${snbt (imap0 slot stacks)}] 1";

  pretty = it: let
    what =
      if it.c ? stored_enchantments
      then "book " + concatStringsSep ", " (mapAttrsToList (e: l: "${e} ${toString l}") it.c.stored_enchantments)
      else if it.c ? potion_contents
      then "${it.id} ${lib.removePrefix "minecraft:" it.c.potion_contents.potion}"
      else it.id;
  in
    "&7${toString it.n}x ${builtins.replaceStrings ["_"] [" "] what}" + lib.optionalString (it.c ? enchantments) " &d*";
  lore = items:
    lib.take 12 (map pretty items)
    ++ lib.optional (builtins.length items > 12) "&7... und ${toString (builtins.length items - 12)} weitere"
    ++ ["" "&eLinks: ins Inventar" "&eRechts: als Shulker-Box"];

  # A kit: name, icon, items; or parts = [kits] for a bundle (one box per part on right click).
  kit = name: icon: items: {inherit name icon items;};
  bundle = name: icon: parts: {
    inherit name icon parts;
    items = lib.concatMap (p: p.items) parts;
  };
  button = cond: color: k: {
    material = toUpper k.icon;
    name = "&b${k.name}";
    lore = lore k.items;
    conditions = cond;
    left-click.commands = map give k.items ++ ["[msg] &a${k.name}: ins Inventar gelegt."];
    right-click.commands =
      map (box color) (k.parts or [k])
      ++ ["[msg] &a${k.name}: Box bekommen - ab in die Endertruhe."];
  };

  # A category panel: kits in reading order, back button bottom right.
  category = id: title: cond: color: kits: extra: let
    n = builtins.length kits + builtins.length extra;
    rows = (n + 8) / 9 + 1;
  in
    assert lib.assertMsg (rows <= 6) "kit category ${id}: too many kits for one panel"; {
      inherit title rows;
      type = "inventory";
      conditions = cond;
      layout =
        builtins.listToAttrs (imap0 (s: name: lib.nameValuePair (toString s) [name])
          (imap0 (j: _: "k${toString j}") kits ++ map (e: e.id) extra))
        // {"${toString (rows * 9 - 1)}" = ["back"];};
      items =
        builtins.listToAttrs (imap0 (j: k: lib.nameValuePair "k${toString j}" (button cond color k)) kits)
        // builtins.listToAttrs (map (e: lib.nameValuePair e.id (removeAttrs e ["id"])) extra)
        // {
          back = {
            material = "ARROW";
            name = "&7Zurueck";
            left-click.commands = ["[open] kit"];
          };
        };
    };

  # --- Survival: tiers, then the max kits that were /kit before ------------------------------
  maxArmor = kit "Netherite-Ruestung" "netherite_chestplate" [
    (ench "netherite_helmet" (maxed
      // {
        protection = 4;
        respiration = 3;
        aqua_affinity = 1;
      }))
    (ench "netherite_chestplate" (maxed // {protection = 4;}))
    (ench "netherite_leggings" (maxed // {protection = 4;}))
    (ench "netherite_boots" (maxed
      // {
        protection = 4;
        feather_falling = 4;
        depth_strider = 3;
      }))
    (ench "elytra" maxed)
    (i "totem_of_undying" 1)
    (ench "shield" maxed)
  ];
  maxWeapons = kit "Netherite-Waffen" "netherite_sword" [
    (ench "netherite_sword" (maxed
      // {
        sharpness = 5;
        looting = 3;
        fire_aspect = 2;
        sweeping_edge = 3;
      }))
    (ench "bow" {
      power = 5;
      infinity = 1;
      unbreaking = 3;
    })
    (i "arrow" 1)
    (ench "trident" (maxed
      // {
        loyalty = 3;
        impaling = 5;
      }))
    (ench "netherite_axe" (maxed
      // {
        sharpness = 5;
        efficiency = 5;
      }))
  ];
  maxTools = kit "Netherite-Werkzeug" "netherite_pickaxe" [
    (ench "netherite_pickaxe" (maxed
      // {
        efficiency = 5;
        fortune = 3;
      }))
    (ench "netherite_shovel" (maxed // {efficiency = 5;}))
    (ench "netherite_hoe" (maxed
      // {
        efficiency = 5;
        fortune = 3;
      }))
    (ench "fishing_rod" (maxed
      // {
        luck_of_the_sea = 3;
        lure = 3;
      }))
    (ench "shears" {
      efficiency = 5;
      unbreaking = 3;
    })
    (i "flint_and_steel" 1)
  ];
  supplies = kit "Vorraete" "golden_carrot" [
    (i "golden_carrot" 64)
    (rocket 64)
    (i "ender_pearl" 16)
    (i "water_bucket" 1)
    (i "lava_bucket" 1)
    (i "torch" 64)
    (i "cobblestone" 64)
    (i "oak_planks" 64)
    (i "ender_chest" 1)
    (i "white_bed" 1)
    (i "experience_bottle" 64)
    (i "golden_apple" 16)
  ];
  tier = name: icon: m: weapon: extra:
    kit name icon ([
        (i "${m}_helmet" 1)
        (i "${m}_chestplate" 1)
        (i "${m}_leggings" 1)
        (i "${m}_boots" 1)
        (i "${weapon}_sword" 1)
        (i "${weapon}_pickaxe" 1)
        (i "${weapon}_axe" 1)
        (i "${weapon}_shovel" 1)
        (i "shield" 1)
      ]
      ++ extra);
  survival = [
    (tier "Start" "leather_chestplate" "leather" "stone" [(i "bread" 32) (i "torch" 32) (i "oak_log" 16) (i "crafting_table" 1) (i "white_bed" 1)])
    (tier "Eisen" "iron_chestplate" "iron" "iron" [(i "bow" 1) (i "arrow" 64) (i "cooked_beef" 32) (i "torch" 64) (i "water_bucket" 1) (i "white_bed" 1)])
    (tier "Diamant" "diamond_chestplate" "diamond" "diamond" [(i "bow" 1) (i "arrow" 64) (i "cooked_beef" 64) (i "torch" 64) (i "water_bucket" 1) (i "ender_pearl" 16) (i "golden_apple" 8)])
    maxArmor
    maxWeapons
    maxTools
    supplies
    (bundle "Alles Netherite (4 Boxen)" "nether_star" [maxArmor maxWeapons maxTools supplies])
  ];

  # --- Bauen: blocks and build tools only, nothing for surviving ------------------------------
  stacks = ids: map (id: i id 64) ids;
  wood = w: stacks ["${w}_planks" "${w}_stairs" "${w}_slab" "${w}_log"];
  buildTools = [
    (ench "netherite_pickaxe" (maxed
      // {
        efficiency = 5;
        silk_touch = 1;
      }))
    (ench "netherite_axe" (maxed // {efficiency = 5;}))
    (ench "netherite_shovel" (maxed // {efficiency = 5;}))
  ];
  bauen = [
    (kit "Steinbau" "stone_bricks" (stacks [
      "stone"
      "cobblestone"
      "smooth_stone"
      "stone_bricks"
      "stone_brick_stairs"
      "stone_brick_slab"
      "stone_brick_wall"
      "mossy_stone_bricks"
      "chiseled_stone_bricks"
      "andesite"
      "polished_andesite"
      "deepslate_bricks"
      "deepslate_brick_stairs"
      "deepslate_brick_slab"
      "deepslate_tiles"
      "polished_deepslate"
      "bricks"
      "brick_stairs"
    ]))
    (kit "Holzbau" "oak_planks" (wood "oak"
      ++ wood "spruce"
      ++ wood "dark_oak"
      ++ wood "birch"
      ++ stacks ["oak_fence" "spruce_fence" "oak_trapdoor" "spruce_trapdoor"]
      ++ [(i "oak_door" 64) (i "spruce_door" 64)]))
    (kit "Glas und Licht" "lantern" (stacks [
      "glass"
      "glass_pane"
      "tinted_glass"
      "white_stained_glass"
      "light_gray_stained_glass"
      "black_stained_glass"
      "light_blue_stained_glass"
      "lantern"
      "soul_lantern"
      "torch"
      "sea_lantern"
      "glowstone"
      "shroomlight"
      "end_rod"
      "redstone_lamp"
      "candle"
    ]))
    (kit "Deko" "flower_pot" (stacks [
        "flower_pot"
        "bookshelf"
        "chiseled_bookshelf"
        "barrel"
        "item_frame"
        "painting"
        "white_carpet"
        "red_carpet"
        "white_wool"
        "iron_bars"
        "iron_chain"
        "cobweb"
        "moss_carpet"
        "azalea_leaves"
        "poppy"
        "dandelion"
      ]
      ++ [(few "white_banner" 16 16) (few "armor_stand" 16 16) (few "decorated_pot" 4 1)]))
    (kit "Gelaende" "grass_block" (stacks [
        "dirt"
        "grass_block"
        "coarse_dirt"
        "podzol"
        "rooted_dirt"
        "moss_block"
        "mud"
        "sand"
        "red_sand"
        "gravel"
        "clay"
        "stone"
        "oak_sapling"
        "spruce_sapling"
        "bone_meal"
        "short_grass"
        "fern"
      ]
      ++ [(i "water_bucket" 1) (i "lava_bucket" 1)]))
    (kit "Bauwerkzeug" "scaffolding" (buildTools
      ++ stacks ["scaffolding" "ladder"]
      ++ [
        (ench "elytra" maxed)
        (rocket 64)
        (rocket 64)
        (i "water_bucket" 1)
        (i "ender_chest" 1)
        (i "spyglass" 1)
        (i "shulker_box" 1)
      ]))
  ];

  # --- Situationen ---------------------------------------------------------------------------
  food = [(i "cooked_beef" 64)];
  situationen = [
    (kit "Bergbau" "diamond_pickaxe" ([
        (ench "diamond_pickaxe" (maxed
          // {
            efficiency = 5;
            fortune = 3;
          }))
        (ench "diamond_pickaxe" (maxed
          // {
            efficiency = 5;
            silk_touch = 1;
          }))
        (ench "diamond_shovel" (maxed // {efficiency = 5;}))
        (i "water_bucket" 1)
        (potion "potion" "long_night_vision" 3)
      ]
      ++ stacks ["torch" "torch" "cobblestone" "ladder"]
      ++ food))
    (kit "Nether" "netherrack" ([
        (i "golden_helmet" 1)
        (potion "potion" "long_fire_resistance" 4)
        (i "obsidian" 14)
        (i "flint_and_steel" 1)
        (ench "bow" {
          power = 5;
          infinity = 1;
          unbreaking = 3;
        })
        (i "arrow" 1)
        (i "ender_pearl" 16)
        (i "gold_ingot" 64)
      ]
      ++ stacks ["cobblestone" "torch"]
      ++ food))
    (kit "Ende" "end_stone" ([
        (i "ender_pearl" 16)
        (i "ender_pearl" 16)
        (potion "potion" "long_slow_falling" 4)
        (i "water_bucket" 1)
        (i "carved_pumpkin" 1)
        (ench "bow" {
          power = 5;
          infinity = 1;
          unbreaking = 3;
        })
        (i "arrow" 1)
        (few "white_bed" 8 1)
        (i "ender_chest" 1)
      ]
      ++ stacks ["cobblestone" "ladder"]
      ++ food))
    (kit "Farm" "wheat" [
      (ench "netherite_hoe" (maxed
        // {
          efficiency = 5;
          fortune = 3;
        }))
      (i "wheat_seeds" 64)
      (i "carrot" 64)
      (i "potato" 64)
      (i "beetroot_seeds" 64)
      (i "melon_seeds" 16)
      (i "pumpkin_seeds" 16)
      (i "sugar_cane" 64)
      (i "bone_meal" 64)
      (i "bone_meal" 64)
      (i "water_bucket" 1)
      (i "water_bucket" 1)
      (i "composter" 4)
      (i "wheat" 64)
      (i "lead" 8)
      (i "oak_fence" 64)
      (i "oak_fence_gate" 8)
    ])
    (kit "Reise" "compass" ([
        (ench "elytra" maxed)
        (rocket 64)
        (rocket 64)
        (rocket 64)
        (i "compass" 1)
        (i "recovery_compass" 1)
        (i "map" 1)
        (i "spyglass" 1)
        (i "clock" 1)
        (i "oak_boat" 1)
        (i "saddle" 1)
        (i "lead" 4)
        (i "golden_carrot" 64)
        (i "white_bed" 1)
        (i "ender_chest" 1)
        (i "water_bucket" 1)
      ]
      ++ stacks ["cobblestone" "torch"]))
    (kit "Redstone" "redstone" (stacks [
        "redstone"
        "redstone_torch"
        "redstone_block"
        "redstone_lamp"
        "lever"
        "stone_button"
        "stone_pressure_plate"
        "target"
        "repeater"
        "comparator"
        "piston"
        "sticky_piston"
        "observer"
        "hopper"
        "dropper"
        "dispenser"
        "crafter"
        "slime_block"
        "honey_block"
        "rail"
        "powered_rail"
        "daylight_detector"
        "note_block"
        "tripwire_hook"
        "smooth_stone"
      ]
      ++ [(i "minecart" 1) (i "hopper_minecart" 1)]))
    (kit "Unterwasser" "trident" ([
        (ench "turtle_helmet" (maxed
          // {
            respiration = 3;
            aqua_affinity = 1;
          }))
        (ench "diamond_boots" (maxed // {depth_strider = 3;}))
        (ench "trident" (maxed
          // {
            riptide = 3;
            impaling = 5;
          }))
        (potion "potion" "long_water_breathing" 4)
        (potion "potion" "long_night_vision" 4)
        (i "conduit" 1)
        (i "prismarine" 64)
        (i "sponge" 16)
        (i "oak_door" 4)
        (i "oak_boat" 1)
      ]
      ++ food))
    (kit "Brauen" "brewing_stand" [
      (i "brewing_stand" 1)
      (i "cauldron" 1)
      (i "blaze_rod" 16)
      (i "blaze_powder" 64)
      (i "nether_wart" 64)
      (i "glass_bottle" 64)
      (i "water_bucket" 1)
      (i "redstone" 64)
      (i "glowstone_dust" 64)
      (i "gunpowder" 64)
      (i "dragon_breath" 16)
      (i "fermented_spider_eye" 64)
      (i "magma_cream" 64)
      (i "sugar" 64)
      (i "golden_carrot" 64)
      (i "glistering_melon_slice" 64)
      (i "ghast_tear" 64)
      (i "rabbit_foot" 64)
      (i "pufferfish" 64)
      (i "phantom_membrane" 64)
      (i "turtle_scute" 64)
      (i "spider_eye" 64)
    ])
    (kit "Verzaubern" "enchanting_table" [
      (i "enchanting_table" 1)
      (i "bookshelf" 15)
      (i "lapis_lazuli" 64)
      (i "lapis_lazuli" 64)
      (i "experience_bottle" 64)
      (i "experience_bottle" 64)
      (i "experience_bottle" 64)
      (i "anvil" 1)
      (i "grindstone" 1)
      (i "book" 64)
      (ic "enchanted_book" 1 {stored_enchantments = {mending = 1;};})
      (ic "enchanted_book" 1 {stored_enchantments = {unbreaking = 3;};})
      (ic "enchanted_book" 1 {stored_enchantments = {protection = 4;};})
      (ic "enchanted_book" 1 {stored_enchantments = {efficiency = 5;};})
      (ic "enchanted_book" 1 {stored_enchantments = {sharpness = 5;};})
    ])
    (kit "Kampf" "diamond_sword" ([
        (ench "netherite_sword" (maxed
          // {
            sharpness = 5;
            looting = 3;
            fire_aspect = 2;
            sweeping_edge = 3;
          }))
        (ench "netherite_axe" (maxed // {sharpness = 5;}))
        (ench "shield" maxed)
        (ench "netherite_helmet" (maxed // {protection = 4;}))
        (ench "netherite_chestplate" (maxed // {protection = 4;}))
        (ench "netherite_leggings" (maxed // {protection = 4;}))
        (ench "netherite_boots" (maxed
          // {
            protection = 4;
            feather_falling = 4;
          }))
        (i "totem_of_undying" 1)
        (i "totem_of_undying" 1)
        (i "golden_apple" 16)
        (i "enchanted_golden_apple" 2)
        (i "ender_pearl" 16)
        (potion "splash_potion" "strong_healing" 8)
        (potion "potion" "strong_strength" 2)
        (potion "potion" "strong_swiftness" 2)
      ]
      ++ food))
    (kit "Bogen" "bow" [
      (ench "bow" (maxed
        // {
          power = 5;
          punch = 2;
          flame = 1;
        }))
      (ench "crossbow" (maxed
        // {
          quick_charge = 3;
          multishot = 1;
        }))
      (i "arrow" 64)
      (i "arrow" 64)
      (i "spectral_arrow" 64)
      (ic "tipped_arrow" 64 {potion_contents = {potion = "minecraft:strong_harming";};})
      (ic "tipped_arrow" 64 {potion_contents = {potion = "minecraft:long_slowness";};})
      (rocket 64)
      (i "target" 4)
    ])
    (kit "Angeln" "fishing_rod" [
      (ench "fishing_rod" (maxed
        // {
          luck_of_the_sea = 3;
          lure = 3;
        }))
      (ench "fishing_rod" (maxed
        // {
          luck_of_the_sea = 3;
          lure = 3;
        }))
      (i "bucket" 4)
      (i "campfire" 1)
      (i "oak_boat" 1)
      (i "torch" 16)
      (i "bread" 32)
    ])
    (kit "Notfall" "totem_of_undying" ([
        (i "totem_of_undying" 1)
        (i "totem_of_undying" 1)
        (i "enchanted_golden_apple" 4)
        (i "golden_apple" 16)
        (potion "splash_potion" "strong_healing" 8)
        (potion "potion" "long_fire_resistance" 2)
        (potion "potion" "strong_regeneration" 2)
        (i "water_bucket" 1)
        (i "ender_pearl" 16)
        (i "white_bed" 1)
        (i "cobblestone" 64)
      ]
      ++ food))
  ];

  # --- Bots: boxes for the bots' base chest ----------------------------------------------------
  bots = [
    (kit "Bot-Arbeit" "iron_pickaxe" [
      (i "iron_pickaxe" 1)
      (i "iron_pickaxe" 1)
      (i "iron_pickaxe" 1)
      (i "iron_pickaxe" 1)
      (i "stone_pickaxe" 1)
      (i "stone_pickaxe" 1)
      (i "iron_axe" 1)
      (i "iron_axe" 1)
      (i "iron_shovel" 1)
      (i "iron_shovel" 1)
      (i "iron_sword" 1)
      (i "iron_sword" 1)
      (i "torch" 64)
      (i "torch" 64)
      (i "bread" 64)
      (i "bread" 64)
      (i "cooked_beef" 64)
    ])
    (kit "Bot-Bau" "cobblestone" (stacks [
        "cobblestone"
        "cobblestone"
        "cobblestone"
        "cobblestone"
        "cobblestone"
        "cobblestone"
        "stone_bricks"
        "stone_bricks"
        "stone_bricks"
        "stone_bricks"
        "oak_planks"
        "oak_planks"
        "ladder"
        "torch"
        "glass"
      ]
      ++ [(i "bread" 64)]))
    (kit "Bot-Farm" "iron_hoe" [
      (i "iron_hoe" 1)
      (i "iron_hoe" 1)
      (i "wheat_seeds" 64)
      (i "carrot" 64)
      (i "potato" 64)
      (i "bone_meal" 64)
      (i "bone_meal" 64)
      (i "water_bucket" 1)
      (i "water_bucket" 1)
      (i "bread" 64)
    ])
  ];

  # --- OP, owner only: admin build blocks; the over-max gear stays in owner.yml ----------------
  op = [
    (kit "Admin-Bau" "structure_void" [
      (i "debug_stick" 1)
      (i "light" 64)
      (i "barrier" 64)
      (i "structure_void" 64)
      (ench "netherite_pickaxe" {
        efficiency = 255;
        silk_touch = 1;
        unbreaking = 255;
      })
      (ench "elytra" {unbreaking = 255;})
      (rocket 64)
    ])
  ];

  # No hack stuff (owner 2026-10-18): outside OP an enchantment is at most its survival level, on an item that can
  # take it (any on a book), never next to one it excludes (item-limits.json). -> the offending enchantments
  illegal = it: let
    es = (it.c.enchantments or {}) // (it.c.stored_enchantments or {});
    bad = e: let
      l = limits.enchant.${e} or null;
    in
      l
      == null
      || es.${e} > l.max
      || lib.any (x: es ? ${x}) l.exclude
      || (it.id != "enchanted_book" && !lib.elem l.category (limits.accepts.${it.id} or []));
  in
    builtins.filter bad (builtins.attrNames es);
  legal = c: let
    bad = lib.concatMap (k: lib.concatMap (it: map (e: "${k.name}/${it.id}/${e}") (illegal it)) k.items) c.kits;
  in
    c.id == "op" || bad == [] || throw "kit category ${c.id}: not survival-legal: ${concatStringsSep ", " bad}";

  categories =
    [
      {
        id = "survival";
        color = "light_blue";
        title = "&8Kits: Survival";
        name = "Survival";
        icon = "iron_chestplate";
        cond = admin;
        kits = survival;
        text = "Start, Eisen, Diamant, Netherite";
      }
      {
        id = "bauen";
        color = "orange";
        title = "&8Kits: Bauen";
        name = "Bauen";
        icon = "bricks";
        cond = admin;
        kits = bauen;
        text = "Bloecke und Bauwerkzeug, ohne Survival-Kram";
      }
      {
        id = "situation";
        color = "cyan";
        title = "&8Kits: Situationen";
        name = "Situationen";
        icon = "compass";
        cond = admin;
        kits = situationen;
        text = "Bergbau, Nether, Ende, Farm, Reise, ...";
      }
      {
        id = "bots";
        color = "gray";
        title = "&8Kits: Bots";
        name = "Bots";
        icon = "armor_stand";
        cond = admin;
        kits = bots;
        text = "Boxen fuer die Bot-Kiste";
      }
      {
        id = "op";
        color = "black";
        title = "&8Kits: OP";
        name = "&cOP (nur Owner)";
        icon = "nether_star";
        cond = owner;
        kits = op;
        text = "Admin-Bau und die Owner-Ausruestung";
        extra = [
          {
            id = "owner";
            material = "BEACON";
            name = "&cOwner-Ausruestung (/owner)";
            conditions = owner;
            left-click.commands = ["[open] owner"];
          }
        ];
      }
    ]
    ++ import ./kits-shop.nix {inherit lib i ic ench potion maxed rocket stacks kit bundle admin;};
in
  {
    kit = {
      title = "&8Kits";
      type = "inventory";
      command = "kit";
      conditions = admin;
      # Seven a row inside a border: 18 categories in three rows.
      rows = 2 + (builtins.length categories + 6) / 7;
      layout = builtins.listToAttrs (imap0 (j: c: lib.nameValuePair (toString (10 + 9 * (j / 7) + lib.mod j 7)) [c.id]) categories);
      items = builtins.listToAttrs (map (c:
        lib.nameValuePair c.id {
          material = toUpper c.icon;
          name = "&b${c.name}";
          lore = ["&7${c.text}" "&7${toString (builtins.length c.kits)} Kits"];
          conditions = c.cond;
          left-click.commands = ["[open] kit-${c.id}"];
        })
      categories);
    };
  }
  // builtins.listToAttrs (map (c: assert legal c; lib.nameValuePair "kit-${c.id}" (category c.id c.title c.cond c.color c.kits (c.extra or [])))
    categories)
