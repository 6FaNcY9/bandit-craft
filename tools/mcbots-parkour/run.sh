#!/bin/sh
# usage: run.sh [course-regex]   (CLEAN=1 run.sh removes the courses only)
D=$(dirname "$0")
NM=/nix/store/zr4ddgnrpj4laxhhby300nslbyx1ld32-mcbots-0.1.0/lib/node_modules/mcbots/node_modules
NODE_PATH=$NM exec node "$D/spike.js" "$@"
