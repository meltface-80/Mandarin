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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import com.musicd.server.client.AlbumCredits
import com.musicd.server.client.PlaylistAdd
import com.musicd.server.client.AlbumExtras
import com.musicd.server.client.Booklet
import com.musicd.server.client.Contract
import com.musicd.server.client.Failure
import com.musicd.server.client.Retry
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.NavList
import com.musicd.server.client.Palette
import com.musicd.server.client.PhoneShelf
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * An album's page, natively (stage N3 of old/plan-android-native.md, a
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
 * One of the phone's own albums ([phone], its key; item 108) is read from the phone and played on it as the page's
 * invokePhone plays one, picked tracks too; the rest of its buttons are the page's, as the page has them for one (Download
 * not offered).
 */
@Composable
internal fun AlbumScreen(offset: Long, zoneId: String, lit: String, client: () -> ServerClient?, list: NavList?, onStepTo: (Long, String, NavList) -> Unit,
                         onBack: () -> Unit, onPage: (String, String?) -> Unit, onBooklet: (Long, Booklet) -> Unit,
                         onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onAlbum: (Long, String) -> Unit, phone: String? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zone by remember(offset) { mutableStateOf(zoneId) }
    var album by remember(offset) { mutableStateOf<Album?>(null) }
    var extras by remember(offset) { mutableStateOf<AlbumExtras?>(null) }
    var more by remember(offset) { mutableStateOf<AlbumMore?>(null) }
    var credits by remember(offset) { mutableStateOf<AlbumCredits?>(null) }   // who played, wrote and made it (item 132)
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
    var sharing by remember(offset) { mutableStateOf(false) }   // its Share card open (item 75)
    var loads by remember(offset) { mutableIntStateOf(0) }   // read again once the editor changed it
    var missed by remember(offset) { mutableIntStateOf(0) }   // the server not reached, in a row
    val room = followRoom(zone, client)
    BackHandler(onBack = onBack)

    LaunchedEffect(offset, loads) {
        if (phone != null) {
            album = withContext(Dispatchers.IO) { runCatching { LocalMusic.load(context); LocalMusic.album(phone)?.let { PhoneShelf.phoneView(PhoneData.phone(it)) } }.getOrNull() }
            val a = album ?: run { failed = "That album isn't on this phone any more"; return@LaunchedEffect }
            val lib = client()?.let { c -> LibraryClient { c.getJson(it) } } ?: return@LaunchedEffect
            extras = withContext(Dispatchers.IO) { runCatching { lib.albumExtras(a.album.title, a.album.subtitle) }.getOrNull() }
            more = withContext(Dispatchers.IO) { runCatching { loadMore(lib, a) }.getOrNull() }
            return@LaunchedEffect
        }
        val c = client() ?: return@LaunchedEffect
        val lib = LibraryClient { c.getJson(it) }
        val got = withContext(Dispatchers.IO) { runCatching { lib.album(offset) } }
            .onSuccess { album = it; favourite = it.album.favourite; later = it.album.later; serviceFav = it.album.serviceFavourite; LibraryWall.coverIs(offset, it.album.imageKey) }
            .onFailure { failed = Failure.said(it, "Couldn't load the album") + if (Failure.unreachable(it)) ". Trying again…" else "" }
        val a = album ?: run {
            // The server not reached (item 127): asked again in a while, less and less often, while the page is up.
            if (got.exceptionOrNull()?.let(Failure::unreachable) == true) { delay(Retry.ms(++missed)); loads++ }
            return@LaunchedEffect
        }
        // Its booklets, as the page asks: an album of your own files only.
        if (a.album.source == null || a.album.source == "local") booklets = withContext(Dispatchers.IO) { runCatching { lib.booklets(offset) }.getOrNull().orEmpty() }
        extras = withContext(Dispatchers.IO) { runCatching { lib.albumExtras(a.album.title, a.album.subtitle) }.getOrNull() }
        // Its credits (item 132): the server may find them there and then, for a few seconds; the rows under them meanwhile.
        coroutineScope {
            launch { credits = withContext(Dispatchers.IO) { runCatching { lib.albumCredits(offset) }.getOrNull() } }
            launch { more = withContext(Dispatchers.IO) { runCatching { loadMore(lib, a) }.getOrNull() } }
        }
    }
    // A page of Last.fm's, or a write-up's: the phone's browser.
    fun openUrl(url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
    val cover = if (phone != null) rememberTileCover(album?.album?.imageKey, 640, client) else rememberCover(album?.album?.imageKey, 640, client)
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    // The phone's own album, track [index] (-1, the whole album) played on this phone, said as the page's invokePhone says it.
    fun playPhone(index: Int, kind: String) {
        val key = phone ?: return
        DownloadsBridge(context as? Activity ?: return).playLocal(key, index, kind)
        toast((if (kind == "queue") "Queued" else if (kind == "play_next" || kind == "add_next") "Next" else "Playing") + " → This phone")
    }
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
    // Made on the app's lane of changes to what Home shows (item 85): to the end if this page closes, and before Home reads.
    fun mark(block: (ServerClient) -> Unit) {
        val c = client() ?: return
        val made = ServerWrites.write { block(c) }
        scope.launch { ServerWrites.await(made).exceptionOrNull()?.let { toast(it.message ?: "Couldn't reach the server") } }
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
                        Button(onClick = { if (phone != null) playPhone(-1, "play_now") else play("") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "play_now") } }, colors = pill, contentPadding = PaddingValues(horizontal = 8.dp),
                            modifier = Modifier.parity("album.play-now", Contract.label("album.play-now")).weight(1f).height(42.dp)) { Text(Contract.label("album.play-now"), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
                        Button(onClick = { if (phone != null) playPhone(-1, "queue") else play("Queued") { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, "queue") } }, colors = pill, contentPadding = PaddingValues(horizontal = 8.dp),
                            modifier = Modifier.parity("album.queue", Contract.label("album.queue")).weight(1f).height(42.dp)) { Text(Contract.label("album.queue"), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
                        // Download to this phone: as the page's bridge words it from the store's state; the app's own dialogs do the rest.
                        val dlState = download.optString("state", "none")
                        val dlLabel = if (phone != null || (a.album.source != null && a.album.source != "local")) null
                            else if (dlState == "done") Contract.label("album.download", 1)
                            else if (dlState == "downloading" || dlState == "queued" || dlState == "waiting") Contract.label("album.download", 2, "${download.optInt("done", 0)}/${download.optInt("total", 0).takeIf { it > 0 } ?: "?"}")
                            else Contract.label("album.download", 0)
                        val bridge = (context as? Activity)?.let { DownloadsBridge(it) }
                        MoreMenu(a, later, onLater = { later = !later; val on = later; mark { it.listenLater(offset, on) } },
                            onPlay = { kind, said -> if (phone != null) playPhone(-1, kind) else play(said) { it.playAlbum(offset, a.album.title, a.album.subtitle, zone, kind) } }, onPage = { what, arg -> if (what == "album-edit") editing = true else onPage(what, arg) },
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
                                    // Removed, the album is no longer in the library: its page closes (the walls read it afresh as they open).
                                    if (!on) onPage("library-changed", offset.toString())
                                }
                            })
                    }
                }
                val playingId = room.view?.takeIf { it.album == a.album.title }?.trackId
                val onPick = { i: Int -> val p = picks; picks = if (p == null) listOf(i) else if (i in p) (p - i).ifEmpty { null } else p + i }
                val onPlay = { i: Int, kind: String, said: String -> if (phone != null) playPhone(i, kind) else play("$said: ${a.tracks[i].title}") { it.playTrack(offset, i, a.tracks[i].title, a.album.title, a.album.subtitle, zone, kind) } }
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
                albumCredits(credits, client, onArtist = { onPage("artist", it) })
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
                        "playlist" -> { PlaylistAddAsk.ask(PlaylistAdd.tracks(a, p)); picks = null }
                        // The phone's own: each to its player, in order (Play next last to first), as the page's playTracks.
                        else -> if (phone != null) {
                            val order = p.sorted().let { if (act == "play_next") it.reversed() else it }
                            order.forEachIndexed { n, i -> playPhone(i, if (act == "play_next" || n == 0) act else "queue") }
                            picks = null
                        } else {
                            val c = client()
                            if (c == null || zone.isEmpty()) toast("Pick a zone first")
                            else scope.launch { toast(withContext(Dispatchers.IO) { playPicks(c, a, p, zone, act) }); picks = null }
                        }
                    }
                })
                else list?.let { NavDiscs(it, disc) { at -> onStepTo(it.items[at].offset, zone, it.copy(index = at)) } }
                FilledIconButton(onClick = { sharing = true }, enabled = album != null, colors = disc,
                    modifier = Modifier.parity("album.share", Contract.label("album.share")).size(40.dp)) {
                    Icon(painterResource(R.drawable.np_share), contentDescription = null, modifier = Modifier.size(20.dp))
                }
            }
            Column(Modifier.align(Alignment.BottomCenter)) {
                MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
                TouchNav(lit, onTap = onNav)
            }
            // Its editor (item 74), over the page; the page read again, and the walls told, once it changed the album.
            // Its Share card (item 75), centred above the mini player and the row, as the page keeps room for them.
            if (sharing) album?.let { ShareSheet(it.album.title, it.album.subtitle, it.album.imageKey, zone, 144.dp, client) { sharing = false } }
            if (editing) album?.let { AlbumEditSheet(offset, it.album.title, it.album.subtitle, client, onClose = { editing = false }, onChanged = { loads++ }) }
        }
    }
}
