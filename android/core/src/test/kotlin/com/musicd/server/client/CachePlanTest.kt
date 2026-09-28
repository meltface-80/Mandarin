package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CachePlanTest {
    @Test fun theChoices() {
        assertEquals(listOf(5, 10, 15, 20, 25, 30, 35, 40, 45), CachePlan.WIFI_CHOICES)
        assertEquals(20, CachePlan.pick(0, CachePlan.WIFI_CHOICES, CachePlan.WIFI_DEFAULT))
        assertEquals(35, CachePlan.pick(35, CachePlan.WIFI_CHOICES, CachePlan.WIFI_DEFAULT))
        assertEquals(10, CachePlan.pick(50, CachePlan.MOBILE_CHOICES, CachePlan.MOBILE_DEFAULT))
        assertEquals(listOf(2, 4, 6, 8, 10), CachePlan.SIZE_CHOICES_GB)
    }

    @Test fun theNextTracksNotYetCachedNearestFirst() {
        val upcoming = listOf("a", "b", "c", "d", "e", "f")
        val cached = setOf("b", "d")
        assertEquals(listOf("a", "c", "e"), CachePlan.toFetch(upcoming, 5) { it in cached })
        assertEquals(listOf("a"), CachePlan.toFetch(upcoming, 2) { it in cached })
        assertEquals(emptyList<String>(), CachePlan.toFetch(upcoming, 0) { false })
    }

    @Test fun downloadsAndRepeatsAreLeftOut() {
        // null: a downloaded track (a file) — nothing to fetch. "a" twice: repeat one.
        assertEquals(listOf("a", "c"), CachePlan.toFetch(listOf("a", null, "a", "c"), 4) { false })
    }

    @Test fun keysAndTrackIds() {
        assertEquals(12L, CachePlan.trackIdOf("http://192.168.1.10:3500/stream/t12.flac?s=abc"))
        assertEquals(7L, CachePlan.trackIdOf("http://127.0.0.1:34500/stream/t7?s=x&q=opus"))
        assertNull(CachePlan.trackIdOf("http://192.168.1.10:3500/api/image/al-3-0"))
        assertEquals("t12:opus", CachePlan.key(12, true))
        assertEquals("t12:orig", CachePlan.key(12, false))
    }
}
