# Every Minecraft plugin jar the lab runs, hash-pinned in one place. `file` is the name under
# plugins/ on the server; `src` is the fetched jar. Docker is still the runtime (default.nix
# seeds/stages from here), so this file changes no container definition.
# `mc263` records the Minecraft 26.3 go/no-go (docs/runbooks/minecraft/MC-26.3-GO-NO-GO.md):
# status = "exists" (a build lists 26.3; `build` names it when it differs from `version`),
# "only-26.2" or "unknown"; `source` is the primary page that shows it.
{pkgs}: let
  mk = {
    file,
    version,
    url,
    hash,
    mc263,
  }: {
    inherit file version url hash mc263;
    src = pkgs.fetchurl {inherit url hash;};
  };
in
  builtins.mapAttrs (_: mk) {
    axgraves = {
      file = "AxGraves-1.32.0.jar";
      version = "1.32.0";
      url = "https://cdn.modrinth.com/data/Cz6msz34/versions/TVfUUk5c/AxGraves-1.32.0.jar";
      hash = "sha512-ZH1PTpLRu+6DkTgDLVM4DhfyCZTe9GfGZ5U1u44/k/fk2bGhuVDCx1Es1wA9azjxhSATFzEobtLYgMvpZOD1Lw==";
      mc263 = {
        status = "exists";
        build = "1.32.1";
        source = "https://modrinth.com/plugin/axgraves/versions";
      };
    };
    bluemap = {
      file = "BlueMap-5.28.jar";
      version = "5.28";
      url = "https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.28/bluemap-5.28-paper.jar";
      hash = "sha256-TPtKmWMTLVvgqdsDGiipjp35Le7TfrsHVtOn3Ychq5g=";
      mc263 = {
        status = "exists";
        build = "5.29";
        source = "https://modrinth.com/plugin/bluemap/versions";
      };
    };
    # Not on Modrinth/Hangar; Jenkins may prune old builds, so keep the jar in the binary cache.
    citizens = {
      file = "Citizens-2.0.44-b4258.jar";
      version = "2.0.44-b4258";
      url = "https://ci.citizensnpcs.co/job/Citizens2/4258/artifact/dist/target/Citizens-2.0.44-b4258.jar";
      hash = "sha256-clL/ln43mWv3V/gWcKXgiw3/UOxyhwkw+82UvdFI/a8=";
      mc263 = {
        status = "unknown";
        source = "https://ci.citizensnpcs.co/job/Citizens2/";
      };
    };
    commandpanels = {
      file = "CommandPanels-4.2.4.jar";
      version = "4.2.4";
      url = "https://github.com/rockyhawk64/CommandPanels/releases/download/4.2.4/CommandPanels-4.2.4.jar";
      hash = "sha256-I5BNRmQALJbL/9w5RCBl4iC09r0CKxXT+CsXgRUgYAE=";
      mc263 = {
        status = "exists";
        build = "4.2.5";
        source = "https://github.com/rockyhawk64/CommandPanels/releases/tag/4.2.5";
      };
    };
    imageframe = {
      file = "ImageFrame-2026.1.5.0.jar";
      version = "2026.1.5.0";
      url = "https://cdn.modrinth.com/data/lJFOpcEj/versions/dKkWOwRr/ImageFrame-2026.1.5.0.jar";
      hash = "sha512-6e5c6laZRnZ8ElOXVQx8pbvL4NUEgyryFuydjeqZ9TL0r4Dg6aF+6RfH/XjBApK6O75hRXlH8Z0+32i79fL0qA==";
      mc263 = {
        status = "exists";
        source = "https://modrinth.com/plugin/imageframe/versions";
      };
    };
    inventoryrollbackplus = {
      file = "InventoryRollbackPlus-1.8.4.jar";
      version = "1.8.4";
      url = "https://cdn.modrinth.com/data/XWKWAzd8/versions/2JWRgmoZ/InventoryRollbackPlus-1.8.4.jar";
      hash = "sha512-UUS+wSYGcxIvG9yRwnQ/JsfSDeR0A8FWiY0pnQrhqV9KptWM/Sg6VH5RhiyRmxMb8JzMOA2iFbcOTuVrc5wbEA==";
      mc263 = {
        status = "exists";
        build = "1.8.5";
        source = "https://modrinth.com/plugin/inventoryrollbackplus/versions";
      };
    };
    # Third-party (iamgadgetman), not the owner's build: the release asset's digest equals the live jar.
    jarvis = {
      file = "jarvis-paper-0.17.0.jar";
      version = "0.17.0";
      url = "https://github.com/iamgadgetman/jarvis/releases/download/v0.17.0/jarvis-paper-0.17.0.jar";
      hash = "sha256-1SGfcfLTuObWgpDu31giAJusRp4Jt30BvinJvQE9XUE=";
      mc263 = {
        status = "only-26.2";
        source = "https://github.com/iamgadgetman/jarvis#readme";
      };
    };
    luckperms = {
      file = "LuckPerms-Bukkit-5.5.71.jar";
      version = "5.5.71";
      url = "https://cdn.modrinth.com/data/Vebnzrzj/versions/b0mk8uS6/LuckPerms-Bukkit-5.5.71.jar";
      hash = "sha512-GIqR8KVD0jv9oyOF/KbbY9YeScikIr1FKiYL2cvGp9f+RQcRmen8qPPOQ8K0HuhP0xW9FUZFdwKP85UafU+rJw==";
      mc263 = {
        status = "exists";
        source = "https://modrinth.com/plugin/luckperms/versions";
      };
    };
    placeholderapi = {
      file = "PlaceholderAPI-2.12.3.jar";
      version = "2.12.3";
      url = "https://hangarcdn.papermc.io/plugins/HelpChat/PlaceholderAPI/versions/2.12.3/PAPER/PlaceholderAPI-2.12.3.jar";
      hash = "sha256-/eAyWfWvaTjzwz7rTYFAAKGtq/HSMEzhSXC+gfYJpDc=";
      mc263 = {
        status = "exists";
        source = "https://modrinth.com/plugin/placeholderapi/versions";
      };
    };
    smoderation = {
      file = "SModeration-Paper-2.0.0.jar";
      version = "2.0.0";
      url = "https://cdn.modrinth.com/data/psWnUhHl/versions/oSGjnNOf/SModeration-Paper-2.0.0.jar";
      hash = "sha512-lPfgeAqYZMZU4ACHBd4Hj7PtCCfcpfVUQ8jWHxwkrEWgO0aJve+jAQB0tjIZEJTw6VE1MalxwIGBwD63nAU2KA==";
      mc263 = {
        status = "only-26.2";
        source = "https://modrinth.com/plugin/smoderation/versions";
      };
    };
    treefeller = {
      file = "TreeFeller-1.32.0.jar";
      version = "1.32.0";
      url = "https://github.com/ThizThizzyDizzy/tree-feller/releases/download/v1.32.0/TreeFeller-1.32.0.jar";
      hash = "sha256-IjoOhQwxz6HSC5NnejYs0/OmuG0DNDe0VwV97XQXO5w=";
      mc263 = {
        status = "exists";
        build = "1.33.0";
        source = "https://modrinth.com/plugin/thizzyz-tree-feller/versions";
      };
    };
    viabackwards = {
      file = "ViaBackwards-5.12.0.jar";
      version = "5.12.0";
      url = "https://hangarcdn.papermc.io/plugins/ViaVersion/ViaBackwards/versions/5.12.0/PAPER/ViaBackwards-5.12.0.jar";
      hash = "sha256-+QL32n65nov69GH4AoPE4nULfZcn5rUI6ku5Fj9Vsds=";
      mc263 = {
        status = "exists";
        build = "5.12.2-SNAPSHOT+662 (beta channel only)";
        source = "https://modrinth.com/plugin/viabackwards/versions";
      };
    };
    viaversion = {
      file = "ViaVersion-5.12.0.jar";
      version = "5.12.0";
      url = "https://hangarcdn.papermc.io/plugins/ViaVersion/ViaVersion/versions/5.12.0/PAPER/ViaVersion-5.12.0.jar";
      hash = "sha256-xNUS+pdg+kHRerrt3hKqH0yb3pINCpkv4PwBaWLxJr4=";
      mc263 = {
        status = "exists";
        build = "5.12.2-SNAPSHOT+1108 (beta channel only)";
        source = "https://modrinth.com/plugin/viaversion/versions";
      };
    };
    voicechat = {
      file = "voicechat-bukkit-2.6.24.jar";
      version = "2.6.24";
      url = "https://cdn.modrinth.com/data/9eGKb6K1/versions/EJth3OAr/voicechat-bukkit-2.6.24.jar";
      hash = "sha256-rz1OKtMY0wZZWSSME3CuMqYZdSy00qT+wvenmxAGd2k=";
      mc263 = {
        status = "exists";
        build = "bukkit-2.6.25";
        source = "https://modrinth.com/plugin/simple-voice-chat/versions";
      };
    };
  }
