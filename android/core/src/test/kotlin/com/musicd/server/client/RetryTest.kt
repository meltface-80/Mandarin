package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Test

class RetryTest {
    @Test fun askedAgainLessAndLessOftenUpToHalfAMinute() {
        // Item 119: a room not answered (a Sonos room away from home) was asked for every 2 s for as long as the screen was up.
        assertEquals(listOf(2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L, 30_000L), (1..7).map { Retry.ms(it) })
        assertEquals(30_000L, Retry.ms(1000))
    }
}
