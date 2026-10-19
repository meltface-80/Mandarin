package com.musicd.server.client

import java.net.URLDecoder
import java.net.URLEncoder

/*
 * The native app's frame (stage N0 of docs/specs/plan-android-native.md): the
 * screens it shows, by route, and the colours they are drawn in: the page in
 * its WebView at a path, and the native screens as they come (Now playing,
 * N2); whatever isn't native yet stays the page's.
 */

/** The shell's routes: `web/{path}`, the page at a path, until a screen of its own replaces it. */
object ShellRoute {
    const val PATH = "path"
    /** The page's route, as the navigation graph declares it. */
    const val WEB = "web/{$PATH}"

    /** The route to the page at [path] ("/" is Home), its path one argument. */
    fun web(path: String = "/"): String = "web/" + enc(path.ifEmpty { "/" })

    /** The page path a `web` route's argument names: "/" when it names none. */
    fun pagePath(arg: String?): String {
        val p = if (arg.isNullOrEmpty()) "/" else URLDecoder.decode(arg, "UTF-8")
        return if (p.startsWith("/")) p else "/$p"
    }

    const val ZONE = "zone"
    /** The native Now playing (N2), of a room. */
    const val NOW_PLAYING = "nowplaying/{$ZONE}"

    /** The route to Now playing in the room [zoneId]. */
    fun nowPlaying(zoneId: String): String = "nowplaying/" + enc(zoneId)

    const val OFFSET = "offset"
    /** The native album page (N3), of an album, played in a room. */
    const val ALBUM = "album/{$OFFSET}?$ZONE={$ZONE}"

    /** The route to the album [offset]'s page, its buttons playing in [zoneId]. */
    fun album(offset: Long, zoneId: String): String = "album/$offset?$ZONE=" + enc(zoneId)

    /** The room a `nowplaying` route's own text names (Navigation hands its argument over decoded already). */
    fun zoneOf(arg: String?): String = URLDecoder.decode(arg.orEmpty(), "UTF-8")

    /** Whether a route (as the graph names it) is the page's, which the WebView shows rather than the shell. */
    fun isWeb(route: String?): Boolean = route == null || route == WEB || route.startsWith("web/")

    // One argument, as an address writes it: a space as %20, which Navigation reads back as one ("+" it leaves).
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}

/**
 * Mandarin's own colours for the native screens: graphite and brass, the page's
 * dark "hifi" palette (style.css, `[data-theme="dark"][data-palette="hifi"]`),
 * so a native screen and the page beside it are one app. ARGB.
 */
object Palette {
    const val BG = 0xFF17191CL
    const val BG_ELEV = 0xFF1F2226L
    const val BG_ELEV_2 = 0xFF262A2FL
    const val BORDER = 0xFF30353BL
    const val TEXT = 0xFFECEBE6L
    const val TEXT_DIM = 0xFF9A9CA1L
    const val TEXT_FAINT = 0xFF7A7D83L
    const val ACCENT = 0xFFC9A45CL
    const val ACCENT_TEXT = 0xFFD4B06AL
    const val ON_ACCENT = 0xFF17191CL
    const val DANGER = 0xFFE8836BL
    /** The mini player's body (`--mt-bg`, rgba(31,34,38,.97)). */
    const val MT_BG = 0xF71F2226L
    /** The level meter's unlit segments (`--meter-off`, rgba(236,235,230,.12)). */
    const val METER_OFF = 0x1FECEBE6L
    /** The mini player's edge: the brass at .24 (style.css, `.mini-transport` in the hifi palette). */
    const val MT_EDGE = 0x3DC9A45CL
    /** A lit mode button's ground (`--accent-soft`, the brass at .15). */
    const val ACCENT_SOFT = 0x26C9A45CL
    /** The album view's and Now playing's text: white, not the cream (style.css, `.modal { --text: #ffffff }` in the hifi palette). */
    const val MODAL_TEXT = 0xFFFFFFFFL
    /** A cover's ring: white at .06 (style.css, the framed cover's box-shadow). */
    const val COVER_RING = 0x0FFFFFFFL
    /** The heart on an album's page, once tapped (style.css, `.fav-btn.is-on`). */
    const val HEART = 0xFFE0463FL
    /** An open track row's wash: white at .05 (style.css, `.t-row.is-open`). */
    const val ROW_OPEN = 0x0DFFFFFFL

    /** Each colour by the page's own token name, for the test that holds the two together. */
    val tokens: Map<String, Long> = mapOf(
        "bg" to BG, "bg-elev" to BG_ELEV, "bg-elev-2" to BG_ELEV_2, "border" to BORDER, "text" to TEXT, "text-dim" to TEXT_DIM,
        "text-faint" to TEXT_FAINT, "accent" to ACCENT, "accent-text" to ACCENT_TEXT, "on-accent" to ON_ACCENT, "danger" to DANGER
    )

    /** The translucent ones, by token name: the page writes these as rgba(r,g,b,a). */
    val rgbaTokens: Map<String, Long> = mapOf("mt-bg" to MT_BG, "meter-off" to METER_OFF, "accent-soft" to ACCENT_SOFT)
}
