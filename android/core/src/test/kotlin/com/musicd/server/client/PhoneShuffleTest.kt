package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** Shuffle on the phone's own player (bug list item 194). */
class PhoneShuffleTest {
    private val album = (1..12).toList()

    @Test fun a_shuffle_starts_anywhere_not_always_at_track_1() {
        val firsts = (0 until 40).map { seed -> PhoneShuffle.order(album, "shuffle", Random(seed)) }
            .onEach { assertEquals("every track, once", album, it.sorted()) }
            .map { it.first() }
        assertTrue("the first track was $firsts", firsts.toSet().size > 4)
    }

    @Test fun anything_else_plays_in_order() {
        for (k in listOf("play_now", "queue", "add_next", null)) assertEquals(album, PhoneShuffle.order(album, k, Random(1)))
    }
}
