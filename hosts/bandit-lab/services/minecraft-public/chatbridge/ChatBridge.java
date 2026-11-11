package chatbridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * The chat bridge of the public world (docs/specs/2026-11-11-discord-platform.md, phase 3): game chat, joins,
 * leaves and deaths go to one Discord channel, and what people write in that channel goes into the game as
 * plain text. Nothing else: no commands, no console, no account linking. Its token can post in that channel
 * and read it; it is the only Discord secret inside this server.
 */
public final class ChatBridge extends JavaPlugin implements Listener {
  static final int MAX_GAME_TEXT = 256; // characters of one Discord message shown in the game
  static final long MIN_IDENTIFY_GAP_MS = 90_000;
  static final long MIN_ACCOUNT_AGE_MS = 7L * 24 * 3600 * 1000;
  // GUILD_MESSAGES | MESSAGE_CONTENT (the second is switched on for the application in the developer portal)
  static final int INTENTS = (1 << 9) | (1 << 15);

  private String token;
  private String channel;
  private String api;
  private String gateway;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  // One thread for every Discord call and all gateway state, so nothing here needs a lock but `out`.
  private ScheduledExecutorService io;
  private final ArrayDeque<String> out = new ArrayDeque<>(); // lines waiting for Discord
  private long pausedUntil; // Discord asked us to wait (429)
  private final ArrayDeque<Long> shown = new ArrayDeque<>(); // times of the last messages shown in the game

  private volatile WebSocket socket; // onDisable reads it from the server thread
  private int generation; // a frame or close of an older socket is ignored
  private long seq = -1;
  private boolean acked = true;
  private ScheduledFuture<?> beat;
  private long waitMs = 5000;
  private long identified; // when this bot last logged in

  @Override
  public void onEnable() {
    // The token comes through the server's root-only environment file, the channel id from the unit.
    token = env("CHATBRIDGE_TOKEN", "");
    channel = env("CHATBRIDGE_CHANNEL", "");
    if (token.isEmpty() || channel.isEmpty()) {
      getLogger().info("chat bridge off: CHATBRIDGE_TOKEN or CHATBRIDGE_CHANNEL is not set");
      return;
    }
    api = env("CHATBRIDGE_API", "https://discord.com/api/v10");
    gateway = env("CHATBRIDGE_GATEWAY", "wss://gateway.discord.gg/?v=10&encoding=json");
    io = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "chatbridge");
      t.setDaemon(true);
      return t;
    });
    Bukkit.getPluginManager().registerEvents(this, this);
    io.scheduleWithFixedDelay(guard(this::flush), 2, 2, TimeUnit.SECONDS);
    io.execute(guard(this::open));
  }

  @Override
  public void onDisable() {
    if (io == null) return;
    io.shutdownNow();
    if (socket != null) socket.abort();
  }

  private static String env(String name, String fallback) {
    String v = System.getenv(name);
    return v == null || v.isEmpty() ? fallback : v;
  }

  // A task that throws would end its schedule without a word.
  private Runnable guard(Runnable task) {
    return () -> {
      try {
        task.run();
      } catch (Throwable e) {
        getLogger().warning("chat bridge: " + e);
      }
    };
  }

  // ---- game to Discord ----

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onChat(AsyncChatEvent e) {
    say("**" + escape(e.getPlayer().getName()) + "**: " + escape(plain(e.message())));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent e) {
    say("➡️ **" + escape(e.getPlayer().getName()) + "**");
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent e) {
    say("⬅️ **" + escape(e.getPlayer().getName()) + "**");
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onDeath(PlayerDeathEvent e) {
    if (e.deathMessage() != null) say("💀 " + escape(plain(e.deathMessage())));
  }

  private static String plain(Component c) {
    return PlainTextComponentSerializer.plainText().serialize(c);
  }

  /** Player text as Discord shows it literally: no markdown, no link ("https\\://" is text), one line. Mentions are switched off in the request. */
  static String escape(String s) {
    return s.replaceAll("[\\p{Cc}\\p{Cf}]", " ").replaceAll("([\\\\*_~`|>#:\\[\\]])", "\\\\$1").strip();
  }

  private void say(String line) {
    synchronized (out) {
      if (out.size() < 200) out.add(line.length() > 500 ? line.substring(0, 500) : line); // a flood is cut, not queued for ever
    }
  }

  /** The next message: as many waiting lines as fit into one Discord message. */
  static String batch(ArrayDeque<String> lines) {
    StringBuilder b = new StringBuilder();
    // The first line always goes: a message put back after a 429 is as long as the limit itself.
    while (!lines.isEmpty() && (b.length() == 0 || b.length() + lines.peek().length() + 1 <= 1900)) b.append(b.length() == 0 ? "" : "\n").append(lines.poll());
    return b.toString();
  }

  private void flush() {
    if (System.currentTimeMillis() < pausedUntil) return;
    String content;
    synchronized (out) {
      content = batch(out);
    }
    if (content.isEmpty()) return;
    JsonObject none = new JsonObject();
    none.add("parse", new com.google.gson.JsonArray());
    JsonObject body = new JsonObject();
    body.addProperty("content", content);
    body.add("allowed_mentions", none); // a player's "@everyone" stays text
    body.addProperty("flags", 4); // no link previews
    HttpResponse<String> res;
    CompletableFuture<HttpResponse<String>> call = null;
    try {
      call = http.sendAsync(HttpRequest.newBuilder(URI.create(api + "/channels/" + channel + "/messages"))
          .timeout(Duration.ofSeconds(10))
          .header("authorization", "Bot " + token)
          .header("content-type", "application/json")
          .header("user-agent", "DiscordBot (https://github.com/6FaNcY9/bandit-craft, 1)")
          .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString());
      res = call.get(15, TimeUnit.SECONDS); // the request's own timeout ends at the headers: a body that hangs must not hold this thread
    } catch (InterruptedException e) {
      return; // the server is stopping
    } catch (Exception e) {
      if (call != null) call.cancel(true);
      // Discord not reachable: the lines wait, the queue stays capped at 200.
      pausedUntil = System.currentTimeMillis() + 10_000;
      synchronized (out) {
        out.addFirst(content);
      }
      return;
    }
    if (res.statusCode() == 429) {
      double wait = 5;
      try {
        wait = JsonParser.parseString(res.body()).getAsJsonObject().get("retry_after").getAsDouble();
      } catch (Exception ignored) {
        // keep the default
      }
      pausedUntil = System.currentTimeMillis() + (long) (Math.min(wait, 600) * 1000);
      synchronized (out) {
        out.addFirst(content); // sent again after the wait
      }
    } else if (res.statusCode() >= 300) {
      getLogger().warning("chat bridge: Discord answered " + res.statusCode() + " to a chat message"); // the lines are dropped
    }
  }

  // ---- Discord to game ----

  /** A Discord account's age is in its id. */
  static boolean oldEnough(String userId, long now) {
    try {
      return (Long.parseUnsignedLong(userId) >>> 22) + 1420070400000L <= now - MIN_ACCOUNT_AGE_MS;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  /** What somebody wrote in Discord as one line of plain text for the game; empty when nothing is left. */
  static String clean(String s, int max) {
    String t = s.replaceAll("<a?:(\\w+):\\d+>", ":$1:") // custom emoji
        .replaceAll("<@[!&]?\\d+>", "@…").replaceAll("<#\\d+>", "#…") // mentions arrive as ids
        .replaceAll("§.?", "") // the game's colour sign and its code letter
        .replaceAll("[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cs}]", " ") // line breaks, direction marks, private use, half pairs
        .replaceAll("[\\s\\p{Z}⠀ㅤᅟᅠﾠ]+", " ").strip(); // every kind of blank, also the ones that only look empty
    if (t.length() <= max) return t;
    return t.substring(0, Character.isHighSurrogate(t.charAt(max - 1)) ? max - 1 : max) + "…";
  }

  private static String text(JsonObject o, String key) {
    JsonElement e = o == null ? null : o.get(key);
    return e == null || !e.isJsonPrimitive() ? "" : e.getAsString();
  }

  private static JsonObject object(JsonObject o, String key) {
    JsonElement e = o.get(key);
    return e != null && e.isJsonObject() ? e.getAsJsonObject() : null;
  }

  /** The line to show in the game for a MESSAGE_CREATE, or null: wrong channel, a bot, a new account, nothing to say. */
  static String[] fromDiscord(JsonObject d, String channel, long now) {
    JsonObject author = object(d, "author");
    JsonElement type = d.get("type");
    if (!channel.equals(text(d, "channel_id")) || author == null || "true".equals(text(author, "bot")) || !text(d, "webhook_id").isEmpty()) return null;
    if (type == null || !type.isJsonPrimitive() || (type.getAsInt() != 0 && type.getAsInt() != 19)) return null; // a message or a reply
    if (!oldEnough(text(author, "id"), now)) return null;
    String message = clean(text(d, "content"), MAX_GAME_TEXT); // attachments, embeds and stickers are not read at all
    String name = text(object(d, "member"), "nick");
    if (name.isEmpty()) name = text(author, "global_name");
    if (name.isEmpty()) name = text(author, "username");
    name = clean(name, 32);
    return message.isEmpty() || name.isEmpty() ? null : new String[] {name, message};
  }

  private void show(JsonObject d) {
    long now = System.currentTimeMillis();
    String[] line = fromDiscord(d, channel, now);
    if (line == null) return;
    while (!shown.isEmpty() && shown.peek() < now - 10_000) shown.poll();
    if (shown.size() >= 8) return; // at most 8 lines in 10 s reach the game; Discord's own spam rules do the rest
    shown.add(now);
    // Component.text is literal: no click, no hover, no colour from the sender.
    Component msg = Component.text("[Discord] ", NamedTextColor.AQUA).append(Component.text(line[0] + ": " + line[1], NamedTextColor.WHITE));
    Bukkit.getScheduler().runTask(this, () -> Bukkit.broadcast(msg));
  }

  // The gateway, as discord-admin/app/gateway.js reads it: no session resume, a new identify after every drop.
  private void open() {
    final int gen = ++generation;
    final StringBuilder buf = new StringBuilder();
    http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(15)).buildAsync(URI.create(gateway), new WebSocket.Listener() {
      @Override
      public CompletionStage<?> onText(WebSocket w, CharSequence data, boolean last) {
        buf.append(data);
        if (buf.length() > 1 << 20) {
          buf.setLength(0);
          w.abort(); // nothing more is read from it
          io.execute(guard(() -> drop(gen, "oversized frame")));
          return null;
        } else if (last) {
          String frame = buf.toString();
          buf.setLength(0);
          io.execute(guard(() -> frame(gen, w, frame)));
        }
        w.request(1);
        return null;
      }

      @Override
      public CompletionStage<?> onClose(WebSocket w, int code, String reason) {
        io.execute(guard(() -> drop(gen, "closed (" + code + ")")));
        return null;
      }

      @Override
      public void onError(WebSocket w, Throwable e) {
        io.execute(guard(() -> drop(gen, String.valueOf(e))));
      }
    }).whenComplete((w, e) -> io.execute(guard(() -> {
      if (e != null) drop(gen, "no connection: " + e.getMessage());
      else if (gen == generation) socket = w;
      else w.abort();
    })));
  }

  // Leaves this socket and opens the next. The wait doubles (up to 5 min) until a READY, and two logins are at
  // least 90 s apart: Discord resets a token after 1000 identifies in a day, also when each of them got a READY.
  private void drop(int gen, String why) {
    if (gen != generation) return;
    generation++;
    if (beat != null) beat.cancel(false);
    beat = null;
    if (socket != null) socket.abort();
    socket = null;
    seq = -1;
    acked = true;
    long wait = Math.max(waitMs, identified + MIN_IDENTIFY_GAP_MS - System.currentTimeMillis());
    getLogger().info("chat bridge: gateway " + why + ", again in " + wait / 1000 + " s");
    io.schedule(guard(this::open), wait, TimeUnit.MILLISECONDS);
    waitMs = Math.min(waitMs * 2, 300_000);
  }

  private void send(int gen, WebSocket w, JsonObject payload) {
    try {
      w.sendText(payload.toString(), true).get(10, TimeUnit.SECONDS); // one send at a time: this thread waits
    } catch (Exception e) {
      drop(gen, "send failed");
    }
  }

  private JsonObject heartbeat() {
    JsonObject o = new JsonObject();
    o.addProperty("op", 1);
    if (seq >= 0) o.addProperty("d", seq);
    else o.add("d", com.google.gson.JsonNull.INSTANCE);
    return o;
  }

  private void frame(int gen, WebSocket w, String raw) {
    if (gen != generation) return;
    JsonObject f;
    try {
      f = JsonParser.parseString(raw).getAsJsonObject();
    } catch (Exception e) {
      drop(gen, "unreadable frame");
      return;
    }
    int op = f.get("op").getAsInt();
    if (f.has("s") && f.get("s").isJsonPrimitive()) seq = f.get("s").getAsLong();
    if (op == 10 && beat == null) {
      long every = f.getAsJsonObject("d").get("heartbeat_interval").getAsLong();
      beat = io.scheduleAtFixedRate(guard(() -> {
        if (gen != generation) return;
        if (!acked) {
          drop(gen, "no heartbeat answer");
          return;
        }
        acked = false;
        send(gen, w, heartbeat());
      }), every, every, TimeUnit.MILLISECONDS);
      JsonObject props = new JsonObject();
      for (String k : List.of("os", "browser", "device")) props.addProperty(k, k.equals("os") ? "linux" : "bandit-bridge");
      JsonObject d = new JsonObject();
      d.addProperty("token", token);
      d.addProperty("intents", INTENTS);
      d.add("properties", props);
      JsonObject identify = new JsonObject();
      identify.addProperty("op", 2);
      identify.add("d", d);
      identified = System.currentTimeMillis();
      send(gen, w, identify);
    } else if (op == 11) {
      acked = true;
    } else if (op == 1) {
      send(gen, w, heartbeat());
    } else if (op == 7 || op == 9) {
      drop(gen, "op " + op);
    } else if (op == 0 && "READY".equals(text(f, "t"))) {
      waitMs = 5000;
    } else if (op == 0 && "MESSAGE_CREATE".equals(text(f, "t")) && f.get("d").isJsonObject()) {
      show(f.getAsJsonObject("d"));
    }
  }
}
