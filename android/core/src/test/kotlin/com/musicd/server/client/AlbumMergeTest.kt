package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Albums merged into one from a wall's selection menu (item 512): what the app asks of the server, and what it reads back. */
class AlbumMergeTest {
    private class Asked : Transport {
        val seen = ArrayList<String>()
        override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
            seen += "$method $path" + (body?.let { " $it" } ?: "")
            return JSONObject().put("ok", true).put("offset", 7).put("title", "Motion")
        }
        override fun bytes(path: String, timeout: Int): ByteArray = path.toByteArray()
    }

    @Test fun `Merge albums sends the albums in the order picked, Unmerge the one`() {
        val server = Asked()
        val c = ServerClient(ServerAddress("server", 0), transport = server)
        assertEquals("Motion", c.mergeAlbums(listOf(9L, 7L)).optString("title"))
        c.unmergeAlbum(7L)
        assertEquals(listOf("""POST /api/albums/merge {"offsets":[9,7]}""", """POST /api/albums/unmerge {"offset":7}"""), server.seen)
    }

    @Test fun `a merged album says so, the rest don't, and the menu's words are the contract's`() {
        assertTrue(AlbumSummary.parse(JSONObject("""{"offset":7,"title":"Motion","discs":2,"merged":true}""")).merged)
        assertFalse(AlbumSummary.parse(JSONObject("""{"offset":8,"title":"Motion I"}""")).merged)
        assertEquals(listOf("Merge albums"), Contract.labels["library.select-merge"])
        assertEquals(listOf("Unmerge"), Contract.labels["library.select-unmerge"])
    }
}
