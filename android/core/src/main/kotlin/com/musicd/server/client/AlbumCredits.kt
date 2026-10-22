package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k, "").ifEmpty { null }

/**
 * Who played, sang, wrote and made an album (/api/album/credits, bug list items 129 and 132), in the server's order:
 * those who play first, then who wrote it, who made the record, its art. Each with their parts and, when they aren't
 * on every track, which ones.
 */
data class AlbumCredits(val status: String, val credits: List<Credit>) {
    /** One person or act and their parts on the album; [tracks] null when they are on every track. */
    data class Credit(val name: String, val roles: List<String>, val tracks: List<Int>?, val photoKey: String?, val inLibrary: Boolean) {
        /** Under the name: their parts, and which tracks when not all ("Drums, organ · tracks 1–3, 5"). */
        val line: String get() = listOfNotNull(roles.joinToString(", ").ifEmpty { null }, tracks?.let(::trackList)).joinToString(" · ")
    }

    companion object {
        /** As many as show before More. */
        const val SHOWN = 8

        /** Which tracks, runs of three or more as a range: "track 4", "tracks 1, 2", "tracks 1–3, 5". */
        fun trackList(tracks: List<Int>): String? {
            val t = tracks.distinct().sorted()
            if (t.isEmpty()) return null
            val parts = ArrayList<String>()
            var i = 0
            while (i < t.size) {
                var j = i
                while (j + 1 < t.size && t[j + 1] == t[j] + 1) j++
                if (j - i >= 2) parts += "${t[i]}–${t[j]}" else for (k in i..j) parts += "${t[k]}"
                i = j + 1
            }
            return (if (t.size == 1) "track " else "tracks ") + parts.joinToString(", ")
        }

        private fun ints(a: JSONArray?): List<Int>? = a?.let { (0 until it.length()).map { i -> it.optInt(i) }.filter { n -> n > 0 } }

        fun parse(j: JSONObject): AlbumCredits {
            val list = j.optJSONArray("credits")
            val credits = if (list == null) emptyList() else (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map { c ->
                val roles = c.optJSONArray("roles")
                Credit(c.optString("name", ""), if (roles == null) emptyList() else (0 until roles.length()).mapNotNull { roles.optString(it, "").ifEmpty { null } },
                    if (c.isNull("tracks")) null else ints(c.optJSONArray("tracks")), c.str("photo_key"), c.optBoolean("in_library", false))
            }.filter { it.name.isNotEmpty() }
            return AlbumCredits(j.optString("status", ""), credits)
        }
    }
}
