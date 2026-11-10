$execute store result score #x bev run random value -$(radius)..$(radius)
$execute store result score #z bev run random value -$(radius)..$(radius)
execute store result storage bev:ev x int 1 run scoreboard players get #x bev
execute store result storage bev:ev z int 1 run scoreboard players get #z bev
# The 3 x 3 chunks around the place: a dungeon reaches past one chunk, and a boss needs room to move.
scoreboard players remove #x bev 16
scoreboard players remove #z bev 16
execute store result storage bev:ev x0 int 1 run scoreboard players get #x bev
execute store result storage bev:ev z0 int 1 run scoreboard players get #z bev
scoreboard players add #x bev 32
scoreboard players add #z bev 32
execute store result storage bev:ev x1 int 1 run scoreboard players get #x bev
execute store result storage bev:ev z1 int 1 run scoreboard players get #z bev
