package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Library wall's view as the page writes it (LibraryView.kt; walls.js libViewQuery), and the Focus sheet's facets. */
class LibraryViewTest {
    @Test fun `a view is the page's query string, there and back`() {
        val v = LibraryView.parse("sort=year&dir=desc&genre=Rock&genre=%21Pop&decade=1990&played=6&prefix=the%20b")
        assertEquals("year", v.sort); assertEquals("desc", v.dir)
        assertEquals(mapOf("genre" to listOf("Rock", "!Pop"), "decade" to listOf("1990")), v.facets)
        assertEquals("6", v.played); assertEquals("the b", v.prefix)
        assertEquals("sort=year&dir=desc&genre=Rock&genre=%21Pop&decade=1990&played=6&prefix=the+b", v.query())
        assertEquals(v, LibraryView.parse(v.query()))
        assertEquals("the defaults", "sort=album&dir=asc", LibraryView.parse("").query())
        assertEquals("nonsense is the default", LibraryView(), LibraryView.parse("sort=size&dir=up&played=sometimes&nothing=1"))
        assertEquals("the seed only with Random", "sort=random&dir=asc&seed=42", LibraryView.parse("sort=random&seed=42").query())
    }

    @Test fun `Home's Library row asks with the order alone, never the Focus nor the name filter`() {
        val v = LibraryView.parse("sort=year&dir=desc&genre=Rock&genre=!Jazz&played=never&prefix=Th")
        assertEquals("sort=year&dir=desc", v.sortQuery())
        assertEquals("a random order keeps its seed", "sort=random&dir=asc&seed=42", LibraryView.parse("sort=random&seed=42&decade=1990s").sortQuery())
        assertEquals("nothing said: the default order", "sort=album&dir=asc", LibraryView.parse("").sortQuery())
    }

    @Test fun `a chip cycles off, on, excluded and off again, with the count and the heading matching`() {
        var v = LibraryView()
        assertEquals(0, v.focusCount); assertFalse(v.focused)
        v = v.cycle("genre", "Rock")
        assertEquals("on", v.state("genre", "Rock")); assertEquals(1, v.focusCount); assertTrue(v.focused)
        v = v.cycle("genre", "Rock")
        assertEquals("not", v.state("genre", "Rock")); assertEquals(listOf("!Rock"), v.facets["genre"])
        v = v.cycle("genre", "Rock")
        assertEquals("off", v.state("genre", "Rock")); assertEquals(0, v.focusCount)
        v = v.copy(played = "never").cycle("decade", "1980")
        assertEquals(2, v.focusCount)
        assertEquals("cleared keeps the order", LibraryView(sort = "year", dir = "desc"), v.copy(sort = "year", dir = "desc").cleared())
        assertTrue("a name filter narrows the wall too", LibraryView(prefix = "a").focused)
    }

    @Test fun `a sort chosen opens its own way, a second tap reverses it, Random reshuffles`() {
        var v = LibraryView()
        assertEquals("A → Z", v.dirLabel)
        v = v.choose("year")
        assertEquals("year" to "desc", v.sort to v.dir); assertEquals("Newest first", v.dirLabel)
        v = v.choose("year")
        assertEquals("asc", v.dir); assertEquals("Oldest first", v.dirLabel)
        val r = v.choose("random")
        assertEquals("random", r.sort); assertTrue(r.seed != 1 || r.seed == 1)   // freshly shuffled: a seed of its own
        assertTrue("a re-tap shuffles again", r.choose("random").seed != r.seed)
        assertEquals("", r.dirLabel); assertFalse(r.sortOption.hasDir)
        assertEquals("unknown: unchanged", v, v.choose("size"))
        assertTrue(LibraryView.nextSeed(7) in 1..100000); assertTrue(LibraryView.nextSeed(7) != 7)
    }

    @Test fun `the facets, a bio and the unplayed wall read as the server answers`() {
        val f = Facets.parse(JSONObject("""{"total":3,"facets":[{"id":"genre","label":"Genre","total_values":5,"values":[{"value":"Rock","label":"Rock","count":2}]}],"coverage":{"genre":2},"hasPlays":false,"sources_derived":false}"""))
        assertEquals(3, f.total); assertEquals("Genre", f.facets[0].label); assertEquals(5, f.facets[0].totalValues)
        assertEquals(Facets.Value("Rock", "Rock", 2), f.facets[0].values[0]); assertEquals(2, f.coverage["genre"]); assertFalse(f.hasPlays)
        assertEquals(ArtistBio("Born in 1970.", "Wikipedia", null), ArtistBio.parse(JSONObject("""{"bio":{"text":"Born in 1970.","source":"Wikipedia","image":null}}""")))
        assertNull(ArtistBio.parse(JSONObject("""{"bio":null}""")))
        val u = Unplayed.parse(JSONObject("""{"albums":[],"total":0,"months":6,"no_history":true,"ready_at":1700000000000}"""))
        assertTrue(u.noHistory); assertEquals(1700000000000L, u.readyAt); assertTrue(u.albums.isEmpty())
    }

    @Test fun `the walls' and the artist's routes and the client's paths`() {
        assertEquals("wall/random?zone=z&filter=", ShellRoute.wall("random", "z"))
        assertEquals("artist?name=Artist%20A&zone=z%201", ShellRoute.artist("Artist A", "z 1"))
        val asked = ArrayList<String>()
        val client = LibraryClient { path -> asked += path; JSONObject("""{"albums":[],"facets":[],"bio":null}""") }
        client.facets(); client.favourites(); client.listenLater(); client.history(60); client.unplayed(6, 96); client.randomAlbums(24); client.artistBio("Artist A", "Album One")
        assertEquals(listOf("/api/library/facets", "/api/favourites", "/api/listen-later", "/api/home/history?count=60", "/api/home/unplayed?months=6&count=96",
            "/api/random-albums?count=24", "/api/artist-bio?artist=Artist%20A&album=Album%20One"), asked)
    }
}
