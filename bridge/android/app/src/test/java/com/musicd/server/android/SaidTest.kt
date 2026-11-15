package com.musicd.server.android

import org.junit.Assert.assertEquals
import org.junit.Test

/** What Mandarin says of a track in its request (item 430): the words decoded, the cover's address. */
class SaidTest {
    // As SlimPlayer.Headers writes them (server/Mandarin.Server/Renderers/Slim/SlimPlayer.cs): each value percent-encoded.
    private val request = Said.lines(
        "GET /stream/t12.orig.flac?e=1&s=x HTTP/1.0\r\nHost: 192.168.1.5:3000\r\n" +
            "X-Mandarin-Title: Along%20Came%20Betty\r\nX-Mandarin-Artist: Art%20Blakey%20%26%20The%20Jazz%20Messengers\r\n" +
            "X-Mandarin-Album: Moanin'\r\n" +
            "X-Mandarin-Art: http%3A%2F%2F192.168.1.5%3A3000%2Fapi%2Fimage%2Fab12%3Fsize%3D600%26e%3D99%26s%3Dsig\r\n\r\n"
    )

    @Test fun theWordsDecoded() {
        assertEquals("Along Came Betty", Said.header(request, "X-Mandarin-Title"))
        assertEquals("Art Blakey & The Jazz Messengers", Said.header(request, "X-Mandarin-Artist"))
        assertEquals("Moanin'", Said.header(request, "X-Mandarin-Album"))
        assertEquals("case aside", "Along Came Betty", Said.header(request, "x-mandarin-title"))
        assertEquals("none said", "", Said.header(request, "X-Mandarin-Untouched"))
    }

    @Test fun theCoversAddress() {
        assertEquals("http://192.168.1.5:3000/api/image/ab12?size=600&e=99&s=sig", Said.art(request))
    }

    @Test fun onlyAWebAddressIsFetched() {
        assertEquals("", Said.art(Said.lines("X-Mandarin-Art: file%3A%2F%2F%2Fdata%2Fx")))
        assertEquals("", Said.art(Said.lines("X-Mandarin-Art: content%3A%2F%2Fx")))
        assertEquals("", Said.art(Said.lines("X-Mandarin-Title: Song")))
        assertEquals("https://h/a.jpg", Said.art(Said.lines("X-Mandarin-Art: https%3A%2F%2Fh%2Fa.jpg")))
    }

    @Test fun anMtrkSaysTheNextTrackOfARun() {
        val m = Said.lines("X-Mandarin-Title: Song%202\r\nX-Mandarin-Art: http%3A%2F%2Fm%2Fapi%2Fimage%2Fk%3Fsize%3D600\r\n")
        assertEquals("Song 2", Said.header(m, "X-Mandarin-Title"))
        assertEquals("http://m/api/image/k?size=600", Said.art(m))
    }
}
