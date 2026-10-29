package com.musicd.server.client

import org.json.JSONObject

/** An update on offer to one row of Settings → Updates: the version it brings ([latest]) and its short notes, if any. */
data class UpdateFound(val latest: String, val notes: String?)

/** A part of the notes under both rows: its [head] ("What's new in v1.1.14") and its short lines. */
data class WhatsNew(val head: String, val notes: String)

/**
 * Settings → Updates (item 223; the page's check-update.js): the server and this app each in a row of its own, its
 * version and its own button, Check for update, which becomes Update available once one is found and installs that one
 * alone on its next tap. What each update brings is under both rows, its short lines (the server's from its release,
 * Admin/ReleaseNotes.cs; the app's from dist/latest.json, tools/release-notes.js), once for a version both bring.
 */
object UpdateCheck {
    const val CHECK = "Check for update"
    const val CHECKING = "Checking…"
    const val AVAILABLE = "Update available"
    const val UP_TO_DATE = "Up to date"
    const val FAILED = "Check failed"
    /** How long an answer that isn't an offer stays on the button before it says Check for update again. */
    const val HOLD_MS = 4_000L
    const val ON_ITS_WAY_MS = 6_000L

    /** The update on offer in [j]: the server's /api/update/status, or this app's own ({current, latest, available, notes}); null for none. */
    fun found(j: JSONObject?): UpdateFound? {
        if (j == null || !j.optBoolean("available") || !has(j, "latest")) return null
        return UpdateFound(j.optString("latest"), if (has(j, "notes")) j.optString("notes") else null)
    }

    /** The server's button after a check that found nothing ([s], its status then): up to date, or the check's failure. */
    fun serverNothing(s: JSONObject?): String = if (s == null || has(s, "error")) FAILED else UP_TO_DATE

    /**
     * This app's button after a check that found nothing, the server at [server] and the app at [app]. The server ahead:
     * a release's app reaches main's dist/latest.json a few minutes after its server, so it is on its way (item 178); a
     * test build's never does, its app being on the test-android page, which is said rather than promised.
     */
    fun appNothing(server: String?, app: String): String {
        if (server.isNullOrEmpty() || app.isEmpty() || runCatching { Release.compare(server, app) <= 0 }.getOrDefault(true)) return UP_TO_DATE
        return if (testBuild(server)) "Test builds of the app are on the test-android page" else "v$server is on its way — try again in a few minutes"
    }

    /** How long [words] (the button's answer) stays before the button says Check for update again. */
    fun holdMs(words: String): Long = if (words == UP_TO_DATE || words == FAILED) HOLD_MS else ON_ITS_WAY_MS

    /** What's new under both rows: one part for a version both bring, or one for each; none for an update without notes. */
    fun whatsNew(server: UpdateFound?, app: UpdateFound?): List<WhatsNew> {
        if (server != null && app != null && server.latest == app.latest)
            return listOfNotNull((server.notes ?: app.notes)?.let { WhatsNew("What's new in v${server.latest}", it) })
        val both = server != null && app != null
        return listOfNotNull(
            server?.notes?.let { WhatsNew(if (both) "What's new in the server's v${server.latest}" else "What's new in v${server.latest}", it) },
            app?.notes?.let { WhatsNew(if (both) "What's new in the app's v${app.latest}" else "What's new in v${app.latest}", it) }
        )
    }

    /** A test build's version (tools/test-version.js: the next release with -tN), which main's dist/ never carries. */
    fun testBuild(version: String): Boolean = Regex("-t\\d+$", RegexOption.IGNORE_CASE).containsMatchIn(version.trim())

    /** The server's own version in [s], its status; null when it doesn't say. */
    fun current(s: JSONObject?): String? = if (s != null && has(s, "current")) s.optString("current") else null

    /** The rows' names: the server's version (none known yet: the server alone) and this app's. */
    fun serverName(version: String?): String = "Server" + if (!version.isNullOrEmpty()) " v$version" else ""
    fun appName(version: String): String = "Android app" + if (version.isNotEmpty()) " v$version" else ""

    private fun has(j: JSONObject, k: String) = !j.isNull(k) && j.optString(k).isNotEmpty()
}
