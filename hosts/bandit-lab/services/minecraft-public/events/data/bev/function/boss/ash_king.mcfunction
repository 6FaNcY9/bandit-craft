summon minecraft:wither_skeleton ~ ~ ~ {Tags:["bev_boss"],CustomName:"The Ash King",PersistenceRequired:1b,Health:300.0f,DeathLootTable:"bev:boss",attributes:[{id:"minecraft:max_health",base:300.0d},{id:"minecraft:attack_damage",base:14.0d},{id:"minecraft:scale",base:1.6d},{id:"minecraft:knockback_resistance",base:1.0d}]}
summon minecraft:wither_skeleton ~2 ~ ~ {Tags:["bev_guard"],PersistenceRequired:1b}
summon minecraft:wither_skeleton ~-2 ~ ~ {Tags:["bev_guard"],PersistenceRequired:1b}
summon minecraft:wither_skeleton ~ ~ ~2 {Tags:["bev_guard"],PersistenceRequired:1b}
summon minecraft:wither_skeleton ~ ~ ~-2 {Tags:["bev_guard"],PersistenceRequired:1b}
bossbar set bev:boss name "The Ash King"
bossbar set bev:boss max 300
