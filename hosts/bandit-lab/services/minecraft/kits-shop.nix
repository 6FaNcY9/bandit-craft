# More /kit categories (owner 2026-10-18): a kit for almost everything, like the kit shops of 2b2t, each category
# in its own shulker colour. Only what survival can give: no spawn eggs, no admin blocks, no duped or over-enchanted
# items; kits.nix checks every enchantment against its survival level and exclusions (item-limits.json).
# Counts are totals: kits.nix splits them into stacks of the item's stack size.
# Returns a list of categories as kits.nix defines them.
{
  lib,
  i,
  ic,
  ench,
  potion,
  maxed,
  rocket,
  stacks,
  kit,
  bundle,
  admin,
}: let
  colors = ["white" "orange" "magenta" "light_blue" "yellow" "lime" "pink" "gray" "light_gray" "cyan" "purple" "blue" "brown" "green" "red" "black"];
  each = suffix: n: map (c: i "${c}_${suffix}" n) colors;
  book = e: l: n: ic "enchanted_book" n {stored_enchantments = {${e} = l;};};
  arrow = p: ic "tipped_arrow" 64 {potion_contents = {potion = "minecraft:${p}";};};
  drink = potion "potion";
  splash = potion "splash_potion";
  linger = potion "lingering_potion";
  horn = v: ic "goat_horn" 1 {instrument = "minecraft:${v}_goat_horn";};
  totems = n: i "totem_of_undying" n;

  prot = maxed // {protection = 4;};
  # Helmet, chestplate, leggings, boots of one material, every piece with `e` and its own best extras.
  armour = m: e: [
    (ench "${m}_helmet" (e
      // {
        respiration = 3;
        aqua_affinity = 1;
      }))
    (ench "${m}_chestplate" e)
    (ench "${m}_leggings" (e // {swift_sneak = 3;}))
    (ench "${m}_boots" (e
      // {
        feather_falling = 4;
        depth_strider = 3;
        soul_speed = 3;
      }))
  ];
  # Crystal PvP: blast protection on the leggings, protection elsewhere.
  crystalArmour = [
    (ench "netherite_helmet" prot)
    (ench "netherite_chestplate" prot)
    (ench "netherite_leggings" (maxed // {blast_protection = 4;}))
    (ench "netherite_boots" (prot // {feather_falling = 4;}))
  ];
  sword = m: e:
    ench "${m}_sword" (maxed
      // {
        fire_aspect = 2;
        looting = 3;
        sweeping_edge = 3;
      }
      // e);
  sharpSword = m: sword m {sharpness = 5;};
  pickaxe = m: e: ench "${m}_pickaxe" (maxed // {efficiency = 5;} // e);
  axe = m: e: ench "${m}_axe" (maxed // {efficiency = 5;} // e);
  shovel = m: e: ench "${m}_shovel" (maxed // {efficiency = 5;} // e);
  hoe = m: e: ench "${m}_hoe" (maxed // {efficiency = 5;} // e);
  tools = m: e: [(pickaxe m e) (axe m e) (shovel m e) (hoe m e)];
  fortune = {fortune = 3;};
  silk = {silk_touch = 1;};
  pvpFood = [(i "enchanted_golden_apple" 64) (i "ender_pearl" 32) (i "experience_bottle" 128)];

  # --- PvP -------------------------------------------------------------------------------------
  pvp = [
    (kit "Kristall-PvP" "end_crystal" (crystalArmour
      ++ [(sharpSword "netherite") (pickaxe "netherite" {}) (totems 6) (i "end_crystal" 256) (i "obsidian" 256)]
      ++ pvpFood))
    (kit "Anker-PvP" "respawn_anchor" (crystalArmour
      ++ [(sharpSword "netherite") (totems 6) (i "respawn_anchor" 256) (i "glowstone" 256) (i "obsidian" 128)]
      ++ pvpFood))
    (kit "Schwert-PvP" "netherite_sword" (armour "netherite" prot
      ++ [
        (sharpSword "netherite")
        (axe "netherite" {sharpness = 5;})
        (ench "shield" maxed)
        (totems 3)
        (i "golden_apple" 64)
        (drink "strong_strength" 2)
        (drink "strong_swiftness" 2)
        (drink "long_fire_resistance" 2)
        (splash "strong_healing" 4)
      ]
      ++ pvpFood))
    (kit "Streitkolben" "mace" (armour "netherite" prot
      ++ [
        (ench "mace" (maxed
          // {
            density = 5;
            wind_burst = 3;
            fire_aspect = 2;
          }))
        (ench "mace" (maxed
          // {
            breach = 4;
            wind_burst = 3;
          }))
        (ench "elytra" maxed)
        (rocket 128)
        (i "wind_charge" 256)
        (totems 4)
      ]
      ++ pvpFood))
    (kit "Speer" "netherite_spear" (armour "netherite" prot
      ++ [
        (ench "netherite_spear" (maxed
          // {
            lunge = 3;
            sharpness = 5;
          }))
        (ench "diamond_spear" (maxed // {lunge = 3;}))
        (i "saddle" 1)
        (i "diamond_horse_armor" 1)
        (i "lead" 4)
        (i "golden_carrot" 64)
        (totems 3)
      ]
      ++ pvpFood))
    (kit "Bogen & Armbrust" "crossbow" [
      (ench "bow" {
        power = 5;
        punch = 2;
        flame = 1;
        infinity = 1;
        unbreaking = 3;
      })
      (ench "bow" (maxed
        // {
          power = 5;
          punch = 2;
          flame = 1;
        }))
      (ench "crossbow" (maxed
        // {
          multishot = 1;
          quick_charge = 3;
        }))
      (ench "crossbow" (maxed
        // {
          piercing = 4;
          quick_charge = 3;
        }))
      (i "arrow" 192)
      (i "spectral_arrow" 128)
      (arrow "strong_harming")
      (arrow "strong_poison")
      (arrow "strong_slowness")
      (arrow "long_weakness")
      (rocket 64)
    ])
    (kit "PvP-Traenke" "splash_potion" [
      (drink "strong_strength" 4)
      (drink "strong_swiftness" 4)
      (drink "long_fire_resistance" 3)
      (drink "strong_regeneration" 2)
      (drink "strong_turtle_master" 2)
      (splash "strong_healing" 8)
      (splash "strong_harming" 2)
      (splash "long_slow_falling" 2)
    ])
    (kit "Totems" "totem_of_undying" [(totems 27)])
    (kit "Goldaepfel" "enchanted_golden_apple" [(i "enchanted_golden_apple" 576) (i "golden_apple" 576)])
    (kit "Endkristalle" "end_crystal" [(i "end_crystal" 1728)])
    (kit "Obsidian" "obsidian" [(i "obsidian" 1408) (i "crying_obsidian" 320)])
    (kit "Enderperlen" "ender_pearl" [(i "ender_pearl" 400) (i "chorus_fruit" 128)])
    (kit "Erfahrung" "experience_bottle" [(i "experience_bottle" 1728)])
    (kit "Anker & Glowstone" "glowstone" [(i "respawn_anchor" 576) (i "glowstone" 1152)])
    (kit "Windladungen" "wind_charge" [(i "wind_charge" 1728)])
    (kit "Raketen" "firework_rocket" [(rocket 1728)])
    (kit "Spinnennetze" "cobweb" [(i "cobweb" 1536) (i "water_bucket" 3)])
  ];

  # --- Ausruestung -----------------------------------------------------------------------------
  ausruestung = [
    (kit "Netherite: Schutz" "netherite_chestplate" (armour "netherite" prot ++ [(sharpSword "netherite") (ench "shield" maxed) (totems 2)]))
    (kit "Netherite: Explosion" "tnt" (armour "netherite" (maxed // {blast_protection = 4;}) ++ [(totems 2)]))
    (kit "Netherite: Feuer" "blaze_powder" (armour "netherite" (maxed // {fire_protection = 4;}) ++ [(drink "long_fire_resistance" 4) (totems 2)]))
    (kit "Netherite: Projektile" "arrow" (armour "netherite" (maxed // {projectile_protection = 4;}) ++ [(ench "shield" maxed) (totems 2)]))
    (kit "Diamant-Set" "diamond_chestplate" (armour "diamond" prot ++ [(sharpSword "diamond") (ench "bow" (maxed // {power = 5;}))] ++ tools "diamond" fortune))
    (kit "Eisen-Set" "iron_chestplate" (armour "iron" prot ++ [(sharpSword "iron") (ench "shield" maxed)] ++ tools "iron" {}))
    (kit "Kupfer-Set" "copper_chestplate" (armour "copper" prot ++ [(sharpSword "copper")] ++ tools "copper" {}))
    (kit "Gold-Set (Piglins)" "golden_helmet" (armour "golden" prot ++ [(sharpSword "golden") (i "gold_ingot" 128)]))
    (kit "Kettenruestung" "chainmail_chestplate" (armour "chainmail" prot ++ [(sharpSword "iron")]))
    (kit "Leder (gefaerbt)" "leather_chestplate" (map (c:
      ic "leather_${c.p}" 1 {
        dyed_color = c.rgb;
        enchantments = prot;
      }) [
      {
        p = "helmet";
        rgb = 11546150;
      }
      {
        p = "chestplate";
        rgb = 3949738;
      }
      {
        p = "leggings";
        rgb = 16701501;
      }
      {
        p = "boots";
        rgb = 3847130;
      }
    ]))
    (kit "Schildkroete" "turtle_helmet" [
      (ench "turtle_helmet" (prot
        // {
          respiration = 3;
          aqua_affinity = 1;
        }))
      (i "turtle_scute" 64)
      (drink "strong_turtle_master" 3)
    ])
    (kit "Elytra-Flug" "elytra" [(ench "elytra" maxed) (ench "elytra" maxed) (rocket 384) (i "phantom_membrane" 64) (i "ender_chest" 1)])
    (kit "Werkzeug: Glueck" "netherite_pickaxe" (tools "netherite" fortune
      ++ [
        (ench "shears" maxed)
        (ench "fishing_rod" (maxed
          // {
            luck_of_the_sea = 3;
            lure = 3;
          }))
      ]))
    (kit "Werkzeug: Behutsamkeit" "diamond_pickaxe" (tools "netherite" silk ++ [(ench "shears" maxed) (ench "brush" maxed)]))
    (kit "Werkzeug: Diamant" "diamond_shovel" (tools "diamond" {} ++ tools "diamond" fortune))
    (kit "Werkzeug: Eisen" "iron_shovel" (tools "iron" {} ++ [(i "shears" 1) (i "flint_and_steel" 1) (i "bucket" 3)]))
    (kit "Schwerter" "diamond_sword" [
      (sharpSword "netherite")
      (sword "netherite" {smite = 5;})
      (sword "netherite" {bane_of_arthropods = 5;})
      (sword "netherite" {
        sharpness = 5;
        knockback = 2;
      })
      (sharpSword "diamond")
      (sharpSword "iron")
    ])
    (kit "Aexte" "netherite_axe" [
      (axe "netherite" {sharpness = 5;})
      (axe "netherite" {smite = 5;})
      (axe "netherite" silk)
      (axe "diamond" {sharpness = 5;})
      (axe "iron" {})
    ])
    (kit "Dreizack" "trident" [
      (ench "trident" (maxed
        // {
          loyalty = 3;
          impaling = 5;
        }))
      (ench "trident" (maxed
        // {
          loyalty = 3;
          channeling = 1;
        }))
      (ench "trident" (maxed
        // {
          riptide = 3;
          impaling = 5;
        }))
    ])
    (kit "Schilde & Banner" "shield" ([(ench "shield" maxed) (ench "shield" maxed) (ench "shield" maxed)] ++ map (c: i "${c}_banner" 4) ["white" "red" "blue" "black" "yellow" "green"]))
    (kit "Besatz: Vorlagen" "flow_armor_trim_smithing_template" (map (t: i "${t}_armor_trim_smithing_template" 4) [
      "sentry"
      "dune"
      "coast"
      "wild"
      "ward"
      "eye"
      "vex"
      "tide"
      "snout"
      "rib"
      "spire"
      "wayfinder"
      "shaper"
      "silence"
      "raiser"
      "host"
      "flow"
      "bolt"
    ]))
    (kit "Besatz: Materialien" "amethyst_shard" (stacks [
        "amethyst_shard"
        "copper_ingot"
        "diamond"
        "emerald"
        "gold_ingot"
        "iron_ingot"
        "lapis_lazuli"
        "netherite_ingot"
        "quartz"
        "redstone"
        "resin_brick"
      ]
      ++ [(i "netherite_upgrade_smithing_template" 16)]))
    (kit "Netherite-Aufwertung" "netherite_upgrade_smithing_template" [
      (i "netherite_upgrade_smithing_template" 64)
      (i "netherite_ingot" 64)
      (i "diamond_helmet" 1)
      (i "diamond_chestplate" 1)
      (i "diamond_leggings" 1)
      (i "diamond_boots" 1)
      (i "diamond_sword" 1)
      (i "diamond_pickaxe" 1)
      (i "diamond_axe" 1)
      (i "diamond_shovel" 1)
    ])
    (kit "Pferd" "saddle" [
      (i "saddle" 2)
      (i "netherite_horse_armor" 1)
      (i "diamond_horse_armor" 1)
      (i "golden_horse_armor" 1)
      (i "iron_horse_armor" 1)
      (i "copper_horse_armor" 1)
      (i "leather_horse_armor" 1)
      (i "lead" 16)
      (i "name_tag" 16)
      (i "golden_carrot" 64)
      (i "hay_block" 64)
    ])
    (kit "Happy Ghast" "white_harness" (each "harness" 1 ++ [(i "dried_ghast" 4) (i "snowball" 32) (i "lead" 8)]))
    (kit "Nautilus" "diamond_nautilus_armor" [
      (i "netherite_nautilus_armor" 1)
      (i "diamond_nautilus_armor" 1)
      (i "golden_nautilus_armor" 1)
      (i "iron_nautilus_armor" 1)
      (i "copper_nautilus_armor" 1)
      (i "saddle" 2)
      (i "pufferfish" 32)
      (i "lead" 8)
    ])
  ];

  # --- Bloecke: Farben -------------------------------------------------------------------------
  farben = [
    (kit "Beton" "light_blue_concrete" (each "concrete" 64))
    (kit "Beton: Grautoene" "gray_concrete" (map (c: i "${c}_concrete" 384) ["white" "light_gray" "gray" "black"]))
    (kit "Betonpulver" "magenta_concrete_powder" (each "concrete_powder" 64))
    (kit "Wolle" "yellow_wool" (each "wool" 64))
    (kit "Teppich" "red_carpet" (each "carpet" 64))
    (kit "Terrakotta" "orange_terracotta" (each "terracotta" 64 ++ [(i "terracotta" 64)]))
    (kit "Glasierte Terrakotta" "cyan_glazed_terracotta" (each "glazed_terracotta" 64))
    (kit "Buntglas" "pink_stained_glass" (each "stained_glass" 64))
    (kit "Glasscheiben" "lime_stained_glass_pane" (each "stained_glass_pane" 64))
    (kit "Glas" "glass" [(i "glass" 640) (i "glass_pane" 384) (i "tinted_glass" 128)])
    (kit "Kerzen" "purple_candle" (each "candle" 16 ++ [(i "candle" 16)]))
    (kit "Betten" "red_bed" (each "bed" 1))
    (kit "Banner" "blue_banner" (each "banner" 16))
    (kit "Shulker-Boxen" "purple_shulker_box" (each "shulker_box" 1 ++ [(i "shulker_box" 1)]))
    (kit "Farbstoffe" "red_dye" (each "dye" 64))
    (kit "Geschirre" "red_harness" (each "harness" 1))
  ];

  # --- Bloecke: Holz ---------------------------------------------------------------------------
  wood = name: w: {
    log ? "${w}_log",
    stripped ? "stripped_${w}_log",
    block ? "${w}_wood",
    leaves ? "${w}_leaves",
    sapling ? "${w}_sapling",
    boats ? ["${w}_boat" "${w}_chest_boat"],
    extra ? [],
  }:
    kit name "${w}_planks" (stacks [log stripped block]
      ++ [(i "${w}_planks" 192)]
      ++ stacks (map (s: "${w}_${s}") ["stairs" "slab" "fence" "fence_gate" "door" "trapdoor" "pressure_plate" "button" "shelf"])
      ++ [(i "${w}_sign" 16) (i "${w}_hanging_sign" 16)]
      ++ lib.optional (leaves != null) (i leaves 64)
      ++ lib.optional (sapling != null) (i sapling 64)
      ++ map (b: i b 1) boats
      ++ map (x: i x 64) extra);
  nether = w: wart: {
    log = "${w}_stem";
    stripped = "stripped_${w}_stem";
    block = "${w}_hyphae";
    leaves = wart;
    sapling = "${w}_fungus";
    boats = [];
    extra = ["${w}_roots" "${w}_nylium" "shroomlight"];
  };
  holz = [
    (wood "Eiche" "oak" {extra = ["apple"];})
    (wood "Fichte" "spruce" {})
    (wood "Birke" "birch" {})
    (wood "Tropenholz" "jungle" {extra = ["cocoa_beans" "vine"];})
    (wood "Akazie" "acacia" {})
    (wood "Schwarzeiche" "dark_oak" {})
    (wood "Mangrove" "mangrove" {
      sapling = "mangrove_propagule";
      extra = ["mangrove_roots" "muddy_mangrove_roots"];
    })
    (wood "Kirsche" "cherry" {extra = ["pink_petals"];})
    (wood "Blasseiche" "pale_oak" {extra = ["pale_moss_block" "pale_hanging_moss"];})
    (wood "Bambus" "bamboo" {
      log = "bamboo_block";
      stripped = "stripped_bamboo_block";
      block = "bamboo_mosaic";
      leaves = null;
      sapling = "bamboo";
      boats = ["bamboo_raft" "bamboo_chest_raft"];
      extra = ["bamboo_mosaic_stairs" "bamboo_mosaic_slab" "scaffolding"];
    })
    (wood "Karmesin" "crimson" (nether "crimson" "nether_wart_block"))
    (wood "Wirrholz" "warped" (nether "warped" "warped_wart_block"))
    (kit "Holz: Alle Staemme" "oak_log" (stacks [
      "oak_log"
      "spruce_log"
      "birch_log"
      "jungle_log"
      "acacia_log"
      "dark_oak_log"
      "mangrove_log"
      "cherry_log"
      "pale_oak_log"
      "bamboo_block"
      "crimson_stem"
      "warped_stem"
    ]))
  ];

  # --- Bloecke: Stein --------------------------------------------------------------------------
  # Stairs, slab and wall of a block; family adds the block itself, for the ones not named in the plural (stone_bricks).
  parts = base: map (s: "${base}_${s}") ["stairs" "slab" "wall"];
  family = base: [base] ++ parts base;
  stone = name: icon: ids: kit name icon (stacks ids);
  stein = [
    (stone "Stein" "stone_bricks" ([
        "stone"
        "stone_stairs"
        "stone_slab"
        "smooth_stone"
        "smooth_stone_slab"
        "cracked_stone_bricks"
        "chiseled_stone_bricks"
      ]
      ++ parts "stone_brick"
      ++ parts "mossy_stone_brick"
      ++ ["stone_bricks" "mossy_stone_bricks"]))
    (stone "Bruchstein" "cobblestone" (family "cobblestone" ++ family "mossy_cobblestone" ++ ["cobblestone" "cobblestone"]))
    (stone "Tiefenschiefer" "deepslate_tiles" (["deepslate" "chiseled_deepslate" "cracked_deepslate_bricks" "cracked_deepslate_tiles"]
      ++ family "cobbled_deepslate"
      ++ family "polished_deepslate"
      ++ parts "deepslate_brick"
      ++ parts "deepslate_tile"
      ++ ["deepslate_bricks" "deepslate_tiles"]))
    (stone "Granit, Diorit, Andesit" "polished_granite" (lib.concatMap (s: family s ++ ["polished_${s}" "polished_${s}_stairs" "polished_${s}_slab"]) ["granite" "diorite" "andesite"]))
    (stone "Tuff" "tuff_bricks" (family "tuff" ++ family "polished_tuff" ++ parts "tuff_brick" ++ ["tuff_bricks" "chiseled_tuff" "chiseled_tuff_bricks"]))
    (stone "Basalt & Calcit" "polished_basalt" ["basalt" "polished_basalt" "smooth_basalt" "calcite" "calcite" "dripstone_block" "dripstone_block" "pointed_dripstone"])
    (stone "Schwarzstein" "polished_blackstone_bricks" (family "blackstone"
      ++ family "polished_blackstone"
      ++ parts "polished_blackstone_brick"
      ++ ["polished_blackstone_bricks" "cracked_polished_blackstone_bricks" "chiseled_polished_blackstone" "gilded_blackstone" "polished_blackstone_button" "polished_blackstone_pressure_plate"]))
    (stone "Netherziegel" "nether_bricks" (parts "nether_brick"
      ++ parts "red_nether_brick"
      ++ ["nether_bricks" "red_nether_bricks" "cracked_nether_bricks" "chiseled_nether_bricks" "nether_brick_fence" "netherrack" "magma_block" "soul_sand" "soul_soil" "glowstone"]))
    (stone "Quarz" "quartz_block" ["quartz_block" "quartz_block" "quartz_stairs" "quartz_slab" "smooth_quartz" "smooth_quartz_stairs" "smooth_quartz_slab" "quartz_bricks" "quartz_pillar" "chiseled_quartz_block"])
    (stone "Sandstein" "sandstone" (family "sandstone" ++ ["sandstone" "smooth_sandstone" "smooth_sandstone_stairs" "smooth_sandstone_slab" "cut_sandstone" "cut_sandstone_slab" "chiseled_sandstone" "sand"]))
    (stone "Roter Sandstein" "red_sandstone" (family "red_sandstone" ++ ["red_sandstone" "smooth_red_sandstone" "smooth_red_sandstone_stairs" "smooth_red_sandstone_slab" "cut_red_sandstone" "cut_red_sandstone_slab" "chiseled_red_sandstone" "red_sand"]))
    (stone "Prismarin" "prismarine_bricks" (family "prismarine"
        ++ ["prismarine_bricks" "prismarine_brick_stairs" "prismarine_brick_slab" "dark_prismarine" "dark_prismarine_stairs" "dark_prismarine_slab" "sea_lantern" "sea_lantern"]))
    (stone "Purpur & Endstein" "purpur_block" ["purpur_block" "purpur_block" "purpur_pillar" "purpur_stairs" "purpur_slab" "end_stone" "end_stone_bricks" "end_stone_brick_stairs" "end_stone_brick_slab" "end_stone_brick_wall" "end_rod"])
    (stone "Schlamm" "mud_bricks" (parts "mud_brick" ++ ["mud_bricks" "packed_mud" "mud"]))
    (stone "Kupfer" "waxed_copper_block" [
      "waxed_copper_block"
      "waxed_cut_copper"
      "waxed_cut_copper_stairs"
      "waxed_cut_copper_slab"
      "waxed_chiseled_copper"
      "waxed_copper_grate"
      "waxed_copper_bulb"
      "waxed_copper_door"
      "waxed_copper_trapdoor"
      "waxed_exposed_copper"
      "waxed_weathered_copper"
      "waxed_oxidized_copper"
      "waxed_oxidized_cut_copper"
      "waxed_oxidized_copper_grate"
      "copper_lantern"
      "copper_torch"
      "waxed_copper_chain"
      "lightning_rod"
    ])
    (stone "Ziegel & Harz" "bricks" (parts "brick" ++ ["bricks" "bricks" "resin_bricks" "resin_brick_stairs" "resin_brick_slab" "resin_brick_wall" "chiseled_resin_bricks" "resin_block"]))
    (stone "Obsidian & Amethyst" "amethyst_block" ["obsidian" "obsidian" "obsidian" "crying_obsidian" "amethyst_block" "amethyst_block" "amethyst_cluster" "tinted_glass"])
    (stone "Licht" "sea_lantern" ["sea_lantern" "glowstone" "shroomlight" "ochre_froglight" "verdant_froglight" "pearlescent_froglight" "lantern" "soul_lantern" "copper_lantern" "torch" "soul_torch" "copper_torch" "end_rod" "redstone_lamp" "jack_o_lantern"])
  ];

  # --- Rohstoffe -------------------------------------------------------------------------------
  rohstoffe = [
    (kit "Diamanten" "diamond" [(i "diamond_block" 128) (i "diamond" 256)])
    (kit "Netherite" "netherite_ingot" [(i "netherite_block" 16) (i "netherite_ingot" 128) (i "netherite_scrap" 64) (i "ancient_debris" 64)])
    (kit "Eisen" "iron_ingot" [(i "iron_block" 256) (i "iron_ingot" 256) (i "raw_iron_block" 64) (i "iron_nugget" 64)])
    (kit "Gold" "gold_ingot" [(i "gold_block" 256) (i "gold_ingot" 256) (i "raw_gold_block" 64) (i "gold_nugget" 64)])
    (kit "Kupfer" "copper_ingot" [(i "copper_block" 256) (i "copper_ingot" 256) (i "raw_copper_block" 64) (i "copper_nugget" 64)])
    (kit "Smaragde" "emerald" [(i "emerald_block" 256) (i "emerald" 256)])
    (kit "Lapis" "lapis_lazuli" [(i "lapis_block" 256) (i "lapis_lazuli" 256)])
    (kit "Redstone" "redstone" [(i "redstone_block" 256) (i "redstone" 256)])
    (kit "Kohle" "coal" [(i "coal_block" 384) (i "coal" 256) (i "charcoal" 128)])
    (kit "Quarz" "quartz" [(i "quartz_block" 256) (i "quartz" 256)])
    (kit "Amethyst" "amethyst_shard" [(i "amethyst_block" 128) (i "amethyst_shard" 256) (i "amethyst_cluster" 64)])
    (kit "Erze (Behutsamkeit)" "diamond_ore" (stacks [
      "coal_ore"
      "deepslate_coal_ore"
      "iron_ore"
      "deepslate_iron_ore"
      "copper_ore"
      "deepslate_copper_ore"
      "gold_ore"
      "deepslate_gold_ore"
      "redstone_ore"
      "deepslate_redstone_ore"
      "emerald_ore"
      "deepslate_emerald_ore"
      "lapis_ore"
      "deepslate_lapis_ore"
      "diamond_ore"
      "deepslate_diamond_ore"
      "nether_gold_ore"
      "nether_quartz_ore"
      "ancient_debris"
    ]))
    (kit "Edel-Mix" "emerald_block" (stacks [
      "diamond_block"
      "netherite_block"
      "iron_block"
      "gold_block"
      "copper_block"
      "emerald_block"
      "lapis_block"
      "redstone_block"
      "coal_block"
      "quartz_block"
      "amethyst_block"
    ]))
  ];

  # --- Mob-Drops -------------------------------------------------------------------------------
  drops = [
    (kit "Knochen" "bone" [(i "bone" 384) (i "bone_meal" 384) (i "bone_block" 128) (i "arrow" 128)])
    (kit "Faden & Spinne" "string" [(i "string" 384) (i "cobweb" 128) (i "spider_eye" 128) (i "fermented_spider_eye" 64)])
    (kit "Schwarzpulver" "gunpowder" [(i "gunpowder" 576)])
    (kit "Ender" "ender_eye" [(i "ender_pearl" 144) (i "ender_eye" 128) (i "chorus_fruit" 64) (i "shulker_shell" 64)])
    (kit "Lohe & Ghast" "blaze_rod" [(i "blaze_rod" 256) (i "blaze_powder" 128) (i "ghast_tear" 128) (i "magma_cream" 128)])
    (kit "Schleim" "slime_ball" [(i "slime_ball" 256) (i "slime_block" 256) (i "magma_cream" 64)])
    (kit "Phantom" "phantom_membrane" [(i "phantom_membrane" 256)])
    (kit "Shulker" "shulker_shell" [(i "shulker_shell" 256) (i "shulker_box" 4)])
    (kit "Wither" "wither_skeleton_skull" [(i "wither_skeleton_skull" 16) (i "nether_star" 16) (i "soul_sand" 128) (i "soul_soil" 64) (i "coal" 64) (i "bone" 64)])
    (kit "Drache & Ende" "dragon_head" [(i "dragon_breath" 128) (i "dragon_head" 4) (i "elytra" 1) (i "chorus_fruit" 64) (i "chorus_flower" 64) (i "end_crystal" 64)])
    (kit "Meer" "nautilus_shell" [(i "ink_sac" 128) (i "glow_ink_sac" 128) (i "prismarine_shard" 128) (i "prismarine_crystals" 128) (i "nautilus_shell" 64) (i "turtle_scute" 64) (i "heart_of_the_sea" 2)])
    (kit "Tiere" "leather" [
      (i "leather" 128)
      (i "feather" 128)
      (i "rabbit_hide" 64)
      (i "rabbit_foot" 64)
      (i "egg" 32)
      (i "white_wool" 64)
      (i "honeycomb" 64)
      (i "honey_bottle" 32)
      (i "armadillo_scute" 64)
      (i "wolf_armor" 2)
    ])
    (kit "Brise & Pruefung" "breeze_rod" [(i "breeze_rod" 256) (i "wind_charge" 256)])
    (kit "Hexe & Zombie" "rotten_flesh" [(i "rotten_flesh" 128) (i "glowstone_dust" 64) (i "redstone" 64) (i "sugar" 64) (i "glass_bottle" 64) (i "stick" 64) (i "iron_ingot" 64) (i "carrot" 64) (i "potato" 64)])
    (kit "Piglin-Tausch" "gold_ingot" [(i "gold_ingot" 256) (i "crying_obsidian" 64) (i "obsidian" 64) (i "soul_sand" 64) (i "quartz" 64) (i "gravel" 64) (i "string" 64) (i "iron_nugget" 64) (i "ender_pearl" 16) (i "leather" 64)])
  ];

  # --- Buecher ---------------------------------------------------------------------------------
  repair = [(book "mending" 1 3) (book "unbreaking" 3 3)];
  buecherRuestung = kit "Buecher: Ruestung" "enchanted_book" ([
      (book "protection" 4 3)
      (book "blast_protection" 4 1)
      (book "fire_protection" 4 1)
      (book "projectile_protection" 4 1)
      (book "feather_falling" 4 1)
      (book "depth_strider" 3 1)
      (book "frost_walker" 2 1)
      (book "respiration" 3 1)
      (book "aqua_affinity" 1 1)
      (book "thorns" 3 1)
      (book "soul_speed" 3 1)
      (book "swift_sneak" 3 1)
    ]
    ++ repair);
  buecherNah = kit "Buecher: Nahkampf" "enchanted_book" ([
      (book "sharpness" 5 2)
      (book "smite" 5 1)
      (book "bane_of_arthropods" 5 1)
      (book "knockback" 2 1)
      (book "fire_aspect" 2 1)
      (book "looting" 3 1)
      (book "sweeping_edge" 3 1)
      (book "density" 5 1)
      (book "breach" 4 1)
      (book "wind_burst" 3 1)
      (book "lunge" 3 1)
    ]
    ++ repair);
  buecherWerkzeug = kit "Buecher: Werkzeug" "enchanted_book" ([
      (book "efficiency" 5 3)
      (book "fortune" 3 2)
      (book "silk_touch" 1 2)
      (book "luck_of_the_sea" 3 1)
      (book "lure" 3 1)
    ]
    ++ repair);
  buecherFern = kit "Buecher: Fernkampf" "enchanted_book" ([
      (book "power" 5 2)
      (book "punch" 2 1)
      (book "flame" 1 1)
      (book "infinity" 1 1)
      (book "multishot" 1 1)
      (book "piercing" 4 1)
      (book "quick_charge" 3 1)
      (book "loyalty" 3 1)
      (book "impaling" 5 1)
      (book "riptide" 3 1)
      (book "channeling" 1 1)
    ]
    ++ repair);
  buecher = [
    buecherRuestung
    buecherNah
    buecherWerkzeug
    buecherFern
    (kit "Buecher: Reparatur" "anvil" [(book "mending" 1 14) (book "unbreaking" 3 13)])
    (kit "Verzaubern & Amboss" "enchanting_table" [(i "enchanting_table" 1) (i "bookshelf" 15) (i "lapis_lazuli" 128) (i "experience_bottle" 256) (i "anvil" 3) (i "grindstone" 1) (i "book" 64)])
    (bundle "Alle Buecher (4 Boxen)" "bookshelf" [buecherRuestung buecherNah buecherWerkzeug buecherFern])
  ];

  # --- Traenke ---------------------------------------------------------------------------------
  traenke = [
    (kit "Trinktraenke" "potion" [
      (drink "long_night_vision" 2)
      (drink "long_invisibility" 1)
      (drink "strong_leaping" 1)
      (drink "long_fire_resistance" 3)
      (drink "strong_swiftness" 3)
      (drink "long_water_breathing" 2)
      (drink "strong_healing" 2)
      (drink "strong_regeneration" 2)
      (drink "strong_strength" 3)
      (drink "long_slow_falling" 2)
      (drink "strong_turtle_master" 2)
      (drink "long_turtle_master" 1)
    ])
    (kit "Wurftraenke" "splash_potion" [
      (splash "strong_healing" 6)
      (splash "strong_harming" 4)
      (splash "strong_poison" 2)
      (splash "strong_slowness" 2)
      (splash "long_weakness" 2)
      (splash "strong_regeneration" 2)
      (splash "strong_strength" 2)
      (splash "strong_swiftness" 2)
      (splash "long_fire_resistance" 2)
      (splash "strong_turtle_master" 1)
      (splash "long_slow_falling" 2)
    ])
    (kit "Verweiltraenke" "lingering_potion" [
      (linger "strong_healing" 4)
      (linger "strong_harming" 4)
      (linger "strong_regeneration" 3)
      (linger "strong_poison" 3)
      (linger "long_slowness" 2)
      (linger "long_weakness" 2)
      (linger "wind_charged" 2)
      (linger "weaving" 2)
      (linger "oozing" 2)
      (linger "infested" 2)
      (linger "long_slow_falling" 1)
    ])
    (kit "Feuerschutz" "magma_cream" [(drink "long_fire_resistance" 14) (splash "long_fire_resistance" 13)])
    (kit "Neue Traenke" "breeze_rod" (lib.concatMap (p: [(drink p 3) (splash p 3)]) ["wind_charged" "weaving" "oozing" "infested"]))
    (kit "Pfeile" "tipped_arrow" (map arrow [
        "strong_harming"
        "strong_poison"
        "strong_slowness"
        "long_weakness"
        "strong_healing"
        "long_slow_falling"
        "strong_turtle_master"
        "long_invisibility"
        "long_night_vision"
      ]
      ++ [(i "spectral_arrow" 128) (i "arrow" 256)]))
    (kit "Brau-Zutaten" "nether_wart" (stacks [
        "nether_wart"
        "blaze_powder"
        "glistering_melon_slice"
        "golden_carrot"
        "magma_cream"
        "ghast_tear"
        "rabbit_foot"
        "sugar"
        "spider_eye"
        "fermented_spider_eye"
        "pufferfish"
        "phantom_membrane"
        "turtle_scute"
        "breeze_rod"
        "slime_block"
        "cobweb"
        "stone"
        "gunpowder"
        "dragon_breath"
        "redstone"
        "glowstone_dust"
        "glass_bottle"
      ]
      ++ [(i "brewing_stand" 2) (i "cauldron" 1)]))
  ];

  # --- Essen -----------------------------------------------------------------------------------
  essen = [
    (kit "Goldkarotten" "golden_carrot" [(i "golden_carrot" 1152)])
    (kit "Fleisch" "cooked_beef" [(i "cooked_beef" 576) (i "cooked_porkchop" 576)])
    (kit "Gemischt" "bread" (stacks [
        "bread"
        "baked_potato"
        "cooked_chicken"
        "cooked_mutton"
        "cooked_rabbit"
        "cooked_salmon"
        "cooked_cod"
        "pumpkin_pie"
        "cookie"
        "apple"
        "melon_slice"
        "sweet_berries"
        "glow_berries"
        "dried_kelp"
        "carrot"
        "beetroot"
      ]
      ++ [(i "honey_bottle" 16) (i "cake" 1) (i "mushroom_stew" 1) (i "rabbit_stew" 1) (i "beetroot_soup" 1)]))
    (kit "Suppen & Kuchen" "cake" [(i "cake" 6) (i "mushroom_stew" 6) (i "rabbit_stew" 5) (i "beetroot_soup" 5)])
    (kit "Brot & Gebaeck" "cookie" [(i "bread" 384) (i "cookie" 256) (i "pumpkin_pie" 256)])
    (kit "Fisch" "cooked_salmon" [(i "cooked_salmon" 256) (i "cooked_cod" 256) (i "dried_kelp_block" 128)])
    (kit "Notration" "golden_apple" [(i "golden_carrot" 256) (i "golden_apple" 64) (i "cooked_beef" 128) (i "honey_bottle" 32) (i "milk_bucket" 2)])
  ];

  # --- Redstone --------------------------------------------------------------------------------
  redstone = [
    (kit "Grundlagen" "repeater" [
      (i "redstone" 256)
      (i "redstone_block" 64)
      (i "redstone_torch" 64)
      (i "repeater" 128)
      (i "comparator" 128)
      (i "lever" 64)
      (i "stone_button" 64)
      (i "target" 64)
      (i "observer" 128)
      (i "redstone_lamp" 64)
      (i "note_block" 64)
      (i "daylight_detector" 64)
    ])
    (kit "Kolben" "sticky_piston" [(i "piston" 192) (i "sticky_piston" 192) (i "slime_block" 192) (i "honey_block" 128) (i "observer" 128) (i "redstone_block" 128) (i "obsidian" 64)])
    (kit "Lager & Sortierer" "hopper" [
      (i "hopper" 384)
      (i "chest" 256)
      (i "trapped_chest" 64)
      (i "barrel" 128)
      (i "comparator" 128)
      (i "repeater" 64)
      (i "redstone_torch" 64)
      (i "redstone" 64)
      (i "dropper" 64)
      (i "dispenser" 64)
      (i "hopper_minecart" 4)
      (i "rail" 64)
      (i "item_frame" 64)
      (i "oak_sign" 16)
    ])
    (kit "Schienen" "powered_rail" [(i "rail" 256) (i "powered_rail" 256) (i "detector_rail" 64) (i "activator_rail" 64) (i "minecart" 4) (i "chest_minecart" 2) (i "hopper_minecart" 2) (i "furnace_minecart" 1) (i "redstone_torch" 64)])
    (kit "Sensoren" "sculk_sensor" (stacks [
      "observer"
      "daylight_detector"
      "sculk_sensor"
      "calibrated_sculk_sensor"
      "tripwire_hook"
      "string"
      "target"
      "lightning_rod"
      "stone_pressure_plate"
      "light_weighted_pressure_plate"
      "heavy_weighted_pressure_plate"
      "oak_pressure_plate"
      "trapped_chest"
      "lectern"
    ]))
    (kit "Tueren & Licht" "iron_door" (stacks ["iron_door" "iron_trapdoor" "copper_door" "copper_trapdoor" "copper_bulb" "copper_bulb" "redstone_lamp" "redstone_lamp" "lever" "stone_button" "polished_blackstone_button"]))
    (kit "Crafter" "crafter" [(i "crafter" 256) (i "hopper" 128) (i "dropper" 64) (i "comparator" 64) (i "repeater" 64) (i "redstone" 64)])
    (kit "Werfer" "dispenser" [(i "dispenser" 128) (i "dropper" 128) (i "observer" 64) (i "redstone" 64) (i "water_bucket" 2) (i "lava_bucket" 2)])
  ];

  # --- Natur -----------------------------------------------------------------------------------
  natur = [
    (kit "Setzlinge" "cherry_sapling" (stacks [
        "oak_sapling"
        "spruce_sapling"
        "birch_sapling"
        "jungle_sapling"
        "acacia_sapling"
        "dark_oak_sapling"
        "cherry_sapling"
        "pale_oak_sapling"
        "mangrove_propagule"
        "azalea"
        "flowering_azalea"
        "crimson_fungus"
        "warped_fungus"
        "bamboo"
        "brown_mushroom"
        "red_mushroom"
      ]
      ++ [(i "bone_meal" 256)]))
    (kit "Saatgut" "wheat_seeds" (stacks [
        "wheat_seeds"
        "beetroot_seeds"
        "melon_seeds"
        "pumpkin_seeds"
        "torchflower_seeds"
        "pitcher_pod"
        "potato"
        "carrot"
        "sugar_cane"
        "cactus"
        "cocoa_beans"
        "nether_wart"
        "sweet_berries"
        "glow_berries"
        "kelp"
        "chorus_flower"
      ]
      ++ [(i "bone_meal" 128) (i "composter" 4) (ench "diamond_hoe" (maxed // fortune)) (i "water_bucket" 2)]))
    (kit "Blumen" "poppy" (stacks [
      "dandelion"
      "golden_dandelion"
      "poppy"
      "blue_orchid"
      "allium"
      "azure_bluet"
      "red_tulip"
      "orange_tulip"
      "white_tulip"
      "pink_tulip"
      "oxeye_daisy"
      "cornflower"
      "lily_of_the_valley"
      "wither_rose"
      "torchflower"
      "sunflower"
      "lilac"
      "rose_bush"
      "peony"
      "pitcher_plant"
      "pink_petals"
      "wildflowers"
      "cactus_flower"
      "spore_blossom"
      "open_eyeblossom"
      "closed_eyeblossom"
    ]))
    (kit "Laub" "azalea_leaves" (stacks [
      "oak_leaves"
      "spruce_leaves"
      "birch_leaves"
      "jungle_leaves"
      "acacia_leaves"
      "dark_oak_leaves"
      "mangrove_leaves"
      "cherry_leaves"
      "pale_oak_leaves"
      "azalea_leaves"
      "flowering_azalea_leaves"
      "vine"
      "glow_lichen"
      "hanging_roots"
      "leaf_litter"
    ]))
    (kit "Moos & Boden" "moss_block" (stacks [
      "moss_block"
      "moss_carpet"
      "pale_moss_block"
      "pale_moss_carpet"
      "grass_block"
      "podzol"
      "mycelium"
      "rooted_dirt"
      "coarse_dirt"
      "dirt"
      "mud"
      "clay"
      "gravel"
      "sculk"
    ]))
    (kit "Wasserpflanzen" "tube_coral_block" (stacks [
      "lily_pad"
      "kelp"
      "seagrass"
      "sea_pickle"
      "big_dripleaf"
      "small_dripleaf"
      "tube_coral_block"
      "brain_coral_block"
      "bubble_coral_block"
      "fire_coral_block"
      "horn_coral_block"
      "tube_coral_fan"
      "brain_coral_fan"
      "bubble_coral_fan"
      "fire_coral_fan"
      "horn_coral_fan"
    ]))
    (kit "Pilze & Nether" "crimson_fungus" (stacks [
      "brown_mushroom"
      "red_mushroom"
      "brown_mushroom_block"
      "red_mushroom_block"
      "mushroom_stem"
      "crimson_fungus"
      "warped_fungus"
      "crimson_roots"
      "warped_roots"
      "nether_sprouts"
      "weeping_vines"
      "twisting_vines"
      "shroomlight"
      "nether_wart_block"
      "warped_wart_block"
      "crimson_nylium"
      "warped_nylium"
    ]))
    (kit "Wueste & Schnee" "blue_ice" (stacks ["sand" "sand" "red_sand" "cactus" "dead_bush" "short_dry_grass" "tall_dry_grass" "snow_block" "ice" "packed_ice" "blue_ice"]
        ++ [(i "snowball" 32) (i "powder_snow_bucket" 2)]))
  ];

  # --- Seltenes --------------------------------------------------------------------------------
  seltenes = [
    (kit "Musikplatten" "music_disc_pigstep" (map (d: i "music_disc_${d}" 1) [
      "13"
      "cat"
      "blocks"
      "chirp"
      "far"
      "mall"
      "mellohi"
      "stal"
      "strad"
      "ward"
      "11"
      "wait"
      "otherside"
      "relic"
      "5"
      "pigstep"
      "creator"
      "creator_music_box"
      "precipice"
      "tears"
      "lava_chicken"
    ]))
    (kit "Toepferscherben" "decorated_pot" (map (s: i "${s}_pottery_sherd" 4) [
        "angler"
        "archer"
        "arms_up"
        "blade"
        "brewer"
        "burn"
        "danger"
        "explorer"
        "flow"
        "friend"
        "guster"
        "heart"
        "heartbreak"
        "howl"
        "miner"
        "mourner"
        "plenty"
        "prize"
        "scrape"
        "sheaf"
        "shelter"
        "skull"
        "snort"
      ]
      ++ [(i "decorated_pot" 4) (i "brush" 1)]))
    (kit "Hoerner & Koepfe" "goat_horn" (map horn ["ponder" "sing" "seek" "feel" "admire" "call" "yearn" "dream"]
        ++ map (h: i h 16) ["skeleton_skull" "wither_skeleton_skull" "zombie_head" "creeper_head" "piglin_head" "dragon_head"]))
    (kit "Leuchtfeuer" "beacon" [(i "beacon" 4) (i "nether_star" 4) (i "iron_block" 192) (i "emerald" 64) (i "diamond" 64)])
    (kit "Aquisitor" "conduit" [(i "conduit" 2) (i "heart_of_the_sea" 4) (i "nautilus_shell" 64) (i "prismarine" 128) (i "prismarine_bricks" 64) (i "dark_prismarine" 64) (i "sea_lantern" 64)])
    (kit "Pruefungskammer" "trial_key" [(i "trial_key" 64) (i "ominous_trial_key" 16) (i "ominous_bottle" 16) (i "heavy_core" 4) (i "breeze_rod" 64) (i "wind_charge" 64)])
    (kit "Elytren & Dreizacke" "elytra" [(i "elytra" 4) (i "trident" 4) (i "phantom_membrane" 64)])
    (kit "Sculk" "sculk_catalyst" (stacks ["sculk" "sculk_vein" "sculk_catalyst" "sculk_sensor" "calibrated_sculk_sensor" "sculk_shrieker" "echo_shard"] ++ [(i "recovery_compass" 2)]))
    (kit "Schwaemme" "sponge" [(i "sponge" 256) (i "wet_sponge" 64)])
    (kit "Reisen & Karten" "compass" [
      (i "compass" 2)
      (i "recovery_compass" 1)
      (i "clock" 1)
      (i "spyglass" 1)
      (i "map" 64)
      (i "lodestone" 4)
      (i "cartography_table" 1)
      (i "name_tag" 16)
      (i "ender_chest" 2)
      (i "bundle" 4)
    ])
  ];

  cat = id: name: icon: color: text: kits: {
    inherit id name icon color text kits;
    title = "&8Kits: ${name}";
    cond = admin;
  };
in [
  (cat "pvp" "PvP" "end_crystal" "red" "Kristall, Anker, Schwert, Streitkolben, Boxen" pvp)
  (cat "ausruestung" "Ausruestung" "diamond_chestplate" "blue" "Ruestungen, Werkzeug, Waffen, Besatz, Reittiere" ausruestung)
  (cat "farben" "Bloecke: Farben" "light_blue_concrete" "white" "Beton, Wolle, Glas, Terrakotta, alle 16 Farben" farben)
  (cat "holz" "Bloecke: Holz" "cherry_planks" "brown" "Jede Holzart als eigene Box" holz)
  (cat "stein" "Bloecke: Stein" "stone_bricks" "light_gray" "Stein, Tiefenschiefer, Quarz, Kupfer, ..." stein)
  (cat "rohstoffe" "Rohstoffe" "diamond_block" "yellow" "Diamant, Netherite, Eisen, Gold, Erze" rohstoffe)
  (cat "drops" "Mob-Drops" "bone" "lime" "Knochen, Faden, Perlen, Lohe, Schleim, ..." drops)
  (cat "buecher" "Buecher" "enchanted_book" "purple" "Verzauberte Buecher, hoechste Survival-Stufe" buecher)
  (cat "traenke" "Traenke" "potion" "pink" "Trink-, Wurf-, Verweiltraenke, Pfeile" traenke)
  (cat "essen" "Essen" "golden_carrot" "orange" "Goldkarotten, Fleisch, Gemischtes" essen)
  (cat "redstone" "Redstone" "redstone" "black" "Grundlagen, Kolben, Sortierer, Schienen" redstone)
  (cat "natur" "Natur" "oak_sapling" "green" "Setzlinge, Saatgut, Blumen, Laub, Korallen" natur)
  (cat "seltenes" "Seltenes" "beacon" "magenta" "Musikplatten, Scherben, Leuchtfeuer, Koepfe" seltenes)
]
