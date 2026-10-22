package com.musicd.server.client

import org.json.JSONObject

/**
 * An act's similar acts for its page (/api/artist/similar, bug list item 137): Last.fm's with a key, else Deezer's
 * ([source]), each with whether the library has them and a picture. Every one opens its page, as a band's members do.
 */
data class ArtistSimilar(val source: String?, val artists: List<Act>) {
    data class Act(val name: String, val inLibrary: Boolean, val photoKey: String?)

    companion object {
        fun parse(j: JSONObject): ArtistSimilar {
            val a = j.optJSONArray("artists")
            val acts = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map {
                Act(it.optString("name", ""), it.optBoolean("in_library", false), if (it.isNull("photo_key")) null else it.optString("photo_key", "").ifEmpty { null })
            }.filter { it.name.isNotEmpty() }
            return ArtistSimilar(if (j.isNull("source")) null else j.optString("source", "").ifEmpty { null }, acts)
        }
    }
}
