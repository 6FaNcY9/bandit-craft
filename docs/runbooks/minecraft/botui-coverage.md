# Bot UI: old dialog flow to picture menu

Source of truth: `SCREENS` in `hosts/bandit-lab/services/mcbots/app/botui-screens.js`, `JOBS` in `botui-jobs.js`, menus in
`botui-menus.js`. "Alle Befehle (alt)" is the book in the overview's bottom row (opens the old Lagebild dialog).
Dialogs stay for number input, text, confirmations and everything marked "still a dialog".

## Screens (`SCREENS`)

- `lage` (Lagebild): covered by overview `ov` (`/bots`, staff left click); the old one is still reachable from "Alle Befehle (alt)".
- `bot` (bot screen): covered by bot page `botm` (staff right click on a bot, or a head in `ov`); inventory by `invm`.
- `wennfrei`: covered by `idlem` (icon per choice). Daueraufträge (keeper) are still a dialog (from "Alle Befehle (alt)").
- `stopall`: still a dialog (confirmation; `ov` "Alle: Stopp" opens it for the owner, Misa's variant acts at once).
- `upload`: still a dialog (opened from `ov` "Bauplan hochladen").
- `karte`: still a dialog (opened from `ov` "Karte").
- `auftrag` (general order list): still a dialog (from "Alle Befehle (alt)"; staff right click on a non-minable block or entity still lands here).
- `job` (one order's form): covered for the jobs below; every other job is still a dialog.
- `ziele` (Ziele/keeper/plan/sidebar settings): still a dialog (from "Alle Befehle (alt)").

## Jobs (`JOBS`)

- `followme`, `summon`, `deposit`, `chop` (Holz holen), `treefarm`: covered by bot page `botm` (one click, `go`).
- `guard`: covered by `botm` "Bewach diesen Ort" (guards the spot the viewer stands at); other guard options are still a dialog.
- `mine`, `shift`, `shiftlogs`: covered by the hopper window `shiftm` with grid `gridm` and point-to-pick; staff on a minable block opens it pre-filled.
- `setchest`: covered by `botm` "Kiste merken" (point at a chest) and `chestm` (staff on a chest).
- `schematic`: `botm` "Bauen…" opens the old job dialog (still a dialog).
- `get`, `craft`, `smelt`: covered by `botm` Holen… (`gridm` mode get), Herstellen… (`craftm`) and Schmelzen… (`smeltm`); staff (sneak) on a
  crafting table or furnace opens the window.
- `goto`, `tidy`, `stock`, `withdraw`, `hunt`, `wheatfarm`, `rearm`, `homebed`, `graves`, `help`, `produce`,
  `lightspawner`: still a dialog (staff right click on a block/entity, or "Alle Befehle (alt)").
- `excavate`, `clear`, `shaft`, `light`, `seal` (area jobs from two corners): still a dialog.
