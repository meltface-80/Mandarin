package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/**
 * Android Auto's shelves (item 533): what the car's top level lists, in the owner's order (Random albums, Smart Picks,
 * Downloaded albums), and the server's Random albums and Smart Picks as the phone keeps them. They were asked of the
 * server only as the car opened one, and away from home the phone's way to it (its own Tailscale, stopped while the app
 * is off screen) was often not up yet: the car was handed nothing, and kept that until the app was opened. Now the last
 * of each is kept on the phone and shown at once, read again behind it once [REFRESH_MS] old.
 */
object AutoShelf {
    const val RANDOM = "random"
    const val PICKS = "picks"
    const val DOWNLOADS = "downloads"

    /** How old a kept shelf is before it is read again behind what the car shows. */
    const val REFRESH_MS = 10 * 60 * 1000L

    /** An album on a shelf: the library's offset, its title and artist, and its cover's key. */
    data class Album(val offset: Int, val title: String, val artist: String, val imageKey: String)

    /** The top level's folders (id to title): Random albums, Smart Picks, Downloaded albums; with no server, Downloaded alone. */
    fun root(server: Boolean): List<Pair<String, String>> =
        (if (server) listOf(RANDOM to "Random albums", PICKS to "Smart Picks") else emptyList()) + (DOWNLOADS to "Downloaded albums")

    /** Where the server answers [shelf]. */
    fun path(shelf: String): String = if (shelf == RANDOM) "/api/random-albums?count=20" else "/api/smart-picks"

    /** [shelf]'s albums in the server's answer [j] (Smart Picks: picks, album, artist; Random albums: albums, title, subtitle). */
    fun parse(shelf: String, j: JSONObject): List<Album> {
        val picks = shelf == PICKS
        val a = j.optJSONArray(if (picks) "picks" else "albums") ?: return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.has("offset") }.map { o ->
            Album(o.optInt("offset"), o.optString(if (picks) "album" else "title"), o.optString(if (picks) "artist" else "subtitle"), o.optString("image_key"))
        }
    }

    /** [albums] kept as read at [at] (ms), as text. */
    fun keep(albums: List<Album>, at: Long): String = JSONObject().put("at", at).put("albums", JSONArray().also { a ->
        albums.forEach { a.put(JSONObject().put("offset", it.offset).put("title", it.title).put("artist", it.artist).put("image_key", it.imageKey)) }
    }).toString()

    /** What [keep] wrote: when, and the albums; null for nothing, or text that isn't it. */
    fun kept(text: String?): Pair<Long, List<Album>>? = runCatching {
        val j = JSONObject(text ?: return null)
        val a = j.getJSONArray("albums")
        j.getLong("at") to (0 until a.length()).map { a.getJSONObject(it) }
            .map { Album(it.getInt("offset"), it.optString("title"), it.optString("artist"), it.optString("image_key")) }
    }.getOrNull()

    /** Whether a shelf read at [at] is read again [now]: older than [REFRESH_MS], or from a clock that went back. */
    fun due(at: Long, now: Long): Boolean = now - at > REFRESH_MS || now < at
}
