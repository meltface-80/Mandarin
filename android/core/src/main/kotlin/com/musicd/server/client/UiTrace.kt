package com.musicd.server.client

/**
 * The log build's watch on the app's screens (bug list item 116, a build of the dev branch alone): what a smooth app
 * never does, found in what the screens show and when. It is told each change of what is shown ([shown]: the screen on
 * top, the side menu or a sheet over it), the back stack after each move ([stack]) and each frame's length ([frame]),
 * and answers with what was wrong:
 *
 * - FLASH: something shown for a moment between two others (the side menu closed, Home seen, then Settings);
 * - BOUNCE: something gone to and straight back (a screen opened and closed again by itself);
 * - STACK: a back stack with nothing, without Home at its foot, or a screen twice in a row (item 115's kind);
 * - JANK: a frame that took long enough to be seen as a stall.
 *
 * Frames that are slow but not stalls are counted by what was shown ([slowFrames]), for a summary now and then.
 */
class UiTrace(private val flashMs: Long = 300, private val bounceMs: Long = 600, private val jankMs: Long = 100, private val slowMs: Long = 34) {
    /** One thing found wrong, at [atMs]. */
    data class Finding(val atMs: Long, val text: String)

    private var shown: String? = null
    private var since = 0L
    private var before: String? = null
    private val slow = LinkedHashMap<String, Int>()

    /** What is shown now: [state] from [atMs]. What was wrong with how it came to be shown. */
    fun shown(state: String, atMs: Long): List<Finding> {
        if (state == shown) return emptyList()
        val out = ArrayList<Finding>()
        val prev = shown
        val prevFor = atMs - since
        val was = before
        if (prev != null && was != null && prevFor < flashMs) {
            if (was == state) out += Finding(atMs, "BOUNCE: $prev for $prevFor ms, then back to $state")
            else out += Finding(atMs, "FLASH: $prev shown for $prevFor ms between $was and $state")
        }
        before = prev
        shown = state
        since = atMs
        return out
    }

    /** The back stack's routes after a move, Home first. What is wrong with it. */
    fun stack(routes: List<String>, atMs: Long): List<Finding> {
        if (routes.isEmpty()) return listOf(Finding(atMs, "STACK: no screen at all"))
        val out = ArrayList<Finding>()
        if (routes.first() != HOME) out += Finding(atMs, "STACK: Home not at the foot: " + routes.joinToString(" > "))
        for (i in 1 until routes.size) if (routes[i] == routes[i - 1]) out += Finding(atMs, "STACK: ${routes[i]} twice in a row: " + routes.joinToString(" > "))
        return out
    }

    /** A frame of [ms] drawn at [atMs]: a stall is a finding; a slow frame is counted against what was shown. */
    fun frame(ms: Long, atMs: Long): Finding? {
        val on = shown ?: "start"
        if (ms >= jankMs) return Finding(atMs, "JANK: a frame took $ms ms on $on")
        if (ms >= slowMs) slow[on] = (slow[on] ?: 0) + 1
        return null
    }

    /** The slow frames counted since the last call, by what was shown; the count starts again. */
    fun slowFrames(): Map<String, Int> {
        val out = LinkedHashMap(slow)
        slow.clear()
        return out
    }

    companion object {
        /** Home's route, as the shell names it. */
        val HOME = ShellRoute.HOME
    }
}
