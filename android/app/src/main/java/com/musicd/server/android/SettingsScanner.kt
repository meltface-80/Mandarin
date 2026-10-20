package com.musicd.server.android

import android.app.AlertDialog
import android.app.TimePickerDialog
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.Scanner
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * Settings → Library Scanner natively (the group T of old/plan-android-native.md, T7; bug list item 90), as the
 * page's (docs/specs/screens.json, settings-scanner; settings-scanner.js and settings-scanner-albums.js; style.css
 * #identify-pane-body, .id-*): the schedule and what runs now, Identify albums and Ask iTunes too, the MusicBrainz pack
 * (ScannerPack.kt), identification's progress, Measure ReplayGain, Clean up, the processor, and the proposed, unidentified,
 * applied and declined albums (ScannerLists.kt). Each block drawn from its own answer as it comes, "…" until then; asked
 * again every five seconds while the page is open (not while an album is being matched or the pack's folder chosen).
 * Changes are made on the app's lane of changes (ServerWrites, item 85).
 */

/** What the page holds: each block's answer, the lists, and what is under way here. */
internal class ScanKept {
    var st by mutableStateOf<JSONObject?>(null)
    var loud by mutableStateOf<JSONObject?>(null)
    var cpu by mutableStateOf<JSONObject?>(null)
    var cleanup by mutableStateOf<JSONObject?>(null)
    var pack by mutableStateOf<JSONObject?>(null)
    var lists by mutableStateOf<JSONObject?>(null)
    var listsAt = ""
    var busy by mutableStateOf(false)
    var err by mutableStateOf("")
    var more by mutableStateOf(setOf<String>())
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
    val k = remember { ScanKept() }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    DisposableEffect(Unit) { toast = { setupToast(context, it) }; onDispose { toast = null } }
    // Opened: every block asked for; then what moves, every five seconds.
    LaunchedEffect(Unit) {
        scanLoad(k, client, scope, true)
        while (true) {
            delay(5_000)
            if (!k.busy && k.matching == null && k.browse == null) scanLoad(k, client, scope, false)
        }
    }
    val st = k.st; val s = st?.optJSONObject("settings")
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-scanner.back", Contract.label("settings-scanner.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "Library Scanner", Modifier.parity("settings-scanner.heading"))
            // The schedule: when identification and ReplayGain run, and what runs now.
            Block {
                ScanTitle("Schedule", null)
                ScanRow("Scheduling", SCHEDULE_INFO, info = { info = it }) {
                    Toggle(s?.optBoolean("schedule") == true, Modifier.parity("settings-scanner.schedule", Contract.label("settings-scanner.schedule"))
                        .clickable(enabled = s != null && !k.busy) { scanAct(k, client, scope, context, "/api/identify/settings", JSONObject().put("schedule", s?.optBoolean("schedule") != true)) })
                }
                val sch = s?.takeIf { it.optBoolean("schedule") }
                if (sch != null) {
                    fun set(which: String) = pickTime(context, sch.optString(which)) { t -> scanAct(k, client, scope, context, "/api/identify/settings", JSONObject().put(which, t)) }
                    ScanRow("Start", null, Modifier.padding(top = 8.dp)) {
                        TimeBox(sch.optString("start"), Modifier.parity("settings-scanner.start", Contract.label("settings-scanner.start")).clickable(enabled = !k.busy) { set("start") })
                    }
                    ScanRow("End", null, Modifier.padding(top = 8.dp)) {
                        TimeBox(sch.optString("end"), Modifier.parity("settings-scanner.end", Contract.label("settings-scanner.end")).clickable(enabled = !k.busy) { set("end") })
                    }
                    ScanNote("Each night, on the server’s clock: identification, then ReplayGain.")
                } else ScanNote(if (s != null) "Identification, then ReplayGain, whenever the library isn’t being scanned, until done." else "…")
                ScanProgress(st?.let { Scanner.nowLine(it, k.loud) })
            }
            ScanDivider()
            Block {
                ScanRow("Identify albums", IDENTIFY_INFO, info = { info = it }) {
                    Toggle(s?.optBoolean("enabled") == true, Modifier.parity("settings-scanner.identify", Contract.label("settings-scanner.identify"))
                        .clickable(enabled = s != null && !k.busy) { scanAct(k, client, scope, context, "/api/identify/settings", JSONObject().put("enabled", s?.optBoolean("enabled") != true)) })
                }
                ScanNote("The right names for each album, from its files and MusicBrainz.")
                ScanRow("Ask iTunes too", ITUNES_INFO, info = { info = it }) {
                    val on = s != null && s.opt("itunes") != false
                    Toggle(on, Modifier.parity("settings-scanner.itunes", Contract.label("settings-scanner.itunes"))
                        .clickable(enabled = s != null && !k.busy) { scanAct(k, client, scope, context, "/api/identify/settings", JSONObject().put("itunes", !on)) })
                }
                ScanNote("A second opinion for what MusicBrainz can’t place.")
            }
            PackBlock(k, client, scope) { info = it }
            ScanDivider()
            Block {
                ScanTitle("Identification progress", null)
                ScanProgress(Scanner.progressLine(st))
                ScanNote(st?.let { Scanner.scanStatus(it) } ?: "…")
                if (Scanner.canRecheck(st)) Row(Modifier.fillMaxWidth().padding(top = 12.dp).heightIn(min = 40.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    SetupButton("Check the proposed and unidentified again", k.busy, Modifier.parity("settings-scanner.recheck-all", Contract.label("settings-scanner.recheck-all")).clickable(enabled = !k.busy) {
                        scanAct(k, client, scope, context, "/api/identify/recheck-all", JSONObject(), "They will be looked at again")
                    })
                }
            }
            ScanDivider()
            Block {
                val loud = k.loud; val measuring = loud?.optJSONObject("settings")?.optBoolean("measure") == true
                ScanRow("Measure ReplayGain", MEASURE_INFO, info = { info = it }) {
                    Toggle(measuring, Modifier.parity("settings-scanner.measure", Contract.label("settings-scanner.measure")).clickable(enabled = loud != null && !k.busy) {
                        val c = client() ?: return@clickable
                        k.busy = true
                        val made = ServerWrites.write { c.post("/api/loudness", JSONObject().put("measure", !measuring)) }
                        scope.launch { ServerWrites.await(made).onSuccess { k.loud = it; k.err = "" }.onFailure { k.err = it.message ?: "Couldn't reach the server" }; k.busy = false }
                    })
                }
                ScanNote("Loudness for your files without ReplayGain tags.")
                ScanProgress(Scanner.loudLine(loud), top = 0)
                Scanner.streamedNote(loud)?.let { ScanNote(it) }
                if (measuring) ScanNote(Scanner.loudStatus(st, loud))
            }
            ScanDivider()
            CleanupBlock(k, client, scope, context) { info = it }
            ScanDivider()
            Block {
                ScanTitle("Processor", CPU_INFO, info = { info = it })
                ScanProgress(Scanner.cpuLine(k.cpu))
                ScanNote(Scanner.cpuNote(k.cpu))
            }
            ScanLists(k, client, scope, context)
            if (k.err.isNotEmpty() && k.browse == null) ScanNote("", error = k.err)
        }
        info?.let { InfoTip(it, Modifier.parity("settings-scanner.info")) }
    }
}

/** Clean up: what could go, counted; only what is pressed goes, once asked. */
@Composable
private fun CleanupBlock(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, context: Context, info: (String) -> Unit) {
    val cleanup = k.cleanup
    Block {
        ScanTitle("Clean up", CLEANUP_INFO, info = info)
        for ((kind, name) in listOf("files" to "Files gone from the server", "qobuz" to "Qobuz albums no longer wanted", "tidal" to "Tidal albums no longer wanted")) {
            ScanRow(name, null, if (kind == "tidal") Modifier.padding(top = 8.dp) else Modifier) {
                val words = Scanner.cleanupButton(cleanup, kind)
                if (cleanup == null) ScanWait()
                else if (words == null) ScanNote("Nothing to remove")
                else SetupButton(words, k.busy, Modifier.parity("settings-scanner.cleanup", Contract.label("settings-scanner.cleanup", 0, words.removePrefix("Remove "))).clickable(enabled = !k.busy) {
                    val n = cleanup.optJSONObject(kind)?.optInt("albums") ?: 0
                    AlertDialog.Builder(context).setMessage(Scanner.cleanupQuestion(kind, n)).setNegativeButton("Cancel", null)
                        .setPositiveButton("Remove") { _, _ -> scanAct(k, client, scope, context, "/api/library/cleanup", JSONObject().put("kind", kind), "Removed") }.show()
                })
            }
            if (kind == "files") ScanNote(Scanner.filesNote(cleanup))
        }
        ScanNote(Scanner.servicesNote(cleanup))
    }
}

/**
 * Each block's answer asked for on its own and shown as it comes (the page's scanLoad): [opening] the page has just been
 * opened, so the pack and the clean-up too, and the lists; otherwise what moves, and the lists when their counts did.
 */
internal fun scanLoad(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, opening: Boolean) {
    val c = client() ?: return
    fun get(path: String, set: (JSONObject) -> Unit) = scope.launch {
        withContext(Dispatchers.IO) { runCatching { c.getJson(path) } }.onSuccess(set).onFailure { if (path.startsWith("/api/identify?")) k.err = it.message ?: "" }
    }
    get("/api/identify?lists=0") { k.st = it; k.err = ""; if (opening || k.lists == null || Scanner.countsOf(it) != k.listsAt) loadLists(k, c, scope) }
    get("/api/loudness") { k.loud = it }
    get("/api/cpu") { k.cpu = it }
    if (opening || ++k.ticks % 6 == 0) get("/api/library/cleanup") { k.cleanup = it }
    if (opening || k.pack?.optBoolean("checking") == true) get("/api/identify/pack" + if (opening) "?check=1" else "") { k.pack = it; followPack(k, c, scope) }
}

/** The lists: the first 60 of each, or up to 500 once one of them is shown in full. */
internal fun loadLists(k: ScanKept, c: ServerClient, scope: CoroutineScope) {
    val wanted = Scanner.countsOf(k.st)
    scope.launch {
        withContext(Dispatchers.IO) { runCatching { c.getJson("/api/identify?lists=" + if (k.more.isNotEmpty()) 500 else Scanner.SHOW) } }
            .onSuccess { k.lists = it; k.listsAt = Scanner.countsOf(it).ifEmpty { wanted } }
    }
}

/** A change to the scanner ([path], [body]): its answer is the scanner's state, and the lists with it; [done] said once made. */
internal fun scanAct(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, context: Context, path: String, body: JSONObject, done: String? = null, then: () -> Unit = {}) {
    if (k.busy) return
    val c = client() ?: return
    k.busy = true
    val made = ServerWrites.write { c.post(path, body, 120_000) }
    scope.launch {
        ServerWrites.await(made).onSuccess { st ->
            k.st = st; k.err = ""; done?.let { setupToast(context, it) }
            if (st.has("proposed")) { k.lists = st; k.listsAt = Scanner.countsOf(st) }
            if (path == "/api/library/cleanup") scanLoad(k, client, scope, true)
            then()
        }.onFailure { k.err = it.message ?: "Couldn't reach the server" }
        k.busy = false
    }
}

private fun pickTime(context: Context, now: String, onPick: (String) -> Unit) {
    val (h, m) = now.split(":").map { it.toIntOrNull() ?: 0 }.let { (it.getOrElse(0) { 0 }) to (it.getOrElse(1) { 0 }) }
    TimePickerDialog(context, { _, hh, mm -> val t = "%02d:%02d".format(hh, mm); if (t != now) onPick(t) }, h, m, android.text.format.DateFormat.is24HourFormat(context)).show()
}

/** A row of the scanner's (#identify-pane-body .settings-row): 40 tall at least, its name in 16 with its ⓘ after it (wrapping under where it must), [control] on the right. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ScanRow(name: String, infoText: String?, modifier: Modifier = Modifier, info: (String) -> Unit = {}, control: @Composable () -> Unit) {
    Row(modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        FlowRow(Modifier.weight(1f), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(name, Modifier.parity("settings-scanner.name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
            if (infoText != null) Box(Modifier.parity("settings-scanner.info", Contract.label("settings-scanner.info", 0, name)).clickable { info(infoText) }.size(32.dp).padding(start = 4.dp),
                contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 16.sp) }
        }
        control()
    }
}

/** A block's title (.settings-block-title), with its ⓘ where it has one; 10 under it. */
@Composable
internal fun ScanTitle(text: String, infoText: String?, info: (String) -> Unit = {}) {
    Row(Modifier.padding(bottom = 10.dp).heightIn(min = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), Modifier.parity("settings-scanner.title"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        if (infoText != null) Box(Modifier.parity("settings-scanner.info", Contract.label("settings-scanner.info", 0, text)).clickable { info(infoText) }.size(32.dp).padding(start = 4.dp),
            contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 13.sp) }
    }
}

/** A note (.settings-note): 12 faint in 1.45, [top] over it; what went wrong after it in red ([error]). */
@Composable
internal fun ScanNote(text: String, error: String? = null, top: Int = 6) {
    val t = buildAnnotatedString {
        append(text)
        if (error != null) withStyle(SpanStyle(color = paletteColor(Palette.DANGER))) { append((if (text.isEmpty()) "" else " ") + error) }
    }
    Text(t, Modifier.parity("settings-scanner.note").padding(top = top.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
}

/** A line of how far it has got (.id-progress): 14 in 1.45; "…" held quietly until the server has answered. */
@Composable
internal fun ScanProgress(text: String?, top: Int = 0) {
    Text(text ?: "…", Modifier.parity("settings-scanner.progress").padding(top = top.dp).alpha(if (text == null) 0.55f else 1f), color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 20.3.sp)
}

/** What hasn't come yet in a row's place (.id-wait). */
@Composable
internal fun ScanWait() { Text("…", Modifier.parity("settings-scanner.progress").alpha(0.55f), color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 20.3.sp) }

/** The rule between two blocks (.settings-divider): 18 over and under, with the blocks' own 4. */
@Composable
internal fun ScanDivider() { SettingsDivider(18, 18) }

/** A time of the schedule (.id-time): 15 on the raised ground, 10 round, 6 and 10 in, as the phone writes it, with the clock beside it. */
@Composable
private fun TimeBox(hhmm: String, modifier: Modifier) {
    val context = LocalContext.current
    val shape = RoundedCornerShape(10.dp)
    val words = runCatching {
        val (h, m) = hhmm.split(":").map { it.toInt() }
        if (android.text.format.DateFormat.is24HourFormat(context)) "%02d:%02d".format(h, m) else "%02d:%02d %s".format(if (h % 12 == 0) 12 else h % 12, m, if (h < 12) "AM" else "PM")
    }.getOrDefault(hhmm)
    val ink = paletteColor(Palette.TEXT)
    Row(modifier.height(37.dp).width(133.8.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(start = 10.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(words, Modifier.weight(1f), color = ink, fontSize = 15.sp, lineHeight = 20.sp, maxLines = 1)
        Canvas(Modifier.size(14.dp)) {
            val r = size.minDimension / 2 - 1.dp.toPx(); val c = center; val w = 1.6.dp.toPx()
            drawCircle(ink, r, c, style = Stroke(w))
            drawLine(ink, c, Offset(c.x, c.y - r * 0.6f), w); drawLine(ink, c, Offset(c.x + r * 0.45f, c.y), w)
        }
    }
}

private const val SCHEDULE_INFO = "When identification and Measure ReplayGain run, in that order: an album is measured once identification has looked at it. On: between the start and end times each night, on the server’s clock, and not at all outside them. Off: whenever the library isn’t being scanned, until every album is done. Either way both wait while the library scan runs; the scan itself isn’t scheduled, so new music shows up as it arrives. Identification looks at about twelve albums a minute, one MusicBrainz request a second."
private const val IDENTIFY_INFO = "Each album is matched first by what its files carry — a MusicBrainz release ID, a barcode, a catalogue number with its label, the tracks’ ISRCs — then looked up on MusicBrainz by its title, track count and (where the tag can be trusted) its artist, scored against the tracks and their lengths. 85 % alike or better is applied: artist, title, year and track titles, kept in the database like an edit; your files are never touched. The rest are left for you to match. Albums you edited by hand are left alone."
private const val ITUNES_INFO = "An album MusicBrainz can’t place is looked up in Apple’s iTunes catalogue too — by barcode first, then by name; no account or key, a request every few seconds. Applied at 85 % alike or better, as a MusicBrainz match is; anything less is left for you. The album keeps the year its files carry, since Apple’s date is often a reissue’s."
private const val MEASURE_INFO = "Tracks without ReplayGain tags are measured on the server — EBU R128 loudness and true peak — so Volume Levelling (Settings → Audio Devices → a device) can level them too. It keeps to the schedule above: album by album, newest first, each once identification has looked at it, on the cores playback doesn’t keep. An album’s gain is worked out once all of its tracks are known. Qobuz and Tidal tracks aren’t measured. Your files are never changed."
private const val CLEANUP_INFO = "Albums the library still lists but can’t play: ones whose files are gone from the server (a folder the scanner found missing, empty or unreadable, kept in case it comes back), and Qobuz albums no longer in your favourites, purchases or playlists — every Qobuz album while you’re signed out. Nothing goes until you press. Plays stay in history; an album’s edits, heart and Listen later go with it."
private const val CPU_INFO = "Playback keeps cores of its own: one, or two while DSP is in use. Scanning, measuring ReplayGain and the phone’s downloads run on the other cores, at the lowest priority, so playback comes first. Set PLAYBACK_CORES to 1 or 2 to fix how many playback keeps, or 0 to share every core."
