package com.musicd.server.client

import org.json.JSONObject

/**
 * Settings → Services as the server keeps one service's account (GET /api/settings/qobuz or /tidal; bug list item 87): the
 * page's paintQobuz and paintTidal (settings-services.js) in what they say.
 */
data class ServiceAccount(
    /** "qobuz" or "tidal". */
    val service: String,
    val connected: Boolean,
    /** The line under the block's title: who is signed in, or that no one is, or how a Tidal sign-in is going. */
    val status: String,
    /** The most the server asks the service for (one of [ServiceSettings.qualities]). */
    val quality: String,
    /** Whether the service's favourites are albums in the library. */
    val import: Boolean,
    /** Whether they are being brought in now (asked again shortly while they are). */
    val importing: Boolean,
    /** What the library holds of the service, under its buttons. */
    val importStatus: String,
    /** A Tidal sign-in under way: the address to open (as the page shows it, [linkText]) and the code; none otherwise. */
    val pendingUrl: String?,
    val pendingCode: String,
    /** A Tidal sign-in that went wrong (the sign-in is no longer waited for). */
    val pendingError: Boolean,
) {
    /** The service's name as the page writes it. */
    val name: String get() = ServiceSettings.name(service)
    /** The address of a sign-in under way, without its scheme. */
    val linkText: String get() = pendingUrl?.replace(Regex("^https?://"), "") ?: ""
    /** Whether to look again shortly: a sign-in waited for, or the library being brought up to date. */
    val again: Boolean get() = (pendingUrl != null && !pendingError) || (connected && importing)
}

object ServiceSettings {
    fun name(service: String) = if (service == "tidal") "Tidal" else "Qobuz"

    /** The stream qualities each service is asked for, as the page lists them. */
    fun qualities(service: String): List<Choice> =
        if (service == "tidal") listOf(Choice("cd", "CD (16/44.1)"), Choice("hires", "Hi-Res up to 24/192"))
        else listOf(Choice("cd", "CD (16/44.1)"), Choice("hires96", "Hi-Res up to 24/96"), Choice("hires192", "Hi-Res up to 24/192"))

    /** The switch's name: Qobuz brings in purchases too. */
    fun importName(service: String) = if (service == "tidal") "Favourites in the library" else "Favourites and purchases in the library"

    /** What is said while the library is brought up to date. */
    fun importing(service: String) = if (service == "tidal") "Bringing your Tidal favourites into the library…" else "Bringing your Qobuz favourites and purchases into the library…"

    /** The account [j] as the server answered it; [at]: a moment (milliseconds) as the phone writes a date and time. */
    fun parse(service: String, j: JSONObject, at: (Long) -> String): ServiceAccount {
        val tidal = service == "tidal"
        val on = j.optBoolean("connected")
        val pending = if (on) null else j.optJSONObject("pending")
        val user = j.optJSONObject("user")
        val who = user?.let { u -> u.optString("name").ifEmpty { u.optString("login") } }.orEmpty().ifEmpty { if (tidal) "your account" else "" }
        val sub = j.optString("subscription").let { if (tidal) it.replace('_', ' ').lowercase() else it }
        val level = if (j.optBoolean("hires")) " · Hi-Res" else if (j.optBoolean("lossless")) " · CD quality" else ""
        val status = when {
            on -> "Signed in as $who" + (if (sub.isNotEmpty()) " · $sub" else "") + level
            pending != null -> pending.optString("error").ifEmpty { "Waiting for the sign-in on tidal.com…" }
            tidal -> ""
            else -> "Not signed in."
        }
        val import = j.opt("import") != false
        val importing = j.optBoolean("importing")
        val li = j.optJSONObject("last_import")
        val name = name(service)
        val importStatus = when {
            !import -> "Off: your $name albums and playlists are not in the library. Switch on to show them."
            importing -> importing(service)
            li != null -> {
                val n = li.optInt("albums")
                "$n $name album" + (if (n == 1) "" else "s") + " in the library · updated " + at(li.optLong("at")) +
                    if (tidal) li.optInt("playlists").let { p -> if (p > 0) " · $p playlist" + (if (p == 1) "" else "s") else "" }
                    else li.optInt("failed").let { f -> if (f > 0) " · $f couldn't be read" else "" }
            }
            else -> "The library is brought up to date shortly after signing in."
        }
        return ServiceAccount(service, on, status, j.optString("quality").ifEmpty { if (tidal) "hires" else "hires192" }, import, importing, importStatus,
            pending?.optString("url")?.takeIf { it.isNotEmpty() }, pending?.optString("code").orEmpty(), pending?.optString("error").orEmpty().isNotEmpty())
    }

    /** What is said once Update library now has finished ([j]: the server's answer). */
    fun updated(service: String, j: JSONObject) = "${j.optJSONObject("result")?.optInt("albums") ?: 0} ${name(service)} albums in the library"

    const val QOBUZ_INFO = "Sign in with your Qobuz account (a subscription that streams). Mandarin keeps the sign-in token, never the password. Your Qobuz favourites and purchases become albums in the library, and the Qobuz browser (☰ → Qobuz) plays anything in the catalogue. Every track is streamed from Qobuz for the player as it is needed and every play is reported to Qobuz, as Qobuz's own apps do; nothing is downloaded. Mandarin uses Qobuz's API the way the Lyrion Music Server plugin does."
    const val TIDAL_INFO = "Sign in with your Tidal account (a subscription that streams): Mandarin shows a link and a code, you sign in on tidal.com, and Mandarin keeps the sign-in token — never a password. Your Tidal favourite albums become albums in the library, your Tidal playlists and favourite tracks playlists here, and the Tidal browser (☰ → Tidal) plays anything in the catalogue. Every track is streamed from Tidal for the player as it is needed; nothing is downloaded. Mandarin uses Tidal's API the way the Lyrion Music Server plugin does."
    const val QOBUZ_QUALITY_INFO = "The most Mandarin asks Qobuz for. Each player still gets what it takes: a Sonos room 24/48 at most, a streamer or a USB DAC up to its own rates, the phone what its DAC takes. Your subscription sets the ceiling too."
    const val TIDAL_QUALITY_INFO = "The most Mandarin asks Tidal for. CD is FLAC 16/44.1. Hi-Res asks for Tidal's hi-res FLAC (up to 24/192) where an album has it and your subscription allows; where Tidal answers with something else, CD quality is asked for instead. Each player still gets what it takes: a Sonos room 24/48 at most, a streamer or a USB DAC up to its own rates, the phone what its DAC takes."
    const val QOBUZ_IMPORT_INFO = "Every album in your Qobuz favourites and purchases, however many, as an album here: on the walls, in search, in Smart Picks and Listen later. Brought up to date every six hours and whenever you add a favourite from the Qobuz browser. Off until you switch it on. Off: none of them, nor your Qobuz playlists, are in the library; switched on again, they are back at once."
    const val TIDAL_IMPORT_INFO = "Every album in your Tidal favourites, however many, as an album here: on the walls, in search, in Smart Picks and Listen later. Brought up to date every six hours and whenever you add a favourite from the Tidal browser. Off until you switch it on. Off: none of them, nor your Tidal playlists, are in the library; switched on again, they are back at once."
    const val TIDAL_NOTE = "Open this link, sign in to Tidal there, and come back. Mandarin notices by itself."
}
