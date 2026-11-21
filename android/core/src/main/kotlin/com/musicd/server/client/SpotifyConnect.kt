package com.musicd.server.client

import org.json.JSONObject

/**
 * Settings → Services → Spotify → Spotify Connect as the server says it (GET /api/settings/spotify-connect; bug list
 * item 501), in the words of the page's (settings-spotify-connect.js): Mandarin as a speaker in the Spotify app,
 * through Spotify's Soloist on the server.
 */
data class SpotifyConnect(
    val hasKey: Boolean,
    /** The line under the title: what Soloist says, or what plays. */
    val status: String,
    /** How the room is sent what plays ("Spotify · Lossless 24-bit/44.1 kHz · sent upsampled ×4 …"); null while it doesn't. */
    val sound: String?,
    val deviceName: String,
    /** The room Spotify plays in ("" for none), and the rooms to choose from: id to its name and how it is sent Spotify. */
    val room: String,
    val rooms: List<Room>,
    /** Download / Update Soloist's words, and whether one is under way. */
    val download: String,
    val fetching: Boolean,
    /** Soloist's build and when it runs out, or why it couldn't be downloaded; "" before it is. */
    val build: String,
) {
    data class Room(val id: String, val name: String, val sound: String) {
        val words: String get() = name + if (sound.isNotEmpty()) " · $sound" else ""
    }

    /** Asked again in two seconds while Soloist is downloaded or Spotify plays, else in thirty. */
    val again: Boolean get() = fetching || sound != null
}

object SpotifyConnectSettings {
    /** [j] as the server answered it; [date]: a "yyyy-MM-dd" as the phone writes a date. */
    fun parse(j: JSONObject, date: (String) -> String): SpotifyConnect {
        val hasKey = j.optBoolean("has_key")
        val playback = j.optString("playback")
        val active = j.optBoolean("active")
        val track = j.optJSONObject("track")
        val playing = active && (playback == "playing" || playback == "paused")
        val status = when {
            !hasKey -> "Add your Soloist API key to show Mandarin in the Spotify app."
            !j.optBoolean("pulseaudio") -> "Needs PulseAudio for Soloist's sound: update Mandarin OS (0.1.13 or later)."
            track != null && playing -> (if (playback == "playing") "Playing " else "Paused: ") + track.optString("title") +
                track.optString("artists").let { if (it.isNotEmpty()) " — $it" else "" }
            else -> j.optString("status").replaceFirstChar { it.uppercaseChar() }
        }
        val sol = j.optJSONObject("soloist") ?: JSONObject()
        val version = sol.optString("version")
        val error = sol.optString("error")
        val expires = sol.optString("expires").takeIf { it.isNotEmpty() && !sol.isNull("expires") }
        val build = when {
            error.isNotEmpty() -> "Couldn't download Soloist: $error"
            version.isNotEmpty() -> version + (expires?.let { " · runs out " + date(it) } ?: "")
            else -> ""
        }
        val fetching = sol.optBoolean("fetching")
        val rooms = j.optJSONArray("rooms")?.let { a ->
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { SpotifyConnect.Room(it.optString("id"), it.optString("name"), it.optString("sound")) }
        }.orEmpty()
        return SpotifyConnect(hasKey, status, if (playing) j.optString("quality") + " · sent " + j.optString("sent") else null,
            j.optString("device_name"), j.optString("room"), rooms,
            if (fetching) "Downloading…" else if (version.isNotEmpty()) "Update Soloist" else "Download Soloist", fetching, build)
    }

    const val INFO = "Mandarin as a speaker in the Spotify app: choose it in the app's devices, and what you play there plays in the room chosen here, made for that room as your library is (upsampled in its filter where it upsamples). It runs Spotify's own Soloist player, which needs Spotify Premium and a Soloist API key of your own, from developer.spotify.com/documentation/soloist. Mandarin downloads Soloist from Spotify and keeps it current. The first time, choose Mandarin in the Spotify app on the same Wi-Fi; after that it stays signed in. Lossless where your plan has it: the line under the title says what the sound proves."
}
