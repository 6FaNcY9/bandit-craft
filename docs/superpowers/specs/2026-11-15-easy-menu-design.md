# Easy bot menu (2026-11-15)

## Intent
The owner (dyslexia, not a programmer) found the in-game bot menu too hard: about 20 buttons on the bot page, a wood
order that ran hundreds of blocks away, a Bereich page where a job click started work without warning and the
selection could not be cleared, and no way to put another player's bot into his running builds.

## Area flow: approaches considered
1. Job starts on click, with a clearer label. Smallest change, but a mis-click still starts digging.
2. A separate confirm page after the job click. Safe, but one more page to read and find the way back from.
3. **Chosen:** the job click only selects (glint), „Los!“ on the same page starts it. One page, nothing starts by accident.

## Decisions
- Bot page: 3 rows, everyday orders only (Komm her, Folg mir, Stopp, Holz holen, Abbauen…, Bereich…, Bauen…,
  Einlagern, Mitmachen…/Wieder raus, Mehr…), one short German lore line each. The rest moved verbatim to Mehr…
  (3 rows); „Helfen“ left the menu (`GO.help` stays in code).
- Menu mine/chop orders carry `near: true`: the bot stays within 64 blocks of where the job started (wood too,
  not 192) and never starts a far search; nothing found fails with „kein X in der Nähe (64 Blöcke)“. Abbauen
  toggles „Nur in der Nähe“ ⇄ „Egal wie weit“ in hopper slot 3 for counted orders; for ∞ (a shift) slot 3 stays
  the chest, a shift keeps its chest leash. Keeper, chat and agent orders are unchanged.
- Bereich: opened from the bot page with no box and no mark it goes straight into picking; step texts 1-3 of 3;
  the pick lasts 5 minutes (marks keep `PICK_MS`); default timing „Jetzt“; „Auswahl löschen“ stays on the page.
- Mitmachen: the hub lists unpaused schematic/produce projects of other bots, grouped by type and args, filtered
  by the same checks an order from that viewer for that bot passes (`allowedBots`, plan visibility, `ground()`).
  Join re-submits the same args with replace; Wieder raus stops and re-submits the bot's previous owner order,
  or lets „Wenn frei“ take over. The menu sees display names only. The builder is made for crews (per-cell claims
  through the shared table, the plan re-read from the world each pass, crew progress counts).
- `JOBS` labels unchanged; menus stay deterministic (no time or randomness in items).

## Out of scope
Crews as a stored concept (a join lives in hub memory and ends with the project or a hub restart), a wood type
choice on „Holz holen“, an amount choice on „Holz holen“.
