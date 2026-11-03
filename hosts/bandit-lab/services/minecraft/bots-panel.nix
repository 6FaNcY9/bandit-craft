# /bots: who works, who idles, who is in trouble. The hub keeps every value in the `mcbots` data table while a viewer is
# online (app/ingame.js). A slot shows its first item whose conditions hold, so the icon is the bot's state.
# Returns { <panel name> = <panel>; }; default.nix writes it as bots.yml (JSON is YAML).
{lib}: let
  # Must match BOT_NAMES and the worker `bots` lists in ../mcbots/default.nix.
  names = ["bot1" "bot2" "bot3" "bot19" "bot20" "bot21" "MisaBot" "EM_Trader"];
  data = key: "%commandpanels_data_${key},mcbots%";
  # botState in app/ingame.js; `work` comes last and has no condition, so a slot is never empty.
  states = bot: [
    {
      state = "offline";
      material = "GRAY_DYE";
      color = "&8";
    }
    {
      state = "dead";
      material = "SKELETON_SKULL";
      color = "&4";
    }
    {
      state = "error";
      material = "BARRIER";
      color = "&c";
    }
    {
      state = "sheltered";
      material = "RED_BED";
      color = "&7";
    }
    {
      state = "idle";
      material = "[head] ${bot}";
      color = "&7";
    }
    {
      state = "work";
      material = "[head] ${bot}";
      color = "&b";
    }
  ];
  itemKey = bot: s: "${bot}_${s.state}";
  botItem = bot: s:
    {
      inherit (s) material;
      name = "${s.color}${bot}";
      lore = [
        "&7Rolle: ${data "${bot}_role"}"
        "&f${data "${bot}_job"}"
        "&7${data "${bot}_doing"}"
        "&c${data "${bot}_error"}"
        "&7${data "${bot}_vitals"}"
        "&7${data "${bot}_where"}"
        "&8Klick: Befehle"
      ];
      left-click.commands = ["[session] set bot ${bot}" "[open] botmenu"];
    }
    // lib.optionalAttrs (s.state != "work") {conditions = "${data "${bot}_state"} $EQUALS ${s.state}";};
  summary = material: name: key: {
    inherit material name;
    lore = ["&f${data key}"];
  };
in {
  bots = {
    title = "&8Bots";
    type = "inventory";
    command = "bots";
    aliases = ["b"];
    conditions = "%player_name% $EQUALS fancy8869 $OR %player_name% $EQUALS MidariBread";
    update-interval = 20;
    rows = 3;
    layout =
      {
        "0" = ["sum_bots"];
        "1" = ["sum_problems"];
        "2" = ["sum_need"];
        "3" = ["sum_day"];
        "7" = ["sidebar"];
        "8" = ["allstop"];
      }
      // lib.listToAttrs (lib.imap0 (i: bot: lib.nameValuePair (toString (9 + i)) (map (itemKey bot) (states bot))) names);
    items =
      {
        sum_bots = summary "COMPASS" "&bBots" "sum_bots";
        sum_problems = summary "BELL" "&cProbleme" "sum_problems";
        sum_need = summary "CHEST" "&eBedarf" "sum_need";
        sum_day = summary "CLOCK" "&eTageszeit" "sum_day";
        sidebar = {
          material = "OAK_SIGN";
          name = "&eSeitenleiste";
          lore = ["&7links: aus" "&7rechts: an"];
          left-click.commands = ["[console] team leave %player_name%"];
          right-click.commands = ["[console] team join mcbots %player_name%"];
        };
        allstop = {
          material = "BARRIER";
          name = "&cAlle stopp";
          left-click.commands = [
            "[console] pa data del %player_name% order"
            "[console] pa data set %player_name% order alle:stopp"
            "[msg] &7gesendet"
          ];
        };
      }
      // lib.listToAttrs (lib.concatMap (bot: map (s: lib.nameValuePair (itemKey bot s) (botItem bot s)) (states bot)) names);
  };
}
