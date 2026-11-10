# One event at a time: only the idle phase calls this.
function bev:pick with storage bev:cfg
scoreboard players operation #minutes bev = #lead bev
scoreboard players operation #minutes bev /= #c1200 bev
execute store result storage bev:ev minutes int 1 run scoreboard players get #minutes bev
scoreboard players operation #timer bev = #lead bev
scoreboard players set #phase bev 1
# Two to four hours of populated play until the next one.
execute store result score #next bev run random value 144000..288000
function bev:announce with storage bev:ev
