package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * Last.fm's rows under an album's tracks (/api/lastfm/similar-artists,
 * /api/lastfm/similar-albums; public/app/album-tracks.js): the server asks
 * Last.fm with the key in Settings, and says which of its answers the
 * library has itself. Without a key neither is enabled; an error is Last.fm's
 * own, the one about the key the only one the page says aloud.
 */

private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k, "").ifEmpty { null }
private fun <T> JSONArray?.items(parse: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }.map(parse)

/** A similar artist: the library's own page when [inLibrary] (one of their covers stands for them), else their Last.fm page. */
data class SimilarArtist(val name: String, val url: String?, val imageKey: String?, val inLibrary: Boolean)

/** Last.fm's similar artists: [artists] (up to 12), and [url], the page listing them. */
data class SimilarArtists(val enabled: Boolean, val error: String?, val url: String?, val artists: List<SimilarArtist>) {
    /** The one failure the user can mend, as the page says it: the key. */
    val keyNote: String? get() = error?.takeIf { it.contains("key", ignoreCase = true) }?.let { "$it — Settings → Setup → API Keys." }

    companion object {
        fun parse(j: JSONObject) = SimilarArtists(
            enabled = j.optBoolean("enabled", false), error = j.str("error"), url = j.str("url"),
            artists = j.optJSONArray("artists").items { SimilarArtist(it.optString("name", ""), it.str("url"), it.str("image_key"), it.optBoolean("in_library", false)) }
        )
    }
}

/** A similar album: the library's own ([album]) when it has it, else its Last.fm page. */
data class SimilarAlbum(val title: String, val artist: String, val url: String?, val imageKey: String?, val album: AlbumSummary?)

data class SimilarAlbums(val enabled: Boolean, val error: String?, val albums: List<SimilarAlbum>) {
    companion object {
        fun parse(j: JSONObject) = SimilarAlbums(
            enabled = j.optBoolean("enabled", false), error = j.str("error"),
            albums = j.optJSONArray("albums").items {
                SimilarAlbum(it.optString("title", ""), it.optString("artist", ""), it.str("url"), it.str("image_key"), it.optJSONObject("album")?.let(AlbumSummary::parse))
            }
        )
    }
}
