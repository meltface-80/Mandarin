package com.musicd.server.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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

    /** The next page, from [client]; nothing while one is in flight or the end came. */
    suspend fun more(client: ServerClient) {
        if (loading || done) return
        loading = true
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
        loading = false
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
}
