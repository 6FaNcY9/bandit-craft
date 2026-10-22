# Velocity plugins shared by the Docker proxy (default.nix) and the nix-minecraft proxy (nix-minecraft.nix).
{pkgs}: let
  botgate = import ./botgate {inherit pkgs;};

  # VeloAuth 1.6.2 (MIT): login for players without a Minecraft account
  # (owner's decision, 2026-10-08). Names Mojang knows are still forced through
  # Mojang auth, so nobody can take fancy8869 or any other bought name; other
  # players register with /register in VeloAuth's embedded holding area.
  # Premium players skip that area.
  veloauthJar = pkgs.fetchurl {
    url = "https://cdn.modrinth.com/data/awl91tjn/versions/utSLTyeT/veloauth-latest.jar";
    hash = "sha512-EGCHlYZvGO71TzY+7TS78zyITmlCptHzeP7tSjw1BLKZGlQu4CzvDRc3f9CnmqPHCOvgN8JfDDx/fayx5ETGpQ==";
  };
  # Upstream default config (keeps its comments) with three changes; the grep
  # guards fail the build if upstream renames a key.
  veloauthConfig = pkgs.runCommand "veloauth-config.yml" {nativeBuildInputs = [pkgs.unzip];} ''
    unzip -p ${veloauthJar} default-config.yml > cfg
    grep -q '^  mode: external$' cfg
    grep -q '^  bypass-auth-server: false$' cfg
    grep -q '^  ip-limit-registrations: 3$' cfg
    sed -e 's/^  mode: external$/  mode: embedded/' \
      -e 's/^  bypass-auth-server: false$/  bypass-auth-server: true/' \
      -e 's/^  ip-limit-registrations: 3$/  ip-limit-registrations: 20/' cfg > $out
  '';
in {inherit botgate veloauthJar veloauthConfig;}
