package com.musicd.server.client

/**
 * The app's log without personal data (bug list item 121): each line goes through [line] before it is written, and the
 * server's lines (already without it, the server keeping only its own words) again as they are saved. What goes:
 *
 * - every address: a web address's host (http://[address]), IP addresses, home, Tailscale or the internet's, v4 or v6
 *   ([ip]), a device's hardware address ([mac]), a host's name on a home network or a tailnet ([host]), an email
 *   ([email]);
 * - rooms and devices: a Sonos room's or the phone's id ("RINCON_[id]", "PHONE_[id]"), a device's ([id]);
 * - what is listened to and searched for: a request's values ("?title=[…]"), all but numbers and the few words that only
 *   say how a list is ordered; anything quoted;
 * - files and folders on the phone or the server ([path]); keys, tokens and passwords ([…]).
 *
 * What a log is for is kept: the app's own words, times, the server's addresses (/api/…), numbers, screens' names.
 */
object LogRedact {
    const val HIDDEN = "[…]"

    /** A request's values kept as they are: numbers for these, and a word for these (how a list is ordered). */
    private val NUMBERS = setOf("count", "offset", "seed", "wait", "wait_for", "timeout", "size", "months", "day", "after", "fast",
        "page", "limit", "track", "index", "start", "revision", "s", "id")
    private val WORDS = setOf("sort", "dir", "kind", "played", "type", "fast", "order")

    private val URL = Regex("""\b([A-Za-z][A-Za-z0-9+.-]*)://[^\s/?#'"]+""")
    private val EMAIL = Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}""")
    private val SECRET = Regex("""(?i)\b(token|password|passwd|secret|api[_-]?key|authorization)(\s*[=:]\s*)[^\s&,;]+|\b(Bearer|Basic)\s+[^\s&,;]+""")
    private val QUERY = Regex("""([?&])([A-Za-z_][\w.-]*)=([^&\s#'"]*)""")
    private val QUOTED = Regex("""'[^'\n]{1,200}'|"[^"\n]{1,200}"|‘[^’\n]{1,200}’|“[^”\n]{1,200}”""")
    private val PATH = Regex("""(?<![\w.:/])/(?!api/|stream/|icons/)[^\s'"/:]+/.*?(?=: |'|"| \(| →|$)""")
    private val ROOM = Regex("""\b(RINCON|PHONE)_[A-Za-z0-9_-]+""")
    private val UUID = Regex("""\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b""")
    private val MAC = Regex("""\b[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}\b""")
    private val IPV4 = Regex("""(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?(?![\w.])""")
    private val IPV6 = Regex("""(?<![\w:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?)(?:%[\w.-]+)?(?![\w:])""")
    private val HOST = Regex("""\b[\w-]+(?:\.[\w-]+)*\.(?:ts\.net|local|lan|home\.arpa|internal|localdomain)\b""")
    private val LONG = Regex("""\b[A-Za-z0-9_-]{32,}\b""")
    private val NUMBER = Regex("""-?\d+(?:\.\d+)?""")
    private val WORD = Regex("""[a-z_-]{1,20}""")

    /** [s] without personal data. */
    fun line(s: String): String {
        var t = URL.replace(s) { it.groupValues[1] + "://[address]" }
        t = EMAIL.replace(t, "[email]")
        t = SECRET.replace(t) { m -> if (m.groupValues[1].isNotEmpty()) m.groupValues[1] + m.groupValues[2] + HIDDEN else m.groupValues[3] + " " + HIDDEN }
        t = QUERY.replace(t) { m ->
            val (sep, key, value) = m.destructured
            val keep = (key in NUMBERS && NUMBER.matches(value)) || (key in WORDS && WORD.matches(value))
            "$sep$key=" + if (keep) value else HIDDEN
        }
        t = QUOTED.replace(t) { m -> m.value.first() + HIDDEN + m.value.last() }
        t = PATH.replace(t, "[path]")
        t = ROOM.replace(t) { it.groupValues[1] + "_[id]" }
        t = UUID.replace(t, "[id]")
        t = MAC.replace(t, "[mac]")
        t = IPV4.replace(t, "[ip]")
        t = IPV6.replace(t, "[ip]")
        t = HOST.replace(t, "[host]")
        return LONG.replace(t, HIDDEN)
    }
}
