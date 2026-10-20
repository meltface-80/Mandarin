package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Record labels as the server answers and the page says them (item 71). */
class LabelsTest {
    private val list = LabelList.parse(JSONObject("""{"labels":[
        {"key":"bluenote","title":"Blue Note","subtitle":"2 albums","albumCount":2,"logo_url":null,"mergedFrom":[{"key":"parlophone","display":"Parlophone"}]},
        {"key":"ecm","title":"ECM Records","subtitle":"1 album","albumCount":1,"logo_url":"https://x/ecm.png","mergedFrom":[]},
        {"key":"etiq","title":"Étiquette","subtitle":"3 albums","albumCount":3}],"scanning":false,"progress":1,"lookups":true}"""))

    @Test fun `the list read, shown in its order, by its find, past its fewest`() {
        assertEquals(3, list.labels.size)
        assertEquals(listOf(MergedLabel("parlophone", "Parlophone")), list.labels[0].mergedFrom)
        assertNull(list.labels[0].logoUrl)
        assertEquals("https://x/ecm.png", list.labels[1].logoUrl)
        assertEquals(listOf("ECM", "Records"), list.labels[1].words)
        assertEquals(listOf("?"), LabelTile("k", "  ", "", 1, null, emptyList()).words)
        assertEquals(listOf("bluenote", "ecm", "etiq"), list.shown(1, false).map { it.key })
        assertEquals(listOf("etiq", "ecm", "bluenote"), list.shown(1, true).map { it.key })
        assertEquals(listOf("bluenote", "etiq"), list.shown(2, false).map { it.key })
        assertEquals("accents and case aside", listOf("etiq"), list.shown(1, false, "ETIQ").map { it.key })
        assertEquals(listOf("ecm"), list.shown(1, false, " records").map { it.key })
        assertNull(list.banner(1))
        assertTrue(list.log)
        assertFalse(list.rescan(1))
    }

    @Test fun `with no labels, what the page says, and its Rescan`() {
        val scanning = LabelList(emptyList(), true, 0.42, true)
        assertEquals("Scanning for record labels… 42% complete.", scanning.banner(1))
        assertEquals("Building library index…", LabelList(emptyList(), true, 0.0, true).banner(1))
        val none = LabelList(emptyList(), false, 1.0, true)
        assertEquals("No labels found yet — the background scan is looking them up. This can take a few minutes for large libraries.", none.banner(1))
        assertTrue(none.rescan(1))
        assertEquals("No labels yet: none of the albums' files carry a LABEL tag.", LabelList(emptyList(), false, 1.0, false).banner(1))
        assertFalse(LabelList(emptyList(), false, 1.0, false).log)
        assertEquals("none past the fewest is none", "No labels found yet — the background scan is looking them up. This can take a few minutes for large libraries.", list.banner(5))
    }

    @Test fun `the order, the find's none, the merge bar's line`() {
        assertEquals("#–Z", Labels.orderWord(false))
        assertEquals("Order: Z to # — tap for # to Z", Labels.orderLabel(true))
        assertEquals("No label matches “blue”", Labels.none(" blue "))
        assertEquals(Labels.MergeLine("Tap labels to select", "", "", false), Labels.mergeLine(emptyList()))
        assertEquals(Labels.MergeLine("", "Blue Note", " — select more to merge", false), Labels.mergeLine(listOf("Blue Note")))
        assertEquals(Labels.MergeLine("Merge 2 into ", "Blue Note", "", true), Labels.mergeLine(listOf("Blue Note", "ECM")))
    }

    @Test fun `a label's albums and logos, the prefs, the client's paths and the route`() {
        val a = LabelAlbums.parse(JSONObject("""{"albums":[{"offset":2,"title":"Hi Res","subtitle":"Artist B"}],"logo_url":"https://x/l.png"}"""))
        assertEquals(2L, a.albums[0].offset)
        assertEquals("https://x/l.png", a.logoUrl)
        assertEquals(listOf(LogoCandidate("https://d/1.png", "Blue Note")), LogoCandidate.list(JSONObject("""{"candidates":[{"img":"https://d/1.png","title":"Blue Note"},{"img":""}]}""")))
        val p = WallPrefs.parse("""{"labelOrder":"random","labelMin":"3"}""")
        assertEquals("random", p.labelOrder); assertEquals(3, p.labelMin)
        assertEquals("alpha", WallPrefs.parse("{}").labelOrder); assertEquals(1, WallPrefs.parse("""{"labelMin":"0"}""").labelMin)
        val asked = ArrayList<String>()
        val c = LibraryClient { asked += it; JSONObject("""{"labels":[],"albums":[],"candidates":[]}""") }
        c.labels(); c.labelAlbums("Blue Note", "alpha"); c.labelLogoCandidates("Blue Note")
        assertEquals(listOf("/api/filters/labels", "/api/label-albums?label=Blue%20Note&order=alpha", "/api/labels/logo-candidates?label=Blue%20Note"), asked)
        assertEquals("labels?zone=z", ShellRoute.labels("z"))
    }
}
