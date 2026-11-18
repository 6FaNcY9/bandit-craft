# Underground View and Loose Dirt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Looking underground in the one view becomes readable (dark cut lid, camera follows the cut, automatic cut at a covered bot, bots visible through rock), and loose bot dirt shows red with a count chip.

**Architecture:** Everything happens in the browser; no hub change, no new route, no new fetch. The mesher recolours faces it already emits (cut lid dark, loose dirt red) and counts loose dirt; the page's Web Worker passes the cut and the layer switch to the mesher, acks cuts and answers a "roof above this bot" probe from its cache; the page moves the camera with the cut, draws a ghost per marker and a chip.

**Tech Stack:** browser classic scripts and one Web Worker, vendored three.js r159, Node 22 tests (`node:vm` worker harness), headless Chromium on the local stand. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-18-underground-view-design.md` (the architect's design; its sections "Constraints" and "Handoff" are binding). Phase 1 contract: `docs/superpowers/plans/2026-11-17-one-view-ui.md` "Global Constraints" and "Shared definitions" still hold unless changed here.

## Global Constraints

- No hub change: no new route, no new fetch, no change to `server.js`, the hub or the plugin. The worker answers the probe from its cache only. The UI still never calls `/api/world/sample`, `blocks`, `height`.
- No new triangles: the lid faces at the cut exist today; loose dirt is a recolour. Draw calls rise only by one ghost mesh per bot/player marker.
- Mesher result: `{pos, col, idx, loose}` (`loose` = number of loose dirt cells in the section below the cut), or `null` when there are no faces (then the worker treats `loose` as 0).
- Lid colour = the block's top colour x 0.3, `Math.round` per channel (stone 138 -> 41), only when the real block above is drawn; a lid face over real air keeps its normal colour.
- Loose rule: block name exactly `dirt` (after `blocks.nameOf`), at most 1 of the four side neighbours (-x, +x, -z, +z) drawn per `blocks.drawn`; a not-loaded neighbour counts as drawn (no red at the view's edge); cells above the cut are neither red nor counted. Loose faces use `0xff2a2a` with the usual `LIGHT` factors and `Math.round`.
- Camera: the target goes underground only together with a cut (`level()`); at start the saved `cam.y` is clamped to at least 70 (the cut is not persisted).
- UI text German, short, through `textContent` only; the chip is at least 44 px high; the page keeps one inline `<script>`; modules declare no top-level name; `public/legacy.html` and „Datei ansehen“ are not touched.
- Commit with `git commit --no-gpg-sign` (global `commit.gpgsign` is on) and the session's trailer lines; never push or deploy. After code changes run `graphify update .` (do not commit `graphify-out/`).
- Tests: `cd hosts/bandit-lab/services/mcbots/app && node test/<part>.js`; the stand needs `NODE_PATH=$(ls -dt /nix/store/*-mcbots-0.1.0/lib/node_modules/mcbots/node_modules | head -1)`. The controller runs the nix `mcbots-tests` check.

## Review Focus

1. A slider dragged fast on a phone: the camera follows the latest acked cut only, no extra re-mesh beyond today's 150 ms debounce, a manual move clears the automatic cut. Pinned in Task 2 (ack order) and Task 3 (page pin).
2. Two bot-row taps in a row, or a bot that walks while its probe waits: newest probe wins, no stale cut is set after the second tap. Pinned in Task 2.
3. A probe for a bot in a chunk that is unknown, ungenerated or never loads: no automatic cut, no hang, no fetch. Pinned in Task 2.
4. The loose switch with many sections: only sections that have loose dirt are re-meshed; eviction and `reset` remove their keys; the count is unchanged by the switch. Pinned in Task 2.
5. The lid exactly at a section border (cut = 16k - 1 and 16k): dark if and only if the real block above is drawn, including when that block is in the next section up. Pinned in Task 1 and Task 2.

---

## Shared definitions

**New worker messages** (add to the phase-1 list; typed arrays still transferred):

```
page -> worker
  {t:'loose', on}                  red loose dirt on/off; re-meshes only sections whose last mesh had loose > 0
  {t:'probe', x, y, z}             is there rock above this bot? one slot, the newest replaces an unanswered one
worker -> page
  {t:'mesh', ..., loose}           as before, plus the section's loose count (0 when the mesh is null)
  {t:'cut', y}                     ack, posted after the re-mesh loop of a cut message
  {t:'probe', x, y, z, roof}       roof = drawn, non-leaves cells among floor(y)+2 .. floor(y)+9 in column (floor x, floor z)
```

Probe rules: answered once the section holding `floor(y)` of that column is cached (a section above that is missing counts as air); if the chunk's state is not 0 (unknown or ungenerated) the answer is `roof: 0`; "covered" = `roof >= 3`.

**Page rules (phone first):**
- ▤ button: unchanged (shows/hides slider and label).
- Slider: label updates live; `{t:'cut'}` after 150 ms as today; the camera moves on the worker's ack (`view.level(m.y)`); a manual move clears `cutAuto`.
- Bot-row tap (`index.html` ~l.450): `view.flyTo(x, Math.max(y + 2, 70), z)` and `{t:'probe', x, y, z}`. Answer `roof >= 3`: `setCut(Math.floor(y) + 1, true)` (slider and label shown at that value). Otherwise: an automatic cut is removed (`setCut(319)`), a manual cut stays.
- Plan-chip tap: fly as today and remove an automatic cut.
- World tap: unchanged.
- Chip `#looseChip` „🟥 N lose Erde“ inside `#world`, top left beside `#conn`: N = sum of the loaded sections' loose counts; hidden at N = 0; a tap toggles red on/off (state in `store` key `looseOn`, default on); N stays the same when red is off.
- Tag text: `name · Höhe N` when the marker's y < 60 (N = `Math.floor(y)`), else `name`.

---

### Task 1: Mesher — dark lid and loose dirt

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/public/oneview/mesher.js`
- Test: `hosts/bandit-lab/services/mcbots/app/test/view-mesher.js`

**Interfaces:**
- Produces: `meshSection(sec, nb, capY = 16, {lid = false, loose = true} = {}) -> {pos, col, idx, loose} | null`. `lid` = "this section holds the cut's top layer although `capY` is 16" (cut = 16k - 1). The worker (Task 2) passes `nb[3]` real from now on.

- [ ] **Step 1: Write the failing tests** (append to `test/view-mesher.js`, reuse its `AIR`, `STONE`, `S6`, `A6`, `one`, `faces`):
  - `meshSection(STONE, S6, 8)`: 256 faces, every colour byte 41.
  - `meshSection(STONE, [STONE, STONE, STONE, AIR, STONE, STONE], 16, {lid: true})`: 256 faces, colour 138; same with `STONE` above: colour 41.
  - A lone `minecraft:dirt` in `A6`: `loose === 1`, its top face colour `[255, 42, 42]`; with `{loose: false}`: `loose === 1` and brown (`blocks.rgb('dirt')`).
  - Dirt with two drawn side neighbours (stone at x-1 and x+1): `loose === 0`.
  - Dirt at x = 0 with one drawn inner neighbour (x = 1): `nb[0] = null` gives 0, `nb[0] = AIR` gives 1.
  - A `minecraft:short_grass` side neighbour is not drawn: dirt with three `short_grass` neighbours and one stone is loose.
  - Dirt at y 10 with `capY = 8` is not counted (`loose === 0` or `null` result).
  - Existing assertions stay green (the one-block colour set `[69, 90, 110, 138]`, buried null, border cases).
- [ ] **Step 2: Run** `node test/view-mesher.js` — expected FAIL (no `loose` field, lid not dark).
- [ ] **Step 3: Implement.** Per cell, compute the six hidden flags first, then emit. Lid: when `capY < 16 || lid`, the top face of layer `capY - 1` is always drawn, dark if the real block above is drawn (`dr[idx[i + 256]]` for in-section, else the real `L[3]` layer). Loose: name `dirt` and at most 1 of directions 0, 1, 4, 5 hidden; count it; when `loose` is on, take its faces' colours from `0xff2a2a` x `LIGHT`. Keep the face order and the shared buffers as they are (no new per-cell allocations).
- [ ] **Step 4: Run** `node test/view-mesher.js` — PASS; also `node test/view-blocks.js`.
- [ ] **Step 5: Commit** `feat(view): dark cut lid and red loose dirt in the mesher`.

### Task 2: Worker — cut lid, ack, loose switch, roof probe

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/public/oneview/worker.js`
- Test: `hosts/bandit-lab/services/mcbots/app/test/view-worker.js`

**Interfaces:**
- Consumes: Task 1's `meshSection(sec, nb, capY, {lid, loose})`.
- Produces: the messages in "Shared definitions".

- [ ] **Step 1: Write the failing tests** in the vm harness:
  - After `{t:'cut', y}` the worker posts its re-meshes first, then exactly one `{t:'cut', y}`.
  - Mesh messages carry `loose` (a section with one lone dirt: 1); `{t:'loose', on:false}` re-meshes only that section (count unchanged, colours brown), `on:true` restores red.
  - `{t:'probe'}` for a column whose tile is not loaded yet: no answer and no new URL in the fetch list; after the tile loads: one answer with the right `roof`; leaves above are not counted; a second probe before the answer replaces the first (only the second is answered); a probe in a chunk with state 1 or 2 answers `roof: 0`.
  - Cut at y = 31 (section border): the sy 1 section's top layer is dark where the sy 2 section has stone above and normal where it has air.
  - Eviction and `reset` drop keys from the loose set (a later `{t:'loose'}` re-meshes nothing evicted).
- [ ] **Step 2: Run** `node test/view-worker.js` — FAIL.
- [ ] **Step 3: Implement.** `mesh()`: stop nulling `nb[3]`; pass `{lid: cut < (sy + 1) * 16, loose: looseOn}` (lid only matters when capY is 16); post `loose`; keep a Set of section keys with `loose > 0`. `cut`: ack after the loop. `loose`: set `looseOn`, re-mesh the Set's keys. `probe`: one slot, tried in `pump()` (and when a tile arrives); never fetches.
- [ ] **Step 4: Run** `node test/view-worker.js` and `node test/view-mesher.js` — PASS.
- [ ] **Step 5: Commit** `feat(view): worker acks cuts, switches loose dirt and probes the roof above a bot`.

### Task 3: Page — camera with the cut, auto cut, ghosts, tag height, chip

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/public/oneview/view.js`, `public/oneview/layers.js`, `public/index.html`
- Test: `hosts/bandit-lab/services/mcbots/app/test/view-page.js`

**Interfaces:**
- Consumes: Task 2's messages.
- Produces: `view.level(y)`; `view.stats().loose`; `canvas.dataset.loose`, `canvas.dataset.cut`; `setCut(y, auto)` in the page.

- [ ] **Step 1: Write the failing pins** in `test/view-page.js`: `#looseChip` exists inside `#world` and is filled via `textContent`; the worker's `cut` ack calls `view.level`; the bot-row tap posts `{t:'probe'`; `setCut(` exists and a manual slider move clears `cutAuto`; layers.js builds a ghost with `depthTest: false`; the tag text uses `Höhe`.
- [ ] **Step 2: Run** `node test/view-page.js` — FAIL.
- [ ] **Step 3: Implement** per "Page rules": view.js keeps `base` (last flyTo / start height) and `lvl`; `level(y)`: `cam.y = y >= 319 ? base : Math.min(base, y + 1)`; `flyTo` sets `base = y` then applies the current level; start: `base = cam.y = Math.max(saved, 70)`; `setMesh`/`dropMesh` keep a loose sum; `dataset.loose` and `dataset.cut` in `counted()`. layers.js: each marker gets a child ghost (same geometry, `{color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false}`), swapped with the colour; tag text per the rule. index.html: `setCut`, `cutAuto`, the ack and probe handlers, bot row and plan chip as described, `#looseChip` (updated where `worldMsg()` runs).
- [ ] **Step 4: Run** `node test/view-page.js`, `node test/view-worker.js` — PASS.
- [ ] **Step 5: Commit** `feat(view): the camera goes down with the cut, covered bots get an automatic cut, ghosts and the loose chip`.

### Task 4: Stand — a cave, water, a dirt pillar; checks and screenshots

**Files:**
- Modify: `tools/oneview-stand/stand.js`, `tools/oneview-stand/check.js`, `docs/runbooks/minecraft/BOTS.md` (one sentence: underground view and loose dirt)

- [ ] **Step 1: Fake world** in `stand.js`: an air cave around y 40-43 under bot9 (about x -264..-260, z -24..-20) with a 1-wide tunnel leading out, a water column inside it, bot9 at `[-262, 40, -22]`, a free-standing 3-high dirt pillar on open ground, one dirt block with two drawn side neighbours. The existing wrong dirt at `ORIGIN + 3` is also loose: expected count 4. Before pinning 4, scan the stand world once with the loose rule (a one-off script, not committed); if the hills add natural loose dirt, move the pillar or pin the scanned number and say so.
- [ ] **Step 2: Checks** in `check.js` part B (real-time `settle()`): `dataset.loose == 4` (or the pinned number); `#looseChip` shows it; tap the bot9 row (the existing bot list in the 🤖 sheet), then wait for `#cutY` value 41 visible, label `Höhe 41`, `dataset.cut == 41`; `dataset.tris` is the same with the loose switch off and on; screenshots `phone-under.png` (after the auto cut) and `phone-loose.png` (the pillar in view) for the reviewer.
- [ ] **Step 3: Run** the stand and `check.js` — `stand ok`; kill the stand, no Chromium left.
- [ ] **Step 4: Commit** `test(view): stand cave, water and dirt pillar; underground and loose dirt checks`.
