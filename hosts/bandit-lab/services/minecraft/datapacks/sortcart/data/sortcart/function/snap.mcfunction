# The owner's sorter (castle spec, origin -308 111 11) was built for the old minecart physics: its cart dropped through
# the top-stop trapdoor onto the load rail and through the station chest onto the station rail. With the experiment on,
# carts collide instead, so these two lines do the drop (architect 2026-11-15, tested by RCON: 22 laps). Under the old
# physics they put the cart on the spot it falls to anyway, so they are harmless there. The cart must keep its tag.
execute as @e[type=minecraft:hopper_minecart,tag=sortcart] at @s if block ~ ~ ~ minecraft:iron_trapdoor run tp @s -303.5 123.0625 22.5
execute as @e[type=minecraft:hopper_minecart,tag=sortcart] at @s if block ~ ~ ~ minecraft:chest if block ~ ~-1 ~ #minecraft:rails align y run tp @s ~ ~-0.9375 ~
