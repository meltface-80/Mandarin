package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The outputs behind the rooms (item 68), and Group zones, Device power and the room-move question as the page has them. */
class OutputsTest {
    private val outputs = Speaker.list(JSONObject("""{"outputs":[
        {"output_id":"k","zone_id":"zk","display_name":"Kitchen","zone_name":"Kitchen","can_group_with_output_ids":["s","b"],"source_controls":[]},
        {"output_id":"s","zone_id":"zs","display_name":"Study","zone_name":"Study + Bath","can_group_with_output_ids":["k","b"],
         "source_controls":[{"control_key":"1","display_name":"Amp","status":"standby","supports_standby":true}]},
        {"output_id":"b","zone_id":"zs","display_name":"Bath","zone_name":"Study + Bath","can_group_with_output_ids":["k","s"],"source_controls":[]},
        {"output_id":"g","zone_id":"zg","display_name":"Garage","zone_name":"Garage","can_group_with_output_ids":[]}]}"""))

    @Test fun `the outputs read, each with its room and its power controls`() {
        assertEquals(4, outputs.size)
        assertEquals(listOf("s", "b"), outputs[0].canGroupWith)
        assertEquals("In standby", outputs[1].controls[0].statusLine)
        assertTrue(outputs[1].controls[0].standby)
        assertEquals("", SourceControl("x", "X", "indeterminate", false).statusLine)
        assertNull("no list from the server: unknown", Speaker.list(JSONObject("""{"outputs":[{"output_id":"x"}]}"""))[0].canGroupWith)
        assertEquals("x", Speaker.list(JSONObject("""{"outputs":[{"output_id":"x"}]}"""))[0].name)
    }

    @Test fun `grouping around this room, the primary kept, the rest offered as Sonos allows`() {
        val g = Grouping(outputs, "zk")
        assertEquals("k", g.primary!!.id)
        assertEquals(listOf("k", "s", "b"), g.offerable.map { it.id })
        assertEquals("Outputs your Core can't sync with Kitchen aren't listed — Sonos decides which rooms can play together.", g.limitNote)
        assertEquals("Keeps playing — this group's queue", g.note(outputs[0]))
        assertEquals("In Study + Bath", g.note(outputs[1]))
        assertEquals("", Grouping(outputs, "zs").note(outputs[2]))
        assertNull(g.emptyNote)
        assertNull("nothing changed", g.change(setOf("k")))
        val c = g.change(setOf("k", "s"))!!
        assertEquals(emptyList<String>(), c.ungroup)
        assertEquals(listOf("k", "s"), c.group)
        assertEquals(setOf("k", "s"), c.want)
    }

    @Test fun `a group split, and a room with no anchor`() {
        val g = Grouping(outputs, "zs")
        assertEquals("s", g.primary!!.id)
        val c = g.change(setOf("s"))!!
        assertEquals(listOf("b"), c.ungroup)
        assertEquals("nothing to group when only splitting", emptyList<String>(), c.group)
        assertEquals(setOf("s"), c.want)
        assertEquals(listOf("s", "b", "k"), Grouping(outputs, "zs").change(setOf("s", "b", "k"))!!.group)
        assertEquals("Choose a zone first — grouping needs a zone to build the group around.", Grouping(outputs, "").emptyNote)
        assertEquals(Speaker.NO_ROOMS, Grouping(emptyList(), "zk").emptyNote)
        assertNull(Grouping(outputs, "").change(setOf("k")))
    }

    @Test fun `the room that holds the output after grouping`() {
        val z = JSONObject("""{"zones":[{"zone_id":"z1","outputs":[{"output_id":"g"}]},{"zone_id":"z2","outputs":[{"output_id":"k"},{"output_id":"s"}]}]}""")
        assertEquals("z2" to true, Grouping.settled(z, "k", setOf("k", "s")))
        assertEquals("z2" to false, Grouping.settled(z, "k", setOf("k")))
        assertNull(Grouping.settled(z, "x", setOf("x")))
    }

    @Test fun `Device power's devices and its empty words, and the room-move question`() {
        assertEquals(listOf("s"), DevicePower.withControls(outputs).map { it.id })
        assertEquals("None of your devices can be switched on or off from here.", DevicePower.emptyNote(outputs))
        assertEquals(Speaker.NO_ROOMS, DevicePower.emptyNote(emptyList()))
        assertTrue(RoomMove.playing(JSONObject("""{"album":{"title":"Kind of Blue"}}""")))
        assertFalse(RoomMove.playing(JSONObject("""{"album":null}""")))
        assertFalse(RoomMove.playing(null))
        assertEquals("Move what's playing in Kitchen to Study?", RoomMove.question("Kitchen", "Study"))
        assertEquals("Moved to Study", RoomMove.moved("Study"))
    }
}
