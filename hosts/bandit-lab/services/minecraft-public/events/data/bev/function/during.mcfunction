# The mark players see from afar while an event with a place is live.
execute at @e[type=minecraft:marker,tag=bev_mark] run particle minecraft:end_rod ~ ~12 ~ 0.1 8 0.1 0 6 force
execute if score #kind bev matches 2 run function bev:boss/during
execute if score #kind bev matches 5 run function bev:storm/during
execute if score #kind bev matches 6 run function bev:blood/during
