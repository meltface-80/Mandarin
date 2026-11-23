package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** iBroadcast's albums deleted at iBroadcast from a wall's selection menu (item 527): its words, and what the app asks of the server. */
class IBroadcastDeleteTest {
    private class Asked(val answer: JSONObject) : Transport {
        val seen = ArrayList<String>()
        override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
            seen += "$method $path" + (body?.let { " $it" } ?: "") + " $timeout"
            return answer
        }
        override fun bytes(path: String, timeout: Int): ByteArray = path.toByteArray()
    }

    @Test fun `the two questions are the page's, for one album and for three`() {
        assertEquals("Delete this album from iBroadcast? It is deleted from your iBroadcast account, not only from Mandarin, and can't be brought back from Mandarin.",
            IBroadcastDelete.warning(1))
        assertEquals("Delete these 3 albums from iBroadcast? They are deleted from your iBroadcast account, not only from Mandarin, and can't be brought back from Mandarin.",
            IBroadcastDelete.warning(3))
        assertEquals("Are you sure? This can't be undone.", IBroadcastDelete.SURE)
    }

    @Test fun `what is said once done, with the server's note where it has one`() {
        assertEquals("Deleted 1 album from iBroadcast", IBroadcastDelete.done(1, null))
        assertEquals("Deleted 3 albums from iBroadcast", IBroadcastDelete.done(3, null))
        assertEquals("Deleted 3 albums from iBroadcast. iBroadcast's library wasn't read again", IBroadcastDelete.done(3, "iBroadcast's library wasn't read again"))
        assertEquals("Deleted 3 albums from iBroadcast", IBroadcastDelete.said(JSONObject("""{"ok":true,"albums":3,"tracks":30,"emptied":false}""")))
        assertEquals("Deleted 1 album from iBroadcast. Later", IBroadcastDelete.said(JSONObject("""{"ok":true,"albums":1,"tracks":9,"emptied":true,"note":"Later"}""")))
    }

    @Test fun `the albums picked go to the server in the order picked, a minute allowed`() {
        val server = Asked(JSONObject().put("ok", true).put("albums", 2))
        val c = ServerClient(ServerAddress("server", 0), transport = server)
        assertEquals(2, c.deleteFromIBroadcast(listOf(9L, 7L)).optInt("albums"))
        assertEquals(listOf("""POST /api/ibroadcast/delete-albums {"offsets":[9,7]} 60000"""), server.seen)
    }

    @Test fun `offered only where every album picked is iBroadcast's, and the menu's words are the contract's`() {
        val ib = AlbumSummary.parse(JSONObject("""{"offset":7,"title":"Motion","source":"ibroadcast"}"""))
        val own = AlbumSummary.parse(JSONObject("""{"offset":8,"title":"Motion I"}"""))
        assertTrue(IBroadcastDelete.offered(listOf(ib)))
        assertTrue(IBroadcastDelete.offered(listOf(ib, ib.copy(offset = 9))))
        assertFalse(IBroadcastDelete.offered(listOf(ib, own)))
        assertFalse(IBroadcastDelete.offered(emptyList()))
        assertEquals(listOf("Delete from iBroadcast"), Contract.labels["library.select-ib-delete"])
    }
}
