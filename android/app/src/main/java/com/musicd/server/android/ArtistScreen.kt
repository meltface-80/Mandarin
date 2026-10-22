package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.PlaylistAdd
import com.musicd.server.client.Retry
import com.musicd.server.client.Failure
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.NavItem
import com.musicd.server.client.NavList
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * An artist's page, natively (plan L4, bug list item 52; rebuilt in item 131; the page's artist-view.js and
 * artist-about.js): the count and the name as the heading once the albums come; who they are over the albums
 * (ArtistHero: their picture, what they are, their links, the biography, a band's members or a person's bands, folded);
 * then, each under its own small heading, their discography, the albums they appear on, their bands' and those they are
 * credited on; then similar artists and similar albums (ArtistFoot, item 140); the mini player and the row along the
 * foot. A tile opens the album's page over it with the page's albums as its list; a long press starts selecting. A page
 * opened again is drawn at once from what it last had (ArtistPages), and asked for afresh once that is old.
 */
@Composable
internal fun ArtistScreen(name: String, prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onAlbum: (Long, String, NavList) -> Unit,
                          onArtist: (String) -> Unit, onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    val key = ArtistPages.key(name)
    val kept = remember(name) { ArtistPages.kept.get(key) }
    var albums by remember(name) { mutableStateOf(kept?.albums) }
    var bio by remember(name) { mutableStateOf(kept?.bio) }
    var about by remember(name) { mutableStateOf(kept?.about) }
    var similar by remember(name) { mutableStateOf(kept?.similar) }
    var similarAlbums by remember(name) { mutableStateOf(kept?.similarAlbums.orEmpty()) }
    fun keep(change: (ArtistPage) -> ArtistPage) = ArtistPages.kept.update(key, ArtistPage(), change)
    var failed by remember(name) { mutableStateOf<String?>(null) }
    var selecting by remember { mutableStateOf(false) }
    var picks by remember { mutableStateOf<List<AlbumSummary>>(emptyList()) }
    val (cols, coverPx) = wallColumns(prefs)
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    BackHandler { if (selecting) { selecting = false; picks = emptyList() } else onBack() }
    LaunchedEffect(name) {
        if (kept?.albums != null && ArtistPages.kept.fresh(key)) return@LaunchedEffect   // as it was, and recent: nothing to ask
        val c = client() ?: return@LaunchedEffect
        val lib = LibraryClient { c.getJson(it) }
        // Asked again a few times when the server isn't reached (a dropped connection, the server restarting; item 133).
        var got = withContext(Dispatchers.IO) { runCatching { lib.artistAlbums(name) } }
        var tries = 0
        while (got.isFailure && tries < 3 && got.exceptionOrNull()?.let(Failure::unreachable) == true) {
            delay(Retry.ms(++tries))
            got = withContext(Dispatchers.IO) { runCatching { lib.artistAlbums(name) } }
        }
        // Asked afresh: kept from now, the rest of what was kept drawn until its answer replaces it.
        got.onSuccess { albums = it; ArtistPages.kept.put(key, (ArtistPages.kept.get(key) ?: ArtistPage()).copy(albums = it)) }
            .onFailure { if (albums == null) failed = Failure.said(it, "no answer") }
        // The head after the albums, so the grid never waits on another service; one of their own albums pins the lookup.
        // Who they are (item 131) alongside: the server may look them up there and then, for a few seconds.
        val a = albums
        val pin = (a?.primary?.firstOrNull() ?: a?.featured?.firstOrNull())?.title ?: ""
        coroutineScope {
            launch { withContext(Dispatchers.IO) { runCatching { lib.artistAbout(name) }.getOrNull() }?.let { got -> about = got; keep { it.copy(about = got) } } }
            launch { withContext(Dispatchers.IO) { runCatching { lib.artistSimilar(name) }.getOrNull() }?.let { got -> similar = got; keep { it.copy(similar = got) } } }   // item 137
            launch {   // item 140
                withContext(Dispatchers.IO) { runCatching { lib.artistSimilarAlbums(name) }.getOrNull() }?.takeIf { it.error == null }?.albums?.let { got -> similarAlbums = got; keep { it.copy(similarAlbums = got) } }
            }
            if (a != null) launch { withContext(Dispatchers.IO) { runCatching { lib.artistBio(name, pin) }.getOrNull() }?.let { got -> bio = got; keep { it.copy(bio = got) } } }
        }
    }
    // Their bands' albums from their years in them (item 133), then those they are credited on beyond all of these,
    // each saying as what (item 131).
    val bands = about?.bandAlbums.orEmpty()
    val shown = ((albums?.primary ?: emptyList()) + (albums?.featured ?: emptyList()) + bands.flatMap { it.albums }).map { it.offset }.toSet()
    val credited = about?.creditedBeyond(shown)?.map { c -> c.album.copy(subtitle = listOf(c.album.subtitle, c.roles.joinToString(", ")).filter { it.isNotEmpty() }.joinToString(" · ")) } ?: emptyList()
    val all = (albums?.primary ?: emptyList()) + (albums?.featured ?: emptyList()) + bands.flatMap { it.albums } + credited
    // What Play and Shuffle play (item 138): their own albums and their bands', else those they appear on.
    val playable = ((albums?.primary ?: emptyList()) + bands.flatMap { it.albums }).ifEmpty { albums?.featured ?: emptyList() }
    fun playArtist(kind: String) {
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Pick a zone first"); return }
        val made = ServerWrites.write { selectAct(c, playable, zone, room.zoneName, kind) }
        scope.launch { toast(ServerWrites.await(made).getOrElse { it.message ?: "Couldn't reach the server" }) }
    }
    val grid = rememberLazyGridState()
    val list = rememberLazyListState()
    fun pick(i: Int) { val a = all[i]; picks = if (picks.any { it.offset == a.offset }) picks.filter { it.offset != a.offset } else picks + a }
    fun open(i: Int) { if (selecting) { pick(i); return }; val a = all[i]; onAlbum(a.offset, zone, NavList(all.map { NavItem(it.offset, it.title) }, i)) }
    fun act(what: String) {
        val chosen = picks
        when (what) {
            "clear" -> { selecting = false; picks = emptyList() }
            "playlist" -> { selecting = false; picks = emptyList(); PlaylistAddAsk.ask(PlaylistAdd.albums(chosen)) }
            else -> {
                val c = client() ?: return
                if (what != "later" && zone.isEmpty()) { toast("Pick a zone first"); return }
                val made = ServerWrites.write { selectAct(c, chosen, zone, room.zoneName, what) }   // Listen later before Home reads (item 85)
                scope.launch { toast(ServerWrites.await(made).getOrElse { it.message ?: "Couldn't reach the server" }); selecting = false; picks = emptyList() }
            }
        }
    }
    val a = albums
    val blocks = if (a == null) emptyList() else listOfNotNull(
        if (a.primary.isNotEmpty()) GridBlock("Discography", a.primary) else null,
        if (a.featured.isNotEmpty()) GridBlock("Appears on", a.featured) else null
    ) + bands.map { GridBlock("With ${it.band}", it.albums) } + listOfNotNull(if (credited.isNotEmpty()) GridBlock("Credited on", credited) else null)

    // A similar album of the library's opens with those of the library's as its list; one it hasn't, its Last.fm page.
    fun openSimilar(i: Int) {
        val al = similarAlbums.getOrNull(i)?.album ?: return
        val own = similarAlbums.mapNotNull { it.album }
        onAlbum(al.offset, zone, NavList(own.map { NavItem(it.offset, it.title) }, own.indexOfFirst { it.offset == al.offset }))
    }
    fun openUrl(url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        AlbumGrid(blocks, prefs, cols, coverPx, client, loaded = albums != null || failed != null, picks.map { it.offset }.toSet(), grid, list,
            onOpen = ::open, onLongPress = { i -> if (!selecting) { selecting = true; pick(i) } },
            foot = { ArtistFoot(similar, similarAlbums, client, onArtist, onAlbum = ::openSimilar, onUrl = ::openUrl) }) {
            // The name at once; the count when the albums come. An error as the page has it, in red under the heading.
            val n = (a?.primary?.size ?: 0) + (a?.featured?.size ?: 0) + bands.sumOf { it.albums.size }
            WallHead(if (a == null) name else "$n album" + (if (n == 1) "" else "s") + " · $name", prefs, failed?.let { "Error: $it" to true })
            if (about != null || bio != null || playable.isNotEmpty())
                ArtistHero(about, bio, client, onArtist, onPlay = if (playable.isNotEmpty()) ::playArtist else null, onGenre = { onPage("genre", it) },
                    kept = kept?.portrait, onPortrait = { p -> keep { it.copy(portrait = p) } })
            if (a != null && n == 0 && credited.isEmpty() && failed == null) Text("No albums found for \"$name\"", Modifier.parity("artist.empty").fillMaxWidth().padding(vertical = 48.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp, lineHeight = 20.5.sp, textAlign = TextAlign.Center)
        }
        WallBack(onBack)
        if (picks.isNotEmpty()) AlbumSelectMenu(picks.size, ::act, Modifier.align(Alignment.TopEnd).padding(end = 14.dp, top = 12.dp))
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
            if (selecting && picks.isEmpty()) SelectBar(onCancel = { selecting = false })
            else TouchNav("", onTap = onNav)
        }
    }
}
