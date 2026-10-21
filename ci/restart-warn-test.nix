# tools/minecraft-restart-warn.sh against a fake rcon-cli: schedule, refusal without a reason,
# failure when RCON is down, no further broadcast after an interrupt. No Docker, no waiting.
{pkgs}:
pkgs.runCommand "restart-warn-test" {} ''
  mkdir tools
  cp ${../tools/minecraft-restart-warn.sh} tools/minecraft-restart-warn.sh
  cp ${../tools/minecraft-restart-warn.test.sh} tools/minecraft-restart-warn.test.sh
  chmod -R u+w tools
  patchShebangs tools
  bash tools/minecraft-restart-warn.test.sh
  touch $out
''
