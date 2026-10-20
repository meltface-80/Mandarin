package com.musicd.server.client

import org.json.JSONObject

/**
 * What Settings → Updates' Check for updates comes to (bug list item 92; the page's check-update.js): the server's update
 * and the app's, looked for at once. [offer]: an update to install, the button then saying which ([words]) and installing
 * [server] and [app] on its next tap; otherwise [words] says how things stand for a few seconds ([holdMs]) before the
 * button says Check for updates again. [notes]: the server's release notes, under the button, once its update is found.
 */
data class UpdateOutcome(val offer: Boolean, val words: String, val server: Boolean, val app: Boolean, val notes: String?, val holdMs: Long)

object UpdateCheck {
    const val CHECK = "Check for updates"
    const val CHECKING = "Checking…"
    const val FAILED = "Check failed"

    /** [s]: the server's /api/update/status after a check; [a]: the app's own ({current, latest, available}), none outside the app. */
    fun outcome(s: JSONObject?, a: JSONObject?): UpdateOutcome {
        val server = s != null && s.optBoolean("available") && s.optString("latest").isNotEmpty() && !s.isNull("latest")
        val app = a != null && a.optBoolean("available") && a.optString("latest").isNotEmpty() && !a.isNull("latest")
        val sl = s?.optString("latest").orEmpty(); val al = a?.optString("latest").orEmpty()
        if (server || app) {
            val words = if (server && app) (if (sl == al) "Update server and app to v$sl" else "Update server and app")
                else if (app) "Update app to v$al"
                else if (s?.optBoolean("isDowngrade") == true) "Roll back to v$sl"
                else "Update to v$sl"
            val notes = if (server) s?.optString("notes")?.takeIf { it.isNotEmpty() && !s.isNull("notes") } else null
            return UpdateOutcome(true, words, server, app, notes, 0)
        }
        val sc = s?.optString("current").orEmpty(); val ac = a?.optString("current").orEmpty()
        // The server ahead of the app, and GitHub without the app yet: it is built a few minutes after the server's release.
        if (a != null && s != null && sc.isNotEmpty() && ac.isNotEmpty() && Release.compare(sc, ac) > 0)
            return UpdateOutcome(false, "App v$sc is on its way — try again in a few minutes", false, false, null, 6_000)
        val words = if (a != null) "Up to date (server v" + sc.ifEmpty { "?" } + ", app v" + ac.ifEmpty { "?" } + ")" else "Up to date (v" + sc.ifEmpty { "?" } + ")"
        return UpdateOutcome(false, words, false, false, null, 4_000)
    }

    /** The app's own row: its version, updated with the server. */
    fun appName(version: String): String = "Android app" + if (version.isNotEmpty()) " v$version" else ""
    const val APP_NOTE = "Updated with the server"
}
