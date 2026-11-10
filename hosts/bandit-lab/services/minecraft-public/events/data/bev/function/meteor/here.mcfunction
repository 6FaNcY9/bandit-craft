summon minecraft:marker ~ ~ ~ {Tags:["bev_mark"]}
# The impact: a creeper that explodes at once makes the crater; the core arrives once it has cleared.
summon minecraft:creeper ~ ~ ~ {ExplosionRadius:7b,Fuse:0s,ignited:1b}
schedule function bev:meteor/core 20t
