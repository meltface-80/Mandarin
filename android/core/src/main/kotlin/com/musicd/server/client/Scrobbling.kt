package com.musicd.server.client

import org.json.JSONObject

/**
 * Scrobbling to Last.fm (/api/lastfm/scrobbling; Settings → API Keys, the page's settings-lastfm.js): the key and its
 * shared secret saved ([keySet], [secretSet]), the account connected ([connected], its [name]), a sign-in waiting on
 * Last.fm's page ([pending]), plays waiting to go ([queued]) and what went wrong ([error]). [line] is what the block says,
 * [button] the contract's label index for its button: Connect to Last.fm (0) or Disconnect (1).
 */
data class Scrobbling(val keySet: Boolean, val secretSet: Boolean, val connected: Boolean, val name: String?, val pending: Boolean,
                      val queued: Long, val error: String?) {
    /** Both saved: Connect can be asked. */
    val ready: Boolean get() = keySet && secretSet
    val button: Int get() = if (connected) 1 else 0

    val line: String get() {
        val said = error?.trimEnd('.')?.let { " $it." }.orEmpty()
        return when {
            connected -> "Scrobbling as ${name?.ifEmpty { null } ?: "your account"}: every room, Bridge and this phone." +
                (if (queued > 0) " $queued waiting to send." else "") + said
            pending -> "Allow Mandarin on Last.fm, then come back here." + said
            error != null -> said.trim()
            !ready -> "Save the Last.fm key and shared secret above, then connect."
            else -> "Not connected."
        }
    }

    companion object {
        const val PATH = "/api/lastfm/scrobbling"
        const val CONNECT = "/api/lastfm/connect"
        const val DISCONNECT = "/api/lastfm/disconnect"

        private fun JSONObject.text(k: String): String? = if (isNull(k)) null else optString(k).ifEmpty { null }

        fun parse(j: JSONObject) = Scrobbling(j.optBoolean("key_set"), j.optBoolean("secret_set"), j.optBoolean("connected"), j.text("name"),
            j.optBoolean("pending"), j.optLong("queued"), j.text("error"))
    }
}
