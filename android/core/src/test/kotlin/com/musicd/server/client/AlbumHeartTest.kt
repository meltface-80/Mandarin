package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Test

/** The button before Play Now on an album's page (item 539): + for a streamed album not in your favourites there, else Mandarin's heart. */
class AlbumHeartTest {
    @Test fun `a Qobuz or Tidal album not in your favourites there is a +, whatever Mandarin's heart says`() {
        assertEquals(AlbumHeart.ADD, AlbumHeart.of("qobuz", serviceFavourite = false, favourite = false))
        assertEquals(AlbumHeart.ADD, AlbumHeart.of("tidal", serviceFavourite = false, favourite = true))
    }

    @Test fun `in your favourites there, the heart, hollow, red once liked in Mandarin`() {
        assertEquals(AlbumHeart.HEART, AlbumHeart.of("qobuz", serviceFavourite = true, favourite = false))
        assertEquals(AlbumHeart.LIKED, AlbumHeart.of("qobuz", serviceFavourite = true, favourite = true))
    }

    @Test fun `your own files, or a service not known (signed out), the heart as ever`() {
        assertEquals(AlbumHeart.HEART, AlbumHeart.of("local", serviceFavourite = null, favourite = false))
        assertEquals(AlbumHeart.LIKED, AlbumHeart.of(null, serviceFavourite = null, favourite = true))
        assertEquals(AlbumHeart.HEART, AlbumHeart.of("qobuz", serviceFavourite = null, favourite = false))
    }

    @Test fun `the service named as the page names it`() {
        assertEquals("Qobuz", AlbumHeart.serviceName("qobuz"))
        assertEquals("Tidal", AlbumHeart.serviceName("tidal"))
        assertEquals(null, AlbumHeart.serviceName("local"))
    }
}
