# ChatBridge, the public world's Discord chat bridge, compiled against the API inside the pinned Paper jar
# (the same jar and way as ../../minecraft/botui). The build runs SelfTest; the jar carries only the plugin.
{pkgs}: let
  paperJar = pkgs.fetchurl {
    url = "https://fill-data.papermc.io/v1/objects/715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba/paper-26.2-130.jar";
    sha256 = "715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba";
  };
  # Compile time only, as for BotUi: signatures javac loads name Guava and JetBrains annotation types.
  guava = pkgs.fetchurl {
    url = "https://repo1.maven.org/maven2/com/google/guava/guava/33.6.0-jre/guava-33.6.0-jre.jar";
    hash = "sha256-3Fc+H8pP1UVPSl/T19ot8DACh2pBdbr8FKlZgN13E7M=";
  };
  # Compile time only: Gson is on the server's classpath (the Paper jar's libraries.list pins 2.14.0, same sha256).
  gson = pkgs.fetchurl {
    url = "https://repo1.maven.org/maven2/com/google/code/gson/gson/2.14.0/gson-2.14.0.jar";
    sha256 = "2cbd119bf1961c28788310963dc80ba65f58cdeec1dd139c8bdb1240faa2c36f";
  };
  annotations = pkgs.fetchurl {
    url = "https://repo1.maven.org/maven2/org/jetbrains/annotations/26.0.2/annotations-26.0.2.jar";
    hash = "sha256-IDe+N4mA07qTM+l5VfOyzeOSqhJNBMpzzi7uZlcZkpc=";
  };
in
  pkgs.runCommand "chatbridge.jar" {nativeBuildInputs = [pkgs.jdk25_headless pkgs.unzip];} ''
    mkdir libs classes test
    unzip -j ${paperJar} 'META-INF/libraries/*.jar' -d libs
    cp ${annotations} libs/annotations.jar
    cp ${guava} libs/guava.jar
    cp ${gson} libs/gson.jar
    cp ${./ChatBridge.java} ChatBridge.java
    cp ${./SelfTest.java} SelfTest.java
    javac --release 25 -proc:none -Xlint:all,-classfile,-processing -Werror -cp 'libs/*' -d classes ChatBridge.java
    javac --release 25 -proc:none -cp 'libs/*:classes' -d test SelfTest.java
    java -cp 'libs/*:classes:test' chatbridge.SelfTest
    cp ${./plugin.yml} classes/plugin.yml
    jar --create --file $out --date 1980-01-01T00:00:02Z -C classes .
  ''
