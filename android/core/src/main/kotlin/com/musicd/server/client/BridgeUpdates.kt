package com.musicd.server.client

import org.json.JSONObject

/** A Mandarin Bridge's row on Settings → Updates: its [id], its [name] with its version, its button's [words], and whether a tap updates it. */
data class BridgeRow(val id: String, val name: String, val words: String, val canUpdate: Boolean, val busy: Boolean)

/**
 * The Mandarin Bridges on Settings → Updates (item 291; the page's bridge-updates.js): every one Mandarin knows (the
 * server's GET /api/update/bridges), a row each after the server's and this app's, its name and version, and its
 * button: Update available where a newer build is published for it (a tap asks it to update itself, POST
 * /api/update/bridges/apply), else how it stands.
 */
object BridgeUpdates {
    const val UPDATING = "Updating…"
    const val ON_DEVICE = "Finish on the device"
    const val RETRY = "Try the update again"
    const val BY_HAND = "Update by hand once"
    const val AWAY = "Not answering"
    const val NONE = "Nothing published"

    /** The rows in [j], the server's answer; none where it says none. */
    fun rows(j: JSONObject?): List<BridgeRow> {
        val list = j?.optJSONArray("bridges") ?: return emptyList()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map(::row)
    }

    /** One Bridge's row from [b], as the server says it stands. */
    fun row(b: JSONObject): BridgeRow {
        val state = b.optJSONObject("update")?.optString("state").orEmpty()
        val available = b.optBoolean("available")
        val words = when {
            state == "downloading" || state == "installing" || state == "restarting" -> UPDATING
            state == "needs-you" -> ON_DEVICE
            !b.optBoolean("reachable") -> AWAY
            !b.optBoolean("updates") -> BY_HAND
            state == "failed" && available -> RETRY
            available -> UpdateCheck.AVAILABLE
            b.isNull("latest") -> NONE
            else -> UpdateCheck.UP_TO_DATE
        }
        val version = if (b.isNull("version")) "" else b.optString("version")
        return BridgeRow(b.optString("id"), name(b.optString("name"), version), words, words == UpdateCheck.AVAILABLE || words == RETRY, words == UPDATING)
    }

    /** A Bridge's name on its row: its own, and its version. */
    fun name(name: String, version: String): String = "$name · Bridge" + if (version.isNotEmpty()) " v$version" else ""

    /** Whether any row is under way: the page looks again until none is. */
    fun underWay(rows: List<BridgeRow>): Boolean = rows.any { it.busy || it.words == ON_DEVICE }
}
