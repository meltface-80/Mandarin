package com.musicd.server.android

import android.app.AlertDialog
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
import com.musicd.server.client.ScanFolder
import com.musicd.server.client.Scanner
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/*
 * Settings → Library Scanner's sections (bug list item 411; the page's settings-scanner-blocks.js, style.css .scan-*): the
 * Album Scanner's switch and its note, then while it is on Progress (one readout, its bar, what it is doing now), the
 * albums to place by hand as brass folders, Schedule with its own switch, Library clean-up and the Processor, each under
 * a thin rule; and the rows, notes and times they are drawn with. The pack between them is ScannerPack.kt.
 */

/** The switch, and what it does; off, that none of it is done. */
@Composable
internal fun ScannerSwitch(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, info: (String) -> Unit) {
    val scan = k.scan
    Column(Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 16.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text("Album Scanner", Modifier.parity("settings-scanner.name"), color = paletteColor(Palette.TEXT), fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.W700)
                InfoMark("Album Scanner", 20) { info(SCANNER_INFO) }
            }
            val on = scan?.optBoolean("on") == true
            Toggle(on, Modifier.parity("settings-scanner.scanner", Contract.label("settings-scanner.scanner")).clickable(enabled = scan != null && !k.busy) {
                setScanner(k, client, scope, JSONObject().put("on", !on))
            }, known = scan != null)
        }
        Text(Scanner.note(scan), Modifier.parity("settings-scanner.note").padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.9.sp)
    }
}

/** Progress: the albums with every step done, a bar, and what it is doing now; the music folders out of reach under it. */
@Composable
internal fun ScannerProgress(scan: JSONObject) {
    ScanSection {
        Row(Modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            ScanLabel("Progress")
            val count = Scanner.progressCount(scan).orEmpty()
            val done = Scanner.num(scan.optLong("done"))
            Text(buildAnnotatedString {
                withStyle(SpanStyle(color = paletteColor(Palette.TEXT), fontWeight = FontWeight.W700)) { append(done) }
                append(count.removePrefix(done))
            }, Modifier.parity("settings-scanner.progress"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
        }
        val shape = RoundedCornerShape(5.dp)
        Box(Modifier.parity("settings-scanner.bar").padding(top = 8.dp).fillMaxWidth().height(10.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2))) {
            Box(Modifier.fillMaxWidth(Scanner.percent(scan) / 100f).fillMaxHeight().clip(shape).background(paletteColor(Palette.ACCENT)))
        }
        Text(Scanner.nowLine(scan), Modifier.parity("settings-scanner.now").padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
        Scanner.coversUnreachable(scan)?.let { ScanNote(it) }
    }
}

/** The albums to place by hand as folders: Unidentified always, To confirm while there are proposals; each opens its albums. */
@Composable
internal fun ScannerFolders(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope) {
    ScanSection {
        for ((i, f) in Scanner.folders(k.scan).withIndex()) {
            val top = Modifier.padding(top = if (i > 0) 12.dp else 0.dp)
            val open = { openFolder(k, client, scope, f.kind) }
            if (f.kind == "proposed") ScanFolderRow(f, top.parity("settings-scanner.to-confirm", Contract.label("settings-scanner.to-confirm")).clickable(enabled = !k.busy, onClick = open))
            else ScanFolderRow(f, top.parity("settings-scanner.unidentified", Contract.label("settings-scanner.unidentified")).clickable(enabled = !k.busy, onClick = open))
        }
    }
}

/** A folder's row ([modifier]: its key and tap): a brass folder (.scan-fico) with its count on it, its name and line, and ›. */
@Composable
private fun ScanFolderRow(f: ScanFolder, modifier: Modifier) {
    val accent = paletteColor(Palette.ACCENT)
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(48.dp, 38.dp)) {
            Box(Modifier.size(19.dp, 9.dp).clip(RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp)).background(accent).background(Color.Black.copy(alpha = 0.28f)))
            Box(Modifier.padding(top = 5.dp).fillMaxWidth().fillMaxHeight().clip(RoundedCornerShape(topStart = 4.dp, topEnd = 8.dp, bottomStart = 8.dp, bottomEnd = 8.dp)).background(accent)
                .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.14f), Color.Black.copy(alpha = 0.16f)))), contentAlignment = Alignment.Center) {
                Text(Scanner.num(f.count.toLong()), color = paletteColor(Palette.ON_ACCENT), fontSize = 12.sp, lineHeight = 14.sp, fontWeight = FontWeight.W800, maxLines = 1)
            }
        }
        Column(Modifier.weight(1f)) {
            Text(f.title, color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
            Text(f.sub, color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
        }
        Text("›", color = paletteColor(Palette.TEXT_FAINT), fontSize = 22.sp, lineHeight = 22.sp)
    }
}

/** Schedule: its own switch; on, the hours it keeps to. */
@Composable
internal fun ScannerSchedule(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope) {
    val context = LocalContext.current
    val sch = k.scan?.optJSONObject("schedule") ?: JSONObject()
    val on = sch.optBoolean("on")
    ScanSection {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                ScanLabel("Schedule")
                Text(Scanner.scheduleNote(on), Modifier.parity("settings-scanner.note"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
            }
            Toggle(on, Modifier.parity("settings-scanner.schedule", Contract.label("settings-scanner.schedule")).clickable(enabled = !k.busy) {
                setScanner(k, client, scope, JSONObject().put("schedule", !on))
            })
        }
        if (on) Row(Modifier.padding(top = 8.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            fun set(which: String) = pickTime(context, sch.optString(which)) { t -> setScanner(k, client, scope, JSONObject().put(which, t)) }
            Text("From", Modifier.parity("settings-scanner.name").weight(1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
            TimeBox(sch.optString("start"), Modifier.parity("settings-scanner.start", Contract.label("settings-scanner.start")).clickable(enabled = !k.busy) { set("start") })
            Text("to", Modifier.parity("settings-scanner.name"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
            TimeBox(sch.optString("end"), Modifier.parity("settings-scanner.end", Contract.label("settings-scanner.end")).clickable(enabled = !k.busy) { set("end") })
        }
    }
}

/** Library clean-up: each kind with something to remove, said, with its Remove (asked first); or nothing to remove. */
@Composable
internal fun ScannerCleanup(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, context: Context, info: (String) -> Unit) {
    val cleanup = k.cleanup
    ScanSection {
        Row(Modifier.heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) { ScanLabel("Library clean-up"); InfoMark("Library clean-up", 16) { info(CLEANUP_INFO) } }
        val rows = Scanner.cleanupRows(cleanup)
        if (cleanup == null) ScanWait()
        else if (rows.isEmpty()) ScanNote("Nothing to remove.", top = 0)
        else for (r in rows) Row(Modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(r.words, Modifier.parity("settings-scanner.note").weight(1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
            IdButton("Remove", false, !k.busy, Modifier.parity("settings-scanner.cleanup", Contract.label("settings-scanner.cleanup")).clickable(enabled = !k.busy) {
                AlertDialog.Builder(context).setMessage(Scanner.cleanupQuestion(r.kind, r.albums)).setNegativeButton("Cancel", null)
                    .setPositiveButton("Remove") { _, _ -> cleanUp(k, client, scope, context, r.kind) }.show()
            }, danger = true)
        }
    }
}

/** The processor: how its cores are shared out, and the cores a track made as it plays has (item 260). */
@Composable
internal fun ScannerCpu(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, info: (String) -> Unit) {
    ScanSection {
        Row(Modifier.heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) { ScanLabel("Processor"); InfoMark("Processor", 16) { info(CPU_INFO + Scanner.cpuHint(k.cpu)) } }
        val line = Scanner.cpuLine(k.cpu)
        Text(line ?: "…", Modifier.parity("settings-scanner.progress").alpha(if (line == null) 0.55f else 1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
        val choices = Scanner.makingChoices(k.cpu)
        if (choices.isNotEmpty()) Row(Modifier.padding(top = 4.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Cores for upsampling and DSD", Modifier.parity("settings-scanner.name").weight(1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
            Box(Modifier.widthIn(max = 180.dp)) {
                Seg(choices, Scanner.makingCurrent(k.cpu), key = { i, ch -> Modifier.parity("settings-scanner.making", Contract.label("settings-scanner.making", i)).clickable(enabled = !k.busy) {
                    val c = client() ?: return@clickable
                    val made = ServerWrites.write { c.post("/api/cpu", JSONObject().put("making_cores", if (ch.value == "auto") "auto" else ch.value.toInt())) }
                    scope.launch { ServerWrites.await(made).onSuccess { k.cpu = it; k.err = "" }.onFailure { k.err = com.musicd.server.client.Failure.said(it, "Couldn't reach the server") } }
                } })
            }
        }
    }
}

// ------------------------------------------------------------ what the sections are drawn with

/** A section (.scan-sec): a thin rule over it, 12 in above and below. */
@Composable
internal fun ScanSection(content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), content = content)
}

/** A section's name (.scan-lab): 16 in 600. */
@Composable
internal fun ScanLabel(name: String) {
    Text(name, Modifier.parity("settings-scanner.name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
}

/** The ⓘ after a name ([name], whose help it is), [size] as the name's. */
@Composable
internal fun InfoMark(name: String, size: Int, tap: () -> Unit) {
    Box(Modifier.parity("settings-scanner.info", Contract.label("settings-scanner.info", 0, name)).clickable(onClick = tap).size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) {
        Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = size.sp, lineHeight = size.sp)
    }
}

/** A row of the scanner's: its name in 16 with its ⓘ after it (wrapping under where it must), [control] on the right. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ScanRow(name: String, infoText: String?, modifier: Modifier = Modifier, info: (String) -> Unit = {}, control: @Composable () -> Unit) {
    Row(modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        FlowRow(Modifier.weight(1f), itemVerticalAlignment = Alignment.CenterVertically) {
            ScanLabel(name)
            if (infoText != null) InfoMark(name, 16) { info(infoText) }
        }
        control()
    }
}

/** A block's title (.settings-block-title): 13 faint in capitals; 10 under it. */
@Composable
internal fun ScanTitle(text: String) {
    Text(text.uppercase(), Modifier.parity("settings-scanner.title").padding(bottom = 10.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp,
        fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
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

/** What hasn't come yet (.id-wait). */
@Composable
internal fun ScanWait() { Text("…", Modifier.parity("settings-scanner.note").alpha(0.55f), color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 20.3.sp) }

/** A time of the schedule (.id-time): 15 on the raised ground, 10 round, as the phone writes it, with the clock beside it. */
@Composable
internal fun TimeBox(hhmm: String, modifier: Modifier) {
    val context = LocalContext.current
    val shape = RoundedCornerShape(10.dp)
    val words = runCatching {
        val (h, m) = hhmm.split(":").map { it.toInt() }
        if (android.text.format.DateFormat.is24HourFormat(context)) "%02d:%02d".format(h, m) else "%d:%02d %s".format(if (h % 12 == 0) 12 else h % 12, m, if (h < 12) "AM" else "PM")
    }.getOrDefault(hhmm)
    val ink = paletteColor(Palette.TEXT)
    Row(modifier.height(37.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(start = 10.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(words, color = ink, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600, maxLines = 1)
        Canvas(Modifier.size(14.dp)) {
            val r = size.minDimension / 2 - 1.dp.toPx(); val c = center; val w = 1.6.dp.toPx()
            drawCircle(ink, r, c, style = Stroke(w))
            drawLine(ink, c, Offset(c.x, c.y - r * 0.6f), w); drawLine(ink, c, Offset(c.x + r * 0.45f, c.y), w)
        }
    }
}


internal const val SCANNER_INFO = "Each album is matched first by what its files carry — a MusicBrainz release ID, a barcode, a catalogue number with its label, the tracks’ ISRCs — then looked up on MusicBrainz, and on Apple’s iTunes catalogue for what MusicBrainz can’t place. 85 % alike or better is applied (artist, title, year and track titles, kept in the database like an edit); the rest are left for you. Tracks without ReplayGain tags are measured (EBU R128 loudness and true peak), so Volume Levelling can level them. Albums with no cover of their own are looked up on Apple Music, Deezer and MusicBrainz and given one only when title, artist and tracks all agree. Your files are never changed, nor albums you edited by hand. It works album by album, newest first, on the cores playback doesn’t keep, and waits while music plays or the library is scanned."
internal const val CLEANUP_INFO = "Albums the library still lists but can’t play: ones whose files are gone from the server (a folder the scanner found missing, empty or unreadable, kept in case it comes back), and Qobuz or Tidal albums no longer in your favourites or purchases — every one while you’re signed out. Nothing goes until you press. Plays stay in history; an album’s edits, heart and Listen later go with it."
internal const val CPU_INFO = "Playback keeps cores of its own: one, or two while DSP is in use. While a track is upsampled or made DSD as it plays, and for half a minute after, playback keeps all the cores but two (but one on a machine of two or three), or as many as Cores for upsampling and DSD says. The Album Scanner and the phone’s downloads run on the other cores, at the lowest priority, so playback comes first. Set PLAYBACK_CORES to 1 or 2 to fix how many playback keeps, or 0 to share every core."
