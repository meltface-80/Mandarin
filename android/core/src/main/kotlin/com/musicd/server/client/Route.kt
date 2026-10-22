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
