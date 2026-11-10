# A wave near every player in the overworld every ten seconds, never more than 60 of these mobs loaded.
scoreboard players operation #beat bev = #timer bev
scoreboard players operation #beat bev %= #c200 bev
execute store result score #mobs bev if entity @e[tag=bev_blood]
execute if score #beat bev matches 0 if score #mobs bev matches ..59 as @a at @s if dimension minecraft:overworld run function bev:blood/wave
