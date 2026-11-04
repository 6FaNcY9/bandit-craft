# BotUi Paper plugin, compiled against the API inside the pinned Paper jar.
{pkgs}: let
  paperJar = pkgs.fetchurl {
    url = "https://fill-data.papermc.io/v1/objects/715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba/paper-26.2-130.jar";
    sha256 = "715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba";
  };
  # javac must load Material and ItemStack, whose signatures use Guava and JetBrains annotation types; Paper's jar bundles neither.
  # Guava is on the server's runtime classpath; the annotations are not, which is harmless (a missing annotation class is ignored at runtime).
  guava = pkgs.fetchurl {
    url = "https://repo1.maven.org/maven2/com/google/guava/guava/33.6.0-jre/guava-33.6.0-jre.jar";
    hash = "sha256-3Fc+H8pP1UVPSl/T19ot8DACh2pBdbr8FKlZgN13E7M=";
  };
  annotations = pkgs.fetchurl {
    url = "https://repo1.maven.org/maven2/org/jetbrains/annotations/26.0.2/annotations-26.0.2.jar";
    hash = "sha256-IDe+N4mA07qTM+l5VfOyzeOSqhJNBMpzzi7uZlcZkpc=";
  };
in
  pkgs.runCommand "botui.jar" {nativeBuildInputs = [pkgs.jdk25_headless pkgs.unzip];} ''
    # The API ships inside the Paper jar (bundled libraries), so no snapshot URL can rot.
    mkdir libs classes
    unzip -j ${paperJar} 'META-INF/libraries/*.jar' -d libs
    cp ${annotations} libs/annotations.jar
    cp ${guava} libs/guava.jar
    cp ${./BotUi.java} BotUi.java
    cp ${./BotMap.java} BotMap.java
    javac --release 25 -proc:none -Xlint:all,-classfile,-processing -Werror -cp 'libs/*' -d classes BotUi.java BotMap.java
    cp ${./plugin.yml} classes/plugin.yml
    jar --create --file $out --date 1980-01-01T00:00:02Z -C classes .
  ''
