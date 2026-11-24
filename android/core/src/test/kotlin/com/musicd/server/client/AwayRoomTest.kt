package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * Away from home, what a screen sends for a room is sent for this phone's (bug list item 487: Now playing and the mini
 * player, opened at home in the Bridge's room, went on asking for the Bridge's from away and were refused, 403).
 */
class AwayRoomTest {
    /** A server that keeps what it was asked, and refuses another room as the server does away. */
    private class Asked(private val own: String?) : Transport {
        val seen = ArrayList<String>()
        val bodies = ArrayList<JSONObject?>()
        override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
            seen += "$method $path" + (body?.let { " $it" } ?: "")
            bodies += body
            val named = listOfNotNull(Regex("[?&]zone=([^&]*)").find(path)?.groupValues?.get(1), body?.optString("zone_or_output_id")?.takeIf { it.isNotEmpty() })
            if (own != null && named.any { it != own }) throw ServerClient.ServerException(403, "Away from home, only this phone plays")
            return JSONObject().put("revision", 1).put("ok", true).put("items", org.json.JSONArray())
        }
        override fun bytes(path: String, timeout: Int): ByteArray = path.toByteArray()
    }

    private fun client(server: Asked, away: Boolean) =
        ServerClient(ServerAddress("server", 0), transport = AwayRoom(server) { if (away) "PHONE_1" else null })

    @Test fun `away, a screen opened in another room asks for, and plays in, this phone's`() {
        val server = Asked("PHONE_1")
        val c = client(server, away = true)
        c.zoneState("SLIM_1", waitFor = 9)
        c.queue("SLIM_1")
        c.control("SLIM_1", "playpause")
        c.seek("SLIM_1", 30.0)
        c.zoneVolume("SLIM_1", 40.0)
        c.playAlbum(7, "Blue Train", "John Coltrane", "SLIM_1", "play_now")
        c.playFromHere("SLIM_1", 2)
        // Each for this phone's room, and nothing else of it changed.
        assertEquals(listOf("GET /api/zone-state?zone=PHONE_1&wait_for=9&timeout=20000", "GET /api/queue?zone=PHONE_1", "POST /api/control",
            "POST /api/seek", "POST /api/volume", "POST /api/play", "POST /api/play-from-here"), server.seen.map { it.substringBefore(" {") })
        val bodies = server.bodies.filterNotNull()
        assertEquals(List(5) { "PHONE_1" }, bodies.map { it.getString("zone_or_output_id") })
        assertEquals("playpause", bodies[0].getString("command"))
        assertEquals(30.0, bodies[1].getDouble("seconds"), 0.0)
        assertEquals(40.0, bodies[2].getDouble("value"), 0.0)
        assertEquals(7 to "Blue Train", bodies[3].getInt("offset") to bodies[3].getString("title"))
        assertEquals("play_now", bodies[3].getString("kind"))
        assertEquals(2, bodies[4].getInt("queue_item_id"))
    }

    @Test fun `at home every room is asked for by its own name`() {
        val server = Asked(null)
        val c = client(server, away = false)
        c.zoneState("SLIM_1")
        c.control("SLIM_1", "next")
        assertEquals(listOf("GET /api/zone-state?zone=SLIM_1", "POST /api/control"), server.seen.map { it.substringBefore(" {") })
        assertEquals("SLIM_1", server.bodies[1]!!.getString("zone_or_output_id"))
    }

    @Test fun `this phone's own requests, and what names no room, go as they are`() {
        assertEquals("/api/zone-state?zone=PHONE_1&wait_for=3", AwayRooms.path("/api/zone-state?zone=PHONE_1&wait_for=3", "PHONE_1"))
        assertEquals("/api/queue", AwayRooms.path("/api/queue", "PHONE_1"))
        assertEquals("/api/zone-state?zone=", AwayRooms.path("/api/zone-state?zone=", "PHONE_1"))
        val own = JSONObject().put("zone_or_output_id", "PHONE_1").put("command", "pause")
        assertSame(own, AwayRooms.body("/api/control", own, "PHONE_1"))
        val none = JSONObject().put("command", "pause")
        assertSame(none, AwayRooms.body("/api/control", none, "PHONE_1"))
        assertEquals(null, AwayRooms.body("/api/control", null, "PHONE_1"))
    }

    @Test fun `the body sent is a copy, the caller's own left as it was`() {
        val sent = JSONObject().put("zone_or_output_id", "SLIM_1").put("command", "pause")
        val gone = AwayRooms.body("/api/control", sent, "PHONE_1")!!
        assertEquals("SLIM_1", sent.getString("zone_or_output_id"))
        assertEquals("PHONE_1", gone.getString("zone_or_output_id"))
        assertEquals("pause", gone.getString("command"))
    }

    @Test fun `a room's id with marks in it is read and written as the address has it`() {
        assertEquals("/api/zone-state?zone=PHONE+a%2Fb&wait_for=1", AwayRooms.path("/api/zone-state?zone=SLIM%201&wait_for=1", "PHONE a/b"))
        assertEquals("/api/zone-state?zone=PHONE+a%2Fb", AwayRooms.path("/api/zone-state?zone=PHONE+a%2Fb", "PHONE a/b"))
    }

    /** What the server keeps for home, a speaker's own switches, SQ-tool's rooms, and everything that isn't a room's at all. */
    @Test fun `what isn't a room's to follow is left to the server to answer`() {
        for (p in listOf("/api/transfer-zone", "/api/group-outputs", "/api/pause-all", "/api/output/standby", "/api/sq-tool/record", "/api/settings/home-rows", "/api/library/albums")) {
            val b = JSONObject().put("zone_or_output_id", "SLIM_1").put("output_id", "SLIM_1").put("zone", "SLIM_1")
            assertSame(p, b, AwayRooms.body(p, b, "PHONE_1"))
            assertEquals(p, "$p?zone=SLIM_1", AwayRooms.path("$p?zone=SLIM_1", "PHONE_1"))
        }
        // A wall's own "zone" filter, were there one, is not a room's request.
        assertEquals("/api/library/albums?zone=SLIM_1&from=a&to=b", AwayRooms.path("/api/library/albums?zone=SLIM_1&from=a&to=b", "PHONE_1"))
    }

    @Test fun `every field that names the room, and no other`() {
        val b = JSONObject().put("zone", "A").put("zone_or_output_id", "B").put("output_id", "C").put("zone_id", "D").put("from", "E").put("to", "F").put("kind", "queue")
        val out = AwayRooms.body("/api/play", b, "PHONE_1")!!
        assertEquals(listOf("PHONE_1", "PHONE_1", "PHONE_1", "PHONE_1", "E", "F", "queue"), listOf("zone", "zone_or_output_id", "output_id", "zone_id", "from", "to", "kind").map { out.getString(it) })
    }

    @Test fun `covers and files are fetched as asked`() {
        val server = Asked("PHONE_1")
        assertEquals("/api/image/al-1?zone=SLIM_1", String(AwayRoom(server) { "PHONE_1" }.bytes("/api/image/al-1?zone=SLIM_1", 1000)))
    }
}
