summon minecraft:ravager ~ ~ ~ {Tags:["bev_boss"],CustomName:"The Colossus",PersistenceRequired:1b,Health:400.0f,DeathLootTable:"bev:boss",attributes:[{id:"minecraft:max_health",base:400.0d},{id:"minecraft:attack_damage",base:18.0d},{id:"minecraft:scale",base:1.4d}]}
summon minecraft:vindicator ~2 ~ ~ {Tags:["bev_guard"],PersistenceRequired:1b}
summon minecraft:vindicator ~-2 ~ ~ {Tags:["bev_guard"],PersistenceRequired:1b}
summon minecraft:vindicator ~ ~ ~2 {Tags:["bev_guard"],PersistenceRequired:1b}
summon minecraft:vindicator ~ ~ ~-2 {Tags:["bev_guard"],PersistenceRequired:1b}
bossbar set bev:boss name "The Colossus"
bossbar set bev:boss max 400
