package com.musicd.server.client

import org.json.JSONObject

/**
 * Settings → Services → Spotify, your library (bug list item 143): the account's state as the server says it (GET
 * /api/settings/spotify's account, or the answer to signing in and out), in the page's words (settings-spotify-account.js
 * paintSpotifyAccount).
 */
data class SpotifyLibrary(
    val connected: Boolean,
    /** The Client ID last given (to sign in again with). */
    val clientId: String,
    /** A sign-in under way: the page to approve Mandarin on; null when none. */
    val pendingUrl: String?,
    /** Who is signed in, or that no one is, or that Spotify's answer is waited for. */
    val status: String,
    val import: Boolean,
    val importing: Boolean,
    /** What the library holds of Spotify, under its buttons. */
    val importStatus: String,
)

object SpotifyLibraries {
    const val INFO = "Your Spotify saved albums become albums in the library, as Qobuz's and Tidal's favourites do, and your liked songs and playlists playlists here. " +
        "They play through Mandarin's own Spotify Soloist, so lossless on a plan that has it: Play starts the album on Soloist and the room plays Soloist's stream. " +
        "Signing in needs a Spotify app of your own: at developer.spotify.com/dashboard, Create app, tick Web API, and add the redirect URI http://127.0.0.1:43143/mandarin-spotify. " +
        "Copy its Client ID here and Sign in to Spotify. In a browser, once you have approved Mandarin, the browser lands on an address that won't open: copy it and paste it here. The app finishes by itself."
    const val IMPORT_INFO = "Every album you have saved on Spotify, however many, as an album here: on the walls, in search, in Smart Picks and Listen later; your liked songs and your playlists as playlists. " +
        "Brought up to date every six hours. Off until you switch it on. Off: none of them are in the library; switched on again, they are back at once."
    const val NOTE = "Approve Mandarin on Spotify's page. Your browser then lands on an address beginning http://127.0.0.1:43143 that won't open: copy it and paste it here."
    const val IMPORTING = "Bringing your Spotify saved albums into the library…"

    /** The account [a] as the server answered it; [at]: a moment (milliseconds) as the phone writes a date and time. */
    fun parse(a: JSONObject, at: (Long) -> String): SpotifyLibrary {
        val on = a.optBoolean("connected")
        val pending = if (on) null else a.optJSONObject("pending")?.optString("url")?.takeIf { it.isNotEmpty() }
        val user = a.optJSONObject("user")
        val who = user?.optString("name").orEmpty().ifEmpty { user?.optString("login").orEmpty() }.ifEmpty { "your account" }
        val import = a.optBoolean("import", true)
        val last = a.optJSONObject("last_import")
        val importStatus = when {
            !import -> "Off: your Spotify albums and playlists are not in the library. Switch on to show them."
            a.optBoolean("importing") -> IMPORTING
            last == null -> "The library is brought up to date shortly after switching on."
            else -> last.optInt("albums").let { n -> "$n Spotify album${if (n == 1) "" else "s"} in the library · updated ${at(last.optLong("at"))}" }
        }
        return SpotifyLibrary(on, a.optString("client_id"), pending,
            if (on) "Signed in as $who" else if (pending != null) "Waiting for Spotify's answer…" else "Not signed in.",
            import, a.optBoolean("importing"), importStatus)
    }
}
