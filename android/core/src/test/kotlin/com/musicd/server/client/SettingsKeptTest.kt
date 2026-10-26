package com.musicd.server.client

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Settings' pages open as last seen, then follow the server (item 198). */
class SettingsKeptTest {
    /** A server answering each GET with [answers]' (counting them), and every write with {"ok": true}. */
    private class Server(val answers: MutableMap<String, JSONObject>) : Transport {
        val asked = mutableListOf<String>()
        override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
            asked += "$method $path"
            return if (method == "GET") answers[path] ?: throw ServerClient.ServerException(404, "Not found") else JSONObject().put("ok", true)
        }
        override fun bytes(path: String, timeout: Int) = ByteArray(0)
    }

    private var disk: String? = null

    @Before fun fresh() { SettingsKept.reset(); disk = null }
    @After fun after() = SettingsKept.reset()

    private fun client(server: Transport) = ServerClient(ServerAddress("h", 1), transport = KeptTransport(server) { it() })

    @Test fun `a page's read is kept as the server answered it, and opens on it next time`() {
        val s = Server(mutableMapOf("/api/auth/status" to JSONObject().put("open", true)))
        assertNull(SettingsKept.last("/api/auth/status"))
        client(s).getJson("/api/auth/status")
        assertTrue(SettingsKept.last("/api/auth/status")!!.getBoolean("open"))
        assertEquals(true, SettingsKept.last("/api/auth/status") { it.getBoolean("open") })
    }

    @Test fun `only Settings' reads are kept, never the API keys, the browser of folders, or anything else`() {
        for (p in listOf("/api/auth/status", "/api/library/folders", "/api/settings/smart-picks", "/api/settings/qobuz", "/api/audio-devices",
                "/api/audio-devices/alsa%3Ahw%3A1", "/api/identify?lists=0", "/api/tailscale")) assertTrue(p, SettingsKept.keeps(p))
        for (p in listOf("/api/settings/lastfm-key", "/api/settings/fanart", "/api/library/browse?path=%2Fmusic", "/api/audio-devices/x/dsp",
                "/api/identify?lists=60", "/api/shortcut/zones", "/api/cpu", "/api/health")) assertFalse(p, SettingsKept.keeps(p))
    }

    @Test fun `kept on the phone for its own server, back after a restart, another server's never shown`() {
        SettingsKept.attach({ "srv-1" }, { disk }, { disk = it })
        client(Server(mutableMapOf("/api/library/folders" to JSONObject().put("roots", 3)))).getJson("/api/library/folders")
        assertTrue(disk!!.contains("srv-1"))

        SettingsKept.reset()
        SettingsKept.attach({ "srv-1" }, { disk }, { disk = it })
        assertEquals(3, SettingsKept.last("/api/library/folders")!!.getInt("roots"))

        SettingsKept.reset()
        SettingsKept.attach({ "srv-2" }, { disk }, { disk = it })
        assertNull(SettingsKept.last("/api/library/folders"))
    }

    @Test fun `the phone's own offline answers are never kept, only a KeptTransport keeps`() {
        val offline = ServerClient(ServerAddress("phone", 0), transport = LocalTransport { _, _, _, _ -> Answer(200, JSONObject().put("open", false)) })
        offline.getJson("/api/auth/status")
        assertNull(SettingsKept.last("/api/auth/status"))
    }

    @Test fun `a write is followed by the reads it changes, so the next opening isn't from before it`() {
        val answers = mutableMapOf("/api/settings/qobuz" to JSONObject().put("signed_in", false), "/api/audio-devices" to JSONObject().put("n", 1),
            "/api/audio-devices/d1" to JSONObject().put("enabled", false), "/api/auth/status" to JSONObject().put("open", false),
            "/api/auth/devices" to JSONObject().put("devices", 2))
        val s = Server(answers)
        val c = client(s)
        answers.keys.toList().forEach { c.getJson(it) }

        answers["/api/settings/qobuz"] = JSONObject().put("signed_in", true)
        c.post("/api/settings/qobuz/signin", JSONObject())
        assertTrue(SettingsKept.last("/api/settings/qobuz")!!.getBoolean("signed_in"))

        answers["/api/audio-devices/d1"] = JSONObject().put("enabled", true)
        c.patch("/api/audio-devices/d1", JSONObject().put("enabled", true))
        assertTrue(SettingsKept.last("/api/audio-devices/d1")!!.getBoolean("enabled"))
        assertTrue("the list read again too", s.asked.count { it == "GET /api/audio-devices" } == 2)

        answers["/api/auth/status"] = JSONObject().put("open", true)
        c.post("/api/auth/open", JSONObject())
        assertTrue(SettingsKept.last("/api/auth/status")!!.getBoolean("open"))
    }

    @Test fun `a write reads again only what was kept, and nothing for a write nothing kept depends on`() {
        assertEquals(emptyList<String>(), SettingsKept.after("/api/settings/qobuz/signin"))
        assertEquals(emptyList<String>(), SettingsKept.after("/api/queue/add"))
    }

    @Test fun `an answer too big for the phone is kept in memory only`() {
        SettingsKept.attach({ "srv" }, { disk }, { disk = it })
        val big = JSONObject().put("x", "y".repeat(SettingsKept.DISK_MAX + 1))
        client(Server(mutableMapOf("/api/backup" to big))).getJson("/api/backup")
        assertTrue(SettingsKept.last("/api/backup") != null)
        assertFalse(disk!!.contains("/api/backup"))
    }
}
