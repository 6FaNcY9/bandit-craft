# BotUi Paper plugin, compiled against the API inside the pinned Paper jar.
{pkgs}: let
  paperJar = pkgs.fetchurl {
    url = "https://fill-data.papermc.io/v1/objects/715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba/paper-26.2-130.jar";
    sha256 = "715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba";
  };
in
  pkgs.runCommand "botui.jar" {nativeBuildInputs = [pkgs.jdk25_headless pkgs.unzip];} ''
    # The API ships inside the Paper jar (bundled libraries), so no snapshot URL can rot.
    mkdir libs classes
    unzip -j ${paperJar} 'META-INF/libraries/*.jar' -d libs
    cp ${./BotUi.java} BotUi.java
    javac --release 25 -proc:none -Xlint:all,-classfile,-processing -Werror -cp 'libs/*' -d classes BotUi.java
    cp ${./plugin.yml} classes/plugin.yml
    jar --create --file $out --date 1980-01-01T00:00:02Z -C classes .
  ''
