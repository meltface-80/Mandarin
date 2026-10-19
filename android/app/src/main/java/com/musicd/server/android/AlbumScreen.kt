package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import android.os.Build
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Album
import com.musicd.server.client.AlbumExtras
import com.musicd.server.client.Booklet
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.NavList
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.albumLength
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * An album's page, natively (stage N3 of docs/specs/plan-android-native.md, a
 * preview: Settings → Setup → UI Settings), drawn as the page's sleeve
 * (docs/specs/screens.json, album; style.css, the album view in the hifi
 * palette): the brass corner discs (previous and next beside Share when it
 * was opened from a list, [list]: a tap opens that album in this one's
 * place, [onStepTo]), the cover's glow behind the top, the 160px cover (the
 * service's mark on it, and its book when it has a booklet: [onBooklet]
 * opens one) with the title, the artists, the date and its label
 * and the rate and length beside it and the notes under them; the heart,
 * Play Now, Queue and ⋯; the tracks,
 * the one playing marked; About this album and the rows under it (another
 * album of the library's opens here, [onAlbum]); the mini player and the
 * touch layout's row at the foot ([lit], the row's button lit under it; a
 * tap is the page's, [onNav]).
 * Its buttons play in
 * [zoneId], the room the page had chosen, or the one chosen since on the mini
 * player's Play on ([onRoom] tells the page); a tap on the mini player opens
 * Now playing ([onNowPlaying], with the room). What the page does with its
 * own sheets (Share card, Add to playlist, Edit album) and screens (an
 * artist's, a label's) it is asked for ([onPage]).
 */
@Composable
internal fun AlbumScreen(offset: Long, zoneId: String, lit: String, client: () -> ServerClient?, list: NavList?, onStepTo: (Long, String, NavList) -> Unit,
                         onBack: () -> Unit, onPage: (String, String?) -> Unit, onBooklet: (Long, Booklet) -> Unit,
                         onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onAlbum: (Long, String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember(offset) { mutableStateOf(zoneId) }
    var album by remember(offset) { mutableStateOf<Album?>(null) }
    var extras by remember(offset) { mutableStateOf<AlbumExtras?>(null) }
    var more by remember(offset) { mutableStateOf<AlbumMore?>(null) }
    var booklets by remember(offset) { mutableStateOf<List<Booklet>>(emptyList()) }
    var picks by remember(offset) { mutableStateOf<List<Int>?>(null) }   // selecting tracks: their places, in order of picking
    var failed by remember(offset) { mutableStateOf<String?>(null) }
    var favourite by remember(offset) { mutableStateOf(false) }
    var later by remember(offset) { mutableStateOf(false) }
    val room = followRoom(zone, client)
    BackHandler(onBack = onBack)

    LaunchedEffect(offset) {
        val c = client() ?: return@LaunchedEffect
        val lib = LibraryClient { c.getJson(it) }
        withContext(Dispatchers.IO) { runCatching { lib.album(offset) } }
            .onSuccess { album = it; favourite = it.album.favourite; later = it.album.later }
            .onFailure { failed = it.message ?: "Couldn't load the album" }
        val a = album ?: return@LaunchedEffect
        // Its booklets, as the page asks: an album of your own files only.
        if (a.album.source == null || a.album.source == "local") booklets = withContext(Dispatchers.IO) { runCatching { lib.booklets(offset) }.getOrNull().orEmpty() }
        extras = withContext(Dispatchers.IO) { runCatching { lib.albumExtras(a.album.title, a.album.subtitle) }.getOrNull() }
        more = withContext(Dispatchers.IO) { runCatching { loadMore(lib, a) }.getOrNull() }
    }
    // A page of Last.fm's, or a write-up's: the phone's browser.
    fun openUrl(url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
    val cover = rememberCover(album?.album?.imageKey, 640, client)
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    // To the room: what came of it said as the page says it.
    fun play(said: String, block: (ServerClient) -> JSONObject?) {
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Pick a zone first"); return }
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { block(c) } }
            toast(r.exceptionOrNull()?.message ?: said)
        }
    }
    fun mark(block: (ServerClient) -> Unit) {
        val c = client() ?: return
        scope.launch { withContext(Dispatchers.IO) { runCatching { block(c) } }.exceptionOrNull()?.let { toast(it.message ?: "Couldn't reach the server") } }
    }

    val bg = MaterialTheme.colorScheme.background
    val white = paletteColor(Palette.MODAL_TEXT)
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    val brass = MaterialTheme.colorScheme.primary
    val disc = IconButtonDefaults.filledIconButtonColors(containerColor = brass, contentColor = MaterialTheme.colorScheme.onPrimary,
        disabledContainerColor = brass, disabledContentColor = MaterialTheme.colorScheme.onPrimary)
    Surface(Modifier.fillMaxSize(), color = bg) {
        Box(Modifier.fillMaxSize()) {
            // The cover's colours washing the top of the page, as the page's glow does: blurred (from Android 12), faint, fading out downwards.
            cover?.let {
                Box(Modifier.parity("album.glow").fillMaxWidth().height(420.dp)) {
                    Image(it, contentDescription = null, contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().alpha(0.26f).let { m -> if (Build.VERSION.SDK_INT >= 31) m.blur(40.dp) else m })
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, 0.6f to bg.copy(alpha = 0.4f), 1f to bg)))
                }
            }
            // The foot keeps room for the mini player and the row, as the page's does; the head starts below the corner discs.
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 18.dp), contentPadding = PaddingValues(top = 64.dp, bottom = 176.dp)) {
                val a = album
                if (a == null) {
                    item { Text(failed ?: "Loading…", Modifier.parity("album.notice").padding(vertical = 24.dp), color = dim) }
                    return@LazyColumn
                }
                item {
                    // The sleeve, and its head beside it, a line each, at its foot.
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        val sleeve = RoundedCornerShape(8.dp)
                        Box(Modifier.parity("album.cover").size(160.dp).shadow(16.dp, sleeve).clip(sleeve).background(MaterialTheme.colorScheme.surfaceVariant)
                            .border(1.dp, paletteColor(Palette.COVER_RING), sleeve)) {
                            cover?.let { Image(it, contentDescription = a.album.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                            SourceBadge(a.album.source, Modifier.align(Alignment.BottomStart))
                            if (booklets.isNotEmpty()) BookletButton(booklets, disc, Modifier.align(Alignment.BottomEnd)) { onBooklet(offset, it) }
                        }
                        Column(Modifier.weight(1f)) {
                            Text(a.album.title, Modifier.parity("album.title").padding(bottom = 6.dp), fontSize = 24.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp,
                                letterSpacing = (-0.02).em, color = white, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            Row {
                                (a.artists.ifEmpty { listOf(a.album.subtitle) }).forEachIndexed { i, name ->
                                    if (i > 0) Text(" · ", Modifier.parity("album.artist"), color = dim, fontSize = 15.sp)
                                    Text(name, Modifier.parity("album.artist", Contract.label("album.artist", 0, name)).clickable { onPage("artist", name) },
                                        color = MaterialTheme.colorScheme.secondary, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            DateLine(extras, onPage)
                            FactsLine(a)
                            HeadNotes(a) { discs -> onStepTo(discs.items[discs.index].offset, zone, discs) }
                        }
                    }
                }
                item {
                    // The heart, Play Now and Queue in brass, and ⋯, each the page's 40px; 20px under the sleeve, 22px over the tracks.
                    Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        IconButton(onClick = { favourite = !favourite; val on = favourite; mark { it.favourite(offset, on) } },
                            modifier = Modifier.parity("album.favourite", Contract.label("album.favourite", if (favourite) 1 else 0)).size(40.dp).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)) {
                            Icon(painterResource(if (favourite) R.drawable.np_heart_on else R.drawable.np_heart), contentDescription = null,
                                tint = if (favourite) paletteColor(Palette.HEART) else dim, modifier = Modifier.size(22.dp))
                        }
                        val pill = ButtonDefaults.buttonColors(containerColor = brass, contentColor = MaterialTheme.colorScheme.onPrimary)
                        Button(onClick = { play("Playing") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "play_now") } }, colors = pill, contentPadding = PaddingValues(horizontal = 8.dp),
                            modifier = Modifier.parity("album.play-now", Contract.label("album.play-now")).weight(1f).height(40.dp)) { Text(Contract.label("album.play-now"), fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
                        Button(onClick = { play("Queued") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "queue") } }, colors = pill, contentPadding = PaddingValues(horizontal = 8.dp),
                            modifier = Modifier.parity("album.queue", Contract.label("album.queue")).weight(1f).height(40.dp)) { Text(Contract.label("album.queue"), fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
                        MoreMenu(a, later, onLater = { later = !later; val on = later; mark { it.listenLater(offset, on) } },
                            onPlay = { kind, said -> play(said) { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, kind) } }, onPage = onPage)
                    }
                }
                albumTracks(a, playingId = room.view?.takeIf { it.album == a.album.title }?.trackId, playing = room.view?.playing == true, picks = picks,
                    onPick = { i -> val p = picks; picks = if (p == null) listOf(i) else if (i in p) (p - i).ifEmpty { null } else p + i },
                    onPlay = { i, kind, said -> play("$said: ${a.tracks[i].title}") { it.playTrack(offset, i, a.tracks[i].title, a.album.title, a.album.subtitle, zone, kind) } })
                albumAbout(extras?.review, more, client, onAlbum = { id -> onAlbum(id, zone) }, onArtist = { onPage("artist", it) }, onUrl = ::openUrl)
            }
            // The corner discs, over the glow: Back, and Share.
            FilledIconButton(onClick = onBack, colors = disc, modifier = Modifier.parity("album.back", Contract.label("album.back")).padding(start = 12.dp, top = 12.dp).size(40.dp).align(Alignment.TopStart)) {
                Icon(painterResource(R.drawable.np_back), contentDescription = null, modifier = Modifier.size(22.dp))
            }
            Row(Modifier.align(Alignment.TopEnd).padding(end = 12.dp, top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // Selecting tracks, their menu takes previous and next's place, as on the page.
                val p = picks
                val a = album
                if (p != null && a != null) SelectMenu(p, onAct = { act ->
                    when (act) {
                        "clear" -> picks = null
                        "later" -> { later = true; mark { it.listenLater(offset, true) }; toast("Added to Listen later"); picks = null }
                        "playlist" -> onPage("album-playlist-tracks", picksJson(a, p))
                        else -> {
                            val c = client()
                            if (c == null || zone.isEmpty()) toast("Pick a zone first")
                            else scope.launch { toast(withContext(Dispatchers.IO) { playPicks(c, a, p, zone, act) }); picks = null }
                        }
                    }
                })
                else list?.let { NavDiscs(it, disc) { at -> onStepTo(it.items[at].offset, zone, it.copy(index = at)) } }
                FilledIconButton(onClick = { onPage("album-share", offset.toString()) }, enabled = album != null, colors = disc,
                    modifier = Modifier.parity("album.share", Contract.label("album.share")).size(40.dp)) {
                    Icon(painterResource(R.drawable.np_share), contentDescription = null, modifier = Modifier.size(20.dp))
                }
            }
            Column(Modifier.align(Alignment.BottomCenter)) {
                MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
                TouchNav(lit, offline = Store.offlineMode(context), onTap = onNav)
            }
        }
    }
}

/** The release date, its label (a tap: the label's albums) and the score after it; nothing until the extras come. */
@Composable
private fun DateLine(extras: AlbumExtras?, onPage: (String, String?) -> Unit) {
    val e = extras ?: return
    val date = e.date()
    if (date.isEmpty() && e.label == null && e.scoreText == null) return
    Row(Modifier.parity("album.date").padding(top = 3.dp)) {
        val dim = MaterialTheme.colorScheme.onSurfaceVariant
        Text(date, color = dim, fontSize = 14.sp)
        e.label?.let { label ->
            if (date.isNotEmpty()) Text(" · ", color = dim, fontSize = 14.sp)
            Text(label, Modifier.parity("album.label", Contract.label("album.label", 0, label)).clickable { onPage("label", label) },
                color = MaterialTheme.colorScheme.secondary, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        e.scoreText?.let { Text(" · $it" + if (e.bestNewMusic) " BNM" else "", color = dim, fontSize = 14.sp) }
    }
}

/** The rate as the page's chip (hi-res in brass, with a brass edge) and the album's length. */
@Composable
private fun FactsLine(a: Album) {
    val length = albumLength(a.tracks)
    Row(Modifier.parity("album.facts").padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        a.album.quality?.let {
            val c = if (a.album.hires) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant
            val edge = if (a.album.hires) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
            Text(it, Modifier.border(1.dp, edge, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 1.dp), color = c, fontSize = 12.sp)
        }
        if (length.isNotEmpty()) Text((if (a.album.quality != null) " · " else "") + length, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
    }
}

/**
 * ⋯: what the server offers beyond Play Now and Queue (Play Next, Shuffle,
 * Radio), Listen later, and the page's own Add to playlist and Edit album.
 */
@Composable
private fun MoreMenu(a: Album, later: Boolean, onLater: () -> Unit, onPlay: (String, String) -> Unit, onPage: (String, String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val kinds = a.actions.map { it.kind }.toSet()
    val offset = a.album.offset.toString()
    Box {
        IconButton(onClick = { open = !open }, modifier = Modifier.parity("album.more", Contract.label("album.more")).size(40.dp).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)) {
            Icon(painterResource(R.drawable.np_more), contentDescription = null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if ("play_next" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.play-next")) }, modifier = Modifier.parity("album.play-next", Contract.label("album.play-next")),
                onClick = { open = false; onPlay("play_next", "Playing next") })
            if ("shuffle" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.shuffle")) }, modifier = Modifier.parity("album.shuffle", Contract.label("album.shuffle")),
                onClick = { open = false; onPlay("shuffle", "Shuffling") })
            if ("radio" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.radio")) }, modifier = Modifier.parity("album.radio", Contract.label("album.radio")),
                onClick = { open = false; onPlay("radio", "Radio") })
            DropdownMenuItem(text = { Text(Contract.label("album.later", if (later) 1 else 0)) }, modifier = Modifier.parity("album.later", Contract.label("album.later", if (later) 1 else 0)),
                onClick = { open = false; onLater() })
            DropdownMenuItem(text = { Text(Contract.label("album.playlist")) }, modifier = Modifier.parity("album.playlist", Contract.label("album.playlist")),
                onClick = { open = false; onPage("album-playlist", offset) })
            if (a.album.source == null || a.album.source == "local") DropdownMenuItem(text = { Text(Contract.label("album.edit")) },
                modifier = Modifier.parity("album.edit", Contract.label("album.edit")), onClick = { open = false; onPage("album-edit", offset) })
        }
    }
}
