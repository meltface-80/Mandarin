package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlbumsMarkTest {
    @Test fun theFirstMarkIsWhereTheAlbumsStandNotAMove() {
        val m = AlbumsMark()
        assertNull(m.last)
        assertFalse(m.seen("3-ab"))
        assertEquals("3-ab", m.last)
    }

    @Test fun anotherMarkIsAMoveTheSameAgainIsNot() {
        val m = AlbumsMark()
        m.seen("3-ab")
        assertFalse(m.seen("3-ab"))
        assertTrue(m.seen("4-cd"))
        assertFalse(m.seen("4-cd"))
        // Albums taken away move it too.
        assertTrue(m.seen("3-ab"))
    }

    @Test fun anEmptyMarkIsNothingAndLeavesTheLastAsItWas() {
        val m = AlbumsMark()
        m.seen("3-ab")
        assertFalse(m.seen(""))
        assertEquals("3-ab", m.last)
    }

    @Test fun forgottenTheNextMarkIsWhereTheAlbumsStand() {
        val m = AlbumsMark()
        m.seen("3-ab")
        m.forget()
        assertFalse(m.seen("9-ff"))
        assertTrue(m.seen("10-00"))
    }

    @Test fun theMarkIsReadFromTheAnswer() {
        assertEquals("4-cd", AlbumsMark.of(JSONObject("""{"albums":"4-cd"}""")))
        assertEquals("", AlbumsMark.of(JSONObject("{}")))
    }

    @Test fun askedAgainAtOnceUnlessAWaitCameBackAtOnceWithNothingMoved() {
        // The first ask, with no mark to wait on: answered at once, asked again at once (with the mark).
        assertEquals(0L, AlbumsMark.pauseMs(waited = false, moved = false, tookMs = 30))
        // A wait the albums ended: at once.
        assertEquals(0L, AlbumsMark.pauseMs(waited = true, moved = true, tookMs = 40))
        // A wait that ran its time: at once.
        assertEquals(0L, AlbumsMark.pauseMs(waited = true, moved = false, tookMs = 20_000))
        // A wait answered at once with nothing moved (a server that doesn't wait): not in a tight loop.
        assertEquals(10_000L, AlbumsMark.pauseMs(waited = true, moved = false, tookMs = 50))
    }
}
