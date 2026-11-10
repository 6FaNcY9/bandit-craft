execute store result score #players bev if entity @a
# The gap between events only runs down while enough players are online.
execute if score #phase bev matches 0 if score #players bev >= #min_players bev run scoreboard players remove #next bev 1
execute if score #phase bev matches 0 if score #next bev matches ..0 run function bev:start
execute if score #phase bev matches 1.. run scoreboard players remove #timer bev 1
execute if score #phase bev matches 1 if score #timer bev matches ..0 run function bev:drop/spawn with storage bev:ev
execute if score #phase bev matches 2 if score #timer bev matches ..0 run function bev:end with storage bev:ev
# The mark players see from afar while the drop is live.
execute if score #phase bev matches 2 at @e[type=minecraft:marker,tag=bev_drop] run particle minecraft:end_rod ~ ~12 ~ 0.1 8 0.1 0 6 force
