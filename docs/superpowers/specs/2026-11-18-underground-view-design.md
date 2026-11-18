# Underground view and loose-dirt layer — design

Date: 2026-11-18. Follow-up to phase 1 of `2026-11-17-one-view-world-design.md` (live as craft d99fef0).

**Owner request (verbatim):** „jup perfekt hald noch verbessern vor allem das wenn man unter die erde … halt noch verbessern bitte“ — the loose-scaffolding layer as proposed (dirt with at most 1 solid side neighbour drawn red, computed on the phone from loaded sections, live, chip „🟥 N lose Erde“ toggles it), and looking underground made good.

**Evidence:** live phone screenshots at bot2 (-449 23 101): fly-to without a cut puts the camera inside rock (jumble, bot hidden behind an opaque water column); the ▤ cut at 26 gives one flat light-grey lid where tunnels are unreadable.

**Approaches considered:** (1) recolour inside the mesher (chosen: no new triangles or draw calls, cut/eviction/live update come free); (2) a separate InstancedMesh overlay for loose dirt (more draw calls, own lifecycle); (3) translucent water/lava as a second mesh (out for now: biggest mesher change, phones unverified); (4) depth darkening by re-meshing (out: re-mesh cost per slider stop; a shader uniform later if needed).

Design by the architect (Fable), 2026-11-18, as handed over:

## 1. Decision

One release, no new triangles, no hub change. Loose dirt is recoloured red inside the mesher (not a layers.js overlay). Underground = dark cut lid + camera target follows the cut + auto-cut on a covered bot via a worker probe + ghost markers + a height hint on tags.

| Item | | Why |
|---|---|---|
| Loose dirt | IN, as mesher recolour | The mesher already computes the four side "hidden" flags per cell; zero extra draw calls; cut, live update, eviction and view-edge behaviour come free |
| (a) dark lid | IN | Main fix: rock mass dark, open space lit |
| (b) depth darkening | OUT | Needs a re-mesh of 2-3 more section layers per slider stop. If caves still look flat: a `uCut` shader uniform on the terrain material, never a re-mesh |
| (c) target follows cut | IN | Today the orbit pivot sits ~44 blocks above the scene |
| (d) auto-cut | IN, worker probe | The cache knows the column even while a cut hides its meshes; a page raycast cannot |
| (e) ghost marker | IN | ~6 lines, 1 draw call per bot; shows bots in water and under the lid |
| (f) translucent water | OUT | Biggest mesher change, phones unverified; the ghost covers "bot hidden in water" |
| (g) tag hint | IN | Tells the owner which slider value to pull to |

## 2. Rationale

- under-1-fly.png is almost certainly the camera inside rock: target y 23, r 30, el 0.9 puts the camera at y ~46 under a y 70 surface, so you see far cave faces through culled rock. Fix by rule, not by collision: **the target goes underground only together with a cut**.
- Lid = top colour x 0.3 rather than one flat colour: stone becomes 41, lit floors stay 138, and a flooded cave still reads dark blue.
- Rejected, layers.js InstancedMesh for loose dirt: more draw calls and its own lifecycle. Rejected, `y < 60` as the "covered" test: misses hill mines.
- Loose red vs plan "wrong" red: it does not matter enough to leave the approved red. Both mean "does not belong", and where they overlap the plan overlay (scale 1.02, polygonOffset) wins. Loose is opaque and face-shaded, wrong is flat and translucent. If the owner mixes them up, change one constant to magenta `0xff2bd6` and the emoji to 🟪.

## 3. Constraints

- A not-loaded neighbour counts as solid, so no red at the view edge. This is exactly what `layer()` returns for `null` today; reuse it, write no second neighbour rule.
- "Solid" = `blocks.drawn`. Only difference from dirtscan.js: a lantern counts as solid. Only the exact name `dirt` can be loose; cells above the cut are neither red nor counted.
- No new fetch or route. The probe reads the cache only.
- Camera: `cam.y` underground only via `level()`. The saved `cam.y` is clamped to >= 70 at start (the cut is not persisted).
- Phone rules:
  - ▤ button: unchanged.
  - Slider: label live, cut posted after 150 ms, camera moves on the worker's ack, clears `cutAuto`.
  - Bot-row tap: fly + probe. Covered: cut to head height, slider and label appear at that value. Not covered: an auto cut is removed, a manual cut stays.
  - Plan-chip tap: fly, removes an auto cut.
  - World tap: unchanged.
  - Chip `🟥 N lose Erde`: toggles the red, N stays; hidden at N = 0.
- Contract block in `/home/vino/src/bandit-craft-oneview/.superpowers/sdd/2026-11-17-one-view-ui/constraints.md` gets the new messages. One inline script; text via textContent; chip >= 44 px.

## 4. Handoff

App = `/home/vino/src/bandit-craft-oneview/hosts/bandit-lab/services/mcbots/app`.

**Task 1: `public/oneview/mesher.js` + `test/view-mesher.js`**
- Signature `meshSection(sec, nb, capY = 16, {lid = false, loose = true} = {})`; result gains `loose` (count).
- Compute the six hidden flags per cell first, then emit.
- Lid: when `capY < 16 || lid`, the top face of layer `capY - 1` is always drawn. It is dark (x 0.3) if the real block above is drawn: `dr[idx[i + 256]]` for y < 15, else `L[3]`.
- Loose: palette name `dirt` and hidden count over directions 0, 1, 4, 5 <= 1. Count it; if `loose` is on, colour its faces from `0xff2a2a` x LIGHT.
- Tests:
  - `meshSection(STONE, S6, 8)`: 256 faces, all colour 41.
  - `{lid: true}` with AIR above: 138; with STONE above: 41.
  - Lone dirt: `loose` 1, red shades. Two side neighbours: 0.
  - Dirt at x = 0 with one inner neighbour: `nb[0] = null` gives 0, `nb[0] = AIR` gives 1.
  - A `short_grass` neighbour is not solid. `{loose: false}` keeps the count but stays brown. Dirt above the cut is not counted.

**Task 2: `public/oneview/worker.js` + `test/view-worker.js`**
- `mesh()`: stop nulling `nb[3]`; pass `{lid: cut < (sy + 1) * 16, loose: looseOn}`; post `loose: m.loose`; keep a Set of section keys with loose > 0.
- `{t:'cut', y}`: after the re-mesh loop, post the ack `{t:'cut', y}`.
- `{t:'loose', on}`: re-mesh only the keys in that Set.
- `{t:'probe', x, y, z}`: one slot, newest wins, tried in `pump()`. Answer once the section holding the feet is cached: `{t:'probe', x, y, z, roof}`. `roof` = drawn, non-`leaves` cells among the 8 above the head (floor(y) + 2 .. + 9). A missing section counts as air. Use `Math.floor`.
- Tests: the ack comes after the meshes; the probe is held until the tile loads; leaves are not counted; a probe adds no URL to the fetch list; the toggle re-meshes only red sections. Existing lid assertions that expect `nb[3] = null` may need updating.

**Task 3: `public/oneview/view.js`, `layers.js`, `public/index.html`**
- view.js:
  - Keep `base` and `lvl`.
  - `level(y)`: `cam.y = y >= 319 ? base : Math.min(base, y + 1)`.
  - `flyTo` sets `base = y`, then applies the same min.
  - At start, `base = cam.y = Math.max(saved, 70)`.
  - `setMesh` / `dropMesh` sum `loose`; expose `stats().loose`, `dataset.loose`, `dataset.cut`.
- layers.js:
  - Each marker gets a child mesh: same geometry, `{color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false}`; swap it with the colour.
  - Tag text is `name · Höhe N` when y < 60.
- index.html:
  - `setCut(y, auto)`: slider value, label, show, post.
  - On `cut`: `view.level(m.y)`.
  - On `probe`: `roof >= 3 ? setCut(Math.floor(m.y) + 1, true) : cutAuto && setCut(319)`.
  - Bot row (l.450): `view.flyTo(x, Math.max(y + 2, 70), z)` plus the probe.
  - Plan chip (l.560): clears an auto cut.
  - `#looseChip` inside `#world`, top-left beside `#conn`; state kept in `store`; updated where `worldMsg()` runs.

**Task 4: `/home/vino/src/bandit-craft-oneview/tools/oneview-stand/stand.js` + `check.js`**
- Fake world: a cave (air box around y 40-43 under bot9, with a 1-wide tunnel), a water column in it, bot9 moved to y 40, a 3-high dirt pillar, and one dirt block with 2 neighbours.
- The existing wrong dirt at ORIGIN + 3 (l.82) is also loose, so the expected count is 4.
- check.js: `dataset.loose == 4`; click the bot9 row, wait for `#cutY` value 41 visible, label `Höhe 41`, `dataset.cut == 41`; take phone screenshots for the reviewer; the triangle count does not rise.

**Afterwards**: `node test/view-mesher.js`, `node test/view-worker.js`, `node test/view-page.js`, the stand with check.js, `graphify update .`. The controller runs the nix check.

**Open**
- Does the hub send all-air sections? If `cache.section()` is null for them, a pillar at a section border stays un-red (never falsely red). Cheapest check: grep the hub's section encoder for a skip-air rule.
- Natural loose dirt (overhangs) may inflate N. Run dirtscan.js on a natural area once before release.
- A bot under fewer than 3 blocks of cover gets no auto-cut, only ghost and tag.
- Lava still has a dull hash colour: one PLANCOL line, but it must stay in sync with index.html.
- No cut and a target inside a mountain is unchanged from today.

Not run or checked: nothing was executed; the lid factor 0.3, the ghost opacity 0.45 and the chip position are judged from code and one screenshot (under-2-cut.png). I did not read stand.js, check.js or view-page.js in full. Real phones remain unseen.
