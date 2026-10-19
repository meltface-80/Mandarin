package com.musicd.server.android

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.NavItem
import com.musicd.server.client.NavList
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The walls Home links to, natively (plan L5, bug list item 52; the page's walls.js and loadRandom): Listen
 * later, Favourites, Recently played, Not played in 6 months, and Random albums with its reshuffle, each the
 * heading at the top and the albums under it, the banner where there is nothing or the library can't be read,
 * the mini player and the row along the foot; a tile opens the album's page over it with the wall as its list,
 * a long press starts selecting. What a wall showed is kept while the app runs, so Back finds it as it was.
 */
@Composable
internal fun WallScreen(kind: String, prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onAlbum: (Long, String, NavList) -> Unit,
                        onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val wall = remember(kind) { Walls.state(kind) }
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    var selecting by remember { mutableStateOf(false) }
    var picks by remember { mutableStateOf<List<AlbumSummary>>(emptyList()) }
    val (cols, coverPx) = wallColumns(prefs)
    val randomCount = randomWallCount(prefs)
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    BackHandler { if (selecting) { selecting = false; picks = emptyList() } else onBack() }
    fun load() { val c = client() ?: return; scope.launch { wall.load(c, randomCount) } }
    LaunchedEffect(wall) { if (!wall.loaded) load() }
    val grid = rememberLazyGridState()
    val list = rememberLazyListState()
    fun pick(i: Int) { val a = wall.albums[i]; picks = if (picks.any { it.offset == a.offset }) picks.filter { it.offset != a.offset } else picks + a }
    fun open(i: Int) { if (selecting) { pick(i); return }; val a = wall.albums[i]; onAlbum(a.offset, zone, NavList(wall.albums.map { NavItem(it.offset, it.title) }, i)) }
    fun act(what: String) {
        val chosen = picks
        when (what) {
            "clear" -> { selecting = false; picks = emptyList() }
            "playlist" -> { selecting = false; picks = emptyList(); onPage("albums-playlist", picksJson(chosen)) }
            else -> {
                val c = client() ?: return
                if (what != "later" && zone.isEmpty()) { toast("Pick a zone first"); return }
                scope.launch { toast(withContext(Dispatchers.IO) { runCatching { selectAct(c, chosen, zone, room.zoneName, what) }.getOrElse { it.message ?: "Couldn't reach the server" } }); selecting = false; picks = emptyList() }
            }
        }
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        AlbumGrid(listOf(GridBlock(null, wall.albums)), prefs, cols, coverPx, client, wall.loaded, picks.map { it.offset }.toSet(), grid, list,
            onOpen = ::open, onLongPress = { i -> if (!selecting) { selecting = true; pick(i) } }) { WallHead(Walls.title(kind), prefs, wall.banner) }
        WallBack(onBack)
        // Top right: the ⋯ while albums are picked; the random wall's reshuffle otherwise (the bar's button).
        if (picks.isNotEmpty()) AlbumSelectMenu(picks.size, ::act, Modifier.align(Alignment.TopEnd).padding(end = 14.dp, top = 12.dp))
        else if (kind == "random") FilledIconButton(onClick = { wall.loaded = false; load() }, enabled = wall.loaded, colors = barDisc(),
            modifier = Modifier.parity("wall.reshuffle", Contract.label("wall.reshuffle")).align(Alignment.TopEnd).padding(end = 14.dp, top = 12.dp).size(40.dp)) {
            Icon(painterResource(R.drawable.tn_reshuffle), contentDescription = null, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
            if (selecting && picks.isEmpty()) SelectBar(onCancel = { selecting = false })
            else TouchNav("", offline = Store.offlineMode(context), onTap = onNav)
        }
    }
}

/** A wall as loaded, kept while the app runs (random albums until reshuffled). */
internal class WallKept(val kind: String) {
    val albums = androidx.compose.runtime.mutableStateListOf<AlbumSummary>()
    var loaded by mutableStateOf(false)
    var banner by mutableStateOf<Pair<String, Boolean>?>(null)

    /** The wall's albums from [client] ([randomCount] of them for the random wall), and the banner as the page says it. */
    suspend fun load(client: ServerClient, randomCount: Int) {
        val lib = LibraryClient { client.getJson(it) }
        val r = withContext(Dispatchers.IO) { runCatching {
            when (kind) {
                "later" -> lib.listenLater().albums to "Nothing put aside — on an album, ⋯ → Listen later. An album comes off here once you’ve played it through."
                "favourites" -> lib.favourites().albums to "No favourites yet — tap the heart on an album."
                "history" -> lib.history(60).albums to "Nothing played in the last 30 days."
                "unplayed" -> lib.unplayed(6, 96).let { u ->
                    // Six months of listening first: before that, every album is "not played".
                    val from = u.readyAt?.let { " — from " + DateFormat.getDateInstance(DateFormat.LONG).format(Date(it)) } ?: ""
                    u.albums to (if (u.noHistory) "Albums show here once Mandarin has six months of listening behind it$from." else "Nothing here yet — play some music and check back.")
                }
                else -> lib.randomAlbums(randomCount).albums to "No albums were returned. Is your library indexed?"
            }
        } }
        r.onSuccess { (list, empty) -> albums.clear(); albums.addAll(list); banner = if (list.isEmpty()) empty to (kind == "random") else null }
            .onFailure { e -> albums.clear(); banner = (if (e is ServerClient.ServerException && e.status == 503) (e.message?.takeIf { !it.startsWith("HTTP") } ?: "Reading your music library…") else "Couldn’t load: " + (e.message ?: "no answer")) to true }
        loaded = true
    }
}

/** The walls held: one of each kind opened. */
internal object Walls {
    private val kept = HashMap<String, WallKept>()
    @Synchronized fun state(kind: String): WallKept = kept.getOrPut(kind) { WallKept(kind) }

    /** The wall's heading, as the page's. */
    fun title(kind: String): String = when (kind) {
        "later" -> "Listen later"; "favourites" -> "Favourites"; "history" -> "Recently played"; "unplayed" -> "Not played in 6 months"; else -> "Random albums"
    }
}
