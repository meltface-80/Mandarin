package com.musicd.server.client

import org.json.JSONObject

/**
 * One step of a track's way to the room (item 247): what was done, and whether it left the sound as it was; [action]
 * and [button] where it can be acted on (the bit-perfect check, item 275: "bitperfect", "Check").
 */
data class SignalStep(val kind: String, val title: String, val detail: String, val quality: String, val action: String? = null, val button: String? = null)

/**
 * Every step of a track's way from its file to the room, as the server says it (now_playing.signal, item 247):
 * Now playing's lines (what goes out, how it was made, what is being made) and its Signal path sheet's steps.
 */
data class Signal(val lines: List<String>, val steps: List<SignalStep>) {
    companion object {
        /** The server's signal, or null from an older server or with nothing to say. */
        fun of(o: JSONObject?): Signal? {
            if (o == null) return null
            val lines = o.optJSONArray("lines")?.let { a -> (0 until a.length()).map { a.optString(it, "") }.filter { it.isNotEmpty() } }.orEmpty()
            val steps = o.optJSONArray("steps")?.let { a ->
                (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { s ->
                    SignalStep(s.optString("kind", ""), s.optString("title", ""), s.optString("detail", ""), s.optString("quality", ""),
                        s.optString("action", "").takeIf { it.isNotEmpty() && it != "null" }, s.optString("button", "").takeIf { it.isNotEmpty() && it != "null" })
                }
            }.orEmpty()
            return if (lines.isEmpty() && steps.isEmpty()) null else Signal(lines, steps)
        }
    }
}
