# Operator scripts for the Minecraft module, shared by the module, the backup
# module and the CI contract so all three use the same derivations.
{pkgs}: let
  mk = name: runtimeInputs: file:
    pkgs.writeShellApplication {
      inherit name runtimeInputs;
      text = builtins.readFile file;
    };
  cutover = mk "minecraft-cutover" [pkgs.coreutils pkgs.docker pkgs.findutils pkgs.gnugrep pkgs.gnused pkgs.rsync pkgs.systemd] ./cutover.sh;
  snapshot = mk "minecraft-snapshot" [pkgs.coreutils pkgs.docker pkgs.gnugrep pkgs.rsync pkgs.systemd pkgs.util-linux] ./snapshot.sh;
in {
  inherit cutover snapshot;
  backup = mk "minecraft-backup" [pkgs.coreutils pkgs.findutils pkgs.gnutar pkgs.zstd snapshot] ./backup.sh;
  stage = mk "minecraft-stage" [pkgs.coreutils pkgs.gnugrep pkgs.gnused pkgs.gawk] ./stage.sh;
}
