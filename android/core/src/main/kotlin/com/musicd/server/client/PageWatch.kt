package com.musicd.server.client

import org.json.JSONObject

/**
 * The page on the app's screen, watched (v0.8.42), as the screen's own thread
 * already is. The page could go stale and stop answering taps, and stay that
 * way until the app was swiped away and opened again. Now the app asks the
 * page every few seconds how it is (`window.__musicdPageCheck`) and puts it
 * right itself:
 *
 *  - **no answer** twice in a row: the page's script has stopped. A new page
 *    in a new WebView, as opening the app again gave ([Action.REBUILD]).
 *  - **asking with no answer**: the page has been asking the server for
 *    [stuckAfterMs] and heard nothing, and is still asking, while the app
 *    reaches the server itself. Its connections are stuck. First they're
 *    dropped ([Action.DROP]: the page's next asks open new ones); still stuck
 *    at the next check, the page is loaded again ([Action.RELOAD]).
 *  - **the WebView says it has stopped** handling taps ([stopped]): a new
 *    WebView, as for no answer.
 *
 * A reload or a new WebView at most once in [gapMs], so a page that can't be
 * put right this way isn't reloaded over and over. The times are the
 * caller's clock (milliseconds; one that counts time asleep).
 */
class PageWatch(
    private val stuckAfterMs: Long = 45_000,
    private val stillAskingMs: Long = 20_000,
    private val gapMs: Long = 120_000
) {
    enum class Action { NONE, DROP, RELOAD, REBUILD }

    /**
     * What the page says: [asking], how long it has been asking the server
     * with no answer at all (0: nothing waiting); [asked], how long since it
     * last asked (−1: never); [waiting], the asks waiting now.
     */
    class Report(val hidden: Boolean, val asking: Long, val asked: Long, val waiting: Int)

    private var silent = 0
    private var stuck = 0
    private var lastFix: Long? = null

    /** The page didn't answer in the time given. */
    fun noAnswer(now: Long): Action {
        stuck = 0
        if (++silent < 2) return Action.NONE
        if (!fixable(now)) return Action.NONE
        silent = 0
        lastFix = now
        return Action.REBUILD
    }

    /**
     * The page answered: [report] is what it said (null from a page too old to
     * say). [serverAnswers]: the app has just reached the server itself.
     */
    fun answered(report: Report?, serverAnswers: Boolean, now: Long): Action {
        silent = 0
        if (!(serverAnswers && report != null && stuck(report))) { stuck = 0; return Action.NONE }
        if (++stuck == 1) return Action.DROP
        if (!fixable(now)) return Action.NONE
        stuck = 0
        lastFix = now
        return Action.RELOAD
    }

    /**
     * The WebView itself says the page has stopped (it hasn't handled a tap
     * for a while): a new WebView, unless one was just put up.
     */
    fun stopped(now: Long): Action {
        if (!fixable(now)) return Action.NONE
        silent = 0
        stuck = 0
        lastFix = now
        return Action.REBUILD
    }

    /** A new page (loaded, or in a new WebView): nothing held against it. */
    fun reset() { silent = 0; stuck = 0 }

    private fun stuck(r: Report) = !r.hidden && r.asking >= stuckAfterMs &&
        (r.waiting > 0 || (r.asked in 0..stillAskingMs))

    private fun fixable(now: Long) = lastFix.let { it == null || now - it >= gapMs }

    companion object {
        /** What the page asked returns for this ([Report.asking] and the rest; null if it can't say). */
        const val CHECK_JS = "(window.__musicdPageCheck ? window.__musicdPageCheck() : null)"

        /** The page's answer, as the WebView hands it over (JSON); null for anything else. */
        fun parse(answer: String?): Report? = runCatching {
            val j = JSONObject(answer ?: return null)
            if (!j.has("asking")) return null
            Report(j.optBoolean("hidden"), j.optLong("asking"), j.optLong("asked", -1), j.optInt("waiting"))
        }.getOrNull()
    }
}
