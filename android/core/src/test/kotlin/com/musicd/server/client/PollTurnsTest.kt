package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's long poll of the server's commands: one loop at a time, each command applied once (audit A-M1, A-M2). */
class PollTurnsTest {
    private val turns = PollTurns()

    private fun cmd(seq: Long, op: String = "play") = Phone.Command(seq, op)
    private fun batch(seq: Long, vararg cmds: Long) = Phone.Batch(seq, cmds.map { cmd(it) })
    private fun seqs(list: List<Phone.Command>) = list.map { it.seq }

    /** Started, said hello at [seq]: the loop's turn. */
    private fun started(seq: Long = 0): Int = turns.begin().also { turns.onHello(it, seq) }

    @Test fun a_stale_batch_is_dropped_after_dormant_then_wake() {
        val old = started()
        turns.end()                         // dormant: the old loop is still in its poll
        val now = started()
        assertEquals("the old loop's batch, back after the wake", emptyList<Long>(), seqs(turns.accept(old, batch(1, 1))))
        assertFalse(turns.current(old))
        assertTrue(turns.current(now))
    }

    @Test fun the_same_batch_handed_to_two_generations_is_applied_once() {
        val old = started()
        turns.end()
        val now = started()
        val b = batch(5, 5)                 // both loops polled with the same after: the server hands command 5 to both
        val applied = seqs(turns.accept(now, b)) + seqs(turns.accept(old, b))
        assertEquals(listOf(5L), applied)
    }

    @Test fun a_seq_at_or_below_the_last_applied_is_dropped() {
        val g = started()
        assertEquals(listOf(2L, 3L), seqs(turns.accept(g, batch(3, 2, 3))))
        val again = Phone.Batch(4, listOf(cmd(0, "volume"), cmd(3), cmd(4)))   // asked again before the cursor moved
        assertEquals("unnumbered (the phone's own, seq 0) still pass", listOf(0L, 4L), seqs(turns.accept(g, again)))
        assertEquals(4L, turns.after)
    }

    @Test fun a_hello_with_a_lower_seq_resets_the_cursor() {
        val g = started()
        assertEquals(listOf(50L), seqs(turns.accept(g, batch(50, 50))))
        turns.onHello(g, 2)                 // the server restarted and counts from nought again
        assertEquals(2L, turns.after)
        assertEquals(listOf(3L), seqs(turns.accept(g, batch(3, 3))))
        assertEquals("then once only", emptyList<Long>(), seqs(turns.accept(g, batch(3, 3))))
    }

    @Test fun a_server_counting_from_nought_again_without_a_hello_is_followed_once() {
        val g = started()
        turns.accept(g, batch(100, 100))
        assertEquals("its after clamped, the server's new commands come", listOf(1L, 2L), seqs(turns.accept(g, batch(2, 1, 2))))
        assertEquals(emptyList<Long>(), seqs(turns.accept(g, batch(2, 2))))
    }

    @Test fun a_401_ends_the_generation_and_the_next_begin_works() {
        val g = started()
        assertEquals(PollTurns.Next.Stop, turns.onError(g, 401))
        assertFalse("signed out: the loop's turn is over, so wake() can start one", turns.live)
        assertFalse(turns.current(g))
        val next = turns.begin()
        assertNotEquals(g, next)
        assertTrue(turns.live)
        assertTrue(turns.current(next))
        assertFalse(turns.current(g))
    }

    @Test fun a_409_asks_for_a_new_hello_of_the_current_loop_only() {
        val old = started()
        turns.end()
        val now = started()
        assertEquals(PollTurns.Next.Stale, turns.onError(old, 409))
        assertEquals(PollTurns.Next.Rehello, turns.onError(now, 409))
        assertTrue(turns.current(now))
        assertEquals(PollTurns.Next.Retry, turns.onError(now, 503))
        assertEquals("a stale loop's 401 ends nothing", PollTurns.Next.Stale, turns.onError(old, 401))
        assertTrue(turns.current(now))
    }

    @Test fun a_stale_generations_hello_changes_nothing() {
        val old = turns.begin()
        turns.end()
        val now = started(10)
        assertEquals(listOf(11L, 12L), seqs(turns.accept(now, batch(12, 11, 12))))
        assertFalse(turns.onHello(old, 5))  // the old loop's hello, answered after the wake
        assertEquals(12L, turns.after)
        assertEquals(emptyList<Long>(), seqs(turns.accept(now, batch(12, 12))))
    }
}
