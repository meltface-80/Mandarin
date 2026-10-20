package com.musicd.server.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
 * own sheets (Share card, Add to playlist) and screens (an artist's, a
 * label's) it is asked for ([onPage]); Edit album is its own (item 74).
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
    // Whether the album is on this phone, following the downloads as they go (the page's ⋯ reads the same store through its bridge).
    var download by remember(offset) { mutableStateOf(DownloadStore.status(context, offset.toInt())) }
    DisposableEffect(offset) {
        val l = { download = DownloadStore.status(context, offset.toInt()) }
        DownloadStore.listen(l)
        onDispose { DownloadStore.unlisten(l) }
    }
    var failed by remember(offset) { mutableStateOf<String?>(null) }
    var favourite by remember(offset) { mutableStateOf(false) }
    var later by remember(offset) { mutableStateOf(false) }
    var serviceFav by remember(offset) { mutableStateOf<Boolean?>(null) }   // a streamed album's favourite on its service, once known
    var editing by remember(offset) { mutableStateOf(false) }   // its editor open (item 74)
    var loads by remember(offset) { mutableIntStateOf(0) }   // read again once the editor changed it
    val room = followRoom(zone, client)
    BackHandler(onBack = onBack)

    LaunchedEffect(offset, loads) {
        val c = client() ?: return@LaunchedEffect
        val lib = LibraryClient { c.getJson(it) }
        withContext(Dispatchers.IO) { runCatching { lib.album(offset) } }
            .onSuccess { album = it; favourite = it.album.favourite; later = it.album.later; serviceFav = it.album.serviceFavourite }
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
    // To the room: what came of it said as the page says it; nothing when [said] is empty (Play Now: the mini player shows what
    // plays, and a toast over it said the same, bug list item 58), unless it failed.
    fun play(said: String, block: (ServerClient) -> JSONObject?) {
        val c = client() ?: return
        if (zone.isEmpty()) { toast("Pick a zone first"); return }
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { block(c) } }
            val err = r.exceptionOrNull()?.message
            if (err != null) toast(err) else if (said.isNotEmpty()) toast(said)
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
                            // The page's head: the title 24px bold in 1.15 (Type.kt), the artists 15 and the lines under them 14, each at its own line.
                            Text(a.album.title, Modifier.parity("album.title").padding(bottom = 6.dp).lineBox(24.sp, 27.6.sp), fontSize = 24.sp, fontWeight = FontWeight.Bold, lineHeight = 27.6.sp,
                                letterSpacing = (-0.02).em, color = white, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            // A classical album: its composers and who performs it, in the artists' place (item 49).
                            if (a.composers.isNotEmpty()) ComposerLines(a, onPage)
                            else Row {
                                (a.artists.ifEmpty { listOf(a.album.subtitle) }).forEachIndexed { i, name ->
                                    if (i > 0) Text(" · ", Modifier.parity("album.artist"), color = dim, fontSize = 15.sp, lineHeight = 21.sp)
                                    Text(name, Modifier.parity("album.artist", Contract.label("album.artist", 0, name)).clickable { onPage("artist", name) },
                                        color = MaterialTheme.colorScheme.secondary, fontSize = 15.sp, lineHeight = 21.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            DateLine(extras, onPage)
                            FactsLine(a)
                            HeadNotes(a) { discs -> onStepTo(discs.items[discs.index].offset, zone, discs) }
                        }
                    }
                }
                item {
                    // The heart, Play Now and Queue in brass, and ⋯, each the page's 42 tall (.modal-actions: 11 of padding round a 13px word), the heart
                    // and ⋯ 40 wide; 20 under the sleeve, 22 over the tracks. Outlined buttons for the rings: a plain button's border lay outside
                    // its 48 touch target and drew the ring 48 wide (bug list item 54).
                    Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val stadium = RoundedCornerShape(999.dp)
                        OutlinedIconButton(onClick = { favourite = !favourite; val on = favourite; mark { it.favourite(offset, on) } }, shape = stadium, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            colors = IconButtonDefaults.outlinedIconButtonColors(contentColor = if (favourite) paletteColor(Palette.HEART) else dim),
                            modifier = Modifier.parity("album.favourite", Contract.label("album.favourite", if (favourite) 1 else 0)).size(40.dp, 42.dp)) {
                            Icon(painterResource(if (favourite) R.drawable.np_heart_on else R.drawable.np_heart), contentDescription = null, modifier = Modifier.size(22.dp))
                        }
                        val pill = ButtonDefaults.buttonColors(containerColor = brass, contentColor = MaterialTheme.colorScheme.onPrimary)
                        Button(onClick = { play("") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "play_now") } }, colors = pill, contentPadding = PaddingValues(horizontal = 8.dp),
                            modifier = Modifier.parity("album.play-now", Contract.label("album.play-now")).weight(1f).height(42.dp)) { Text(Contract.label("album.play-now"), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
                        Button(onClick = { play("Queued") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "queue") } }, colors = pill, contentPadding = PaddingValues(horizontal = 8.dp),
                            modifier = Modifier.parity("album.queue", Contract.label("album.queue")).weight(1f).height(42.dp)) { Text(Contract.label("album.queue"), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
                        // Download to this phone: as the page's bridge words it from the store's state; the app's own dialogs do the rest.
                        val dlState = download.optString("state", "none")
                        val dlLabel = if (a.album.source != null && a.album.source != "local") null
                            else if (dlState == "done") Contract.label("album.download", 1)
                            else if (dlState == "downloading" || dlState == "queued" || dlState == "waiting") Contract.label("album.download", 2, "${download.optInt("done", 0)}/${download.optInt("total", 0).takeIf { it > 0 } ?: "?"}")
                            else Contract.label("album.download", 0)
                        val bridge = (context as? Activity)?.let { DownloadsBridge(it) }
                        MoreMenu(a, later, onLater = { later = !later; val on = later; mark { it.listenLater(offset, on) } },
                            onPlay = { kind, said -> play(said) { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, kind) } }, onPage = { what, arg -> if (what == "album-edit") editing = true else onPage(what, arg) },
                            download = dlLabel?.takeIf { bridge != null },
                            onDownload = {
                                val b = bridge ?: return@MoreMenu
                                when (dlState) { "done" -> b.remove(offset.toInt()); "downloading", "queued", "waiting" -> b.open(); else -> b.download(offset.toInt(), a.album.title, a.album.subtitle) }
                            },
                            serviceFavourite = serviceFav, onServiceFavourite = { on ->
                                val c = client() ?: return@MoreMenu
                                val name = a.album.serviceName ?: return@MoreMenu
                                val source = a.album.source ?: return@MoreMenu
                                val id = a.album.serviceId ?: return@MoreMenu
                                scope.launch {
                                    val r = withContext(Dispatchers.IO) { runCatching { c.serviceFavourite(source, id, on) } }
                                    val err = r.exceptionOrNull()?.message ?: r.getOrNull()?.optString("error", "")?.ifEmpty { null }
                                    if (err != null) { toast(err); return@launch }
                                    serviceFav = on
                                    toast(if (on) "Added to your $name favourites" else "Removed from your $name favourites")
                                    // Removed, the album is no longer in the library: its page closes and the walls are redrawn without it; added, they take it in.
                                    if (on) NativeShell.toPage("library-changed", null) else onPage("library-changed", offset.toString())
                                }
                            })
                    }
                }
                val playingId = room.view?.takeIf { it.album == a.album.title }?.trackId
                val onPick = { i: Int -> val p = picks; picks = if (p == null) listOf(i) else if (i in p) (p - i).ifEmpty { null } else p + i }
                val onPlay = { i: Int, kind: String, said: String -> play("$said: ${a.tracks[i].title}") { it.playTrack(offset, i, a.tracks[i].title, a.album.title, a.album.subtitle, zone, kind) } }
                // A classical album's works and movements (item 49), else the plain list; a work plays as a selection of its tracks would (Play next last to first).
                if (a.classical) albumWorks(a, playingId, room.view?.playing == true, picks, onPick, onPlay, onPlayWork = { w, kind, said ->
                    play("$said: ${w.title}") { c ->
                        val order = w.movements.map { it.track }.filter { it in a.tracks.indices }.let { if (kind == "play_next") it.reversed() else it }
                        var last: JSONObject? = null
                        order.forEachIndexed { n, i -> last = c.playTrack(offset, i, a.tracks[i].title, a.album.title, a.album.subtitle, zone, if (kind == "play_next" || n == 0) kind else "queue") }
                        last
                    }
                })
                else albumTracks(a, playingId, room.view?.playing == true, picks, onPick, onPlay)
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
            // Its editor (item 74), over the page; the page read again, and the walls told, once it changed the album.
            if (editing) album?.let { AlbumEditSheet(offset, it.album.title, it.album.subtitle, client, onClose = { editing = false }, onChanged = { loads++; NativeShell.toPage("library-changed", null) }) }
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
        Text(date, color = dim, fontSize = 14.sp, lineHeight = 19.sp)
        e.label?.let { label ->
            if (date.isNotEmpty()) Text(" · ", color = dim, fontSize = 14.sp, lineHeight = 19.sp)
            Text(label, Modifier.parity("album.label", Contract.label("album.label", 0, label)).clickable { onPage("label", label) },
                color = MaterialTheme.colorScheme.secondary, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        e.scoreText?.let { Text(" · $it" + if (e.bestNewMusic) " BNM" else "", color = dim, fontSize = 14.sp, lineHeight = 19.sp) }
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
            Text(it, Modifier.border(1.dp, edge, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 1.dp), color = c, fontSize = 12.sp, lineHeight = 16.sp)
        }
        if (length.isNotEmpty()) Text((if (a.album.quality != null) " · " else "") + length, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 19.sp)
    }
}

/**
 * ⋯: what the server offers beyond Play Now and Queue (Play Next, Shuffle,
 * Radio), a streamed album's favourite on its service ([serviceFavourite],
 * once known), Listen later, the page's own Add to playlist and Edit album,
 * and, for an album of your own files, Download to this phone ([download],
 * the item's words as the store has them).
 */
@Composable
private fun MoreMenu(a: Album, later: Boolean, onLater: () -> Unit, onPlay: (String, String) -> Unit, onPage: (String, String?) -> Unit,
                     download: String?, onDownload: () -> Unit, serviceFavourite: Boolean?, onServiceFavourite: (Boolean) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val kinds = a.actions.map { it.kind }.toSet()
    val offset = a.album.offset.toString()
    Box {
        OutlinedIconButton(onClick = { open = !open }, shape = RoundedCornerShape(999.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            colors = IconButtonDefaults.outlinedIconButtonColors(contentColor = paletteColor(Palette.MODAL_TEXT)),
            modifier = Modifier.parity("album.more", Contract.label("album.more")).size(40.dp, 42.dp)) {
            Icon(painterResource(R.drawable.np_more), contentDescription = null, modifier = Modifier.size(22.dp))
        }
        // The page's menu (.overflow-menu): 186 wide, each item 15px in 10 of padding, 41 tall.
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = RoundedCornerShape(10.dp), containerColor = paletteColor(Palette.BG_ELEV_2),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), modifier = Modifier.width(186.dp)) {
            if ("play_next" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.play-next"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.play-next", Contract.label("album.play-next")),
                onClick = { open = false; onPlay("play_next", "Playing next") })
            if ("shuffle" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.shuffle"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.shuffle", Contract.label("album.shuffle")),
                onClick = { open = false; onPlay("shuffle", "Shuffling") })
            if ("radio" in kinds) DropdownMenuItem(text = { Text(Contract.label("album.radio"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.radio", Contract.label("album.radio")),
                onClick = { open = false; onPlay("radio", "Radio") })
            val service = a.album.serviceName
            if (service != null && a.album.serviceId != null && serviceFavourite != null) {
                val words = (if (serviceFavourite) "Remove from " else "Add to ") + service
                DropdownMenuItem(text = { Text(Contract.label("album.service-favourite", 0, words), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.service-favourite", Contract.label("album.service-favourite", 0, words)),
                    onClick = { open = false; onServiceFavourite(!serviceFavourite) })
            }
            DropdownMenuItem(text = { Text(Contract.label("album.later", if (later) 1 else 0), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.later", Contract.label("album.later", if (later) 1 else 0)),
                onClick = { open = false; onLater() })
            DropdownMenuItem(text = { Text(Contract.label("album.playlist"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.playlist", Contract.label("album.playlist")),
                onClick = { open = false; onPage("album-playlist", offset) })
            if (a.album.source == null || a.album.source == "local") DropdownMenuItem(text = { Text(Contract.label("album.edit"), fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp),
                modifier = Modifier.parity("album.edit", Contract.label("album.edit")), onClick = { open = false; onPage("album-edit", offset) })
            if (download != null) DropdownMenuItem(text = { Text(download, fontSize = 15.sp, lineHeight = 21.sp) }, contentPadding = PaddingValues(10.dp), modifier = Modifier.parity("album.download", Contract.label("album.download", 0)),
                onClick = { open = false; onDownload() })
        }
    }
}
