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
  meta.mainProgram = "mcbots";
}
