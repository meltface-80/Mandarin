package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Edit album's Version (item 420) as the server answers it and the page says it (album-editor-version.js). */
class AlbumVersionEditTest {
    private val state = EditState.parse(JSONObject("""{"offset":3,"title":"Kind of Blue","artist":"Miles Davis","year":1959,"scanned":{"title":"Kind of Blue","artist":"Miles Davis","year":1959},
        "edited":true,"art":{"own":true},"match":{"artist":"Miles Davis","title":"Kind of Blue","year":1959,"editions":[]},
        "version":{"name":{"value":"HDTT DSD256","was":"blue disc label","from":"match","edited":true},
                   "label":{"value":"Columbia","was":"Columbia","from":"match","edited":false},
                   "catno":{"value":"CL 1355","was":"CL 1355","from":"files","edited":false},
                   "barcode":{"value":null,"was":null,"from":null,"edited":false},
                   "country":{"value":"US","was":"US","from":"match","edited":false},
                   "year":{"value":2015,"was":2015,"from":"match","edited":false},
                   "format":{"value":"12\" Vinyl","was":"12\" Vinyl","from":"match","edited":false}}}"""))

    @Test fun `the version read, each field's words, what Put back gives it and where from, a year written whole`() {
        val v = state.version
        assertEquals(AlbumVersionEdit.FIELDS, v.keys.toList())
        assertEquals(VersionField("HDTT DSD256", "blue disc label", "match", true), v["name"])
        assertEquals("2015", v.getValue("year").value)
        assertEquals(VersionField("", "", null, false), v["barcode"])
        assertTrue(EditState.parse(JSONObject("""{"offset":1}""")).version.isEmpty())
    }

    @Test fun `what is said under a field, the match's or the files' words, none, or nothing when they agree`() {
        val v = state.version
        assertEquals("From the match: blue disc label · ", AlbumVersionEdit.was(v["name"], "HDTT DSD256", true))
        assertNull("the same as the match: nothing under it", AlbumVersionEdit.was(v["label"], " Columbia ", true))
        assertEquals("From the files: CL 1355 · ", AlbumVersionEdit.was(v["catno"], "HDTT-1", true))
        assertEquals("nothing either side, a match applied", "From the match: (none) · ", AlbumVersionEdit.was(v["barcode"], "0123", true))
        assertEquals("nothing either side, no match", "From the files: (none) · ", AlbumVersionEdit.was(v["barcode"], "0123", false))
    }

    @Test fun `a release applied fills every field not typed in since the editor opened, and Save sends them all`() {
        val now = AlbumVersionEdit.refill(emptyMap(), emptySet(), state.version)
        assertEquals("HDTT DSD256", now["name"])
        val typed = now + ("label" to "HDTT")
        val next = EditState.parse(JSONObject("""{"offset":3,"version":{"name":{"value":"mono","was":"mono","from":"match"},"label":{"value":"CBS","was":"CBS","from":"match"}}}""")).version
        val after = AlbumVersionEdit.refill(typed, setOf("label"), next)
        assertEquals("mono", after["name"])
        assertEquals("the one typed stays as typed", "HDTT", after["label"])
        assertEquals("", after["country"])
        val body = AlbumEdit.saveBody(3, "Kind of Blue", "Miles Davis", "1959", null, after + ("year" to " 2015 ")).getJSONObject("version")
        assertEquals(AlbumVersionEdit.FIELDS.toSet(), body.keys().asSequence().toSet())
        assertEquals("2015", body.getString("year"))
        assertFalse("no version sent where the editor has none", AlbumEdit.saveBody(3, "a", "b", "", null).has("version"))
    }

    @Test fun `this pressing's year is four digits or none`() {
        assertNull(AlbumVersionEdit.yearError(""))
        assertNull(AlbumVersionEdit.yearError("2008"))
        assertEquals("This pressing's year should be four digits, like 2008.", AlbumVersionEdit.yearError("08"))
    }
}
