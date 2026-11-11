package com.musicd.server.client

import org.json.JSONObject

/** One step of a track's way to the room (item 247): what was done, and whether it left the sound as it was. */
data class SignalStep(val kind: String, val title: String, val detail: String, val quality: String)

/**
 * Every step of a track's way from its file to the room, as the server says it (now_playing.signal, item 247):
 * Now playing's lines (what goes out, how it was made, what is being made) and its Signal path sheet's steps.
 */
data class Signal(val lines: List<String>, val steps: List<SignalStep>, val alert: Int? = null) {
    companion object {
        /** The server's signal, or null from an older server or with nothing to say. */
        fun of(o: JSONObject?): Signal? {
            if (o == null) return null
            val lines = o.optJSONArray("lines")?.let { a -> (0 until a.length()).map { a.optString(it, "") }.filter { it.isNotEmpty() } }.orEmpty()
            val steps = o.optJSONArray("steps")?.let { a ->
                (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { s ->
                    SignalStep(s.optString("kind", ""), s.optString("title", ""), s.optString("detail", ""), s.optString("quality", ""))
                }
            }.orEmpty()
            // The line to show in red: its upsampling clipped (item 348).
            val alert = if (o.has("alert")) o.optInt("alert", -1).takeIf { it in lines.indices } else null
            return if (lines.isEmpty() && steps.isEmpty()) null else Signal(lines, steps, alert)
        }
    }
}
