scoreboard players operation #timer bev = #life bev
scoreboard players set #phase bev 2
$execute if score #kind bev matches 1..4 in minecraft:overworld run forceload add $(x0) $(z0) $(x1) $(z1)
$execute if score #kind bev matches 1 in minecraft:overworld positioned $(x) 0 $(z) positioned over world_surface run function bev:drop/here
$execute if score #kind bev matches 2 in minecraft:overworld positioned $(x) 0 $(z) positioned over world_surface run function bev:boss/here
$execute if score #kind bev matches 3 in minecraft:overworld positioned $(x) 0 $(z) positioned over world_surface run function bev:dungeon/here
$execute if score #kind bev matches 4 in minecraft:overworld positioned $(x) 0 $(z) positioned over world_surface run function bev:meteor/here
$execute if score #kind bev matches 1 run say Supply drop landed at X $(x) Z $(z)
$execute if score #kind bev matches 2 run say A boss has awoken at X $(x) Z $(z)
$execute if score #kind bev matches 3 run say A ruin has surfaced at X $(x) Z $(z)
$execute if score #kind bev matches 4 run say A meteor has hit X $(x) Z $(z)
execute if score #kind bev matches 5 run function bev:storm/begin
execute if score #kind bev matches 6 run function bev:blood/begin
