# One bolt near every player in the overworld every five seconds: 20 players are 4 bolts a second at most.
scoreboard players operation #beat bev = #timer bev
scoreboard players operation #beat bev %= #c100 bev
execute if score #beat bev matches 0 as @a at @s if dimension minecraft:overworld run function bev:storm/bolt
