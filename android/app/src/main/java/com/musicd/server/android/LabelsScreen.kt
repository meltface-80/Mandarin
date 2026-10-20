package com.musicd.server.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.LabelList
import com.musicd.server.client.LabelTile
import com.musicd.server.client.Labels
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.MergedLabel
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The list as last read, kept while the app runs, so Back from a label finds it as it was. */
internal object LabelsKept {
    var list by mutableStateOf<LabelList?>(null)
}

/**
 * The record labels natively (the group B of old/plan-android-native.md, B1; bug list item 71), drawn as the page's
 * (docs/specs/screens.json, labels; labels.js, labels-list.js): the heading with the bar's Back, the order (# to Z, Z to #) at
 * the top right, every label as a tile of the wall (its logo, or its name in words), its name, how many albums and how many
 * merged into it (a tap there, the labels merged into it: [LabelUnmergeSheet]); the row's Search finds a label. While the scan
 * runs, its bar and what it says, the list read again every few seconds; with none, Rescan now and the scan log. A long press
 * selects labels to merge into the first picked, the merge bar along the foot. A label's albums are a wall ([onLabel]).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun LabelsScreen(prefs: WallPrefs, zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onLabel: (String) -> Unit,
                          onNowPlaying: (String) -> Unit, onRoom: (String) -> Unit, onNav: (String) -> Unit, onPage: (String, String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val saved = remember { context.getSharedPreferences("labels", Context.MODE_PRIVATE) }
    var zone by remember { mutableStateOf(zoneId) }
    val room = followRoom(zone, client)
    val (cols, _) = wallColumns(prefs)
    var reversed by remember { mutableStateOf(saved.getBoolean("reversed", false)) }
    var finding by remember { mutableStateOf(false) }
    var find by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf<String?>(null) }
    var reads by remember { mutableStateOf(0) }
    var selecting by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf<List<LabelTile>>(emptyList()) }
    var unmerge by remember { mutableStateOf<LabelTile?>(null) }
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    fun stopSelecting() { selecting = false; picked = emptyList() }
    BackHandler { when { unmerge != null -> unmerge = null; selecting -> stopSelecting(); finding -> { finding = false; find = "" }; else -> onBack() } }
    // Read now, and again every few seconds while the scan runs (sooner while there is nothing yet), or after a failure.
    LaunchedEffect(reads) {
        val c = client() ?: return@LaunchedEffect
        val got = withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.labels() } }
        got.onSuccess { LabelsKept.list = it; failed = null }.onFailure { failed = "Couldn't load labels: " + (it.message ?: "no answer") }
        val l = got.getOrNull()
        val wait = when { l == null -> 10_000L; l.scanning && l.labels.none { it.albumCount >= prefs.labelMin } -> 4_000L; l.scanning -> 5_000L; else -> return@LaunchedEffect }
        delay(wait); reads++
    }
    val list = LabelsKept.list
    val shown = list?.shown(prefs.labelMin, reversed, find).orEmpty()
    val banner = failed?.let { it to true } ?: list?.banner(prefs.labelMin)?.let { it to false }
    fun pick(l: LabelTile) { picked = if (picked.any { it.key == l.key }) picked.filter { it.key != l.key } else picked + l }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), state = rememberLazyGridState(), contentPadding = WALL_PADDING,
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) { if (finding) Box(Modifier.height(2.dp)) else WallHead("Labels", prefs, banner) }
            items(shown.size, key = { "l" + shown[it].key }) { i ->
                val l = shown[i]
                LabelTileView(Modifier.parity("labels.label", Contract.label("labels.label", 0, l.title)).combinedClickable(
                    onLongClick = { if (!selecting) selecting = true; pick(l) }, onClick = { if (selecting) pick(l) else onLabel(l.title) }),
                    l, prefs, picked.indexOfFirst { it.key == l.key }, onMerged = { if (!selecting) unmerge = l })
            }
            if (find.isNotBlank() && shown.isEmpty() && list != null) item("none", span = { GridItemSpan(maxLineSpan) }) {
                Text(Labels.none(find), Modifier.parity("labels.none").fillMaxWidth().padding(vertical = 24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, lineHeight = 20.sp, textAlign = TextAlign.Center)
            }
            if (list != null && list.rescan(prefs.labelMin)) item("rescan", span = { GridItemSpan(maxLineSpan) }) {
                Box(Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                    var starting by remember { mutableStateOf(false) }
                    Box(Modifier.parity("labels.rescan", Contract.label("labels.rescan")).defaultMinSize(minHeight = 40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary)
                        .clickable(enabled = !starting) {
                            val c = client() ?: return@clickable
                            starting = true
                            scope.launch { withContext(Dispatchers.IO) { runCatching { c.rescanLabels() } }; delay(1_000); starting = false; reads++ }
                        }.padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
                        Text(if (starting) "Starting…" else "Rescan now", color = MaterialTheme.colorScheme.onPrimary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
                    }
                }
            }
            // The scan log, as the page offers it beside the tiles: downloaded (shared, here) or copied.
            if (list != null && list.log) item("log") { ScanLog(client) }
        }
        WallBack(onBack)
        if (finding) FindField(find, onFind = { find = it }, onClear = { if (find.isNotEmpty()) find = "" else finding = false })
        else LabelsOrder(reversed) { reversed = !reversed; saved.edit().putBoolean("reversed", reversed).apply() }
        // The scan's bar, along the foot of the bar above (.scan-progress-bar).
        if (list?.scanning == true) Box(Modifier.parity("labels.progress").padding(top = 62.dp).fillMaxWidth().height(2.dp).background(MaterialTheme.colorScheme.outline)) {
            Box(Modifier.fillMaxWidth(list.progress.toFloat().coerceIn(0f, 1f)).height(2.dp).background(MaterialTheme.colorScheme.primary))
        }
        Column(Modifier.align(Alignment.BottomCenter)) {
            MiniPlayer(zone, room, client, onOpen = { onNowPlaying(zone) }, onRoom = { id -> zone = id; onRoom(id) }, onPage = onPage)
            if (selecting) MergeBar(picked, onMerge = {
                val c = client() ?: return@MergeBar
                val items = picked.map { MergedLabel(it.key, it.title) }
                scope.launch {
                    val err = withContext(Dispatchers.IO) { runCatching { c.mergeLabels(items) }.exceptionOrNull() }
                    if (err != null) toast("Merge failed: " + (err.message ?: "no answer")) else { stopSelecting(); reads++ }
                }
            }, onCancel = ::stopSelecting)
            else TouchNav("", offline = OfflineNow.on, onTap = { what -> if (what == "search") finding = true else onNav(what) })
        }
        unmerge?.let { l ->
            LabelUnmergeSheet(l, client, onClose = { unmerge = null }, onChanged = { reads++ })
        }
    }
}

/** A label's tile: its art (the logo on the raised ground, or its name in words), its name, how many albums, how many merged; [pick] its place among those picked (-1: not), the first in brass. */
@Composable
private fun LabelTileView(modifier: Modifier, l: LabelTile, prefs: WallPrefs, pick: Int, onMerged: () -> Unit) {
    val title = (12 * prefs.text).sp; val titleLine = (15 * prefs.text).sp
    val sub = (10.5 * prefs.text).sp; val subLine = (13.65 * prefs.text).sp
    val corners = RoundedCornerShape(12.dp)
    val ring = if (pick == 0) MaterialTheme.colorScheme.secondary else Color.White.copy(alpha = 0.35f)
    Column(modifier.fillMaxWidth()) {
        BoxWithConstraints(Modifier.parity("labels.label-art").fillMaxWidth().aspectRatio(1f).clip(corners)
            .background(if (l.logoUrl != null) Brush.linearGradient(listOf(paletteColor(Palette.BG_ELEV_2), paletteColor(Palette.BG_ELEV_2)))
                else Brush.linearGradient(listOf(paletteColor(Palette.BG_ELEV_2), paletteColor(Palette.BG_ELEV))))
            .border(if (pick >= 0) 2.5.dp else 0.dp, if (pick >= 0) ring else Color.Transparent, corners)) {
            val logo = rememberWebImage(l.logoUrl)
            if (logo != null) Image(logo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.align(Alignment.Center).fillMaxSize(0.8f))
            else {
                // Each word a line, centred, 9% of the tile's inside wide (the page's 9cqw).
                val size = ((maxWidth.value - 16f) * 0.09f).sp
                Column(Modifier.fillMaxSize().padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
                    for (w in l.words) Text(w, color = MaterialTheme.colorScheme.onSurface, fontSize = size, lineHeight = size * 1.2f, fontWeight = FontWeight.W700, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (pick >= 0) Box(Modifier.align(Alignment.TopEnd).padding(5.dp).size(20.dp).clip(CircleShape).background(if (pick == 0) MaterialTheme.colorScheme.secondary else Color.White.copy(alpha = 0.55f)),
                contentAlignment = Alignment.Center) {
                Text("✓", color = if (pick == 0) Color(0xFF0B1418) else Color.Black, fontSize = 13.sp, lineHeight = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
        Text(l.title, Modifier.parity("labels.label-title").padding(top = 11.dp).lineBox(title, titleLine), color = MaterialTheme.colorScheme.onSurface,
            fontSize = title, lineHeight = titleLine, fontWeight = FontWeight.W600, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(l.subtitle, Modifier.parity("labels.label-subtitle").padding(top = 1.dp).lineBox(sub, subLine), color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = sub, lineHeight = subLine, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (l.mergedFrom.isNotEmpty()) Text("${l.mergedFrom.size} merged", Modifier.parity("labels.label-merged", Contract.label("labels.label-merged", 0, l.mergedFrom.size.toString())).padding(top = 1.dp).clickable(onClick = onMerged),
            color = MaterialTheme.colorScheme.secondary, fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 0.02.em)
    }
}

/** The order, top right: the brass pill with "#–Z" or "Z–#" (.labels-sort-btn). */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.LabelsOrder(reversed: Boolean, onTap: () -> Unit) {
    Box(Modifier.parity("labels.order", Contract.label("labels.order", if (reversed) 1 else 0)).align(Alignment.TopEnd).padding(top = 12.dp, end = 14.dp).height(40.dp)
        .defaultMinSize(minWidth = 44.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable(onClick = onTap).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Text(Labels.orderWord(reversed), color = MaterialTheme.colorScheme.onPrimary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W700, letterSpacing = 0.04.em)
    }
}

/** Finding a label: the field in the bar beside Back, its glass and its ✕ (the first tap clears the words, the next closes it). */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.FindField(find: String, onFind: (String) -> Unit, onClear: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Row(Modifier.align(Alignment.TopStart).padding(start = 64.dp, top = 12.dp, end = 14.dp).fillMaxWidth().height(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
        .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BasicTextField(find, onFind, Modifier.parity("labels.find-field", Contract.label("labels.find-field")).weight(1f).focusRequester(focus), singleLine = true,
            textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, lineHeight = 19.sp), cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), decorationBox = { field ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(painterResource(R.drawable.tn_search), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                    Box(Modifier.weight(1f)) {
                        if (find.isEmpty()) Text("Find a label…", color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 19.sp, maxLines = 1)
                        field()
                    }
                }
            })
        Box(Modifier.parity("labels.find-clear", Contract.label("labels.find-clear")).size(32.dp).clip(CircleShape).clickable(onClick = onClear), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
    }
}

/** The merge bar along the foot (.label-merge-bar): what is picked, Merge (open from two), and ✕. */
@Composable
private fun MergeBar(picked: List<LabelTile>, onMerge: () -> Unit, onCancel: () -> Unit) {
    val line = Labels.mergeLine(picked.map { it.title })
    Row(Modifier.fillMaxWidth().background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(buildAnnotatedString {
            append(line.before)
            withStyle(SpanStyle(color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.W700)) { append(line.name) }
            append(line.after)
        }, Modifier.parity("labels.merge-info").weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(Modifier.parity("labels.merge", Contract.label("labels.merge")).height(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = if (line.canMerge) 1f else 0.5f))
            .clickable(enabled = line.canMerge, onClick = onMerge).padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
            Text("Merge", color = MaterialTheme.colorScheme.onPrimary, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500)
        }
        Box(Modifier.parity("labels.merge-cancel", Contract.label("labels.merge-cancel")).size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable(onClick = onCancel), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
    }
}

/** The scan log's two links (.scan-log-link): Download (shared from the phone) and Copy, small and underlined. */
@Composable
private fun ScanLog(client: () -> ServerClient?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf<String?>(null) }
    fun read(then: (String) -> Unit) {
        val c = client() ?: return
        scope.launch { withContext(Dispatchers.IO) { runCatching { c.labelsScanLog() } }.onSuccess(then).onFailure { copied = "Failed"; delay(2_000); copied = null } }
    }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        val link = TextStyle(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f), fontSize = 12.8.sp, lineHeight = 18.sp, textDecoration = TextDecoration.Underline)
        Text("Download scan log", Modifier.parity("labels.log-download", Contract.label("labels.log-download")).clickable {
            read { log -> runCatching { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, log).putExtra(Intent.EXTRA_SUBJECT, "labels-scan.log"), null)) } }
        }, style = link)
        Text(copied ?: "Copy log", Modifier.parity("labels.log-copy", Contract.label("labels.log-copy")).clickable {
            read { log ->
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager)?.setPrimaryClip(ClipData.newPlainText("labels-scan.log", log))
                scope.launch { copied = "Copied!"; delay(2_000); copied = null }
            }
        }, style = link)
    }
}
