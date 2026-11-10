# What the event made stays (the chest, the ruin, the crater, a boss nobody killed); the mark and the
# forced chunks go.
kill @e[type=minecraft:marker,tag=bev_mark]
execute if score #kind bev matches 2 run function bev:boss/end
execute if score #kind bev matches 5 run weather clear
$execute if score #kind bev matches 1..4 in minecraft:overworld run forceload remove $(x0) $(z0) $(x1) $(z1)
scoreboard players set #phase bev 0
$execute if score #kind bev matches 1 run say Supply drop at X $(x) Z $(z) is no longer marked
$execute if score #kind bev matches 2..4 run say The event at X $(x) Z $(z) is over
execute if score #kind bev matches 5 run say The thunderstorm has passed
execute if score #kind bev matches 6 run say The blood night is over
