# Public world: launch texts

Ready-to-post texts for the public anarchy world (`docs/specs/2026-11-10-public-anarchy-world.md`).
Nothing here is posted yet. Replace `<NAME>`, `<ADDRESS>`, `<DISCORD>`, `<SITE>` and `<REPORT-MAIL>`
before use; the name and the domain are the owner's decision and still open.

## When to post what

The agreed sequence: no advertising while the whitelist is on (phases 1 and 2). Before opening, the
Discord and the site go up. At opening, the server lists and the server subreddits. Afterwards clips of
real raids and bases, a monthly community goal and the open cost report.

Do not post before all of these hold:

- the relay address answers and shows real client addresses in the log (phase 2);
- a restore drill passed;
- the imprint, privacy policy and terms are on the site, and a named adult reads `<REPORT-MAIL>`;
- the store, if it is linked, runs on a registered business and an adult Tebex account.

## Claims: only what the server enforces

Every sentence in the texts below is backed by the configuration or the design. Keep it that way when
editing: the listing sites and the subreddits remove servers for false claims, and paying supporters are
customers.

| Claim | Backed by |
| --- | --- |
| Free, paid Java account required | Velocity `online-mode = true`, no offline plugin |
| No operators, no admin items | `operators = {}`, `ops.json` emptied on every start, no RCON |
| No resets, no rollbacks | design: the world is never reset; no rollback plugin installed |
| No `/home`, `/tpa`, `/rtp`, no kits | plugin list is exactly Chunky and SModeration |
| Hacked clients allowed | no anti-cheat plugin; `allow-flight = true` |
| Border 10,000 x 10,000, pre-generated | `max-world-size = 5000`, Chunky (runbook) |
| Hard difficulty, 20 slots | `server.properties` |
| Nothing sold that gives an advantage | design, "Monetization" |
| Automatic events, the same for everyone, vanilla loot only | the `bev` datapack: its own schedule, nothing a player or the owner triggers; loot tables hold vanilla items |

If a protected area is ever added, name it in the rules and drop "no admin interference" from every
text first. A hidden exception to an advertised rule is not something these texts may cover.

## The rules (site, Discord, listing)

```text
<NAME> has three rules.

1. No illegal content, no threats, no doxxing.
2. No crashing or lagging the server.
3. No advertising and no real-money trading.

Everything else is allowed. Griefing, raiding, stealing and hacked clients are part of the game.
The server runs events by itself (supply drops, bosses, ruins, meteors, storms, blood nights) at random
places, announced to everyone. Nobody can start, buy or steer one, and their loot is vanilla.
Chat is not anarchy: Mojang's chat reporting is on, and reports to <REPORT-MAIL> are answered within 48 hours.
Illegal content is removed once reported, in chat and in the world. That is the only thing the operator
ever changes in the world.
```

## Server list entry

Short (up to 150 characters):

```text
Anarchy survival. No resets, no admins, no kits, no /home. Hard mode, hacked clients allowed. Three rules. Free.
```

Long:

```text
<NAME> is a small anarchy survival world for Minecraft: Java Edition.

One overworld, nether and end, 10,000 x 10,000 blocks, generated once and never reset. You spawn somewhere
random, with nothing. What you build stands until someone finds it.

- Hard difficulty, vanilla survival
- Griefing, raiding and hacked clients are allowed
- No operators, no admin items, no rollbacks
- No /home, /tpa, /rtp, no kits, no crates
- TNT duplication works
- Automatic world events at random places, announced to all, vanilla loot only
- 20 slots, so the map stays lived in

Three rules: nothing illegal, no crashing the server, no advertising. That is the whole list.

Free to play with a paid Java account. Supporters get a prefix and a name colour, nothing that helps in a
fight.

Address: <ADDRESS>
Discord: <DISCORD>

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
```

Tags: `anarchy`, `survival`, `vanilla`, `no-reset`, `hard`.

## Reddit (server subreddits, opening day)

Title:

```text
<NAME> [Anarchy] [Vanilla] {Java} {No resets} {No admins} {20 slots}
```

Body:

```text
A new anarchy world opened today. The map is 10,000 x 10,000, fully generated, and will never be reset.

What it is: hard survival with three rules (nothing illegal, don't crash the server, no advertising).
Griefing and hacked clients are allowed. There are no operators, no kits, no teleport commands and no
rollbacks. You spawn at a random place and the rest is yours.

What it is not: big. It has 20 slots on purpose, so you will actually meet the people whose base you found.

Running costs and what supporters paid are published every month. Supporter ranks are a prefix and a
colour, nothing else.

Address: <ADDRESS>
Discord: <DISCORD>
Rules and legal: <SITE>
```

Read each subreddit's posting rules first (title format, repost interval); they differ and are enforced.

## Discord announcement

English:

```text
@everyone <NAME> is open.

Address: <ADDRESS> (Java Edition, paid account)
The whitelist is off. The world is the same one the testers played: nothing was reset and nothing will be.

Three rules, pinned in #rules. Everything else is allowed.
Founders keep their tag. Thank you for breaking things early.
```

German:

```text
@everyone <NAME> ist offen.

Adresse: <ADDRESS> (Java Edition, gekauftes Konto)
Die Whitelist ist aus. Es ist dieselbe Welt wie in der Testphase: Nichts wurde zurückgesetzt, und das bleibt so.

Drei Regeln, angepinnt in #regeln. Alles andere ist erlaubt.
Gründer behalten ihren Tag. Danke fürs frühe Kaputtmachen.
```

## Telegram (channel or group post, opening day)

```text
<NAME> is open: a small anarchy Minecraft world (Java Edition).

Hard survival, three rules, never reset. No admins, no kits, no teleports. Griefing and hacked clients
are allowed. The server drops loot at random places and tells everyone where: go and get it, or wait
for whoever does.

Free with a paid Java account, 20 slots.
Address: <ADDRESS>
Rules and legal: <SITE>
```

## Instagram (caption for a screenshot or a short clip)

```text
Nobody is coming to save your base.

<NAME>: anarchy Minecraft, Java Edition. One world, 10,000 x 10,000 blocks, never reset. Hard mode,
three rules, no admins. The server drops loot somewhere and announces the coordinates. What happens
there is up to whoever shows up.

Free to join. Address in bio.

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.

#minecraft #minecraftserver #anarchy #minecraftjava #survival
```

Put the address and the site in the profile, since captions carry no links.

## TikTok (clip idea and caption)

Clip, 15 to 25 seconds, filmed on the server itself, nothing staged: the chat line "Supply drop in 20
min at X ... Z ...", a cut to the run across the map, the chest, and whoever is already waiting there.
End on the address as text.

```text
The server tells everyone where the loot is. That's the problem. <NAME>, anarchy Minecraft, free,
Java Edition. #minecraft #minecraftserver #anarchy #minecraftjava
```

The events datapack is live on the server since 2026-11-10, so the supply drop sentence may stay. Instagram and TikTok have their own rules for promoting games to minors: the texts
advertise a free game and no purchase, and they should stay that way.

## Tester invitation (phases 1 and 2, sent personally)

```text
I'm starting a small anarchy Minecraft world and I'd like you in the first 10 to 20 players.
Java Edition, paid account, hard survival, three rules, never reset. Testers keep a founder tag.
Send me your Minecraft name and I'll put you on the whitelist. It is still rough: tell me what breaks.
```

## Site (one page)

1. Name, address with a copy button, "Java Edition, free, paid account required".
2. The three rules, as above.
3. What the server does not have: operators, kits, teleports, resets, rollbacks.
4. Supporter extras and what is never sold (the design's list), with the store link once it exists.
5. The monthly cost report.
6. Footer: imprint, privacy policy, terms (including parental consent for minors), the report address,
   and "Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft."

## Not written yet

Imprint, privacy policy and terms: they need the owner's registered business details, the named adult
for chat reports and the chat log retention (about 30 days in the design). Clips and screenshots come
from the tester phase.
