package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Qobuz and Tidal browsers as the server answers and the page says them (item 73). */
class ServiceBrowseTest {
    @Test fun `the tabs, Tidal's own lists after New Releases`() {
        assertEquals(listOf("new-releases", "best-sellers", "most-streamed", "press-awards", "editor-picks"), ServiceBrowse.tabs("qobuz").map { it.id })
        val tidal = ServiceBrowse.tabs("tidal")
        assertEquals(listOf("New Releases"), tidal.map { it.label })
        val more = ServiceBrowse.lists(tidal, JSONObject("""{"lists":[{"id":"top","label":"Top 20"},{"id":"","label":"x"},{"id":"rising","label":"Rising"}]}"""))
        assertEquals(listOf("new-releases", "top", "rising"), more.map { it.id })
        assertEquals("featured", more[1].kind)
        assertEquals("none said, the tabs as they were", tidal, ServiceBrowse.lists(tidal, JSONObject("{}")))
    }

    @Test fun `a page of albums, its artists and its head, and the status line`() {
        val p = ServicePage.parse("qobuz", JSONObject("""{"albums":[{"id":"1001","title":"Q Album","version":"Deluxe","artist":"Q Artist","image":"http://x/1.jpg","favourited":true},
            {"id":"1002","title":"Q Second","artist":"Q Artist","image":null}],"artists":[{"id":"1","name":"Q Artist","image":null}],"total":7,"has_more":true,"limit":2}"""))
        assertEquals("Deluxe", p.albums[0].version)
        assertTrue(p.albums[0].favourited)
        assertNull(p.albums[1].image)
        assertEquals("1", p.artists[0].id)
        assertTrue(p.hasMore); assertEquals(2, p.limit)
        assertEquals("7 albums for “Q”", ServiceBrowse.searchStatus("Q", p))
        assertEquals("7 albums", ServiceBrowse.artistStatus(p))
        val empty = ServicePage.parse("qobuz", JSONObject("""{"albums":[],"artists":[{"id":"1","name":"A"}],"days":30}"""))
        assertFalse(empty.hasMore); assertEquals(ServiceBrowse.PAGE_SIZE, empty.limit)
        assertEquals("No album matches for “Q” — artists below", ServiceBrowse.searchStatus("Q", empty))
        assertEquals("No results for “Q”", ServiceBrowse.searchStatus("Q", ServicePage.parse("qobuz", JSONObject("{}"))))
        val nr = ServiceBrowse.tabs("qobuz")[0]; val bs = ServiceBrowse.tabs("qobuz")[1]
        assertEquals("2 releases in the last 30 days", ServiceBrowse.tabStatus(nr, p))
        assertEquals("No new releases found in the last 30 days.", ServiceBrowse.tabStatus(nr, empty))
        assertEquals("2 albums", ServiceBrowse.tabStatus(bs, p))
        assertEquals("No albums found.", ServiceBrowse.tabStatus(bs, empty))
        val head = ServicePage.parse("tidal", JSONObject("""{"albums":[],"artist":{"name":"Artist A","image":"http://x/a.jpg"},"biography":"Born…"}"""))
        assertEquals("Artist A", head.artistName); assertEquals("http://x/a.jpg", head.artistImage); assertEquals("Born…", head.biography)
        assertEquals("tidal", head.albums.firstOrNull()?.service ?: "tidal")
    }

    @Test fun `the paths, the failures, the toasts and the route`() {
        assertEquals("/api/qobuz/new-releases?days=30", ServiceBrowse.tabPath("qobuz", ServiceBrowse.tabs("qobuz")[0]))
        assertEquals("/api/tidal/featured?type=top%20twenty", ServiceBrowse.tabPath("tidal", ServiceTab("top twenty", "Top", "featured")))
        assertEquals("/api/qobuz/search?q=Q%20Artist&offset=50", ServiceBrowse.searchPath("qobuz", "Q Artist", 50))
        assertEquals("/api/tidal/artist-albums?artist_id=7&offset=0", ServiceBrowse.artistPath("tidal", "7", 0))
        assertEquals("Connect your Qobuz account in Settings to browse Qobuz.", ServiceBrowse.failure("qobuz", "Qobuz not connected"))
        assertEquals("Sign in to Tidal in Settings → Services to browse Tidal.", ServiceBrowse.failure("tidal", "not connected"))
        assertEquals("Couldn't load: HTTP 500", ServiceBrowse.failure("qobuz", "HTTP 500"))
        assertEquals("Loading new releases…", ServiceBrowse.loading(ServiceBrowse.tabs("qobuz")[0]))
        assertEquals("Added to Tidal favourites", ServiceBrowse.favourited("tidal", true))
        assertEquals("Removed from Qobuz favourites", ServiceBrowse.favourited("qobuz", false))
        assertEquals("service/qobuz?artistId=1&name=Q%20Artist&q=&zone=z", ShellRoute.serviceBrowser("qobuz", "z", "1", "Q Artist"))
        assertEquals("service/qobuz?artistId=&name=&q=Artist%20A&zone=z", ShellRoute.serviceBrowser("qobuz", "z", q = "Artist A"))
        assertEquals("service/{service}?artistId={artistId}&name={name}&q={q}&zone={zone}", ShellRoute.SERVICE_BROWSER)
    }
}
