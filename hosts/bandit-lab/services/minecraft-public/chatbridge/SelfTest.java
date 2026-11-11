package chatbridge;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayDeque;
import java.util.List;

/** Run by the build, not shipped in the jar: what may cross the bridge and in which form. */
final class SelfTest {
  private static void same(Object want, Object got) {
    if (!String.valueOf(want).equals(String.valueOf(got))) throw new AssertionError("want <" + want + "> got <" + got + ">");
  }

  private static String line(String json) {
    String[] l = ChatBridge.fromDiscord(JsonParser.parseString(json).getAsJsonObject(), "C", NOW);
    return l == null ? null : l[0] + ": " + l[1];
  }

  // An account made at Discord's epoch + 1000 days, and "now" 8 days or 6 days after it.
  private static final long BORN = 1420070400000L + 1000L * 86400000;
  private static final String ID = Long.toUnsignedString((BORN - 1420070400000L) << 22);
  private static final long NOW = BORN + 8L * 86400000;

  private static String msg(String more) {
    return "{\"channel_id\":\"C\",\"type\":0,\"content\":\"hallo\",\"author\":{\"id\":\"" + ID + "\",\"username\":\"vino\"}" + more + "}";
  }

  public static void main(String[] args) {
    // Discord to game: plain, one line, no ids, no colour sign, cut to length
    same("a b c", ChatBridge.clean("a\nb\r\n\tc", 256));
    same("hi @… and @… in #… :wave:", ChatBridge.clean("hi <@123> and <@&45> in <#6> <a:wave:789>", 256));
    same("red text", ChatBridge.clean("§cred‮ text​", 256));
    same("", ChatBridge.clean(" \n​ ", 256));
    same("abc…", ChatBridge.clean("abcdef", 3));
    same("ab…", ChatBridge.clean("ab😀cd", 3)); // never half an emoji
    same("a b", ChatBridge.clean("a 　⠀ㅤ b", 256)); // blanks that only look empty do not pad a line
    same("a b", ChatBridge.clean("a\uD83Db", 256)); // private use, half a pair

    // account age from the id
    same(true, ChatBridge.oldEnough(ID, NOW));
    same(false, ChatBridge.oldEnough(ID, BORN + 6L * 86400000));
    same(false, ChatBridge.oldEnough("not-a-number", NOW));
    same(false, ChatBridge.oldEnough("", NOW));

    // which messages are shown
    same("vino: hallo", line(msg("")));
    same("vino: hallo", line(msg(",\"member\":{\"nick\":null}")));
    same("Der Vino: hallo", line(msg(",\"member\":{\"nick\":\"Der §4Vino\"}").replace("§4", "§4")));
    same("vino: hallo", line(msg("").replace("\"type\":0", "\"type\":19"))); // a reply
    same("vino: hallo", line(msg("").replace("\"username\":\"vino\"", "\"username\":\"vino\",\"bot\":false")));
    same(null, line(msg("").replace("\"C\"", "\"other\""))); // another channel
    same(null, line(msg("").replace("\"username\":\"vino\"", "\"username\":\"vino\",\"bot\":true")));
    same(null, line(msg(",\"webhook_id\":\"9\"")));
    same(null, line(msg("").replace("\"type\":0", "\"type\":7"))); // a join notice
    same(null, line(msg("").replace("hallo", ""))); // only an attachment
    same(null, line(msg(",\"attachments\":[{\"url\":\"https://x/y.png\"}]").replace("hallo", " ")));
    same(null, line("{\"channel_id\":\"C\",\"type\":0,\"content\":\"x\"}")); // no author
    JsonObject young = JsonParser.parseString(msg("")).getAsJsonObject();
    same(true, ChatBridge.fromDiscord(young, "C", BORN + 6L * 86400000) == null);

    // game to Discord: markdown and line breaks from a player stay text
    same("\\*\\*fett\\*\\* \\[x\\](http\\://a) \\`c\\` \\> q", ChatBridge.escape("**fett** [x](http://a) `c` > q"));
    same("a b", ChatBridge.escape("a\nb"));
    same("https\\://x.example/a 12\\:30", ChatBridge.escape("https://x.example/a 12:30")); // no clickable link from the game

    // batching: lines are joined up to Discord's limit, a put-back message of full length still goes out
    ArrayDeque<String> q = new ArrayDeque<>(List.of("a", "b", "x".repeat(1900), "c"));
    same("a\nb", ChatBridge.batch(q));
    same(1900, ChatBridge.batch(q).length());
    same("c", ChatBridge.batch(q));
    same("", ChatBridge.batch(q));
    System.out.println("chatbridge self-test ok");
  }
}
