package com.musicd.server.android

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.GenreCard
import com.musicd.server.client.HomeRow
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.Pick
import com.musicd.server.client.PlaylistTile
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Home's rows as last loaded, kept while the app runs (bug list item 57; the
 * page's home.js to home-picks.js): each row's tiles, or its one line of
 * words where it has none, loaded as the page loads them (the Not played and
 * Random rows kept five minutes, the rest asked for again on each visit) and
 * the place Home was scrolled to, so Back finds it as it was. The app's own
 * rows, Downloaded albums and Music on device, are read from the phone. The
 * screens contract's `home` (HomeScreen.kt draws them); nothing is drawn here.
 */

/** A row of albums as last loaded: its tiles, or its one line ([note]: "Loading…", "No albums.") where it has none. */
internal class RowKept {
    val albums = mutableStateListOf<AlbumSummary>()
    var note by mutableStateOf<String?>(null)
    var at = 0L
}

/** An album on the phone, or on its way ([state] as DownloadStore has it), with the server's own album where it still has it. */
internal class DownloadTile(val id: Int, val state: String, val done: Int, val total: Int, val title: String, val artist: String, val imageKey: String?, val album: AlbumSummary?) {
    /** The badge on a tile not yet whole, as the page words it (home.js downloadBadge); none once downloaded. */
    val badge: String? get() = when (state) { "done" -> null; "away" -> "Card out"; "downloading" -> "↓ $done/$total"; "failed" -> "Failed"; "waiting" -> "Waiting"; else -> "Queued" }
    /** The tile's album: the server's, or the phone's own words for it, under an offset of its own (below any of the library's). */
    val tile: AlbumSummary get() = album ?: AlbumSummary(-1_000_000L - id, title.ifEmpty { "Album" }, artist, imageKey, null, null, null, null)
}

internal object HomeKept {
    /** The Not played and Random rows turn over on a clock: five minutes, as the page's. */
    private const val TTL_MS = 5 * 60 * 1000L
    /** The rows in the page's own order (HOME_ROWS), the app's two first. */
    val ROW_IDS = listOf("phone", "downloads", "unplayed", "later", "playlists", "favourites", "history", "picks", "lotw", "random", "library", "genres")

    /** The rows in the owner's order, each on or off (/api/settings/home-rows), the app's own at the top where the server doesn't know them. */
    val layout = mutableStateListOf<HomeRow>()
    val rows: Map<String, RowKept> = listOf("unplayed", "later", "favourites", "history", "random", "library", "lotw", "downloads", "phone").associateWith { RowKept() }
    val picks = mutableStateListOf<Pick>()
    val playlists = mutableStateListOf<PlaylistTile>()
    var lotwName by mutableStateOf<String?>(null)
    val genres = mutableStateListOf<GenreCard>()
    var genresNote by mutableStateOf<String?>(null)
    /** Today's album, under the greeting; none once it has been played today. */
    var aotd by mutableStateOf<AlbumSummary?>(null)
    /** The phone's own albums by the offset their tiles carry here: Music on device's key, a download's tile. */
    val phoneKeys = HashMap<Long, String>()
    val downloads = HashMap<Long, DownloadTile>()
    /** Where Home is scrolled to, kept for Back; [toTop] asks for its top (Home tapped on the row from another screen). */
    val list = LazyListState()
    var toTop by mutableStateOf(false)
    private var rowsAt = 0L
    private var genresLoaded = false
    private var lotwLoaded = false
    private val serverAlbums = HashMap<Int, AlbumSummary>()

    /** Whether a row hides itself when it has nothing to show (the page's rowHidesWhenEmpty). */
    fun hidesWhenEmpty(id: String) = id in setOf("unplayed", "history", "picks", "lotw", "favourites", "later", "playlists", "phone")

    /** Whether [row] is on: the Downloads row is on while anything is downloaded, whatever the switch said. */
    fun on(row: HomeRow): Boolean = row.unavailable == null && (row.on || (row.id == "downloads" && rows["downloads"]!!.albums.isNotEmpty()))

    /** Every row loaded as the page loads it on a visit: at once from what is kept, the rest behind. */
    fun refresh(scope: CoroutineScope, context: Context, client: ServerClient?, libraryView: String) {
        loadPhone(context)
        if (client == null) return
        val lib = LibraryClient { client.getJson(it) }
        val now = System.currentTimeMillis()
        val ttlFresh = rowsAt > 0 && now - rowsAt < TTL_MS && rows["random"]!!.albums.isNotEmpty()
        if (!ttlFresh) rowsAt = now
        scope.launch { layout(lib) }
        scope.launch { refreshAotd(client) }
        if (!ttlFresh) {
            scope.launch { hidingRow("unplayed", lib) { it.unplayed(6, 30).albums } }
            scope.launch { plainRow("random", lib) { it.randomAlbums(30).albums } }
        }
        scope.launch { hidingRow("later", lib) { it.listenLater().albums } }
        scope.launch { hidingRow("favourites", lib) { it.favourites().albums } }
        scope.launch { hidingRow("history", lib) { it.history(30).albums } }
        scope.launch { plainRow("library", lib) { it.albums(0, 30, libraryView).albums } }
        scope.launch { val got = withContext(Dispatchers.IO) { runCatching { lib.playlists() }.getOrNull() }; if (got != null) { playlists.clear(); playlists.addAll(got) } }
        scope.launch { val got = withContext(Dispatchers.IO) { runCatching { lib.smartPicks().picks }.getOrNull() }; if (got != null && (got.isNotEmpty() || picks.isEmpty())) { picks.clear(); picks.addAll(got) } }
        if (!lotwLoaded) scope.launch { lotw(lib) }
        if (!genresLoaded) scope.launch { genres(lib) }
        scope.launch { loadDownloads(context, client) }
    }

    /** Today's album, as the server says now: gone once played today (a real answer), kept as it was when the server can't say. */
    suspend fun refreshAotd(client: ServerClient) {
        withContext(Dispatchers.IO) { runCatching { LibraryClient { client.getJson(it) }.albumOfTheDay().album } }.onSuccess { aotd = it }
    }

    private suspend fun layout(lib: LibraryClient) {
        val got = withContext(Dispatchers.IO) { runCatching { lib.homeRows() }.getOrNull() }
        val next = (got ?: layout.toList()).toMutableList()
        if (next.isEmpty()) next += ROW_IDS.map { HomeRow(it, true, null) }
        // A row this phone has that the saved layout doesn't know (an older server): at the top, on, as the page does.
        for (id in ROW_IDS.reversed()) if (next.none { it.id == id }) next.add(0, HomeRow(id, true, null))
        layout.clear(); layout.addAll(next)
    }

    /** A row that hides itself when empty: its tiles, or none; what it had kept when the server can't say. */
    private suspend fun hidingRow(id: String, lib: LibraryClient, load: (LibraryClient) -> List<AlbumSummary>) {
        val row = rows[id]!!
        val got = withContext(Dispatchers.IO) { runCatching { load(lib) }.getOrNull() } ?: return
        row.albums.clear(); row.albums.addAll(got); row.at = System.currentTimeMillis()
    }

    /** The Random and Library rows (the page's renderAlbumRow): "Loading…" until the first answer, "No albums." for none, the server's trouble said where there are no tiles to keep. */
    private suspend fun plainRow(id: String, lib: LibraryClient, load: (LibraryClient) -> List<AlbumSummary>) {
        val row = rows[id]!!
        if (row.albums.isEmpty()) row.note = "Loading…"
        val r = withContext(Dispatchers.IO) { runCatching { load(lib) } }
        r.onSuccess { got ->
            if (got.isNotEmpty() || row.albums.isEmpty()) { row.albums.clear(); row.albums.addAll(got); row.note = if (got.isEmpty()) "No albums." else null; row.at = System.currentTimeMillis() }
        }.onFailure { e ->
            if (row.albums.isEmpty()) row.note = if (e is ServerClient.ServerException && e.status == 503) "Reading your music library…" else "Couldn’t load."
        }
    }

    private suspend fun lotw(lib: LibraryClient) {
        val row = rows["lotw"]!!
        if (row.albums.isEmpty()) row.note = "Loading…"
        val got = withContext(Dispatchers.IO) { runCatching { lib.labelOfTheWeek() }.getOrNull() }
        if (got?.label != null && got.albums.isNotEmpty()) { lotwName = got.label; row.albums.clear(); row.albums.addAll(got.albums); row.note = null; lotwLoaded = true }
        else if (row.albums.isEmpty()) row.note = null   // nothing yet: the row stays hidden, and is asked again next visit
    }

    private suspend fun genres(lib: LibraryClient) {
        if (genres.isEmpty()) genresNote = "Loading…"
        val r = withContext(Dispatchers.IO) { runCatching { lib.genreCards() } }
        r.onSuccess { cards ->
            if (cards.isNotEmpty()) { genres.clear(); genres.addAll(cards); genresNote = null; genresLoaded = true }
            else if (genres.isEmpty()) genresNote = "No genres found."
        }.onFailure { e -> if (genres.isEmpty()) genresNote = if (e is ServerClient.ServerException && e.status == 503) "Reading your music library…" else "Couldn’t load genres." }
    }

    /** Music on device (the page's loadHomeLocal): the phone's own albums, from its index. */
    fun loadPhone(context: Context) {
        LocalMusic.load(context)
        val row = rows["phone"]!!
        val list = LocalMusic.albums.mapIndexed { i, a -> AlbumSummary(-1L - i, a.title, a.artist, if (a.art != null) "phone-${a.key}" else null, LocalMusic.quality(a), a.year, null, "local", hires = LocalMusic.hires(a)) }
        phoneKeys.clear()
        LocalMusic.albums.forEachIndexed { i, a -> phoneKeys[-1L - i] = a.key }
        row.albums.clear(); row.albums.addAll(list)
        row.note = if (list.isNotEmpty()) null else {
            val folder = Store.localFolder(context)
            if (folder == null) "Choose a folder of music on this phone in Settings → Music Folders."
            else if (LocalMusic.scanning) "Reading the folder…" else "Nothing in “" + (LocalMusic.folderName(context) ?: "Folder") + "” yet."
        }
    }

    /** Downloaded albums (the page's loadHomeDownloads): every album on the phone or on its way, the server's own album where it has it. */
    suspend fun loadDownloads(context: Context, client: ServerClient) {
        val row = rows["downloads"]!!
        val list = withContext(Dispatchers.IO) { DownloadTiles.list(context) }
        if (list.isEmpty()) { row.albums.clear(); downloads.clear(); row.note = "Nothing downloaded yet — on an album, ⋯ → Download to this phone."; return }
        if (row.albums.isEmpty()) row.note = "Loading…"
        val missing = list.map { it.id }.filter { it !in serverAlbums }
        if (missing.isNotEmpty()) withContext(Dispatchers.IO) { runCatching { client.downloadAlbums(missing) }.getOrNull() }?.forEach { d -> d.album?.let { serverAlbums[d.id] = it } }
        val tiles = list.map { if (it.state == "away") it else DownloadTile(it.id, it.state, it.done, it.total, it.title, it.artist, it.imageKey, serverAlbums[it.id]) }
        downloads.clear()
        for (t in tiles) downloads[t.tile.offset] = t
        row.albums.clear(); row.albums.addAll(tiles.map { it.tile }); row.note = null
    }
}

/** The phone's downloads as the page's bridge lists them (DownloadsBridge.all): each album, and those away on a card that is out. */
internal object DownloadTiles {
    fun list(c: Context): List<DownloadTile> {
        val out = ArrayList<DownloadTile>()
        for ((a, _) in DownloadAlbums.list(c)) out += DownloadTile(a.id, a.state, a.doneCount, a.tracks.size, a.title, a.artist, a.imageKey, null)
        val away = DownloadStore.awayAlbums(c)
        for (i in 0 until away.length()) {
            val o = away.getJSONObject(i)
            out += DownloadTile(o.optInt("id"), "away", o.optInt("total"), o.optInt("total"), o.optString("title"), o.optString("artist"), o.optString("image_key").ifEmpty { null }, null)
        }
        return out
    }

    /** A downloaded album the library no longer has: played from the phone (the page's DL.play). */
    fun play(c: Context, albumId: Int) {
        c.startService(Intent(c, PhonePlayerService::class.java).setAction(PhonePlayerService.ACTION_PLAY_LOCAL)
            .putExtra(PhonePlayerService.EXTRA_ALBUM, albumId).putExtra(PhonePlayerService.EXTRA_INDEX, 0))
    }
}
