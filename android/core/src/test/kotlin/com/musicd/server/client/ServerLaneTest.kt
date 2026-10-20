package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The app's changes to what Home shows, made in order, Home's read waiting for them (item 85). */
class ServerLaneTest {
    @Test fun `Home waits for an album put on Listen later before it reads its rows`() {
        val lane = ServerLane()
        val later = mutableListOf<Long>()
        val entered = CountDownLatch(1)
        val let = CountDownLatch(1)
        lane.submit { entered.countDown(); let.await(5, TimeUnit.SECONDS); synchronized(later) { later += 7L } }
        assertEquals(true, entered.await(5, TimeUnit.SECONDS))
        val drained = lane.drained()
        Thread.sleep(100)
        assertFalse("still under way", drained.isDone)
        let.countDown()
        drained.get(5, TimeUnit.SECONDS)
        assertEquals(listOf(7L), synchronized(later) { later.toList() })
    }

    @Test fun `changes made in the order asked, the layout's with them`() {
        val lane = ServerLane()
        val made = java.util.Collections.synchronizedList(mutableListOf<String>())
        lane.submit { Thread.sleep(50); made += "later on" }
        HomeLayoutSync(lane).save(listOf(HomeRow("later", true, null))) { made += "layout"; it }
        lane.submit { made += "later off" }
        lane.drained().get(5, TimeUnit.SECONDS)
        assertEquals(listOf("later on", "layout", "later off"), made.toList())
    }
}
