package com.musicd.server.android

import android.app.TimePickerDialog
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import com.musicd.server.client.Contract
import com.musicd.server.client.Scanner
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SettingsKept
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * Settings → Library Scanner natively (the group T of old/plan-android-native.md, T7; bug list items 90 and 411), as the
 * page's (docs/specs/screens.json, settings-scanner; settings-scanner.js and its parts; style.css .scan-*, .id-*): the
 * Album Scanner's one switch, and while it is on its sections in order (ScannerSections.kt) — Progress, the albums to
 * place by hand as folders, Schedule, the MusicBrainz pack (ScannerPack.kt), Library clean-up and the Processor; off,
 * the switch and its note alone. A folder opened shows its albums (ScannerLists.kt), Back closing it. Each section
 * drawn from its own answer as it comes, as last seen until then; asked again every five seconds while the page is
 * open (not while an album is being matched or the pack's folder chosen). Changes are made on the app's lane of
 * changes (ServerWrites, item 85).
 */

/** The Album Scanner (GET /api/album-scanner), and its clean-up: kept as last read (item 198). */
private const val SCANNER = "/api/album-scanner"
private const val CLEANUP = "/api/library/cleanup"

/** What the page holds: each section's answer, the folder open and its albums, and what is under way here. */
internal class ScanKept {
    var scan by mutableStateOf<JSONObject?>(null)
    var cpu by mutableStateOf<JSONObject?>(null)
    var cleanup by mutableStateOf<JSONObject?>(null)
    var pack by mutableStateOf<JSONObject?>(null)
    var folder by mutableStateOf<String?>(null)
    var lists by mutableStateOf<JSONObject?>(null)
    var listsAt = ""
    var busy by mutableStateOf(false)
    var err by mutableStateOf("")
    var more by mutableStateOf(false)
    var matching by mutableStateOf<Long?>(null)
    var draft by mutableStateOf("")
    var browse by mutableStateOf<JSONObject?>(null)
    var places by mutableStateOf<List<String>>(emptyList())
    var ticks = 0
}

/** Settings' Library Scanner ([client]: the server's, [onBack]: back to Settings). */
@Composable
internal fun SettingsScanner(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // As last seen, then the server's (item 198): before, every switch drew off until the server answered.
    val k = remember { ScanKept().apply { scan = SettingsKept.last(SCANNER); cleanup = SettingsKept.last(CLEANUP) } }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    DisposableEffect(Unit) { toast = { setupToast(context, it) }; onDispose { toast = null } }
    // Opened: every section asked for; then what moves, every five seconds.
    LaunchedEffect(Unit) {
        scanLoad(k, client, scope, true)
        while (true) {
            delay(5_000)
            untilOnScreen()
            if (!k.busy && k.matching == null && k.browse == null) scanLoad(k, client, scope, false)
        }
    }
    // A folder open: back closes it, not the page.
    BackHandler(enabled = k.folder != null) { closeFolder(k) }
    val scan = k.scan
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-scanner.back", Contract.label("settings-scanner.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Library Scanner", Modifier.parity("settings-scanner.heading"))
            // A folder open: its albums alone, as the page draws it; else the switch, and its sections while it is on.
            val folder = k.folder
            if (folder != null) FolderView(k, folder, client, scope, context)
            else {
                ScannerSwitch(k, client, scope) { info = it }
                if (scan != null && scan.optBoolean("on")) {
                    ScannerProgress(scan)
                    ScannerFolders(k, client, scope)
                    ScannerSchedule(k, client, scope)
                    PackBlock(k, client, scope) { info = it }
                    ScannerCleanup(k, client, scope, context) { info = it }
                    ScannerCpu(k, client, scope) { info = it }
                }
            }
            if (k.err.isNotEmpty() && k.browse == null) ScanNote("", error = k.err)
        }
        info?.let { InfoTip(it, Modifier.parity("settings-scanner.info")) }
    }
}

/**
 * Each answer asked for on its own and shown as it comes (the page's scanLoad): [opening] the page has just been
 * opened, so the pack and the clean-up too; otherwise what moves, and a folder's albums when their counts did.
 */
internal fun scanLoad(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, opening: Boolean) {
    val c = client() ?: return
    fun get(path: String, set: (JSONObject) -> Unit) = scope.launch {
        withContext(Dispatchers.IO) { runCatching { c.getJson(path) } }.onSuccess(set).onFailure { if (path == SCANNER) k.err = com.musicd.server.client.Failure.said(it, "") }
    }
    get(SCANNER) { k.scan = it; k.err = ""; if (k.folder != null && (k.lists == null || Scanner.countsOf(it) != k.listsAt)) loadLists(k, c, scope) }
    get("/api/cpu") { k.cpu = it }
    if (opening || ++k.ticks % 6 == 0) get(CLEANUP) { k.cleanup = it }
    if (opening || k.pack?.optBoolean("checking") == true) get("/api/identify/pack" + if (opening) "?check=1" else "") { k.pack = it; followPack(k, c, scope) }
}

/** The folder's albums: the first 60, or up to 500 once Show all is tapped. */
internal fun loadLists(k: ScanKept, c: ServerClient, scope: CoroutineScope) {
    val wanted = Scanner.countsOf(k.scan)
    scope.launch {
        withContext(Dispatchers.IO) { runCatching { c.getJson("/api/identify?lists=" + if (k.more) 500 else Scanner.SHOW) } }
            .onSuccess { k.lists = it; k.listsAt = wanted }
    }
}

/** A folder opened ([kind]: unidentified or proposed): its albums asked for. */
internal fun openFolder(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, kind: String) {
    k.folder = kind; k.lists = null; k.more = false; k.matching = null; k.draft = ""
    client()?.let { loadLists(k, it, scope) }
}

internal fun closeFolder(k: ScanKept) { k.folder = null; k.lists = null; k.matching = null }

/** The switch, Schedule's or its hours ([patch], as POSTed): moved as it is tapped (item 200), back where it was if refused. */
internal fun setScanner(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, patch: JSONObject) {
    if (k.busy) return
    val c = client() ?: return
    k.busy = true
    val before = k.scan
    k.scan = Scanner.withScanner(before, patch)
    val made = ServerWrites.write { c.post(SCANNER, patch) }
    scope.launch {
        ServerWrites.await(made).onSuccess { k.scan = it; k.err = "" }.onFailure { k.scan = before; k.err = com.musicd.server.client.Failure.said(it, "Couldn't reach the server") }
        k.busy = false
    }
}

/** An album's action or Check them all again ([path], [body]): its answer is identification's, with the lists; [done] said once made. */
internal fun scanAct(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, context: Context, path: String, body: JSONObject, done: String? = null, then: () -> Unit = {}) {
    if (k.busy) return
    val c = client() ?: return
    k.busy = true
    val made = ServerWrites.aside { c.post(path, body, 120_000) }
    scope.launch {
        ServerWrites.await(made).onSuccess { st ->
            k.err = ""; done?.let { setupToast(context, it) }
            if (st.has("proposed")) { k.lists = st; k.listsAt = "" }
            then()
        }.onFailure { k.err = com.musicd.server.client.Failure.said(it, "Couldn't reach the server") }
        k.busy = false
        scanLoad(k, client, scope, false)
    }
}

/** A kind of album removed by the clean-up (asked first); its counts the answer's. */
internal fun cleanUp(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, context: Context, kind: String) {
    if (k.busy) return
    val c = client() ?: return
    k.busy = true
    val made = ServerWrites.aside { c.post(CLEANUP, JSONObject().put("kind", kind), 120_000) }
    scope.launch {
        ServerWrites.await(made).onSuccess { r -> r.optJSONObject("count")?.let { k.cleanup = it }; k.err = ""; setupToast(context, "Removed") }
            .onFailure { k.err = com.musicd.server.client.Failure.said(it, "Couldn't reach the server") }
        k.busy = false
    }
}

internal fun pickTime(context: Context, now: String, onPick: (String) -> Unit) {
    val (h, m) = now.split(":").map { it.toIntOrNull() ?: 0 }.let { (it.getOrElse(0) { 0 }) to (it.getOrElse(1) { 0 }) }
    TimePickerDialog(context, { _, hh, mm -> val t = "%02d:%02d".format(hh, mm); if (t != now) onPick(t) }, h, m, android.text.format.DateFormat.is24HourFormat(context)).show()
}
