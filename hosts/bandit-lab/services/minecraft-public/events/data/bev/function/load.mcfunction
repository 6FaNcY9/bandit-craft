# World events (docs/specs/2026-11-10-public-world-events.md). All state is in the `bev` objective and the
# `bev:ev` storage, so an event survives a restart and nothing is left forced after it.
# #phase: 0 idle, 1 announced, 2 live. Times are game ticks (20 per second).
scoreboard objectives add bev dummy
scoreboard players set #c1200 bev 1200
execute unless score #phase bev matches 0.. run scoreboard players set #phase bev 0
# No event on a nearly empty server.
execute unless score #min_players bev matches 0.. run scoreboard players set #min_players bev 3
# 20 minutes from the announcement to the landing, 30 minutes marked.
execute unless score #lead bev matches 0.. run scoreboard players set #lead bev 24000
execute unless score #life bev matches 0.. run scoreboard players set #life bev 36000
# First event two hours of populated play after the first load.
execute unless score #next bev matches -2147483648.. run scoreboard players set #next bev 144000
