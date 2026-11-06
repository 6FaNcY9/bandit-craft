# BotUi menu spike: virtual crafting, furnace and enchanting screens

Tried 2026-11-06 on the botui stand (Paper 26.2) with `MenuType.X.builder().title(..).build(player)` plus
`player.openInventory(view)`, no block involved, every click cancelled by a LOWEST click handler. Spike code reverted.

- FURNACE: opens (window type 14), 3 slots (input, fuel, result) settable, a cancelled result click (mode 0 and shift) leaves no
  ghost item and the player inventory stays unchanged. No location builder needed. Best candidate for a third menu shape.
- ENCHANTMENT: opens (type 13), 2 slots settable, clicks cancelled cleanly. Needs `checkReachable(false)`, else it closes without
  an enchanting table nearby. The three offer buttons were not exercised (they come from server-side offer data, not slots).
- CRAFTING: opens (type 12, needs `checkReachable(false)`), slots 1-9 settable, but the result slot 0 is recomputed by the server
  on every grid change, so a diamond set there showed as empty. Result click cancelled without ghost item. Not a free-form screen.
- Recipe book: a raw protocol client cannot show it. The server side stays a risk for CRAFTING: a recipe-book request moves items
  from the real player inventory into the grid, which a click handler does not see. Untested; avoid CRAFTING, FURNACE has the same
  recipe book on the client but its placement also goes through a server request, so verify with a real client before relying on it.
- Holder: all three are plain `InventoryView`s, not `MenuHolder`s, so a menu check must key on the view or a tracked set.
