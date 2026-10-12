# The `pc-admin` command (pc-admin.sh with the PC table from pcs.nix); pc-admin.nix installs it on the
# laptop, the flake builds it as a check (shellcheck runs in writeShellApplication).
{
  lib,
  writeShellApplication,
  openssh,
  coreutils,
  glibc,
}: let
  pcs = import ./pcs.nix;
in
  writeShellApplication {
    name = "pc-admin";
    runtimeInputs = [openssh coreutils glibc.bin];
    text =
      ''
        pcs="${lib.concatStringsSep " " (builtins.attrNames pcs)}"
        pc() {
          case "$1" in
        ${lib.concatStrings (lib.mapAttrsToList (name: pc: "    ${name}) user=${pc.user} addr=${pc.address} ;;\n") pcs)}    *) return 1 ;;
          esac
        }
      ''
      + builtins.readFile ./pc-admin.sh;
  }
