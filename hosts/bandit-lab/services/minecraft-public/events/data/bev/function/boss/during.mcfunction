execute store result bossbar bev:boss value run data get entity @e[tag=bev_boss,limit=1] Health
execute at @e[tag=bev_boss,limit=1] run bossbar set bev:boss players @a[distance=..64]
# The forced chunks keep the boss loaded, so "not there" means dead.
execute unless entity @e[tag=bev_boss] run function bev:boss/slain
