package com.musicd.server.client

import org.json.JSONObject

/**
 * A Mandarin Bridge's row on Settings → Updates: its [id], its [name] with its version, its button's [words], whether a
 * tap updates it, and [checked]: where its button says Check for update (item 293), what a check that finds nothing to
 * install says (Up to date, Nothing published); null where a tap doesn't check. [why]: where its update failed or waits on
 * the device, what the Bridge said of it (item 327), shown under its row; null otherwise.
 */
data class BridgeRow(val id: String, val name: String, val words: String, val canUpdate: Boolean, val busy: Boolean, val checked: String? = null,
    val why: String? = null)

/**
 * The Mandarin Bridges on Settings → Updates (item 291; the page's bridge-updates.js): every one Mandarin knows (the
 * server's GET /api/update/bridges), a row each after the server's and this app's, its name and version, and its
 * button: Update available where a newer build is published for it (a tap asks it to update itself, POST
 * /api/update/bridges/apply), else how it stands; where nothing is to be done, Check for update, as the server's and the
 * app's rows (item 293): a tap asks GitHub again (?fresh=1) and says what it found for a few seconds.
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
        val update = b.optJSONObject("update")
        val state = update?.optString("state").orEmpty()
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
        val settled = words == UpdateCheck.UP_TO_DATE || words == NONE
        val says = if (update == null || update.isNull("says")) "" else update.optString("says")
        return BridgeRow(b.optString("id"), name(b.optString("name"), version), if (settled) UpdateCheck.CHECK else words,
            words == UpdateCheck.AVAILABLE || words == RETRY, words == UPDATING, if (settled) words else null,
            says.takeIf { it.isNotEmpty() && (words == RETRY || words == ON_DEVICE) })
    }

    /** What a check of a Bridge says, [fresh] its row as GitHub was asked again: its update, or how it stands; Check failed where it is gone. */
    fun answer(fresh: BridgeRow?): String = when {
        fresh == null -> UpdateCheck.FAILED
        fresh.checked != null -> fresh.checked
        else -> fresh.words
    }

    /** A Bridge's name on its row: its own, and its version. */
    fun name(name: String, version: String): String = "$name · Bridge" + if (version.isNotEmpty()) " v$version" else ""

    /** Whether any row is under way: the page looks again until none is. */
    fun underWay(rows: List<BridgeRow>): Boolean = rows.any { it.busy || it.words == ON_DEVICE }
}
