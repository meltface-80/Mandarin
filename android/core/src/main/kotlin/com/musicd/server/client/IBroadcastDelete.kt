package com.musicd.server.client

import org.json.JSONObject

/*
 * Delete from iBroadcast (bug list item 527), as the page's album-ib-delete.js words it: iBroadcast's albums picked on a
 * wall deleted at iBroadcast itself, not only from Mandarin, from the select menu, there only where every album picked
 * is iBroadcast's. Asked twice, what it does and then "Are you sure?"; the server's answer (IBroadcastDeleteRoutes.cs)
 * { ok, albums, tracks, emptied, note? } said as a toast.
 */
object IBroadcastDelete {
    /** The second question. */
    const val SURE = "Are you sure? This can't be undone."

    /** The menu's item is there: albums picked, every one of them iBroadcast's (none of the phone's own). */
    fun offered(picks: List<AlbumSummary>): Boolean = picks.isNotEmpty() && picks.all { it.source == "ibroadcast" && it.offset >= 0 }

    /** The first question, for [n] albums. */
    fun warning(n: Int): String {
        val them = if (n == 1) "this album" else "these $n albums"
        return "Delete $them from iBroadcast? " + (if (n == 1) "It is" else "They are") +
            " deleted from your iBroadcast account, not only from Mandarin, and can't be brought back from Mandarin."
    }

    /** What is said once done: "Deleted 3 albums from iBroadcast", and the server's [note] after it where it has one. */
    fun done(albums: Int, note: String?): String =
        "Deleted $albums album" + (if (albums == 1) "" else "s") + " from iBroadcast" + (if (note.isNullOrEmpty()) "" else ". $note")

    /** The toast for the server's answer to POST /api/ibroadcast/delete-albums. */
    fun said(j: JSONObject): String = done(j.optInt("albums"), if (!j.has("note") || j.isNull("note")) null else j.optString("note"))
}
