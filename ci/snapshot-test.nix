# hosts/bandit-lab/services/minecraft/snapshot.sh against fake systemd/nixos-container/setpriv:
# the container path writes the console inside the box and copies as the box uid; the private path is unchanged.
{pkgs}:
pkgs.runCommand "snapshot-test" {nativeBuildInputs = [pkgs.rsync pkgs.util-linux];} ''
  cp ${../hosts/bandit-lab/services/minecraft/snapshot.sh} snapshot.sh
  cp ${../hosts/bandit-lab/services/minecraft/snapshot.test.sh} snapshot.test.sh
  bash snapshot.test.sh
  touch $out
''
