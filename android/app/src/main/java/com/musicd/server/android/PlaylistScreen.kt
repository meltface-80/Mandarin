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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
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
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.Palette
import com.musicd.server.client.PlaylistTrack
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShareFile
import com.musicd.server.client.UserPlaylist
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * One of your playlists, natively (the Playlists group of docs/specs/plan-android-native.md, P2's page; bug list item 65),
 * drawn as the page's (docs/specs/screens.json, playlist; playlists.js openUserPlaylist, style.css .playlist-detail):
 * the bar's Back to Home, ← Playlists, the name over its hairline and how many tracks, Play now, Queue and ⋯ (Share, the
 * page's sheet over this screen; Delete, asked first), then the tracks numbered, each with its album's cover, a tap playing
 * it from its album; "Nothing in this playlist yet." for none; the banner where it can't be read; the mini player and the row.
 */
@Composable
internal fun PlaylistScreen(id: String, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onHome: () -> Unit,
                            onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    var playlist by remember { mutableStateOf<UserPlaylist?>(null) }
    var trouble by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf<ShareFile?>(null) }
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    BackHandler { if (menu) menu = false else onBack() }
    // Share (the page's shareTracks): the tracks made into text by the server, then its sheet (PlaylistShareSheet.kt; item 94).
    fun share() {
        val p = playlist ?: return
        val c = client() ?: return
        if (p.tracks.isEmpty()) { toast("Nothing to share yet"); return }
        scope.launch { encodeShare(c, p.name, p.tracks).onSuccess { sharing = it }.onFailure { toast(it.message ?: "Couldn't build the share file") } }
    }
    LaunchedEffect(id) {
        val c = client() ?: return@LaunchedEffect
        withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.userPlaylist(id) } }
            .onSuccess { playlist = it; trouble = null }
            .onFailure { trouble = (it as? ServerClient.ServerException)?.message?.takeIf { m -> m.isNotEmpty() && !m.startsWith("HTTP") } ?: "Couldn't open that playlist." }
    }
    // Play now or Queue: one track after another (the server has no batch of tracks), the first as asked and the rest queued.
    fun playAll(kind: String) {
        val p = playlist ?: return
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Choose a zone first"); return }
        if (p.tracks.isEmpty()) { toast("Nothing in this playlist"); return }
        busy = true
        scope.launch {
            var queued = 0; var failed = 0; var first = ""
            for ((i, t) in p.tracks.withIndex()) {
                if (p.tracks.size > 3) toast("Adding track ${i + 1} of ${p.tracks.size}…")
                withContext(Dispatchers.IO) { runCatching { c.playTrack(t.albumOffset, t.trackIndex, t.title, t.albumTitle, t.albumSubtitle, zone, if (i == 0) kind else "queue") } }
                    .onSuccess { queued++ }.onFailure { failed++; if (first.isEmpty()) first = it.message ?: "Couldn't reach the server" }
            }
            busy = false
            toast(UserPlaylist.report(kind, queued, failed, first))
        }
    }
    fun playOne(t: PlaylistTrack) {
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Choose a zone first"); return }
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.playTrack(t.albumOffset, t.trackIndex, t.title, t.albumTitle, t.albumSubtitle, zone, "play_now") } }
                .onSuccess { toast("Playing ${t.title}") }.onFailure { toast(it.message ?: "Couldn't play that track") }
        }
    }
    fun delete() {
        val c = client() ?: return
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { c.deletePlaylist(id) } }
                .onSuccess { toast("Playlist deleted"); onBack() }.onFailure { toast("Couldn't delete that") }
        }
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        val p = playlist
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 14.dp, top = 78.dp, end = 14.dp, bottom = 164.dp)) {
            item("head") {
                Column {
                    // ← Playlists (.playlist-back, an .action-btn): 40 tall, the second ground with its edge.
                    Box(Modifier.parity("playlist.back", Contract.label("playlist.back")).height(40.dp).clip(RoundedCornerShape(999.dp)).background(paletteColor(Palette.BG_ELEV_2))
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp)).clickable(onClick = onBack).padding(horizontal = 9.dp), contentAlignment = Alignment.Center) {
                        Text("← Playlists", color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                    }
                    trouble?.let { Banner(it, true, Modifier.padding(top = 14.dp)) }
                    if (p != null) {
                        // The name (.playlist-title): 22 at 700, a hairline under it 8 below; how many tracks 4 under that.
                        Text(p.name, Modifier.parity("playlist.title").padding(top = 14.dp, bottom = 8.dp), color = MaterialTheme.colorScheme.onSurface, fontSize = 22.sp, lineHeight = 30.sp, fontWeight = FontWeight.W700)
                        HorizontalDivider(color = Color(0x14ECEBE6))
                        Text(p.count, Modifier.parity("playlist.subtitle").padding(top = 4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 19.sp)
                        Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.parity("playlist.play-now", Contract.label("playlist.play-now")).weight(1f).height(40.dp).clip(RoundedCornerShape(999.dp))
                                .background(MaterialTheme.colorScheme.primary).clickable(enabled = !busy) { playAll("play_now") }, contentAlignment = Alignment.Center) {
                                Text("Play now", color = MaterialTheme.colorScheme.onPrimary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                            }
                            Box(Modifier.parity("playlist.queue", Contract.label("playlist.queue")).weight(1f).height(40.dp).clip(RoundedCornerShape(999.dp)).background(paletteColor(Palette.BG_ELEV_2))
                                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp)).clickable(enabled = !busy) { playAll("queue") }, contentAlignment = Alignment.Center) {
                                Text("Queue", color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                            }
                            Box {
                                Box(Modifier.parity("playlist.more", Contract.label("playlist.more")).size(40.dp).clip(CircleShape).background(paletteColor(Palette.BG_ELEV_2))
                                    .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable { menu = !menu }, contentAlignment = Alignment.Center) {
                                    Icon(painterResource(R.drawable.np_more), contentDescription = null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
                                }
                                if (menu) MoreMenu(p.name, onShare = { menu = false; share() }, onDelete = { menu = false; asking = true }, onClose = { menu = false })
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        if (p.tracks.isNotEmpty()) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
            val tracks = p?.tracks.orEmpty()
            items(tracks.size) { i -> TrackRow(i + 1, tracks[i], last = i == tracks.size - 1, client) { playOne(tracks[i]) } }
            if (p != null && tracks.isEmpty()) item("empty") {
                Text("Nothing in this playlist yet.", Modifier.parity("playlist.empty"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 14.sp, lineHeight = 19.sp)
            }
        }
        // The bar's Back: to Home, as the page's.
        WallBack(onHome)
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { rid -> zone = rid; onRoom(rid) }, onPage = onPage)
            TouchNav("", offline = Store.offlineMode(context), onTap = onNav)
        }
        if (asking) ConfirmDialog("Delete “${p?.name.orEmpty()}”? This can't be undone.") { yes -> asking = false; if (yes) delete() }
        sharing?.let { f -> PlaylistShareSheet(p?.name.orEmpty(), f) { sharing = null } }
    }
}

/** ⋯'s menu (.sel-menu under the button, its right edge on the button's): the playlist's name small, then Share and Delete in the warning colour. */
@Composable
private fun MoreMenu(name: String, onShare: () -> Unit, onDelete: () -> Unit, onClose: () -> Unit) {
    val y = with(LocalDensity.current) { 48.dp.roundToPx() }
    Popup(alignment = Alignment.TopEnd, offset = IntOffset(0, y), onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Column(Modifier.width(200.dp).shadow(18.dp, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp)).background(paletteColor(Palette.BG_ELEV_2))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp)).padding(6.dp)) {
            Text(name.uppercase(), Modifier.parity("playlist.more-title").padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT),
                fontSize = 11.sp, lineHeight = 15.sp, letterSpacing = 0.08.em, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Box(Modifier.parity("playlist.share", Contract.label("playlist.share")).fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onShare).padding(10.dp)) {
                Text("Share", color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, lineHeight = 21.sp)
            }
            Box(Modifier.parity("playlist.delete", Contract.label("playlist.delete")).fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onDelete).padding(10.dp)) {
                Text("Delete", color = MaterialTheme.colorScheme.error, fontSize = 15.sp, lineHeight = 21.sp)
            }
        }
    }
}

/** A track of the playlist (.playlist-tracks .track-row): its number faint, its album's cover 44, the title over the artist and album; a hairline under all but the last. */
@Composable
private fun TrackRow(n: Int, t: PlaylistTrack, last: Boolean, client: () -> ServerClient?, onTap: () -> Unit) {
    val px = with(LocalDensity.current) { 88.dp.roundToPx() }.coerceAtLeast(80)
    Column {
        Row(Modifier.parity("playlist.track", Contract.label("playlist.track", 0, t.title)).fillMaxWidth().clickable(onClick = onTap).padding(horizontal = 2.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("$n", Modifier.width(22.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 20.sp, style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"))
            val cover = rememberTileCover(t.imageKey, px, client)
            Box(Modifier.parity("playlist.track-art").size(44.dp).clip(RoundedCornerShape(4.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
                if (cover != null) Image(cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
            Column(Modifier.weight(1f).align(Alignment.CenterVertically)) {
                Text(t.title, Modifier.parity("playlist.track-title"), color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, lineHeight = 21.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (t.line.isNotEmpty()) Text(t.line, Modifier.parity("playlist.track-artist").padding(top = 2.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 18.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (!last) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
    }
}
