summon minecraft:marker ~ ~ ~ {Tags:["bev_bolt"]}
spreadplayers ~ ~ 0 24 false @e[type=minecraft:marker,tag=bev_bolt]
execute at @e[type=minecraft:marker,tag=bev_bolt] run summon minecraft:lightning_bolt
kill @e[type=minecraft:marker,tag=bev_bolt]
