# The chest stays where it is; only the mark and the forced chunk go.
kill @e[type=minecraft:marker,tag=bev_drop]
$execute in minecraft:overworld run forceload remove $(x) $(z)
scoreboard players set #phase bev 0
$say Supply drop at X $(x) Z $(z) is no longer marked
