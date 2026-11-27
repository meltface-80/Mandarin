package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/** The phone's own albums dated from their files' tags, the server off (item 541). */
class TagDateTest {
    @Test fun `the fullest date the tags give, a Qobuz FLAC's DATE among them`() {
        assertEquals("2011-09-30", TagDate.of(null, "2011-09-30"))
        assertEquals("2011-09-30", TagDate.of("2011", "2011-09-30"))
        assertEquals("2011-09-30", TagDate.of("2011-09-30T07:00:00Z", null))
        assertEquals("2011-09", TagDate.of("2011-09", null))
        assertEquals("2011-09-30", TagDate.of("2011/09/30", null))
        assertEquals("1971", TagDate.of("1971", null))
    }

    @Test fun `an MP4 file's making date is no release date, and years that differ keep the first`() {
        assertEquals("2011", TagDate.of("2011", "20230101T120000.000Z"))
        assertEquals("", TagDate.of(null, "20230101T120000.000Z"))
        assertEquals("1971", TagDate.of("1971", "2011-09-30"))
        assertEquals("", TagDate.of("", "unknown"))
        assertEquals("", TagDate.of(null, null))
    }

    @Test fun `the album page and share card take the album's own date where the extras have none`() {
        val a = PhoneShelf.phoneView(PhoneAlbum("ab12", "Metals", "Feist", 2011, true, emptyList(), "2011-09-30"))
        assertEquals("2011-09-30", a.releaseDate)
        assertEquals("30 September 2011", albumDate(null, a, Locale.UK))
        assertEquals("30 September 2011", albumDate(AlbumExtras.parse(JSONObject()), a, Locale.UK))
        assertEquals("1 October 2011", albumDate(AlbumExtras.parse(JSONObject().put("release_date", "2011-10-01")), a, Locale.UK))
        assertEquals("2011-09-30", CardFields.NONE.orRelease("2011-09-30").releaseRaw)
        assertEquals("2011-10-01", CardFields("2011-10-01", "", "", null, false).orRelease("2011-09-30").releaseRaw)
    }
}
