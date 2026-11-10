summon minecraft:marker ~ ~ ~ {Tags:["bev_wave"]}
spreadplayers ~ ~ 0 20 false @e[type=minecraft:marker,tag=bev_wave]
execute at @e[type=minecraft:marker,tag=bev_wave] run summon minecraft:zombie ~ ~ ~ {Tags:["bev_blood"],attributes:[{id:"minecraft:movement_speed",base:0.32d},{id:"minecraft:attack_damage",base:6.0d}]}
execute at @e[type=minecraft:marker,tag=bev_wave] run summon minecraft:skeleton ~1 ~ ~ {Tags:["bev_blood"],attributes:[{id:"minecraft:movement_speed",base:0.3d}]}
kill @e[type=minecraft:marker,tag=bev_wave]
