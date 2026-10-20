package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The album editor as the server answers and the page says it (item 74). */
class AlbumEditTest {
    private val state = EditState.parse(JSONObject("""{"offset":7,"folder":"Music/Artist A/Album One","box":{"name":"The Box","disc":2,"of":5},
        "title":"Album One (Remaster)","artist":"Artist A","year":2002,"scanned":{"title":"Album One","artist":"Artist A","year":null},
        "edited":true,"image_key":"k7","art":{"own":false,"found":true,"source":"Deezer"}}"""))

    @Test fun `the editor's view read, names now and scanned, the year as a number is written whole`() {
        assertEquals(7L, state.offset)
        assertEquals("2002", state.year)
        assertEquals("", state.scanned["year"])
        assertEquals("From The Box · disc 2 of 5", state.boxLine)
        assertTrue(state.edited)
        assertEquals("From the files: Album One · ", AlbumEdit.was(state.scanned.getValue("title"), state.title))
        assertNull("the same as the files: nothing under it", AlbumEdit.was("Artist A", " Artist A "))
        assertEquals("From the files: (none) · ", AlbumEdit.was("", "2002"))
    }

    @Test fun `the cover's line, found, own, none, a new one chosen, the found one to go`() {
        assertEquals("Found cover from Deezer.", AlbumEdit.coverStatus(state, null).text)
        assertEquals("Found cover", AlbumEdit.coverStatus(state, null).bold)
        assertEquals("a pasted address says nothing of where", "Found cover.", AlbumEdit.coverStatus(state.copy(artSource = "https://x/y.jpg"), null).text)
        assertEquals("Cover from the album's files.", AlbumEdit.coverStatus(state.copy(artFound = false, artOwn = true), null).text)
        assertEquals("No cover. This album's folder and tracks have no artwork.", AlbumEdit.coverStatus(state.copy(artFound = false), null).text)
        assertEquals("New cover from a pasted address — save to use it.", AlbumEdit.coverStatus(state, CoverPick("https://x/c.jpg", null, CoverPick.PASTED)).text)
        assertEquals("The found cover will be removed when you save.", AlbumEdit.coverStatus(state, CoverPick.REMOVE).text)
    }

    @Test fun `the covers found, the sure one picked, each one's line, what the search says`() {
        val s = ArtSearch.parse(JSONObject("""{"sure":{"url":"https://a/1.jpg","source":"Apple Music"},"candidates":[
            {"source":"Apple Music","title":"Album One","artist":"Artist A","year":"2002","tracks":3,"url":"https://a/1.jpg","thumb":"https://a/1s.jpg","match":{"tracks":1}},
            {"source":"Deezer","title":"Album One","artist":"Artist A","year":"2003","tracks":12.0,"url":"https://d/2.jpg","thumb":null,"match":{"tracks":0.5}},
            {"source":"MusicBrainz","title":"Album One","artist":"Artist A","year":"1999","tracks":9,"url":"https://m/3.jpg","match":{"tracks":null}},
            {"source":"Nowhere","url":""}]}"""))
        assertEquals("an address-less one dropped", 3, s.candidates.size)
        assertTrue("the sure one is the list's own", s.sure === s.candidates[0])
        assertEquals("Found it on Apple Music — same tracks, artist and title. Save to use it, or pick another.", s.status.text)
        assertEquals("All tracks match", s.candidates[0].line)
        assertEquals("50% tracks match", s.candidates[1].line)
        assertEquals("1999 · 9 tracks", s.candidates[2].line)
        assertEquals("https://a/1s.jpg", s.candidates[0].picture)
        assertEquals("https://d/2.jpg", s.candidates[1].picture)
        assertEquals("Album One — Artist A (Deezer)", s.candidates[1].label)
        assertEquals("Not sure which one is right.", s.copy(sure = null).status.bold)
        assertEquals("Nothing found.", ArtSearch.parse(JSONObject("{}")).status.bold)
    }

    @Test fun `the releases offered, each one's lines, the badge on the first, what the search says`() {
        val m = MatchSearch.parse(JSONObject("""{"verdict":"proposed","ambiguous":true,"candidates":[
            {"mbid":"a","title":"Album One","artist":"Artist A","year":2002,"release_year":2005,"edition":"Deluxe","country":"GB","track_count":12,"source":"musicbrainz","similarity":97,"missing_tracks":1,"extra_tracks":0},
            {"mbid":"itunes:5","title":"Album One","artist":"","year":null,"track_count":10,"source":"itunes","similarity":80}]}"""))
        assertEquals("Artist A — Album One", m.candidates[0].name)
        assertEquals("2002 · this pressing 2005 · Deluxe · GB · 12 tracks · 1 missing here", m.candidates[0].line)
        assertTrue(m.candidates[0].sure)
        assertEquals("Album One", m.candidates[1].name)
        assertEquals("iTunes · 10 tracks", m.candidates[1].line)
        assertFalse(m.candidates[1].sure)
        assertEquals("Likely", m.badge(0))
        assertNull(m.badge(1))
        assertEquals("Close, but two releases fit. Tap the right one to apply.", m.status.text)
        assertEquals("Match", m.copy(verdict = "applied").badge(0))
        assertEquals("This is it", m.copy(verdict = "applied").status.bold)
        assertEquals("Not sure which.", m.copy(verdict = "unidentified").status.bold)
        assertEquals("Nothing with this title on MusicBrainz.", MatchSearch.parse(null).status.bold)
    }

    @Test fun `what Save sends, and what is refused before it`() {
        val plain = AlbumEdit.saveBody(7, "T", "A", " 2002 ", null)
        assertEquals(listOf("artist", "offset", "title", "year"), plain.keys().asSequence().sorted().toList())
        assertEquals("2002", plain.getString("year"))
        assertEquals("remove", AlbumEdit.saveBody(7, "T", "A", "", CoverPick.REMOVE).getString("art"))
        val pasted = AlbumEdit.saveBody(7, "T", "A", "", CoverPick("https://x/c.jpg", "https://x/c.jpg", CoverPick.PASTED))
        assertEquals("a pasted address is its own source", "https://x/c.jpg", pasted.getString("art_source"))
        assertEquals("Deezer", AlbumEdit.saveBody(7, "T", "A", "", CoverPick("https://d/2.jpg", null, "Deezer")).getString("art_source"))
        assertNull(AlbumEdit.yearError(""))
        assertNull(AlbumEdit.yearError("1999"))
        assertEquals("The year should be four digits, like 2002.", AlbumEdit.yearError("99"))
        assertNull(AlbumEdit.urlError(" https://x/c.jpg "))
        assertEquals("That doesn't look like a web address (it should start with http).", AlbumEdit.urlError("x/c.jpg"))
    }

    @Test fun `what is said once a release is applied`() {
        val answer = JSONObject("""{"applied":[{"album":{"offset":3},"candidate":{"title":"Other","artist":"B"}},
            {"album":{"offset":7},"candidate":{"title":"Album One","artist":"Artist A","year":2002}}]}""")
        assertEquals("Matched: Artist A — Album One (2002). Undo is under Settings → Library Scanner.", AlbumEdit.matched(answer, 7).text)
        assertEquals("Matched.", AlbumEdit.matched(JSONObject("{}"), 7).text)
    }
}
