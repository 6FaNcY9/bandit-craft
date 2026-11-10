summon minecraft:marker ~ ~ ~ {Tags:["bev_mark"]}
execute store result score #variant bev run random value 1..2
# The tower stands on the ground; the crypt lies under it with its ladder hole at the surface.
execute if score #variant bev matches 1 run place template bev:tower ~-4 ~ ~-4
execute if score #variant bev matches 2 run place template bev:crypt ~-6 ~-7 ~-6
