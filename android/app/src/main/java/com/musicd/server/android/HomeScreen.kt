package com.musicd.server.android

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.NavItem
import com.musicd.server.client.NavList
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Home, natively (stage N5 of docs/specs/plan-android-native.md, bug list
 * item 57; a preview: Settings → Setup → UI Settings), drawn as the page's
 * (docs/specs/screens.json, home; style.css in the hifi palette): the
 * greeting with the date over it, the strip under it (Random Album with its
 * turning disc, today's album with ★ Today), then the rows in the owner's
 * order and visibility (/api/settings/home-rows), each a small brass heading
 * that opens its wall over its tiles scrolling sideways, Smart Picks' cards,
 * the label of the week, the genre cards two to a row, and the app's own
 * two rows (Downloaded albums, Music on device) from the phone; the mini
 * player and the row along the foot. Its rows are kept (HomeKept) and asked
 * for again on each visit, and Back from a wall or an album finds it as it was.
 */
@Composable
internal fun HomeScreen(prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onAlbum: (Long, String, NavList) -> Unit, onWall: (String, String) -> Unit, onLibrary: () -> Unit, onPicks: () -> Unit,
                        onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember(zoneId) { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    val coverPx = homeCoverPx(prefs)
    val spin = remember { DiscSpin() }
    var picked by remember { mutableStateOf<AlbumSummary?>(null) }
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    LaunchedEffect(spin) { spin.run() }
    // Each time Home comes on screen, its rows as the page loads them on a visit; today's album asked for every minute while it stays.
    LaunchedEffect(Unit) {
        HomeKept.refresh(scope, context, client(), NativeShell.libraryView)
        while (true) { delay(60_000); client()?.let { HomeKept.refreshAotd(it) } }
    }
    // One of the page's own screens over Home has closed (Settings → Home Screen, Playlists, a label): the rows asked for again, as the page's showHome does.
    val pageFront by NativeShell.pageFront
    var wasFront by remember { mutableStateOf(pageFront) }
    LaunchedEffect(pageFront) { if (wasFront && !pageFront) HomeKept.refresh(scope, context, client(), NativeShell.libraryView); wasFront = pageFront }
    LaunchedEffect(HomeKept.toTop) { if (HomeKept.toTop) { HomeKept.list.scrollToItem(0); HomeKept.toTop = false } }
    // Random Album (the page's playUnheard): the disc turns fast for two seconds, then the album chosen is offered.
    fun randomAlbum() {
        if (spin.finding) return
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Select a zone first"); return }
        spin.start()
        scope.launch {
            delay(2000)
            val r = withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.pickUnheard().album } }
            spin.stop()
            r.onSuccess { picked = it }.onFailure { toast(it.message ?: "Could not choose an album") }
        }
    }
    // A tile tapped: the album's page over Home with its row as the list; one of the phone's own, the page's own page of it; a download the library no longer has, played from the phone.
    fun open(albums: List<AlbumSummary>, i: Int) {
        val a = albums[i]
        HomeKept.phoneKeys[a.offset]?.let { onPage("phone-album", it); return }
        HomeKept.phoneDownload(a.offset)?.let { d ->
            if (d.state == "away") toast("On a card that isn’t in right now")
            else { DownloadTiles.play(context, d.id); toast("Not in the library right now — playing from this phone") }
            return
        }
        val items = albums.filter { it.offset >= 0 }
        onAlbum(a.offset, zone, NavList(items.map { NavItem(it.offset, it.title) }, items.indexOfFirst { it.offset == a.offset }))
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyColumn(Modifier.fillMaxSize(), state = HomeKept.list, contentPadding = PaddingValues(top = 14.dp, bottom = 164.dp)) {
            // The page's notices (the server's, the update offer; item 69), at Home's head as on the page's.
            item("notices") { NoticeBanners(prefs.menu, client) { what, arg -> NativeShell.toPage(what, arg) } }
            if (prefs.greeting) item("greeting") { Greeting() }
            // The strip under the greeting: Random Album, then today's album; gone with both.
            val aotd = HomeKept.aotd
            if (prefs.random || aotd != null) item("today") {
                Column {
                    LazyRow(Modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (prefs.random) item("random") { RandomAlbumTile(prefs, spin, ::randomAlbum) }
                        if (aotd != null) item("aotd") { Box(Modifier.width((144 * prefs.tile).dp)) { AlbumTile(aotd, prefs, coverPx, client, badge = "★ Today") { open(listOf(aotd), 0) } } }
                    }
                    Spacer(Modifier.height(50.dp))
                }
            }
            for (row in HomeKept.layout) {
                if (!HomeKept.on(row)) continue
                when (row.id) {
                    "picks" -> if (HomeKept.picks.isNotEmpty()) item(row.id) {
                        Column {
                            SectionTitle(Modifier.parity("home.picks-title", Contract.label("home.picks-title")).clickable(onClick = onPicks), "Smart Picks", true)
                            // A pick the library has opens as any album; one it doesn't opens Smart Picks, where Add and the reason live.
                            Carousel(HomeKept.picks, key = { it.artist + "|" + it.album }) { _, p ->
                                PickCardHome(p, prefs, client) { p.inLibrary?.let { open(listOf(it), 0) } ?: onPicks() }
                            }
                            Spacer(Modifier.height(50.dp))
                        }
                    }
                    "playlists" -> if (HomeKept.playlists.isNotEmpty()) item(row.id) {
                        Column {
                            SectionTitle(Modifier.parity("home.playlists-title", Contract.label("home.playlists-title")).clickable { onPage("playlists", null) }, "Playlists", true)
                            Carousel(HomeKept.playlists, key = { (if (it.smart) "s" else "m") + it.id }) { _, p ->
                                PlaylistTileView(p, prefs, coverPx, client) { onPage(if (p.smart) "smart-playlist" else "playlist", p.id) }
                            }
                            Spacer(Modifier.height(50.dp))
                        }
                    }
                    "genres" -> item(row.id) {
                        Column {
                            SectionTitle(Modifier.parity("home.genres-title"), "Browse by genre", false)
                            if (HomeKept.genres.isEmpty()) HomeKept.genresNote?.let { RowNote(it) }
                            else GenreGrid(HomeKept.genres) { card -> val f = card.filter(); onWall("genre", com.musicd.server.client.WallFilter.routeQuery(f)) }
                            Spacer(Modifier.height(32.dp))
                        }
                    }
                    "lotw" -> HomeKept.lotwName?.let { name -> if (HomeKept.rows["lotw"]!!.albums.isNotEmpty()) item(row.id) {
                        Column {
                            SectionTitle(Modifier.parity("home.lotw-title", Contract.label("home.lotw-title", 0, name)).clickable { onWall("label", name) }, "Label of the week", true, name)
                            AlbumRowItems(HomeKept.rows["lotw"]!!, prefs, coverPx, client, onOpen = { list, i -> open(list, i) })
                        }
                    } }
                    else -> {
                        val kept = HomeKept.rows[row.id] ?: continue
                        if (HomeKept.hidesWhenEmpty(row.id) && kept.albums.isEmpty()) continue
                        item(row.id) {
                            Column {
                                when (row.id) {
                                    "unplayed" -> SectionTitle(Modifier.parity("home.unplayed-title", Contract.label("home.unplayed-title")).clickable { onWall("unplayed", "") }, "Not played in 6 months", true)
                                    "later" -> SectionTitle(Modifier.parity("home.later-title", Contract.label("home.later-title")).clickable { onWall("later", "") }, "Listen later", true)
                                    "favourites" -> SectionTitle(Modifier.parity("home.favourites-title", Contract.label("home.favourites-title")).clickable { onWall("favourites", "") }, "Favourites", true)
                                    "history" -> SectionTitle(Modifier.parity("home.history-title", Contract.label("home.history-title")).clickable { onWall("history", "") }, "Recently played", true)
                                    "random" -> SectionTitle(Modifier.parity("home.random-title", Contract.label("home.random-title")).clickable { onWall("random", "") }, "Random albums", true)
                                    "library" -> SectionTitle(Modifier.parity("home.library-title", Contract.label("home.library-title")).clickable(onClick = onLibrary), "Library", true)
                                    "downloads" -> SectionTitle(Modifier.parity("home.downloads-title", Contract.label("home.downloads-title")).clickable { onWall("downloads", "") }, "Downloaded albums", true)
                                    "phone" -> SectionTitle(Modifier.parity("home.phone-title", Contract.label("home.phone-title")).clickable { onWall("phone", "") }, "Music on device", true)
                                }
                                AlbumRowItems(kept, prefs, coverPx, client, badges = row.id == "downloads", onOpen = { list, i -> open(list, i) })
                            }
                        }
                    }
                }
            }
        }
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
            // Home, tapped where it is already: its top, as the page's row does.
            TouchNav("home", offline = Store.offlineMode(context), onTap = { what -> if (what == "home") scope.launch { HomeKept.list.animateScrollToItem(0) } else onNav(what) })
        }
        picked?.let { RandomPickDialog(it, zone, client, onClose = { picked = null }) }
    }
}

/** The greeting (the page's paintGreeting; style.css .home-greeting in the hifi palette): the date in small brass capitals, the time of day in the serif under it. */
@Composable
private fun Greeting() {
    var now by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = Date() } }
    val hour = Calendar.getInstance().also { it.time = now }.get(Calendar.HOUR_OF_DAY)
    val words = if (hour < 12) "Good morning" else if (hour < 18) "Good afternoon" else "Good evening"
    // The weekday, the day and the month in the phone's own order ("Monday, October 19"; "Monday 19 October"), as the page's toLocaleDateString.
    val locale = Locale.getDefault()
    val date = SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, "EEEEMMMMd"), locale).format(now)
    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 6.dp, bottom = 26.dp)) {
        Text(date.uppercase(locale), Modifier.parity("home.greeting-date"), color = MaterialTheme.colorScheme.secondary, fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.W700, letterSpacing = 0.18.em)
        Text(words, Modifier.parity("home.greeting").padding(top = 6.dp).lineBox(34.sp, 37.4.sp, Face.YOUNG_SERIF), color = MaterialTheme.colorScheme.onSurface, fontFamily = youngSerif, fontWeight = FontWeight.W400,
            fontSize = 34.sp, lineHeight = 37.4.sp, letterSpacing = 0.01.em)
    }
}

/**
 * A row's heading (the hifi .home-section-title): small brass capitals, with "›" at its end where it opens a wall
 * ([link]), 14 under it; the label of the week's [name] large in the serif beside it, the two on one foot.
 */
@Composable
private fun SectionTitle(modifier: Modifier, text: String, link: Boolean, name: String? = null) {
    Row(modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 14.dp).then(if (name == null) Modifier.height(if (link) 20.dp else 17.dp) else Modifier),
        verticalAlignment = if (name == null) Alignment.CenterVertically else Alignment.Bottom) {
        Text(text.uppercase(), color = MaterialTheme.colorScheme.secondary, fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.W700, letterSpacing = 0.18.em)
        if (name != null) Text(name, Modifier.parity("home.lotw-name").padding(start = 6.dp, top = 5.dp).lineBox(24.sp, 27.6.sp, Face.YOUNG_SERIF), color = MaterialTheme.colorScheme.onSurface,
            fontFamily = youngSerif, fontWeight = FontWeight.W400, fontSize = 24.sp, lineHeight = 27.6.sp)
        if (link) { Spacer(Modifier.weight(1f)); Text("›", Modifier.lineBox(20.sp, 20.sp), color = MaterialTheme.colorScheme.onSurface, fontSize = 20.sp, lineHeight = 20.sp) }
    }
}

/**
 * A row's tiles (an album each, with a download's badge on the app's own row alone, [badges]), or its one line where it has
 * none; the page's 18 under the row and 32 under the section. A tile tapped opens with the row as it was drawn ([onOpen]).
 */
@Composable
private fun AlbumRowItems(row: RowKept, prefs: WallPrefs, coverPx: Int, client: () -> ServerClient?, badges: Boolean = false, onOpen: (List<AlbumSummary>, Int) -> Unit) {
    val albums = row.albums.toList()
    if (albums.isEmpty()) row.note?.let { RowNote(it) }
    else Carousel(albums, key = { it.offset }) { i, a ->
        Box(Modifier.width((144 * prefs.tile).dp)) { AlbumTile(a, prefs, coverPx, client, dl = if (badges) HomeKept.downloads[a.offset]?.badge else null) { onOpen(albums, i) } }
    }
    Spacer(Modifier.height(50.dp))
}
