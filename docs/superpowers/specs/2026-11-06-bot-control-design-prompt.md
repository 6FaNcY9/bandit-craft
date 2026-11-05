# Design prompt: commanding the bots like a wizard commands servants

Use this prompt to design (not yet build) the next version of how players command and watch the bots.
Output: a design document in `docs/superpowers/specs/`, reviewed by the architect before the owner sees it.

## Who and why

- **fancy8869 (owner)** plays an evil wizard. The bots are his servants and that is the theme of the whole
  world (his castle and wizard tower come next). He commands every bot.
- **MidariBread (Misa)** owns two bots: MisaBot (builder, helper) and EM_Trader (trader). She commands
  only those two, but with them she must be able to do *everything* the owner can.
- Both said the same thing (2026-11-05/06): the in-game window offered far too little ("komm her",
  "hol Holz"). They want to do with the bots **whatever a player can normally do in Minecraft**, without
  learning commands by heart. Controlling and watching the bots must feel easy and obvious.
- The ultimate goal: the two of them run the bots themselves, so Claude no longer has to manage them.
  The bots keep working when nobody is online.

## What exists today (read it before proposing anything)

- Bot hub and jobs: `hosts/bandit-lab/services/mcbots/app/` (`bots.js` JOBS and VALIDATE, about 40
  job types: mine, chop, get, craft, smelt, schematic, produce, build, excavate, clear, shaft, seal,
  light, tidy, deposit, withdraw, stock, goto, guard, follow, homebed, graves, treefarm, wheatfarm,
  hunt, trade, rearm, help, road, ...). Runbook `docs/runbooks/minecraft/BOTS.md`.
- In-game command stand ("Kommandostand"): Paper plugin `hosts/bandit-lab/services/minecraft/botui/`
  plus `app/botui.js`, `botui-jobs.js` (order catalog, ~30 orders), `botui-screens.js`. Dialog screens,
  orders from what the player looks at (gaze), area selection by two corners, a map item, a status
  view (Lagebild). Spec `docs/specs/2026-11-04-kommandostand.md`.
- `/bots` CommandPanels menu and sidebar (`app/ingame.js`, spec `docs/specs/2026-11-02-ingame-bots.md`,
  v2 `docs/specs/2026-11-03-ingame-bots-v2.md`).
- Chat orders in German to a bot (`app/owner.js` grammar, MisaBot v2: `docs/specs/2026-11-03-misabot-v2-design.md`).
- Tailnet web dashboard (`app/public/index.html`): only the owner, not in game.
- Keeper (standing stock quotas), job board, projects that resume by themselves, death-loop hold,
  night rearm. LLM agents (Andy-4.2 on the lab's Ollama, `hosts/bandit-lab/services/mcagents/`)
  exist but are switched off.
- 2026-11-05 already shipped: guests get the full order catalog for their own bots; all helpers play
  on the main server.

## What to design

1. **Capability map.** List what a player normally does in Minecraft survival (gather, mine, farm,
   breed and tend animals, fish, craft, smelt, cook, brew, enchant, repair, build from a plan, dig,
   terraform, light, defend, fight, follow, carry and sort items, trade with villagers, explore, travel
   by cart, boat, nether portal, ...). For each: what the bots can do today, what is a small addition, what is
   large, what is out of reach (and why). Ordered by how often the two players would want it.
2. **How an order is given**, for someone who knows no commands. Find ways to make orders obvious and
   fun to give within the theme. Some ideas to weigh, not decisions: a wizard's staff item, where
   right-clicking a block, mob, chest or area offers what the servants can do *there*; say what you
   want in plain German in chat and have an LLM turn it into jobs, with a confirmation; "make me X"
   that works out the whole chain (gather, smelt, craft) by itself; give a schematic by placing it with
   Litematica or picking it from a list; a task board in the world (lectern, book, signs) the servants
   take work from; summoning servants. Compare, recommend, and say what you dropped.
3. **How bots are watched.** Where each servant is, what it does, why it is stuck, what it needs, what it
   finished, without opening the web dashboard: in game first. Alerts that matter (death, stuck,
   missing material), never spam.
4. **Rights.** The owner: every bot plus server-wide switches. Misa: everything for her two bots,
   nothing for others. A third player later should be one config line.
5. **Always busy.** When a servant has nothing to do, what does it take next (a queue per player, the
   task board, the keeper's quotas, a "when idle" default)? The players set this, not Claude.
6. **Alive, even with nothing to do.** An idle servant must never look dead or frozen. It shows life in a
   bot-like, uncannily quick way (owner 2026-11-06): it reacts at once to a player near it, looks at
   things, moves with purpose, never wanders into danger or griefs. Say which idle behaviours fit the
   evil-wizard theme and cost little.
7. **Perfect movement.** The servants should move so well that Misa thinks "wow, they are good at this
   game": clean parkour over gaps and up blocks, sprinting, climbing (ladders, vines, scaffolding),
   swimming, doors and gates, no stuck spinning or pillaring where a jump would do. Measure today's
   gaps (pullbacks, "No path", stuck time) and say what to build (pathfinder settings, own moves,
   recovery) in which order. Sprint and parkour flags are on since 2026-11-05; diagonals are off.
8. **Phases.** Split into shippable steps, the first one useful on its own within a few days.

## Constraints

- Paper 26.2 behind Velocity. Bots are mineflayer 4.39 speaking 26.1 through ViaBackwards (sprint and parkour on since
  2026-11-05, diagonals off). No client mods may be required (Misa plays vanilla-ish; the owner uses
  Litematica, Xaero, Meteor).
- Bot chat to players goes as `tellraw` from the console (the server rejects the bots' `/tell`).
- Every player input is untrusted and checked server-side (VALIDATE has the last word). Bots never dig
  in protected areas (`PROTECTED_AREAS`) unless that box names them, never destroy chest contents,
  never act for a player on bots that are not theirs.
- The repo is public: no secrets in code. Deploys go through bandit-nix and the owner.
- Reuse the hub, the job catalog, BotUi and the chat grammar. Extend them, do not start over.

## Success

- Misa opens one thing in game, sees all she can do with MisaBot and EM_Trader, and gives an order
  in under 30 seconds without help.
- The owner gives a castle-sized job ("build this plan here, get all the materials") in game and the
  servants finish it without Claude.
- Both can see at any time what each servant does and why it waits.

## Anti-goals (a failure even if it works)

- A wall of 40 buttons or a command list to memorise.
- An LLM that acts without showing what it understood first.
- Bots that silently stand idle, or that spam chat.
- Anything that lets one player use or harm the other's bots, base or items.

## Deliverables of the design

The capability map, the recommended way to give and watch orders (with the alternatives you
dropped), rights, idle behaviour, the phases, and the open questions only the owner or Misa can
answer. German texts for anything players see.
