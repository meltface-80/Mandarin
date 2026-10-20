package com.musicd.server.client

import org.json.JSONObject

/**
 * The update offer at the head of Home, worked out by the app as the page's updater.js works it out (bug list item 111):
 * what a look at the server's /api/update/status and this app's own ({current, latest, available, installing}) offers,
 * the words while an update runs, and when it has come to an end. The app does the looking and the installing
 * (UpdateNow.kt); what it shows is decided here.
 */
object UpdateBanner {
    /** The words for each step of the server's update (its apply's phase). */
    val PHASES = mapOf(
        "checking" to "Preparing…", "downloading" to "Downloading…", "extracting" to "Unpacking…",
        "preparing" to "Fetching the C# server…", "restarting" to "Restarting…"
    )
    const val RESTARTING = "restarting"
    const val TAKING_A_WHILE = "Update is taking a while — if the app doesn't come back on its own, restart the container (docker restart musicd-server)."
    /** How often the server is asked while its update runs; how long before the banner says it is taking a while; how often an offer is looked for. */
    const val POLL_MS = 1_500L
    const val TIMEOUT_MS = 180_000L
    const val LOOK_MS = 15L * 60 * 1000

    /** An offer: the [server]'s update and this [app]'s, [sig] what Later puts away, and the [banner]. */
    data class Offer(val server: Boolean, val app: Boolean, val sig: String, val banner: UpdateOffer)

    /** The step the server's update is at in [s], while it runs (downloading, extracting, preparing, restarting), or null. */
    fun running(s: JSONObject?): String? =
        s?.optJSONObject("apply")?.optString("phase")?.takeIf { it in setOf("downloading", "extracting", "preparing", RESTARTING) }

    /** The banner while the update runs: its step's words, nothing to tap. */
    fun busy(phase: String): UpdateOffer = UpdateOffer(PHASES[phase] ?: "Updating…", "", null, false, false)

    /** What [s] and [a] offer, none when nothing is newer or the offer is the one Later put away ([dismissed]). */
    fun offer(s: JSONObject?, a: JSONObject?, dismissed: String): Offer? {
        val server = s != null && s.optBoolean("available") && has(s, "latest")
        val app = a != null && a.optBoolean("available") && has(a, "latest") && !a.optBoolean("installing")
        val sig = (if (server) "s" + s!!.optString("latest") else "") + (if (app) "a" + a!!.optString("latest") else "")
        if (!(server || app) || sig == dismissed) return null
        val word = if (server && s!!.optBoolean("isDowngrade") && !app) "Roll back" else "Update"
        val notes = if (server && has(s!!, "notes")) s.optString("notes") else ""
        return Offer(server, app, sig, UpdateOffer(offerText(s, a, server, app), notes, word, true, false))
    }

    /** The banner's line for what's on offer: the server, this app, or both. */
    fun offerText(s: JSONObject?, a: JSONObject?, server: Boolean, app: Boolean): String {
        val sl = s?.optString("latest").orEmpty(); val sc = s?.optString("current").orEmpty()
        val al = a?.optString("latest").orEmpty(); val ac = a?.optString("current").orEmpty()
        if (server && app) return if (sl == al) "v$sl available for the server and this app (you have v$sc)" else "Server v$sl and app v$al available"
        if (app) return "App v$al available (you have v$ac)"
        var line = (if (s?.optBoolean("isDowngrade") == true) "Rollback to v" else "v") + "$sl available (you have v$sc)"
        // The server ahead of the app with no newer app on GitHub yet: its build follows the release by a few minutes.
        if (ac.isNotEmpty() && newer(sl, ac) && !(a != null && has(a, "latest") && newer(al, ac))) line += " · the app's v$sl follows in a few minutes"
        return line
    }

    /** The update failed ([error], the server's words): said in red, Update ([word]) to try again; the app's update waiting for it when [appWaits]. */
    fun failed(error: String?, appWaits: Boolean, word: String = "Update"): UpdateOffer =
        UpdateOffer("Update failed: " + (error?.takeIf { it.isNotEmpty() } ?: "unknown") + ". Tap Update to retry" + (if (appWaits) " (the app's update waits for it)" else "") + ".", "", word, true, true)

    /** The server refused to start the update ([error], or its status). */
    fun couldntStart(error: String, word: String = "Update"): UpdateOffer = UpdateOffer("Couldn't start update: $error", "", word, true, true)

    /** The banner once the update has run past [TIMEOUT_MS]. */
    val slow = UpdateOffer(TAKING_A_WHILE, "", null, false, false)

    /** Whether the server is back from its update ([s], a look at its status): on the version it went to ([target]), or down meanwhile ([wasDown]) and with nothing more on offer. */
    fun back(s: JSONObject, target: String?, wasDown: Boolean): Boolean =
        (!target.isNullOrEmpty() && s.optString("current") == target) || (wasDown && !s.optBoolean("available"))

    private fun has(j: JSONObject, k: String) = !j.isNull(k) && j.optString(k).isNotEmpty()
    private fun newer(x: String, y: String) = x.isNotEmpty() && y.isNotEmpty() && runCatching { Release.compare(x, y) > 0 }.getOrDefault(false)
}
