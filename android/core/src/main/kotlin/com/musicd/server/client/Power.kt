package com.musicd.server.client

import org.json.JSONObject

/*
 * Restart and Shut down from the side menu's power button, natively (bug list item 96), as the page's power.js says them:
 * its question first, then the screen over everything while the server is away, until it answers again.
 */
object Power {
    /** How the server is started again after a shut down, by `/api/system/power`'s `start_again`. */
    private val START_AGAIN = mapOf("manual" to "To start it again, start it the way it was started.", "docker" to "")

    /** The question before [what] ("power-restart" or "power-shutdown"); [power]: `/api/system/power`, or none when unread. */
    fun ask(what: String, power: JSONObject?): String =
        if (what == "power-restart") "Restart Mandarin? Music playing from Mandarin stops, and it's back in a few seconds."
        else "Shut down Mandarin? Music playing from Mandarin stops. " + startAgain(power)

    /** The address asked to do [what]. */
    fun path(what: String) = if (what == "power-restart") "/api/system/restart" else "/api/system/shutdown"

    /** The screen while the server is away: its title, what it says, and how often the server is looked for again. */
    data class Cover(val title: String, val text: String, val everyMs: Long)

    /** The screen once the server has said yes to [what] ([answer]: its answer). */
    fun cover(what: String, answer: JSONObject, power: JSONObject?): Cover =
        if (what == "power-restart") Cover("Restarting Mandarin…", "This page reloads when it's back.", 1000)
        else Cover("Mandarin is shut down", START_AGAIN[answer.optString("start_again")].orEmpty().ifEmpty { startAgain(power) }, 5000)

    private fun startAgain(power: JSONObject?) = START_AGAIN[power?.optString("start_again")].orEmpty()

    /**
     * Whether the server is back: it answered ([ok]) after once not answering, as the page's reloadWhenBack waits (an
     * answer before it has gone is the server still on its way down).
     */
    class BackWatch {
        private var wasDown = false
        fun seen(ok: Boolean): Boolean {
            if (ok) return wasDown
            wasDown = true
            return false
        }
    }
}
