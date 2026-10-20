package com.musicd.server.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Browsed
import com.musicd.server.client.Contract
import com.musicd.server.client.FolderSettings
import com.musicd.server.client.LocalFolder
import com.musicd.server.client.MusicFolders
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder
import java.text.DateFormat
import java.util.Date

/*
 * Settings → Music Folders natively (the group T of docs/specs/plan-android-native.md, T5; bug list item 88), as the page's
 * (docs/specs/screens.json, settings-folders; settings-folders.js, android-downloads.js localFolderBlock; style.css .mf-*,
 * android.css .dl-folder): the server's folders as cards (icon, name, path, tracks or what is wrong), Remove where there are
 * more; Add a folder, which browses the server's folders (the drives and shares it sees, Up, the folders in it, Add); then
 * Music on this phone, the app's own folder (LocalMusic): Choose a folder, or the folder with Read again, Change and Forget.
 * An add or a remove goes on the app's lane of changes to what Home shows (ServerWrites, item 85).
 */

/** Settings' Music Folders ([client]: the server's, [onBack]: back to Settings). */
@Composable
internal fun SettingsFolders(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var folders by remember { mutableStateOf<MusicFolders?>(null) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var browsing by remember { mutableStateOf<Browsed?>(null) }
    var loadingDirs by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    suspend fun load() {
        val c = client() ?: run { err = FolderSettings.UNREACHABLE; return }
        withContext(Dispatchers.IO) { runCatching { FolderSettings.parse(c.getJson("/api/library/folders")) } }
            .onSuccess { folders = it; err = "" }.onFailure { folders = null; err = it.message ?: FolderSettings.UNREACHABLE }
    }
    // Open at once (the page's), the folders filling in when the server answers.
    fun browse(path: String) {
        val c = client() ?: return
        if (browsing == null) { browsing = Browsed(path, null, emptyList(), null); loadingDirs = true }
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { FolderSettings.browsed(c.getJson("/api/library/browse?path=" + URLEncoder.encode(path, "UTF-8"))) } }
                .onSuccess { browsing = it; err = "" }.onFailure { err = it.message ?: "Couldn’t open it"; if (browsing == null) browsing = Browsed("/", null, emptyList(), null) }
            loadingDirs = false
        }
    }
    // An add or a remove, made on the lane: the server's answer kept over what was, or what went wrong said.
    fun change(body: JSONObject, done: (JSONObject) -> Unit) {
        val c = client() ?: return
        busy = true
        val made = ServerWrites.write { c.post("/api/library/folders", body, 60_000) }
        scope.launch {
            ServerWrites.await(made).onSuccess { j -> folders = folders?.let { FolderSettings.after(it, j) }; err = ""; done(j) }.onFailure { err = it.message ?: "Couldn’t change it" }
            busy = false
        }
    }
    // Read on opening, then again every four seconds while the server is reading the folders (the counts follow).
    LaunchedEffect(Unit) { while (true) { if (browsing == null && !busy) load(); delay(if (folders?.scanning == true) 4_000L else 30_000L) } }
    val back = { if (browsing != null) { browsing = null; err = "" } else onBack() }
    BackHandler(enabled = browsing != null) { browsing = null; err = "" }
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-folders.back", Contract.label("settings-folders.back")).clip(CircleShape).clickable(onClick = back), R.drawable.np_back,
                "Music Folders", Modifier.parity("settings-folders.heading"))
            SettingsDesc("Where your library is read from", Modifier.parity("settings-folders.desc"))
            Block {
                val b = browsing
                val f = folders
                if (b != null) Browser(b, f, busy, loadingDirs, ::browse, onCancel = { browsing = null; err = "" }) {
                    change(JSONObject().put("add", b.path)) { browsing = null; setupToast(context, FolderSettings.ADDED) }
                } else if (f != null) {
                    Column(Modifier.padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (folder in f.folders) FolderCard(folder, if (!f.removable) null else Modifier.parity("settings-folders.remove", Contract.label("settings-folders.remove"))
                            .clickable(enabled = !busy) {
                                asking = FolderSettings.removeQuestion(folder) to { change(JSONObject().put("remove", folder.path)) { j -> setupToast(context, FolderSettings.removed(folder, j)) } }
                            }, busy)
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        SetupButton("Add a folder", busy, Modifier.parity("settings-folders.add", Contract.label("settings-folders.add")).clickable(enabled = !busy) { err = ""; browse("/") })
                    }
                    if (f.scanning) SetupNote(FolderSettings.SCANNING, Modifier.parity("settings-folders.note"))
                    Text(buildAnnotatedString { for ((t, bold) in FolderSettings.note(f.docker)) if (bold) withStyle(SpanStyle(fontWeight = FontWeight.W700)) { append(t) } else append(t) },
                        Modifier.parity("settings-folders.note").padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
                }
                if (err.isNotEmpty()) Text(err, Modifier.parity("settings-folders.error").padding(top = 6.dp), color = paletteColor(Palette.DANGER), fontSize = 12.sp, lineHeight = 17.4.sp)
                if (b == null) {
                    // The rule between the server's folders and the phone's (.settings-divider).
                    Box(Modifier.padding(vertical = 18.dp).parity("settings-folders.divider").fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
                    PhoneFolder({ info = it }) { q, yes -> asking = q to yes }
                }
            }
        }
        info?.let { InfoTip(it, Modifier.parity("settings-folders.info")) }
        asking?.let { (q, yes) -> ConfirmDialog(q) { ok -> asking = null; if (ok) yes() } }
    }
}

/** A folder of the server's (.mf-row): its icon on the dark ground, its name, path and tracks (red when it is gone), [remove] where offered. */
@Composable
private fun FolderCard(f: com.musicd.server.client.MusicFolder, remove: Modifier?, busy: Boolean) {
    val shape = RoundedCornerShape(14.dp)
    Row(Modifier.parity("settings-folders.folder").fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)
        .padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        IconTile(R.drawable.st_folders, 36, 10, 20)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(f.name, Modifier.parity("settings-folders.name"), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(f.path, Modifier.parity("settings-folders.path"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp)
            Text(f.state(), Modifier.parity("settings-folders.state"), color = paletteColor(if (f.bad) Palette.DANGER else Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp)
            f.hint?.let { Text(it, Modifier.parity("settings-folders.hint"), color = paletteColor(Palette.DANGER), fontSize = 13.sp, lineHeight = 18.sp) }
        }
        if (remove != null) SetupButton("Remove", busy, remove)
    }
}

/** An icon on the dark ground (.mf-ico, .dl-folder-ico): [box] square, [round] round, the icon [icon] in the accent's text colour. */
@Composable
private fun IconTile(drawable: Int, box: Int, round: Int, icon: Int) {
    Box(Modifier.parity("settings-folders.icon").size(box.dp).clip(RoundedCornerShape(round.dp)).background(paletteColor(Palette.BG_ELEV)), contentAlignment = Alignment.Center) {
        Icon(painterResource(drawable), contentDescription = null, tint = paletteColor(Palette.ACCENT_TEXT), modifier = Modifier.size(icon.dp))
    }
}

/**
 * Choosing a folder to add (.mf-browse-*): Cancel and where it is; the drives and shares the server sees; the folders in it in
 * a box of their own (55% of the screen at most, scrolled), Up first; then Add it, or that it is in the library already.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Browser(b: Browsed, folders: MusicFolders?, busy: Boolean, loading: Boolean, go: (String) -> Unit, onCancel: () -> Unit, onChoose: () -> Unit) {
    Row(Modifier.padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        SetupButton("Cancel", false, Modifier.parity("settings-folders.add-close", Contract.label("settings-folders.add-close")).clickable(onClick = onCancel))
        Text(b.path, Modifier.parity("settings-folders.browse-path").weight(1f), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp)
    }
    val places = folders?.mounts.orEmpty()
    if (places.isNotEmpty()) FlowRow(Modifier.padding(bottom = 10.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(FolderSettings.PLACES.uppercase(), Modifier.parity("settings-folders.places-label").fillMaxWidth(), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp,
            fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        for (m in places) {
            val pill = RoundedCornerShape(999.dp)
            val tone = if (m.waiting) Palette.DANGER else if (m.path == b.path) Palette.ACCENT_TEXT else Palette.TEXT
            Text(m.path, Modifier.parity("settings-folders.place", Contract.label("settings-folders.place", 0, m.path)).clip(pill).background(paletteColor(Palette.BG_ELEV_2))
                .border(1.dp, paletteColor(if (m.waiting) Palette.DANGER else if (m.path == b.path) Palette.ACCENT else Palette.BORDER), pill).clickable { go(m.path) }
                .padding(horizontal = 12.dp, vertical = 6.dp), color = paletteColor(tone), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    b.hint?.let { Text(it, Modifier.parity("settings-folders.browse-hint").padding(bottom = 10.dp), color = paletteColor(Palette.DANGER), fontSize = 12.sp, lineHeight = 17.4.sp) }
    val box = RoundedCornerShape(14.dp)
    val watched = folders?.folders?.map { it.path }?.toSet().orEmpty()
    Column(Modifier.fillMaxWidth().heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.55f).dp).clip(box).background(paletteColor(Palette.BG_ELEV_2))
        .border(1.dp, paletteColor(Palette.BORDER), box).verticalScroll(rememberScrollState())) {
        val rows = (if (b.parent != null) listOf<Pair<String, String>?>(null) else emptyList()) + b.dirs
        rows.forEachIndexed { i, d ->
            val last = i == rows.lastIndex
            if (d == null) DirRow(Modifier.parity("settings-folders.up", Contract.label("settings-folders.up")).clickable { go(b.parent.orEmpty()) }, "Up", null, last, up = true)
            else DirRow(Modifier.parity("settings-folders.dir", Contract.label("settings-folders.dir", 0, d.first)).clickable { go(d.second) }, d.first, if (d.second in watched) FolderSettings.TAG else null, last)
        }
        if (b.dirs.isEmpty() && !loading) SetupNote(FolderSettings.NO_FOLDERS, Modifier.parity("settings-folders.browse-note").padding(horizontal = 14.dp).padding(bottom = 10.dp))
    }
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.End) {
        val inside = FolderSettings.inside(folders, b.path)
        if (inside != null) Text("Already in the library ($inside)", Modifier.parity("settings-folders.browse-note"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
        else {
            val words = FolderSettings.chooseWords(b.path)
            val can = !busy && !loading && b.path != "/"
            SetupButton(words, !can, Modifier.parity("settings-folders.choose", Contract.label("settings-folders.choose", 0, words.removePrefix("Add “").removeSuffix("”"))).widthIn(max = 372.dp)
                .clickable(enabled = can, onClick = onChoose))
        }
    }
}

/** A folder in the box (.mf-dir): 10 and 14 in, its icon (Up's ↰), its name in 16/500, [tag] in the accent; a rule under all but the last. */
@Composable
private fun DirRow(modifier: Modifier, name: String, tag: String?, last: Boolean, up: Boolean = false) {
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (up) Box(Modifier.parity("settings-folders.icon").size(36.dp).clip(RoundedCornerShape(10.dp)).background(paletteColor(Palette.BG_ELEV)), contentAlignment = Alignment.Center) {
                Text("↰", color = paletteColor(Palette.ACCENT_TEXT), fontSize = 18.sp, lineHeight = 18.sp)
            } else IconTile(R.drawable.st_folders, 36, 10, 20)
            Text(name, Modifier.weight(1f), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W500)
            tag?.let { Text(it, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 12.sp, lineHeight = 17.sp) }
        }
        if (!last) Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
    }
}

/**
 * Music on this phone (android-downloads.js localFolderBlock, android.css .settings-subhead and .dl-folder): its title with
 * its ⓘ; no folder and Choose a folder, or the folder (its name, its albums and tracks and when it was read), what went
 * wrong, Read again, Change folder and Forget. Read from LocalMusic every second and a half while open.
 */
@Composable
private fun PhoneFolder(info: (String) -> Unit, ask: (String, () -> Unit) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var local by remember { mutableStateOf<LocalFolder?>(null) }
    val dates = remember { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT) }
    fun read(): LocalFolder? = if (Store.localFolder(context) == null) null else
        LocalFolder(LocalMusic.folderName(context) ?: "Folder", LocalMusic.albums.size, LocalMusic.albums.sumOf { it.tracks.size }, LocalMusic.scanning, LocalMusic.scannedAt,
            LocalMusic.available(context), LocalMusic.lastError)
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) { LocalMusic.load(context) }
        while (true) { local = withContext(Dispatchers.IO) { read() }; delay(1_500) }
    }
    val choose = { (context as? MainActivity)?.pickLocalFolder(); Unit }
    Column(Modifier.padding(vertical = 4.dp)) {
        Row(Modifier.padding(top = 4.dp, bottom = 10.dp).heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("MUSIC ON THIS PHONE", Modifier.parity("settings-folders.local-title"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp,
                fontWeight = FontWeight.W700, letterSpacing = 0.08.em)
            Box(Modifier.parity("settings-folders.info", Contract.label("settings-folders.info", 0, "Music on this phone")).clickable { info(FolderSettings.LOCAL_INFO) }.size(32.dp).padding(start = 4.dp),
                contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 12.sp) }
        }
        val l = local
        if (l == null) {
            SetupRow("No folder chosen", Modifier.parity("settings-folders.local-none"), null) {
                SetupButton("Choose a folder", false, Modifier.parity("settings-folders.local-choose", Contract.label("settings-folders.local-choose")).clickable { choose() })
            }
            SetupNote(FolderSettings.LOCAL_NONE_NOTE, Modifier.parity("settings-folders.local-note"))
        } else LocalFolderCard(l, { dates.format(Date(it)) }, onRescan = { scope.launch(Dispatchers.IO) { LocalMusic.rescan(context, force = true) } }, onChoose = choose,
            onForget = { ask(FolderSettings.FORGET_QUESTION) { scope.launch(Dispatchers.IO) { LocalMusic.forget(context) } } })
    }
}

/** The phone's folder (.dl-folder) and its buttons (.dl-toolbar): Read again (dim while reading), Change folder, Forget. */
@Composable
private fun LocalFolderCard(l: LocalFolder, at: (Long) -> String, onRescan: () -> Unit, onChoose: () -> Unit, onForget: () -> Unit) {
    Column {
        val shape = RoundedCornerShape(14.dp)
        Row(Modifier.parity("settings-folders.local-folder").fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)
            .padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            IconTile(R.drawable.st_services, 40, 11, 22)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(l.name, Modifier.parity("settings-folders.local-name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
                Text(FolderSettings.localState(l, at), Modifier.parity("settings-folders.local-state"), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        l.error?.takeIf { it.isNotEmpty() }?.let { Text(it, Modifier.parity("settings-folders.local-error").padding(top = 6.dp), color = paletteColor(Palette.DANGER), fontSize = 12.sp, lineHeight = 17.4.sp) }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SetupButton("Read again", l.scanning, Modifier.parity("settings-folders.local-rescan", Contract.label("settings-folders.local-rescan")).clickable(enabled = !l.scanning, onClick = onRescan))
            SetupButton("Change folder", false, Modifier.parity("settings-folders.local-choose", Contract.label("settings-folders.local-choose", 1)).clickable(onClick = onChoose))
            SetupButton("Forget", false, Modifier.parity("settings-folders.local-forget", Contract.label("settings-folders.local-forget")).clickable(onClick = onForget))
        }
    }
}
