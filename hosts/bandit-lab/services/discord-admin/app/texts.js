// The texts the bot keeps in the INFO channels, German and English. Facts come from
// docs/specs/2026-11-10-public-anarchy-world.md and -public-world-events.md: change them there first.
// Before the opening (LAUNCH_AT unset or in the future) the texts tease and never show the address.

const NAME = 'Bandit Anarchy'

const pitch = `🇩🇪
• **Fast alles ist erlaubt:** Griefen, Fallen, Hack-Clients. Keine Rollbacks, kein /home, kein /tpa.
• **Eine Welt für immer:** 10.000 × 10.000 Blöcke, Overworld, Nether und End. Sie wird nie zurückgesetzt. Was du baust oder zerstörst, bleibt.
• **Events aus dem Nichts:** Supply-Drops, Bosse, Dungeons, Meteore, Gewitter und Blutnächte. Zufällig, mit Koordinaten angesagt. Wer lebend rauskommt, behält die Beute. Die Ruinen bleiben für immer.
• **Kostenlos**, für Minecraft Java mit gekauftem Account. Nichts zu installieren.

🇬🇧
• **Almost anything goes:** griefing, traps, hacked clients. No rollbacks, no /home, no /tpa.
• **One world forever:** 10,000 × 10,000 blocks, overworld, nether and end. It never resets. What you build or destroy stays.
• **Events out of nowhere:** supply drops, bosses, dungeons, meteors, thunderstorms and blood nights. Random, announced with coordinates. Whoever gets out alive keeps the loot. The ruins stay forever.
• **Free**, for Minecraft Java with a paid account. Nothing to install.`

function announcement ({ open, launchAt }) {
  const when = open
    ? `🟢 **${NAME} ist offen. / ${NAME} is open.**\nDie Adresse steht in #adresse-join. / The address is in #adresse-join.`
    : launchAt
      ? `⏳ **Start: <t:${launchAt}:F>** (<t:${launchAt}:R>)\nDie Adresse gibt es erst zum Start. / The address is revealed at launch.`
      : '⏳ **Start: bald. / Launch: soon.**\nDas Datum wird hier enthüllt, die Adresse erst zum Start. / The date will be revealed here, the address at launch.'
  return `# ${NAME}\n**Der Minecraft-Anarchie-Server, der nie zurückgesetzt wird.**\n**The Minecraft anarchy server that never resets.**\n\n${pitch}\n\n${when}`
}

const rules = () => `# Regeln / Rules

🇩🇪 **Im Spiel**
1. Keine illegalen Inhalte, keine Drohungen, kein Doxxing.
2. Den Server nicht zum Absturz bringen und nicht absichtlich lahmlegen.
3. Keine Werbung und kein Handel gegen echtes Geld.
Alles andere ist erlaubt. Die Anarchie gilt für das Spiel, nicht für den Chat.

**Hier im Discord** gelten außerdem Discords Nutzungsbedingungen und Community-Richtlinien: kein Spam, keine Belästigung.
**Melden:** Schreib einem Moderator. Meldungen werden innerhalb von 48 Stunden beantwortet.

🇬🇧 **In the game**
1. No illegal content, threats or doxxing.
2. No crashing or deliberately lagging the server.
3. No advertising and no real-money trading.
Everything else is allowed. The anarchy covers the game, not the chat.

**Here on Discord** the Discord Terms of Service and Community Guidelines apply as well: no spam, no harassment.
**Reports:** message a moderator. Reports are answered within 48 hours.`

const disclaimer = 'Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.\nNot an official Minecraft product. Not approved by or associated with Mojang or Microsoft.'

function join ({ open, address }) {
  const where = open
    ? `**Adresse / Address:** \`${address}\``
    : '**Adresse / Address:** 🔒 wird zum Start hier veröffentlicht / revealed here at launch'
  return `# Mitspielen / How to join

${where}

🇩🇪 Du brauchst Minecraft **Java Edition** mit gekauftem Account. Keine Mods, keine Anmeldung, keine Whitelist. Beim ersten Betreten landest du an einem zufälligen Ort weit draußen.
🇬🇧 You need Minecraft **Java Edition** with a paid account. No mods, no sign-up, no whitelist. On your first join you land at a random spot far out.

-# ${disclaimer.replace('\n', '\n-# ')}`
}

function status ({ open, launchAt, state, now }) {
  // The check time moves in five-minute steps, so an unchanged status costs one edit per five minutes.
  const checked = `-# geprüft / checked <t:${Math.floor(now / 300) * 300}:R>`
  if (open) {
    const line = state?.online
      ? `🟢 **Online** · ${state.players}/${state.max} Spieler / players · ${state.version}`
      : '🔴 **Offline** · Der Server ist gerade nicht erreichbar. / The server is not reachable right now.'
    return `${line}\n${checked}`
  }
  const head = launchAt
    ? `⏳ **${NAME} öffnet <t:${launchAt}:R>** / opens <t:${launchAt}:R>\n<t:${launchAt}:F>`
    : `⏳ **${NAME} öffnet bald. / ${NAME} opens soon.**`
  const test = state?.online
    ? '🟢 Die Welt läuft schon im Testbetrieb. / The world is already running in testing.'
    : '🔧 Die Welt wird gerade vorbereitet. / The world is being prepared.'
  return `${head}\n${test}\n${checked}`
}

function all ({ launchAt, now, state, address }) {
  const open = launchAt != null && now >= launchAt
  return {
    announcement: announcement({ open, launchAt }),
    rules: rules(),
    join: join({ open, address }),
    status: status({ open, launchAt, state, now })
  }
}

module.exports = { all }
