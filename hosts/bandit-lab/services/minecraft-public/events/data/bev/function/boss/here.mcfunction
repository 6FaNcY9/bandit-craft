summon minecraft:marker ~ ~ ~ {Tags:["bev_mark"]}
bossbar add bev:boss "Boss"
bossbar set bev:boss color red
execute store result score #variant bev run random value 1..2
execute if score #variant bev matches 1 run function bev:boss/ash_king
execute if score #variant bev matches 2 run function bev:boss/colossus
