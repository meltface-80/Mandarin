package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ContractTest {
    // The screens contract (docs/specs/screens.json), as the page reads it too.
    private val screens: JSONObject by lazy {
        val f = listOf("../../docs/specs/screens.json", "../docs/specs/screens.json", "docs/specs/screens.json").map { File(it) }.first { it.exists() }
        JSONObject(f.readText()).getJSONObject("screens")
    }

    @Test fun `a control's label as the page has it, in each state, its content filled in`() {
        assertEquals("Next track", Contract.label("now-playing.next"))
        assertEquals("Play", Contract.label("now-playing.playpause", 0))
        assertEquals("Pause", Contract.label("now-playing.playpause", 1))
        assertEquals("a state past the last: the last", "Pause", Contract.label("now-playing.playpause", 5))
        assertEquals("Open album: Album One", Contract.label("now-playing.album", 0, "Album One"))
        assertThrows(IllegalArgumentException::class.java) { Contract.label("now-playing.lyrics") }
    }

    @Test fun `every label is the contract's, and every control of the contract has one`() {
        val want = mutableMapOf<String, List<String>>()
        for (s in screens.keySet()) {
            val items = screens.getJSONObject(s).getJSONObject("items")
            for (k in items.keySet()) {
                val it = items.getJSONObject(k)
                if (it.getString("kind") != "action" || it.optString("only") == "page") continue
                val l = it.get("label")
                want["$s.$k"] = if (l is String) listOf(l) else (0 until it.getJSONArray("label").length()).map { i -> it.getJSONArray("label").getString(i) }
            }
        }
        assertTrue(want.isNotEmpty())
        assertEquals(want, Contract.labels)
    }
}
