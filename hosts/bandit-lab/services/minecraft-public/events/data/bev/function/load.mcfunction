# World events (docs/specs/2026-11-10-public-world-events.md). All state is in the `bev` objective and the
# `bev:ev` storage, so an event survives a restart and nothing is left forced after it.
# #phase: 0 idle, 1 announced, 2 live. #kind: 1 drop, 2 boss, 3 dungeon, 4 meteor (these four have a place),
# 5 thunderstorm, 6 blood night. Times are game ticks (20 per second).
scoreboard objectives add bev dummy
scoreboard players set #c1200 bev 1200
scoreboard players set #c100 bev 100
scoreboard players set #c200 bev 200
execute unless score #phase bev matches 0.. run scoreboard players set #phase bev 0
execute unless score #force bev matches 0.. run scoreboard players set #force bev 0
# No event on a nearly empty server.
execute unless score #min_players bev matches 0.. run scoreboard players set #min_players bev 3
# 20 minutes from the announcement to the start, 30 minutes live.
execute unless score #lead bev matches 0.. run scoreboard players set #lead bev 24000
execute unless score #life bev matches 0.. run scoreboard players set #life bev 36000
# First event two hours of populated play after the first load.
execute unless score #next bev matches -2147483648.. run scoreboard players set #next bev 144000
# Events land within this many blocks of 0 0: 500 inside the 5,000 border.
execute unless data storage bev:cfg radius run data modify storage bev:cfg radius set value 4500
