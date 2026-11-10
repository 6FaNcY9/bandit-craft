# One event at a time: only the idle phase calls this. Places stay 500 blocks inside the 5,000 border.
execute store result storage bev:ev x int 1 run random value -4500..4500
execute store result storage bev:ev z int 1 run random value -4500..4500
scoreboard players operation #minutes bev = #lead bev
scoreboard players operation #minutes bev /= #c1200 bev
execute store result storage bev:ev minutes int 1 run scoreboard players get #minutes bev
scoreboard players operation #timer bev = #lead bev
scoreboard players set #phase bev 1
# Two to four hours of populated play until the next one.
execute store result score #next bev run random value 144000..288000
function bev:announce with storage bev:ev
