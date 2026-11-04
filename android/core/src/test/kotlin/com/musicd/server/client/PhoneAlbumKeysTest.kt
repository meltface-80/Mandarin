package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * A folder is an album (item 279): the phone's tracks keyed as the server keys an album, by its tags and its folder,
 * so three folders all tagged "Machine Head" are three albums; the discs of one album in folders of their own are one.
 */
class PhoneAlbumKeysTest {
    private val dp = "primary:Music/Deep Purple"
    private fun e(folder: String, album: String = "Machine Head", artist: String = "Deep Purple") = PhoneAlbumKeys.Entry(artist, album, folder)

    @Test fun `the same tags in three folders are three albums`() {
        val keys = PhoneAlbumKeys.keys(listOf(
            e("$dp/Machine Head (1972)"), e("$dp/Machine Head (1972)"),
            e("$dp/Machine Head (2024 Remix)"), e("$dp/Machine Head (2024 Remix)"),
            e("$dp/Machine Head (Remastered 2012)"),
        ))
        assertEquals(keys[0], keys[1])
        assertEquals(keys[2], keys[3])
        assertEquals(3, keys.toSet().size)
    }

    @Test fun `an album's discs in folders of their own are one album`() {
        val keys = PhoneAlbumKeys.keys(listOf(e("$dp/Made in Japan/CD1", "Made in Japan"), e("$dp/Made in Japan/Disc 2", "Made in Japan"), e("$dp/Made in Japan/cd-3", "Made in Japan")))
        assertEquals(1, keys.toSet().size)
        assertEquals("$dp/Made in Japan", PhoneAlbumKeys.albumFolder("$dp/Made in Japan/Disc 2"))
        // Not a disc folder: a word that only starts like one.
        assertEquals("$dp/Discography", PhoneAlbumKeys.albumFolder("$dp/Discography"))
        assertEquals("$dp/CD12x", PhoneAlbumKeys.albumFolder("$dp/CD12x"))
    }

    @Test fun `an album in one folder keeps the key it had`() {
        val keys = PhoneAlbumKeys.keys(listOf(e("$dp/In Rock", "In Rock"), e("$dp/Machine Head (1972)"), e("$dp/Machine Head (1972)")))
        assertEquals(PhoneAlbumKeys.hash("deep purple", "in rock"), keys[0])
        assertEquals(PhoneAlbumKeys.hash("deep purple", "machine head"), keys[1])
        assertNotEquals(keys[0], keys[1])
    }

    @Test fun `tags differing only in case are one album in one folder`() {
        val keys = PhoneAlbumKeys.keys(listOf(e("$dp/X", "Machine Head"), e("$dp/X", "machine head ", "DEEP PURPLE")))
        assertEquals(1, keys.toSet().size)
    }
}
