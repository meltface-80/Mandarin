package com.musicd.server.client

/**
 * Home or away: which address the app talks to the server on.
 *
 * At home it's the server's address on the home network. Away — off the home
 * Wi-Fi, on mobile data — it's the server's Tailscale address, and the server
 * treats the phone as away: only "This phone" plays, and tracks come as
 * Opus 256 kbps rather than lossless, for mobile data.
 *
 * The server hands out addresses (stream, artwork) on its home address;
 * [rewrite] moves them to whichever one is in use now.
 */
object Route {

    /**
     * On Wi-Fi (or Ethernet) the phone is home if the home address answers —
     * someone else's Wi-Fi is away too. Off Wi-Fi it's away, unless a VPN is
     * up and the home address answers through it (v0.6.16): another VPN into
     * the home network reaches the server as if at home, so it's used.
     */
    fun away(onWifi: Boolean, homeAnswers: Boolean, onVpn: Boolean = false): Boolean =
        !((onWifi || onVpn) && homeAnswers)

    /** The way to the server: [away] or home, and away whether over MusicD's own Tailscale ([viaEngine], 127.0.0.1:34500). */
    data class Way(val away: Boolean, val viaEngine: Boolean)

    /**
     * The way to the server, decided before anything is connected (item 118): away needs an address there
     * ([awayAddress]), and a phone signed in to MusicD's own Tailscale ([ownSignedIn]) goes over it whether its engine
     * is up yet or not, never over the Tailscale app's address in the meantime.
     */
    fun way(onWifi: Boolean, homeAnswers: Boolean, onVpn: Boolean = false, awayAddress: Boolean, ownSignedIn: Boolean): Way {
        val away = away(onWifi, homeAnswers, onVpn) && awayAddress
        return Way(away, away && ownSignedIn)
    }

    /** Signed in to MusicD's own Tailscale: its engine is in the app, and it has joined here before ([stateFile], or [joined] as the app remembers it; item 157). */
    fun ownSignedIn(installed: Boolean, stateFile: Boolean, joined: Boolean): Boolean = installed && (stateFile || joined)

    /**
     * How many looks at the home address, none answered, make the phone away (item 157): on the home Wi-Fi and home
     * till now, [HOME_MISSES] in a row — one slow answer (the server reading its library again) sent the phone away for
     * a quarter of a minute, at home; coming home, or off the Wi-Fi, one look decides.
     */
    fun looksBeforeAway(wasAway: Boolean, onWifi: Boolean): Int = if (!wasAway && onWifi) HOME_MISSES else 1
    const val HOME_MISSES = 3

    /**
     * May MusicD's own Tailscale engine be started afresh at [now] (ms), last started afresh at [last] (0: never)?
     * At most once in [RESTART_GAP_MS] (item 157): each restart dropped the music playing and every request, and one
     * after a sleep started over an engine that was only waking.
     */
    fun mayRestartEngine(now: Long, last: Long): Boolean = last == 0L || now - last >= RESTART_GAP_MS
    const val RESTART_GAP_MS = 180_000L

    /**
     * The app's connections tied to the Wi-Fi (item 127): at home on it, so the server's home address is asked over
     * it even while Android sends what it can over mobile data (a Wi-Fi it judges poor), which can't reach a home
     * address; away, or with no Wi-Fi, they go wherever Android sends them.
     */
    fun overWifi(away: Boolean, onWifi: Boolean): Boolean = !away && onWifi

    /** The room the screens play in: [kept] at home; away, this phone's ([phone], once known). */
    fun room(away: Boolean, kept: String?, phone: String?): String = if (away && !phone.isNullOrEmpty()) phone else kept.orEmpty()

    /**
     * [url] on the address in use: [home] or [away] (base URLs). A track's
     * stream away asks for Opus (`q=opus`) when [opus] (your choice; else the
     * original file); at home it doesn't. Addresses on anything else are left alone.
     *
     * [keepOpus]: this track started as Opus and stays Opus wherever it's
     * fetched from (the rest of a track must be the same file as its start —
     * a change of format waits for the next track).
     */
    fun rewrite(url: String, home: String, away: String?, isAway: Boolean, opus: Boolean = true,
                keepOpus: Boolean = false): String {
        val from = listOfNotNull(home, away).map { it.trimEnd('/') }
            .firstOrNull { url.startsWith("$it/") } ?: return url
        val to = (if (isAway && away != null) away else home).trimEnd('/')
        var rest = url.substring(from.length)
        rest = rest.replace(Regex("([?&])q=opus(&|$)")) { m -> if (m.groupValues[2] == "&") m.groupValues[1] else "" }
        if (((isAway && opus && away != null) || keepOpus) && rest.startsWith("/stream/")) {
            rest += (if (rest.contains('?')) "&" else "?") + "q=opus"
        }
        return to + rest
    }
}
