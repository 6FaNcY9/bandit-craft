# One event at a time: only the idle phase calls this.
function bev:pick with storage bev:cfg
# Drop 30, boss 20, dungeon 15, meteor 15, thunderstorm 10, blood night 10 in a hundred.
execute store result score #roll bev run random value 1..100
scoreboard players set #kind bev 1
execute if score #roll bev matches 31..50 run scoreboard players set #kind bev 2
execute if score #roll bev matches 51..65 run scoreboard players set #kind bev 3
execute if score #roll bev matches 66..80 run scoreboard players set #kind bev 4
execute if score #roll bev matches 81..90 run scoreboard players set #kind bev 5
execute if score #roll bev matches 91..100 run scoreboard players set #kind bev 6
# For the test and for a try-out from the console on the whitelisted server: the next event's kind.
execute if score #force bev matches 1.. run scoreboard players operation #kind bev = #force bev
scoreboard players set #force bev 0
scoreboard players operation #minutes bev = #lead bev
scoreboard players operation #minutes bev /= #c1200 bev
execute store result storage bev:ev minutes int 1 run scoreboard players get #minutes bev
scoreboard players operation #timer bev = #lead bev
scoreboard players set #phase bev 1
# Two to four hours of populated play until the next one.
execute store result score #next bev run random value 144000..288000
function bev:announce with storage bev:ev
