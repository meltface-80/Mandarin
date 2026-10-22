package com.musicd.server.android

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
import com.musicd.server.client.ArtistAlbums
import com.musicd.server.client.ArtistAbout
import com.musicd.server.client.ArtistBio
import com.musicd.server.client.ArtistSimilar
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
 * (ArtistHero: their picture, what they are, their links, the biography, a band's members or a person's bands);
 * their own albums and, each under its own small heading, those they appear on and those they are credited on; the mini player and the row along the foot. A tile opens the album's page over it
 * with the page's albums as its list; a long press starts selecting.
 */
@Composable
internal fun ArtistScreen(name: String, prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onAlbum: (Long, String, NavList) -> Unit,
                          onArtist: (String) -> Unit, onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    var albums by remember(name) { mutableStateOf<ArtistAlbums?>(null) }
    var bio by remember(name) { mutableStateOf<ArtistBio?>(null) }
    var about by remember(name) { mutableStateOf<ArtistAbout?>(null) }
    var similar by remember(name) { mutableStateOf<ArtistSimilar?>(null) }
    var failed by remember(name) { mutableStateOf<String?>(null) }
    var selecting by remember { mutableStateOf(false) }
    var picks by remember { mutableStateOf<List<AlbumSummary>>(emptyList()) }
    val (cols, coverPx) = wallColumns(prefs)
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    BackHandler { if (selecting) { selecting = false; picks = emptyList() } else onBack() }
    LaunchedEffect(name) {
        val c = client() ?: return@LaunchedEffect
        val lib = LibraryClient { c.getJson(it) }
        // Asked again a few times when the server isn't reached (a dropped connection, the server restarting; item 133).
        var got = withContext(Dispatchers.IO) { runCatching { lib.artistAlbums(name) } }
        var tries = 0
        while (got.isFailure && tries < 3 && got.exceptionOrNull()?.let(Failure::unreachable) == true) {
            delay(Retry.ms(++tries))
            got = withContext(Dispatchers.IO) { runCatching { lib.artistAlbums(name) } }
        }
        got.onSuccess { albums = it }.onFailure { failed = Failure.said(it, "no answer") }
        // The head after the albums, so the grid never waits on another service; one of their own albums pins the lookup.
        // Who they are (item 131) alongside: the server may look them up there and then, for a few seconds.
        val a = albums
        val pin = (a?.primary?.firstOrNull() ?: a?.featured?.firstOrNull())?.title ?: ""
        coroutineScope {
            launch { about = withContext(Dispatchers.IO) { runCatching { lib.artistAbout(name) }.getOrNull() } }
            launch { similar = withContext(Dispatchers.IO) { runCatching { lib.artistSimilar(name) }.getOrNull() } }   // item 137
            if (a != null) launch { bio = withContext(Dispatchers.IO) { runCatching { lib.artistBio(name, pin) }.getOrNull() } }
        }
    }
    // Their bands' albums from their years in them (item 133), then those they are credited on beyond all of these,
    // each saying as what (item 131).
    val bands = about?.bandAlbums.orEmpty()
    val shown = ((albums?.primary ?: emptyList()) + (albums?.featured ?: emptyList()) + bands.flatMap { it.albums }).map { it.offset }.toSet()
    val credited = about?.creditedBeyond(shown)?.map { c -> c.album.copy(subtitle = listOf(c.album.subtitle, c.roles.joinToString(", ")).filter { it.isNotEmpty() }.joinToString(" · ")) } ?: emptyList()
    val all = (albums?.primary ?: emptyList()) + (albums?.featured ?: emptyList()) + bands.flatMap { it.albums } + credited
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
        if (a.primary.isNotEmpty()) GridBlock(if (a.featured.isNotEmpty() || bands.isNotEmpty() || credited.isNotEmpty()) "Albums" else null, a.primary) else null,
        if (a.featured.isNotEmpty()) GridBlock("Also appears on", a.featured) else null
    ) + bands.map { GridBlock("With ${it.band}", it.albums) } + listOfNotNull(if (credited.isNotEmpty()) GridBlock("Credited on", credited) else null)

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        AlbumGrid(blocks, prefs, cols, coverPx, client, loaded = albums != null || failed != null, picks.map { it.offset }.toSet(), grid, list,
            onOpen = ::open, onLongPress = { i -> if (!selecting) { selecting = true; pick(i) } }) {
            // The name at once; the count when the albums come. An error as the page has it, in red under the heading.
            val n = (a?.primary?.size ?: 0) + (a?.featured?.size ?: 0) + bands.sumOf { it.albums.size }
            WallHead(if (a == null) name else "$n album" + (if (n == 1) "" else "s") + " · $name", prefs, failed?.let { "Error: $it" to true })
            if (about != null || bio != null || similar?.artists?.isNotEmpty() == true) ArtistHero(about, bio, similar, client, onArtist)
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
