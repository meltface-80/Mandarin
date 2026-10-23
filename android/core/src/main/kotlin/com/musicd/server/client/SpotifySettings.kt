package com.musicd.server.client

import org.json.JSONObject

/**
 * Settings → Services → Spotify as the server keeps it (GET /api/settings/spotify; bug list item 142): the page's
 * paintSpotify (settings-spotify.js) in what it says. The key itself is never sent: only whether one is set.
 */
data class SpotifyAccount(
    val hasKey: Boolean,
    /** The room Spotify plays in ("" for none). */
    val room: String,
    /** The name the Spotify app shows. */
    val deviceName: String,
    /** The line under the block: the key, Soloist's state, what the sound has proven. */
    val status: String,
    /** Soloist's build and when it runs out, or how its download went. */
    val build: String,
    /** "Download Soloist", or "Update Soloist" once there is one. */
    val download: String,
    /** Soloist being downloaded now (asked again shortly while it is). */
    val fetching: Boolean,
)

object SpotifySettings {
    /** The name the Spotify app shows when none is given (the server's SpotifySettings.DefaultName). */
    const val DEFAULT_NAME = "Mandarin"

    const val INFO = "Spotify Lossless, through Spotify Soloist: Mandarin becomes a device in the Spotify app (Spotify Connect), and what you play on it there plays in the room chosen here, " +
        "lossless (FLAC up to 24-bit/44.1 kHz) on a plan that has Spotify Lossless. Soloist needs an API key of your own: sign in at developer.spotify.com/dashboard/soloist " +
        "and make one. Mandarin downloads Soloist from Spotify and keeps it up to date. Then, on a phone on the same network, choose the name below in the Spotify app's devices once. " +
        "Play, pause, next, previous and seek in Mandarin go back to Spotify. The status says what the sound has proven: Lossless 24-bit or 16-bit, or Lossy."
    const val ROOM_INFO = "The room Spotify plays in when you choose Mandarin in the Spotify app. Its queue is replaced, as Play now does; Mandarin's controls in that room go back to Spotify."

    /** The state [j] as the server answered it; [date]: "yyyy-MM-dd" as the phone writes a date. */
    fun parse(j: JSONObject, date: (String) -> String): SpotifyAccount {
        val s = j.optJSONObject("soloist")
        val version = s?.optString("version").orEmpty()
        val fetching = s?.optBoolean("fetching") == true
        val status = when {
            !j.optBoolean("has_key") -> "No Soloist API key yet: make one at developer.spotify.com/dashboard/soloist."
            !j.optBoolean("pulseaudio") -> "This server has no PulseAudio: Soloist can't play here."
            version.isEmpty() -> if (fetching) "Downloading Soloist from Spotify…" else "Soloist isn't downloaded yet."
            else -> j.optString("status") + (if (j.optString("playback") == "playing" && j.optString("quality").isNotEmpty()) " · " + j.optString("quality") else "")
        }
        val error = s?.optString("error").orEmpty()
        val expires = s?.optString("expires").orEmpty().takeIf { s?.isNull("expires") == false }.orEmpty()
        val build = when {
            s == null -> ""
            fetching -> "Downloading Soloist from Spotify…"
            error.isNotEmpty() -> "Couldn't download Soloist: $error"
            version.isEmpty() -> ""
            else -> "Soloist " + version.replace(Regex("\\s*\\(\\d{8}\\)\\s*$"), "") + (if (expires.isNotEmpty()) " · runs out " + date(expires) else "")
        }
        return SpotifyAccount(j.optBoolean("has_key"), j.optString("room"), j.optString("device_name"), status, build,
            if (version.isNotEmpty()) "Update Soloist" else "Download Soloist", fetching)
    }

    /** The rooms Spotify can play in (/api/zones' answer [j]): None, then every room but a phone, and [want] if it isn't there now. */
    fun rooms(j: JSONObject, want: String): List<Choice> {
        val arr = j.optJSONArray("zones")
        val zones = if (arr == null) emptyList() else (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
            .filter { it.optString("zone_id").isNotEmpty() && !it.optBoolean("is_phone") }
            .map { Choice(it.getString("zone_id"), it.optString("display_name")) }
        val gone = if (want.isNotEmpty() && zones.none { it.value == want }) listOf(Choice(want, "A room not here now")) else emptyList()
        return listOf(Choice("", "None")) + zones + gone
    }
}
