# Bot UI: old dialog flow to picture menu

Source of truth: `MENUS` in `hosts/bandit-lab/services/mcbots/app/botui-menus.js`, `SCREENS` in `botui-screens.js`, `JOBS` in
`botui-jobs.js`. Every row of the old dialog flow is covered by a menu. Dialogs left: `stopall` (confirmation), `upload` (browser link)
and the `ziele` quota sliders (numbers). Everything else, including "Alle Befehle (alt)", was removed in part 2b; a viewer whose saved
screen is a deleted dialog lands on the overview.

## Screens (old `SCREENS`)

- `lage` (Lagebild): covered by overview `ov` (`/bots`, staff left click, a plain open).
- `bot` (bot screen): covered by bot page `botm` (staff right click on a bot, or a head in `ov`); inventory by `invm`.
- `wennfrei`: covered by `idlem` (icon per choice; Daueraufträge only for the owner's bots).
- `stopall`: dialog left (confirmation; `ov` "Alle: Stopp" opens it for the owner, Misa's variant acts at once).
- `upload`: dialog left (opened from `ov` "Bauplan hochladen"; the link is a browser button).
- `karte`: covered by `kartem` (six zoom slots, "Mitte: ich" and a head per bot).
- `auftrag` (general order list): covered by the menus below; nothing lands there any more, a staff click on a block without a menu goes to `ov`.
- `job` (one order's form): covered per job below.
- `ziele`: sliders are the dialog left; keeper and sidebar toggles and trader-chest removal are the `zielm` menu (Einstellungen in `ov`).

## Jobs (`JOBS`)

- `followme`, `summon`, `deposit`, `chop` (Holz holen), `treefarm`: bot page `botm` (one click, `go`).
- `guard`: `botm` "Bewachen…" opens `guardm` (radius 8/16/32/48, here or the marked spot).
- `goto`, `tidy`, `help`, `rearm`, `homebed`, `graves`: `morem` ("Mehr…" on the bot page): Hingehen… (marked spot, saved places, where I stand), Hier aufräumen, Ausrüsten, Heim, Gräber holen, Helfen, Bereich….
- `mine`, `shift`, `shiftlogs`: hopper window `shiftm` with grid `gridm` and point-to-pick; staff on a minable block opens it pre-filled.
- `setchest`: `botm` "Kiste merken" and `chestm` (staff on a chest).
- `deposit`, `withdraw`, `stock`, `tidy` from a chest: `chestjobs` / `chestm` (staff on a chest, bot by head; withdraw asks for the item via `gridm`).
- `hunt`: `huntm` (staff on cow/sheep/pig/chicken; counts 1/4/8/16). `wheatfarm`, `lightspawner`: `whom` (staff on wheat / a spawner).
- `schematic`, `produce`: `botm` "Bauen…" → plan grid `schemm` → `placem` (ghost box, "Markierte Stelle", "Wo ich stehe", saved places) → `buildm`
  (Bauen / Material sammeln, who, when, rotation).
- `get`, `craft`, `smelt`: `botm` Holen… (`gridm` mode get), Herstellen… (`craftm`), Schmelzen… (`smeltm`); staff (sneak) on a crafting table or furnace opens the window.
- `enchant`: `botm` Verzaubern… and staff on an enchanting table → `enchm` (tool, lapis, Stufe 1-3).
- `excavate`, `clear`, `shaft`, `light`, `seal` (area jobs): `aream` after two staff clicks with the ghost box or the marked area; `level` is not offered (needs numbers).
- Marks (sneak + staff on the ground: spot, again elsewhere: area) are shared by `placem`, `aream`, goto and guard.
- Resume of a stopped project: `botm` "Weiter" (only while the bot has a paused project).

## Not in a menu

Trade on a button, ore mining from a marked area (owner decision), Meldungen and Essen (no job / no unread store), the upload itself (browser link).
