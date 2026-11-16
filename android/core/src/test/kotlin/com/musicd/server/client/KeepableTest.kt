package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Test

/** Which albums may be kept on the phone (item 448): the library's own and iBroadcast's; never Qobuz's or Tidal's. */
class KeepableTest {
    @Test fun bySource() {
        assertEquals(listOf(true, true, true, false, false), listOf(null, "local", "ibroadcast", "qobuz", "tidal").map { Keepable.album(it) })
    }
}
