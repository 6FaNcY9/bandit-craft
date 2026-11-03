# Mineflayer bot runner + dashboard (app/). Shared by the lab image and the
# laptop runner (`nix run .#mcbots`).
{
  lib,
  buildNpmPackage,
  nodejs_22,
}:
buildNpmPackage {
  pname = "mcbots";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ./app;
    fileset = lib.fileset.difference ./app (lib.fileset.maybeMissing ./app/node_modules);
  };
  nodejs = nodejs_22;
  npmDepsHash = "sha256-SOL02ZbK1HktrP+Nb9LwXvwCHe+9mNkEP2Ui/I7Gde4=";
  dontNpmBuild = true;
  # test.js: unit tests plus a loopback hub/worker round trip (no Minecraft
  # server involved), so a broken token check or reservation fails the build.
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node test.js
    runHook postCheck
  '';
  npmFlags = ["--ignore-scripts"];
  # mineflayer-pathfinder 2.4.5: once a door is clicked nothing is left to place, but `placing` stays on and the next
  # tick of a bot with scaffolding blocks reads placingBlock.y: an uncaught TypeError that killed the worker and all its
  # bots at every door (2026-11-03). --replace-fail: a new version has to be looked at again; test/walking.js checks it.
  preBuild = ''
    substituteInPlace node_modules/mineflayer-pathfinder/index.js --replace-fail \
      "      const block = stateMovements.getScaffoldingItem()" \
      "      if (!placingBlock) { // the door was the last thing to place
        placing = false
        lastNodeTime = performance.now()
        return
      }
      const block = stateMovements.getScaffoldingItem()"
    # The path aimed at the middle of the door's panel: a bot walked into the open panel and stood there (sandbox test
    # 2026-11-03). A door or gate is walked through in the middle of its cell, like any other free block.
    substituteInPlace node_modules/mineflayer-pathfinder/index.js --replace-fail \
      "if (!block || block.shapes.length === 0) return null" \
      "if (!block || block.shapes.length === 0 || /_door\$|_fence_gate\$/.test(block.name)) return null"
  '';
  meta.mainProgram = "mcbots";
}
