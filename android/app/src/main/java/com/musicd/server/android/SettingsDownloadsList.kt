package com.musicd.server.android

import android.app.Activity
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSummary
import com.musicd.server.client.Contract
import com.musicd.server.client.DlAlbum
import com.musicd.server.client.Downloads
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShellRoute
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Settings → Downloads' albums natively (bug list item 91), as the page's (docs/specs/screens.json, settings-downloads-
 * albums; android-downloads.js renderAlbums; android.css .dl-toolbar, .dl-row, .dl-selbar): Select and Clear all; each
 * album with its cover, title, artist and how far it has come, Play on this phone once downloaded and Remove; selecting,
 * a tick box an album, Select all or none, Done, and the bar along the foot that removes the ones ticked. Each removal is
 * asked first, made off the screen's thread, and Home's Downloaded albums row read again once it is done.
 */

/** The albums on the phone ([albums], [used] bytes), their covers asked of [client]; [onBack] to Downloads; [changed] after a removal. */
@Composable
internal fun SettingsDownloadsList(albums: List<DlAlbum>, used: Long, client: () -> ServerClient?, bridge: DownloadsBridge, onBack: () -> Unit, changed: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var selecting by remember { mutableStateOf(false) }
    var chosen by remember { mutableStateOf(setOf<Int>()) }
    val server = remember { mutableStateMapOf<Int, AlbumSummary?>() }
    // The server's own album for each (its cover, and the page it opens), asked for those not asked yet.
    val ids = albums.map { it.id }
    LaunchedEffect(ids) {
        val missing = ids.filter { it !in server }
        val c = client() ?: return@LaunchedEffect
        if (missing.isNotEmpty()) withContext(Dispatchers.IO) { runCatching { c.downloadAlbums(missing) }.getOrNull() }?.forEach { server[it.id] = it.album }
    }
    // What is ticked of the albums still here, and selecting only while there are any (the page's renderAlbums).
    val ticked = chosen.filter { it in ids }.toSet()
    val sel = selecting && albums.isNotEmpty()
    BackHandler(enabled = sel) { selecting = false; chosen = emptySet() }
    // [all]: Clear all, asked as the page asks it.
    fun remove(list: List<DlAlbum>, all: Boolean = false) {
        if (list.isEmpty()) return
        val text = if (all) Downloads.askClearAll(list.size) else Downloads.askRemove(list.map { it.title })
        askFirst(context, text, "Remove") {
            val gone = list.map { it.id }
            chosen = chosen - gone.toSet(); selecting = false
            DownloadStore.removeInBackground(context, gone) {
                (context as? Activity)?.runOnUiThread {
                    Toast.makeText(context, Downloads.removed(gone.size), Toast.LENGTH_SHORT).show()
                    changed()
                    // Home's Downloaded albums row as the phone now has it.
                    client()?.let { c -> scope.launch { HomeKept.loadDownloads(context, c) } }
                }
            }
        }
    }
    fun open(a: DlAlbum) {
        val album = server[a.id] ?: return
        // Settings closed first, as the page's does, then the album's own page.
        val n = NativeShell.nav ?: return
        while (n.currentDestination?.route == ShellRoute.SETTINGS) if (!n.popBackStack()) break
        NativeShell.open(ShellRoute.album(album.offset, NativeShell.zone))
    }
    SettingsFrame(scroll = false) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            SettingsHead(Modifier.parity("settings-downloads-albums.back", Contract.label("settings-downloads-albums.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Downloads", Modifier.parity("settings-downloads-albums.heading"))
            SettingsDesc(Downloads.albumsDesc(albums, used), Modifier.parity("settings-downloads-albums.desc"))
            if (albums.isEmpty()) {
                SetupNote(Downloads.EMPTY, Modifier.parity("settings-downloads-albums.note"))
                return@Column
            }
            // The toolbar (.dl-toolbar): to the right, 10 apart, 8 over the list.
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
                if (sel) {
                    val all = ticked.size == albums.size
                    DlButton(if (all) "Select none" else "Select all", false, Modifier.parity("settings-downloads-albums.select-all", Contract.label("settings-downloads-albums.select-all", if (all) 1 else 0))
                        .clickable { chosen = if (all) emptySet() else albums.map { it.id }.toSet() })
                    DlButton("Done", false, Modifier.parity("settings-downloads-albums.select-close", Contract.label("settings-downloads-albums.select-close")).clickable { selecting = false; chosen = emptySet() })
                } else {
                    DlButton("Select", false, Modifier.parity("settings-downloads-albums.select", Contract.label("settings-downloads-albums.select")).clickable { selecting = true; chosen = emptySet() })
                    DlButton("Clear all", true, Modifier.parity("settings-downloads-albums.clear-all", Contract.label("settings-downloads-albums.clear-all")).clickable { remove(albums, all = true) })
                }
            }
            Block {
                for ((i, a) in albums.withIndex()) AlbumRow(a, server[a.id]?.imageKey ?: a.imageKey, client, sel, a.id in ticked, i == albums.lastIndex,
                    choose = { chosen = if (a.id in ticked) ticked - a.id else ticked + a.id }, open = { open(a) }, play = { bridge.play(a.id) }, remove = { remove(listOf(a)) })
            }
        }
        if (sel) SelBar(ticked.size) { remove(albums.filter { it.id in ticked }) }
    }
}

/**
 * An album's row (.dl-row): 8 over and under, a rule under all but the last, washed in brass while ticked. Selecting, its
 * tick box first and the row a tick; else its cover (52, 8 round), title 15/600, artist 13 dim and how far it has come in
 * 12 faint, then Play once downloaded and Remove, 40 round, brass on the raised ground. One on a card that is out has none.
 */
@Composable
private fun AlbumRow(a: DlAlbum, imageKey: String?, client: () -> ServerClient?, selecting: Boolean, on: Boolean, last: Boolean,
                     choose: () -> Unit, open: () -> Unit, play: () -> Unit, remove: () -> Unit) {
    val accent = paletteColor(Palette.ACCENT)
    Column(Modifier.fillMaxWidth().background(if (on) accent.copy(alpha = 0.08f) else Color.Transparent)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (selecting) Box(Modifier.parity("settings-downloads-albums.check", Contract.label("settings-downloads-albums.check", 0, a.title)).clickable(onClick = choose).size(36.dp, 44.dp),
                contentAlignment = Alignment.CenterStart) { TickBox(on) }
            Row(Modifier.parity("settings-downloads-albums.open", Contract.label("settings-downloads-albums.open", 0, a.title)).weight(1f).clickable(onClick = if (selecting) choose else open),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val cover = rememberTileCover(imageKey, 160, client)
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(8.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
                    if (cover != null) Image(cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.parity("settings-downloads-albums.art").size(52.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(a.title, Modifier.parity("settings-downloads-albums.title"), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(a.artist, Modifier.parity("settings-downloads-albums.artist"), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(Downloads.stateLine(a), Modifier.parity("settings-downloads-albums.state").padding(top = 2.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (!selecting && a.state != "away") {
                if (a.state == "done") RoundButton(R.drawable.dl_play, Modifier.parity("settings-downloads-albums.play", Contract.label("settings-downloads-albums.play")).clickable(onClick = play))
                RoundButton(R.drawable.dl_bin, Modifier.parity("settings-downloads-albums.remove", Contract.label("settings-downloads-albums.remove")).clickable(onClick = remove))
            }
        }
        if (!last) Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
    }
}

/** A row's tick box (.dl-checkbox): 24, 7 round, a faint edge; ticked, brass with the tick in the dark of the brass's text. */
@Composable
private fun TickBox(on: Boolean) {
    val shape = RoundedCornerShape(7.dp)
    val accent = paletteColor(Palette.ACCENT)
    val mark = paletteColor(Palette.ON_ACCENT)
    Box(Modifier.size(24.dp).clip(shape).background(if (on) accent else Color.Transparent).border(2.dp, if (on) accent else paletteColor(Palette.TEXT_FAINT), shape))
    {
        if (on) Canvas(Modifier.size(24.dp).padding(4.dp)) {
            val u = size.width / 24f
            val p = Path().apply { moveTo(5 * u, 12 * u); lineTo(10 * u, 17 * u); lineTo(19 * u, 7 * u) }
            drawPath(p, mark, style = Stroke(width = 3 * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

/** Play or Remove on a row (.dl-btn): 40 round, the raised ground, a hairline, its 18 icon in brass. */
@Composable
private fun RoundButton(icon: Int, modifier: Modifier) {
    Box(modifier.size(40.dp).clip(CircleShape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), CircleShape), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), contentDescription = null, tint = paletteColor(Palette.ACCENT_TEXT), modifier = Modifier.size(18.dp))
    }
}

/** A toolbar's button (.settings-update-btn): 36 tall, 14 in, 8 round, 13 dim, or in the danger's red ([danger]: Clear all, Remove). */
@Composable
private fun DlButton(words: String, danger: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(8.dp)
    Box(modifier.heightIn(min = 36.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center) {
        Text(words, color = paletteColor(if (danger) Palette.DANGER else Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
    }
}

/** The bar along the foot while selecting (.dl-selbar): how many are ticked in 14 dim, and Remove them (dimmed with none). */
@Composable
private fun SelBar(n: Int, remove: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 12.dp).background(paletteColor(Palette.BG_ELEV))) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(Downloads.selected(n), Modifier.parity("settings-downloads-albums.selected").weight(1f), color = paletteColor(Palette.TEXT_DIM), fontSize = 14.sp, lineHeight = 19.sp)
            DlButton(Downloads.removeChosen(n), true, Modifier.parity("settings-downloads-albums.remove-chosen", Contract.label("settings-downloads-albums.remove-chosen", if (n > 0) 1 else 0, n.toString()))
                .alpha(if (n > 0) 1f else 0.5f).clickable(enabled = n > 0, onClick = remove))
        }
    }
}
