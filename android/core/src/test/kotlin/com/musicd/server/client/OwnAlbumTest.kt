package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Test

/** Which albums are the owner's own, kept on the phone and edited (items 448, 458): the library's and iBroadcast's; never Qobuz's or Tidal's. */
class OwnAlbumTest {
    @Test fun bySource() {
        assertEquals(listOf(true, true, true, false, false), listOf(null, "local", "ibroadcast", "qobuz", "tidal").map { OwnAlbum.mine(it) })
    }
}
