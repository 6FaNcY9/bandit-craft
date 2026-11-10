$forceload add $(x) $(z)
$execute in minecraft:overworld positioned $(x) 0 $(z) positioned over world_surface run function bev:drop/here
scoreboard players operation #timer bev = #life bev
scoreboard players set #phase bev 2
$say Supply drop landed at X $(x) Z $(z)
