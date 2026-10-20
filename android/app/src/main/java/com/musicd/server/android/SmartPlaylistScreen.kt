package com.musicd.server.android

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.NavItem
import com.musicd.server.client.NavList
import com.musicd.server.client.Palette
import com.musicd.server.client.PlaylistTrack
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SmartPlaylist
import com.musicd.server.client.SmartTracks
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A Dynamic Playlist, natively (the Playlists group of docs/specs/plan-android-native.md, P3; bug list item 66), drawn as
 * the page's (docs/specs/screens.json, smart-playlist; smart-playlist.js): the bar's Back to Home, ← Dynamic Playlists, its
 * name over its hairline and what it is made of, its order and its view, Play now, Queue and ⋯ (Share and Edit, the page's
 * sheets over this screen; Delete, asked first); then, made of albums, its albums as tiles of the wall; made of tracks, its
 * tracks numbered with their covers, read a few albums at a time with Load more; and the line saying how many.
 */
@Composable
internal fun SmartPlaylistScreen(id: String, prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onHome: () -> Unit,
                                 onAlbum: (Long, String, NavList) -> Unit, onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit,
                                 onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    val (cols, coverPx) = wallColumns(prefs)
    var sp by remember { mutableStateOf<SmartPlaylist?>(null) }
    val tracks = remember { mutableStateListOf<PlaylistTrack>() }
    var albums by remember { mutableStateOf<List<AlbumSummary>>(emptyList()) }
    var status by remember { mutableStateOf("") }
    var read by remember { mutableStateOf(0) }
    var done by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val sheets by NativeShell.sheetsClosed
    // Edit's and Share's sheets, the app's own (item 95); a save is read back here through sheetsClosed.
    val smartSheets = rememberSmartSheets()
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    BackHandler { if (menu) menu = false else onBack() }
    // A tracks playlist's next few albums' tracks (the page's loadPage).
    fun more() {
        val c = client() ?: return
        if (loading || done) return
        loading = true
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.smartTracks(id, read, zone) } }
                .onSuccess { page -> tracks.addAll(page.tracks); read += page.albumsExpanded; done = page.done || page.albumsExpanded <= 0; status = SmartTracks.status(tracks.size, read, page.albumTotal, done) }
                .onFailure { status = it.message?.takeIf { m -> !m.startsWith("HTTP") } ?: "Couldn't read this playlist."; done = true }
            loading = false
        }
    }
    // The playlist read afresh (and again once Edit's sheet over it has closed): its albums, or its first tracks.
    LaunchedEffect(id, sheets) {
        val c = client() ?: return@LaunchedEffect
        val lib = LibraryClient { c.getJson(it) }
        val found = withContext(Dispatchers.IO) { runCatching { lib.smartPlaylists().firstOrNull { it.id == id } }.getOrNull() }
        if (found == null) { status = "Couldn't read this playlist."; return@LaunchedEffect }
        sp = found
        tracks.clear(); albums = emptyList(); read = 0; done = false
        if (found.tracks) { status = "Reading tracks…"; more(); return@LaunchedEffect }
        status = "Reading albums…"
        withContext(Dispatchers.IO) { runCatching { lib.smartAlbums(id) } }
            .onSuccess { albums = it.albums; status = it.status }.onFailure { status = "Couldn't read this playlist." }
    }
    // Play now or Queue: its albums (as many as one go takes) played in turn by the server.
    fun playAll(kind: String) {
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Choose a zone first"); return }
        busy = true
        scope.launch {
            val said = withContext(Dispatchers.IO) {
                runCatching {
                    val a = LibraryClient { c.getJson(it) }.smartAlbums(id, 400)
                    if (a.albums.isEmpty()) "Nothing matches this Dynamic Playlist"
                    else {
                        val pj = c.playMulti(a.albums, zone, kind)
                        SmartPlaylist.outcome(if (kind == "queue") "Queued" else "Playing", pj.optInt("queued", a.albums.size), pj.optInt("failed", 0), a.albums.size, a.matched)
                    }
                }.getOrElse { it.message ?: "Couldn't read this playlist" }
            }
            busy = false
            toast(said)
        }
    }
    fun playOne(t: PlaylistTrack) {
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Choose a zone first"); return }
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.playTrack(t.albumOffset, t.trackIndex, t.title, "", "", zone, "play_now") } }
                .onSuccess { toast(it.optString("action").ifEmpty { "Playing" }) }.onFailure { toast(it.message ?: "Couldn't play that track") }
        }
    }
    fun delete() {
        val c = client() ?: return
        val name = sp?.name.orEmpty()
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.deleteSmartPlaylist(id) } }
                .onSuccess { toast("Deleted “$name”"); onBack() }.onFailure { toast(it.message ?: "Couldn't delete that") }
        }
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        val p = sp
        LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), state = rememberLazyGridState(), contentPadding = WALL_PADDING,
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            item("head", span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    Box(Modifier.parity("smart-playlist.back", Contract.label("smart-playlist.back")).height(40.dp).clip(RoundedCornerShape(999.dp)).background(paletteColor(Palette.BG_ELEV_2))
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp)).clickable(onClick = onBack).padding(horizontal = 9.dp), contentAlignment = Alignment.Center) {
                        Text("← Dynamic Playlists", color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                    }
                    if (p != null) {
                        Text(p.name, Modifier.parity("smart-playlist.title").padding(top = 14.dp, bottom = 8.dp), color = MaterialTheme.colorScheme.onSurface, fontSize = 22.sp, lineHeight = 30.sp, fontWeight = FontWeight.W700)
                        HorizontalDivider(color = Color(0x14ECEBE6))
                        Text(p.detail, Modifier.parity("smart-playlist.subtitle").padding(top = 4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 19.sp)
                        Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.parity("smart-playlist.play-now", Contract.label("smart-playlist.play-now")).weight(1f).height(40.dp).clip(RoundedCornerShape(999.dp))
                                .background(MaterialTheme.colorScheme.primary).clickable(enabled = !busy) { playAll("play_now") }, contentAlignment = Alignment.Center) {
                                Text("Play now", color = MaterialTheme.colorScheme.onPrimary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                            }
                            Box(Modifier.parity("smart-playlist.queue", Contract.label("smart-playlist.queue")).weight(1f).height(40.dp).clip(RoundedCornerShape(999.dp)).background(paletteColor(Palette.BG_ELEV_2))
                                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp)).clickable(enabled = !busy) { playAll("queue") }, contentAlignment = Alignment.Center) {
                                Text("Queue", color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                            }
                            Box {
                                Box(Modifier.parity("smart-playlist.more", Contract.label("smart-playlist.more")).size(40.dp).clip(CircleShape).background(paletteColor(Palette.BG_ELEV_2))
                                    .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable { menu = !menu }, contentAlignment = Alignment.Center) {
                                    Icon(painterResource(R.drawable.np_more), contentDescription = null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
                                }
                                if (menu) SmartMenu(p.name, onShare = { menu = false; shareSmart(scope, context, client, p, smartSheets) }, onEdit = { menu = false; smartSheets.edit(p) },
                                    onDelete = { menu = false; asking = true }, onClose = { menu = false })
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        if (p.tracks && tracks.isNotEmpty()) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
            if (p?.tracks == true) items(tracks.size, span = { GridItemSpan(maxLineSpan) }) { i -> SmartTrackRow(i + 1, tracks[i], last = i == tracks.size - 1, client) { playOne(tracks[i]) } }
            else {
                val shown = albums
                items(shown.size, key = { "a" + shown[it].offset }) { i ->
                    Box(Modifier.padding(bottom = 12.dp)) { AlbumTile(shown[i], prefs, coverPx, client) { onAlbum(shown[i].offset, zone, NavList(shown.map { NavItem(it.offset, it.title) }, i)) } }
                }
            }
            item("status", span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(top = 14.dp)) {
                    Text(status, Modifier.parity("smart-playlist.status"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 14.sp, lineHeight = 19.sp)
                    if (p?.tracks == true && !done && tracks.isNotEmpty()) Box(Modifier.padding(top = 14.dp).parity("smart-playlist.load-more", Contract.label("smart-playlist.load-more")).height(40.dp)
                        .clip(RoundedCornerShape(999.dp)).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp))
                        .clickable(enabled = !loading) { more() }.padding(horizontal = 9.dp), contentAlignment = Alignment.Center) {
                        Text("Load more", color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                    }
                }
            }
        }
        WallBack(onHome)
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { rid -> zone = rid; onRoom(rid) }, onPage = onPage)
            TouchNav("", offline = OfflineNow.on, onTap = onNav)
        }
        if (asking) ConfirmDialog("Delete the Dynamic Playlist “${p?.name.orEmpty()}”?") { yes -> asking = false; if (yes) delete() }
        SmartSheets(smartSheets, client, onShowAlbums = { v -> onPage("library-show", v.query()) })
    }
}

/** ⋯'s menu (.sel-menu): the playlist's name small, then Share, Edit, and Delete in the warning colour. */
@Composable
private fun SmartMenu(name: String, onShare: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit, onClose: () -> Unit) {
    val y = with(LocalDensity.current) { 48.dp.roundToPx() }
    Popup(alignment = Alignment.TopEnd, offset = IntOffset(0, y), onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Column(Modifier.width(200.dp).shadow(18.dp, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp)).background(paletteColor(Palette.BG_ELEV_2))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp)).padding(6.dp)) {
            Text(name.uppercase(), Modifier.parity("smart-playlist.more-title").padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT),
                fontSize = 11.sp, lineHeight = 15.sp, letterSpacing = 0.08.em, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Box(Modifier.parity("smart-playlist.share", Contract.label("smart-playlist.share")).fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onShare).padding(10.dp)) {
                Text("Share", color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, lineHeight = 21.sp)
            }
            Box(Modifier.parity("smart-playlist.edit", Contract.label("smart-playlist.edit")).fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onEdit).padding(10.dp)) {
                Text("Edit", color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, lineHeight = 21.sp)
            }
            Box(Modifier.parity("smart-playlist.delete", Contract.label("smart-playlist.delete")).fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onDelete).padding(10.dp)) {
                Text("Delete", color = MaterialTheme.colorScheme.error, fontSize = 15.sp, lineHeight = 21.sp)
            }
        }
    }
}

/** A track of the playlist: its number faint, its album's cover 44, the title over the artist and album; a hairline under all but the last. */
@Composable
private fun SmartTrackRow(n: Int, t: PlaylistTrack, last: Boolean, client: () -> ServerClient?, onTap: () -> Unit) {
    val px = with(LocalDensity.current) { 88.dp.roundToPx() }.coerceAtLeast(80)
    Column {
        Row(Modifier.parity("smart-playlist.track", Contract.label("smart-playlist.track", 0, t.title)).fillMaxWidth().clickable(onClick = onTap).padding(horizontal = 2.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("$n", Modifier.width(22.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 20.sp, style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"))
            val cover = rememberTileCover(t.imageKey, px, client)
            Box(Modifier.parity("smart-playlist.track-art").size(44.dp).clip(RoundedCornerShape(4.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
                if (cover != null) Image(cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Column(Modifier.weight(1f).align(Alignment.CenterVertically)) {
                Text(t.title, Modifier.parity("smart-playlist.track-title"), color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, lineHeight = 21.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (t.line.isNotEmpty()) Text(t.line, Modifier.parity("smart-playlist.track-artist").padding(top = 2.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 18.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (!last) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}
