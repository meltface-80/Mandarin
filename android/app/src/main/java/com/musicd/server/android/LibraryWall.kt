package com.musicd.server.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.musicd.server.client.AlbumCovers
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The Library wall's albums as loaded (bug list item 51), a page of 60 at a
 * time as the page's wall loads them (library-wall.js), kept while the app
 * runs so the wall comes back as it was from an album's page (its place is
 * the list's own saved state); a wall in another view starts afresh.
 */
internal class WallState(val view: String) {
    val albums = mutableStateListOf<AlbumSummary>()
    var total by mutableIntStateOf(0)
    /** The first page has answered (the skeletons go). */
    var loaded by mutableStateOf(false)
    /** The library's end came: a short page. */
    var done by mutableStateOf(false)
    var loading by mutableStateOf(false)
    /** What the banner says, and whether as an error (the page's setBanner); null: nothing. */
    var banner by mutableStateOf<Pair<String, Boolean>?>(null)
    /** No page yet, and more to come: the first asked for (again, after a failure) when the Library opens. */
    val needsFirst: Boolean get() = !done && albums.isEmpty()

    /** The next page, from [client]; nothing while one is in flight or the end came. */
    suspend fun more(client: ServerClient) {
        if (loading || done) return
        loading = true
        // Let go however the request ends: called off on the way (the Library left before the page came, as on mobile
        // data or a VPN), a flag still up kept the wall waiting for good, its skeletons up on every visit (item 99).
        try { page(client) } finally { loading = false }
    }

    private suspend fun page(client: ServerClient) {
        val first = albums.isEmpty()
        val r = withContext(Dispatchers.IO) { runCatching { LibraryClient { client.getJson(it) }.albums(albums.size, PAGE, view) } }
        r.onSuccess { p ->
            albums.addAll(p.albums)
            total = p.total
            done = p.albums.size < PAGE
            loaded = true
            // Nothing at all: as the page says it; otherwise whatever the banner said is over.
            banner = if (first && p.albums.isEmpty()) "Nothing matches this focus — try clearing a filter." to false else null
        }.onFailure { e ->
            // The library's index still being built (503): said, and not asked again until the wall is reopened.
            if (e is ServerClient.ServerException && e.status == 503) { banner = (e.message?.takeIf { !it.startsWith("HTTP") } ?: "Reading your music library…") to true; done = true; loaded = true }
            else if (first) { banner = "Couldn’t load: " + (e.message ?: "no answer") to true; loaded = true }
            // Mid-scroll: what is loaded stays; the next nudge asks the same page again.
        }
    }

    companion object { const val PAGE = 60 }
}

/** The one wall held: the last view opened. */
internal object LibraryWall {
    private var last: WallState? = null

    /** The wall in [view]: the one held when it is that view's, else a new one. */
    @Synchronized fun state(view: String): WallState {
        val l = last
        if (l != null && l.view == view) return l
        return WallState(view).also { last = it }
    }

    /**
     * Album [offset]'s cover as its page has just read it ([imageKey], item 123): a tile showing another is put right in
     * every list kept from before, the Library wall's, the other walls' and the search's (a cover found in the editor has
     * a new key, and they went on drawing the old one for as long as the app ran).
     */
    fun coverIs(offset: Long, imageKey: String?) {
        synchronized(this) { last?.let { l -> for ((i, a) in AlbumCovers.fixes(l.albums, offset, imageKey)) l.albums[i] = a } }
        Walls.coverIs(offset, imageKey)
        SearchKept.lib?.let { r -> val f = AlbumCovers.fixes(r.albums, offset, imageKey); if (f.isNotEmpty()) SearchKept.lib = r.copy(albums = r.albums.toMutableList().also { l -> for ((i, a) in f) l[i] = a }) }
    }
}
