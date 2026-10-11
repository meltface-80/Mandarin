package com.musicd.server.client

import com.musicd.server.client.PageWatch.Action
import com.musicd.server.client.PageWatch.Report
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageWatchTest {
    private fun stuckFor(ms: Long) = Report(hidden = false, asking = ms, asked = 2_000, waiting = 1)
    private val fine = Report(hidden = false, asking = 0, asked = 3_000, waiting = 0)

    @Test fun aPageThatAnswersIsLeftAlone() {
        val w = PageWatch()
        for (i in 0 until 20) assertEquals(Action.NONE, w.answered(fine, serverAnswers = true, now = i * 10_000L))
        // Asking a while, but not yet long (a slow answer on its way).
        assertEquals(Action.NONE, w.answered(stuckFor(30_000), true, 300_000))
        assertEquals(Action.NONE, w.answered(stuckFor(40_000), true, 310_000))
    }

    @Test fun aSilentPageIsRebuiltOnTheSecondMiss() {
        val w = PageWatch()
        assertEquals(Action.NONE, w.noAnswer(0))          // once can be a busy moment
        assertEquals(Action.REBUILD, w.noAnswer(10_000))
        // Answering again between misses starts the count again.
        val v = PageWatch()
        assertEquals(Action.NONE, v.noAnswer(0))
        assertEquals(Action.NONE, v.answered(fine, true, 10_000))
        assertEquals(Action.NONE, v.noAnswer(20_000))
        assertEquals(Action.REBUILD, v.noAnswer(30_000))
    }

    @Test fun stuckConnectionsAreDroppedThenThePageReloaded() {
        val w = PageWatch()
        assertEquals(Action.DROP, w.answered(stuckFor(45_000), true, 0))
        assertEquals(Action.RELOAD, w.answered(stuckFor(55_000), true, 10_000))
        // The drop put it right: nothing more.
        val v = PageWatch()
        assertEquals(Action.DROP, v.answered(stuckFor(50_000), true, 0))
        assertEquals(Action.NONE, v.answered(fine, true, 10_000))
        assertEquals(Action.DROP, v.answered(stuckFor(60_000), true, 200_000))
    }

    @Test fun notStuckWhenTheServerIsntThereEither() {
        // The app can't reach the server itself: an outage, which the app's own
        // check handles (the app's copy of the page), not stuck connections.
        val w = PageWatch()
        assertEquals(Action.NONE, w.answered(stuckFor(90_000), serverAnswers = false, now = 0))
        assertEquals(Action.NONE, w.answered(stuckFor(100_000), serverAnswers = false, now = 10_000))
    }

    @Test fun onlyAPageStillAsking() {
        val w = PageWatch()
        // One ask that failed a minute ago, and nothing asked since: idle, not stuck.
        assertEquals(Action.NONE, w.answered(Report(false, 60_000, 60_000, 0), true, 0))
        // Asked lately, or an ask waiting now: stuck.
        assertEquals(Action.DROP, w.answered(Report(false, 60_000, 5_000, 0), true, 10_000))
        val v = PageWatch()
        assertEquals(Action.DROP, v.answered(Report(false, 60_000, 40_000, 2), true, 0))
        // Hidden: not watched.
        val h = PageWatch()
        assertEquals(Action.NONE, h.answered(Report(true, 60_000, 1_000, 1), true, 0))
    }

    @Test fun anOlderPageIsOnlyWatchedForAnswering() {
        val w = PageWatch()
        assertEquals(Action.NONE, w.answered(null, true, 0))
        assertEquals(Action.NONE, w.noAnswer(10_000))
        assertEquals(Action.REBUILD, w.noAnswer(20_000))
    }

    @Test fun putRightAtMostOnceInTwoMinutes() {
        val w = PageWatch()
        assertEquals(Action.DROP, w.answered(stuckFor(45_000), true, 0))
        assertEquals(Action.RELOAD, w.answered(stuckFor(55_000), true, 10_000))
        w.reset()
        // Stuck again straight away: dropped, but not reloaded until two minutes on.
        assertEquals(Action.DROP, w.answered(stuckFor(45_000), true, 60_000))
        assertEquals(Action.NONE, w.answered(stuckFor(55_000), true, 70_000))
        assertEquals(Action.NONE, w.noAnswer(80_000))
        assertEquals(Action.NONE, w.noAnswer(90_000))
        assertEquals(Action.REBUILD, w.noAnswer(130_000))
        assertEquals(Action.NONE, w.noAnswer(140_000))
    }

    @Test fun theWebViewSayingItHasStoppedIsHeardWithTheSameSpacing() {
        val w = PageWatch()
        assertEquals(Action.REBUILD, w.stopped(0))
        // A page that stops again at once (stuck at every load) isn't put up over and over.
        assertEquals(Action.NONE, w.stopped(15_000))
        assertEquals(Action.NONE, w.noAnswer(20_000))
        assertEquals(Action.NONE, w.noAnswer(30_000))
        assertEquals(Action.REBUILD, w.stopped(120_000))
    }

    @Test fun readsThePagesAnswer() {
        val r = PageWatch.parse("""{"v":1,"hidden":false,"asking":47000,"asked":1200,"waiting":3}""")!!
        assertEquals(false, r.hidden)
        assertEquals(47_000L, r.asking)
        assertEquals(1_200L, r.asked)
        assertEquals(3, r.waiting)
        assertEquals(-1L, PageWatch.parse("""{"hidden":true,"asking":0}""")!!.asked)
        // A page too old to say, a page between loads, or anything else.
        assertNull(PageWatch.parse("null"))
        assertNull(PageWatch.parse(null))
        assertNull(PageWatch.parse("\"text\""))
        assertNull(PageWatch.parse("""{"other":1}"""))
    }
}
