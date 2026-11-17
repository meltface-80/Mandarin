package com.musicd.server.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.IBroadcastSettings
import com.musicd.server.client.Palette
import com.musicd.server.client.SegChoice
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch
import org.json.JSONObject

/*
 * Settings → Services → iBroadcast natively (item 443), as the page's (docs/specs/screens.json, settings-ibroadcast;
 * settings-ibroadcast.js): Back to Services, its title; the account under its title and ⓘ. Signed out, Sign in on
 * iBroadcast, which opens iBroadcast with a code to approve Mandarin with there, and is waited for (asked again every two
 * seconds) until it lands. Signed in, who, whether the account is Premium, the formats iBroadcast takes, and Sign out;
 * then Upload (item 446): how the one under way is going (asked again every two seconds while it goes), or what the last
 * one did, Upload now or Stop upload, and the files left out or not sent; and on a schedule (item 447), its switch and
 * hours beside the Library Scanner's, which they can't overlap (a window that would refused, in the server's words);
 * and (item 451) Upload from, files at once, and uploading while music plays at home or away, each with its number.
 */

/** Settings' iBroadcast page ([client]: the server's, [onBack]: back to Services). */
@Composable
internal fun SettingsIBroadcast(client: () -> ServerClient?, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    val dates = remember { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT) }
    val at = { ms: Long -> dates.format(Date(ms)) }
    var account by remember { mutableStateOf(keptSetting("ibroadcast")?.let { runCatching { IBroadcastSettings.parse(it, at) }.getOrNull() }) }
    var busy by remember { mutableStateOf(false) }
    var updating by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    fun show(j: JSONObject) { account = IBroadcastSettings.parse(j, at) }
    suspend fun load() { readSetting(client, "ibroadcast")?.let(::show) }
    // Asked again every 2 s while something goes on, else every 30 s; a change that starts something (Upload now) is
    // followed within 2 s, not at the end of the 30 (item 451: the page sat on "Looking at what iBroadcast has…").
    LaunchedEffect(Unit) { while (true) { untilOnScreen(); load(); var waited = 0L; do { delay(2_000L); waited += 2_000L } while (account?.again != true && waited < 30_000L) } }
    fun change(path: String, body: JSONObject = JSONObject(), timeout: Int = 20_000, done: (JSONObject) -> Unit = ::show) {
        val c = client() ?: return
        val call = { c.post("/api/settings/ibroadcast$path", body, timeout).also { j -> j.optString("error").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) } } }
        // Update library now reads the whole library: beside the lane, so a change asked meanwhile isn't held (item 390).
        val made = if (timeout > ServerWrites.LANE_MOST) ServerWrites.aside(call) else ServerWrites.write(call)
        scope.launch {
            ServerWrites.await(made).onSuccess(done).onFailure { busy = false; updating = false; asking = false; setupToast(context, com.musicd.server.client.Failure.said(it, "Couldn't reach the server")); load() }
        }
    }
    Box(Modifier.fillMaxSize()) {
        SettingsFrame {
            SettingsHead(Modifier.parity("settings-ibroadcast.back", Contract.label("settings-ibroadcast.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
                "iBroadcast", Modifier.parity("settings-ibroadcast.heading"))
            Block {
                ServiceTitle("Account", Modifier.parity("settings-ibroadcast.title"),
                    Modifier.parity("settings-ibroadcast.info", Contract.label("settings-ibroadcast.info", 0, "Account")).clickable { info = IBroadcastSettings.INFO })
                val a = account ?: return@Block
                if (!a.connected) {
                    val url = a.pendingUrl
                    if (url == null) SetupButton("Sign in on iBroadcast", busy, Modifier.parity("settings-ibroadcast.signin", Contract.label("settings-ibroadcast.signin")).clickable(enabled = !busy) {
                        busy = true
                        change("/signin") { j -> busy = false; show(j); account?.pendingUrl?.let { openLink(context, it) } }
                    }) else {
                        // The sign-in under way (.tidal-auth-pending): the note, the link to open, the code to approve with, Cancel.
                        val box = RoundedCornerShape(10.dp)
                        Column(Modifier.padding(top = 16.dp, bottom = 10.dp).fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box).padding(12.dp),
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(IBroadcastSettings.NOTE, Modifier.parity("settings-ibroadcast.note").fillMaxWidth(), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
                            Text(a.linkText, Modifier.parity("settings-ibroadcast.link", Contract.label("settings-ibroadcast.link", 0, a.linkText)).clickable { openLink(context, url) },
                                color = paletteColor(Palette.ACCENT_TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, textDecoration = TextDecoration.Underline, textAlign = TextAlign.Center)
                            Text(a.pendingCode, Modifier.parity("settings-ibroadcast.code").clip(RoundedCornerShape(8.dp)).background(paletteColor(Palette.BG_ELEV)).padding(horizontal = 10.dp, vertical = 4.dp),
                                color = paletteColor(Palette.TEXT), fontSize = 22.sp, lineHeight = 25.sp, fontFamily = FontFamily.Monospace, letterSpacing = 0.18.em)
                            SetupButton("Cancel", false, Modifier.parity("settings-ibroadcast.cancel", Contract.label("settings-ibroadcast.cancel")).clickable { change("/signin/cancel") })
                        }
                    }
                    if (a.status.isNotEmpty()) StatusLine(a.status, Modifier.parity("settings-ibroadcast.status").padding(top = 4.dp))
                    return@Block
                }
                StatusLine(a.status, Modifier.parity("settings-ibroadcast.status"))
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Fact("Premium", a.premium, Modifier.parity("settings-ibroadcast.premium"))
                    Fact("Formats iBroadcast takes", a.formats, Modifier.parity("settings-ibroadcast.formats"))
                    val importName = "iBroadcast albums in the library"
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                            Text(importName, Modifier.parity("settings-ibroadcast.name").weight(1f, fill = false), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
                            Box(Modifier.parity("settings-ibroadcast.info", Contract.label("settings-ibroadcast.info", 0, importName)).clickable { info = IBroadcastSettings.IMPORT_INFO }.size(32.dp).padding(start = 4.dp),
                                contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 16.sp) }
                        }
                        Toggle(a.import, Modifier.parity("settings-ibroadcast.import", Contract.label("settings-ibroadcast.import")).clickable {
                            val on = !a.import
                            account = a.copy(import = on)
                            // The walls and Home read afresh as each opens: the albums are in or out.
                            change("", JSONObject().put("import", on)) { j -> show(j); HomeKept.reset() }
                        })
                    }
                }
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (a.import) SetupButton("Update library now", updating, Modifier.parity("settings-ibroadcast.update", Contract.label("settings-ibroadcast.update")).clickable(enabled = !updating) {
                        updating = true
                        account = a.copy(libraryStatus = IBroadcastSettings.READING)
                        change("/library", timeout = 600_000) { j -> updating = false; show(j); HomeKept.reset() }
                    })
                    SetupButton("Sign out", busy, Modifier.parity("settings-ibroadcast.signout", Contract.label("settings-ibroadcast.signout")).clickable(enabled = !busy) {
                        busy = true
                        change("/signout") { j -> busy = false; setupToast(context, "Signed out of iBroadcast"); show(j); HomeKept.reset() }
                    })
                }
                StatusLine(a.libraryStatus, Modifier.parity("settings-ibroadcast.library-status").padding(top = 4.dp))
            }
            account?.takeIf { it.connected }?.let { a ->
                UploadBlock(a.upload, asking, { info = IBroadcastSettings.UPLOAD_INFO }, {
                    ChoiceRows(a.choices, asking) { patch -> asking = true; change("/upload/settings", patch) { j -> asking = false; show(j) } }
                }) { path -> asking = true; change(path) { j -> asking = false; show(j) } }
                ScheduleRows(a, asking) { patch -> asking = true; change("/schedule", patch) { j -> asking = false; show(j) } }
            }
        }
        info?.let { InfoTip(it, Modifier.parity("settings-ibroadcast.info")) }
    }
}

/** Upload (item 446): how it goes or went, Upload now or Stop upload ([ask]: the path asked, [asking] while it is), what was left out or not sent. */
@Composable
private fun UploadBlock(u: com.musicd.server.client.IBroadcastUploadWords, asking: Boolean, onInfo: () -> Unit, choices: @Composable () -> Unit, ask: (String) -> Unit) {
    Block {
        ServiceTitle("Upload", Modifier.parity("settings-ibroadcast.upload-title"),
            Modifier.parity("settings-ibroadcast.info", Contract.label("settings-ibroadcast.info", 0, "Upload")).clickable(onClick = onInfo))
        choices()
        StatusLine(u.status, Modifier.parity("settings-ibroadcast.upload-status"))
        if (u.progress.isNotEmpty()) StatusLine(u.progress, Modifier.parity("settings-ibroadcast.upload-progress").padding(top = 4.dp))
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!u.running) SetupButton("Upload now", asking, Modifier.parity("settings-ibroadcast.upload", Contract.label("settings-ibroadcast.upload")).clickable(enabled = !asking) { ask("/upload") })
            else SetupButton("Stop upload", asking, Modifier.parity("settings-ibroadcast.upload-stop", Contract.label("settings-ibroadcast.upload-stop")).clickable(enabled = !asking) { ask("/upload/stop") })
        }
        if (u.problems.isNotEmpty()) StatusLine(u.problems, Modifier.parity("settings-ibroadcast.upload-problems").padding(top = 4.dp))
    }
}

/** Upload from, files at once, and while music plays at home or away (item 451; [save]: the change POSTed). */
@Composable
private fun ChoiceRows(c: com.musicd.server.client.IBroadcastUploadChoices, asking: Boolean, save: (JSONObject) -> Unit) {
    val counts = listOf(SegChoice("1", "1"), SegChoice("2", "2"), SegChoice("3", "3"))
    Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Upload from", Modifier.parity("settings-ibroadcast.name"), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
        val box = RoundedCornerShape(10.dp)
        Column(Modifier.fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box)) {
            for ((i, src) in c.sources.withIndex()) {
                val on = src.first == c.from
                Text(src.second, Modifier.parity("settings-ibroadcast.from", Contract.label("settings-ibroadcast.from", i, src.second)).fillMaxWidth()
                    .background(if (on) paletteColor(Palette.ACCENT) else androidx.compose.ui.graphics.Color.Transparent).clickable(enabled = !asking) { save(JSONObject().put("from", src.first)) }
                    .padding(horizontal = 12.dp, vertical = 9.dp), color = paletteColor(if (on) Palette.TEXT else Palette.TEXT_DIM), fontSize = 13.5.sp, lineHeight = 18.sp,
                    fontWeight = if (on) FontWeight.W600 else FontWeight.W400)
            }
        }
        if (c.fromNote.isNotEmpty()) StatusLine(c.fromNote, Modifier.parity("settings-ibroadcast.from-note"))
        CountRow("Files at once", counts, c.atOnce, keyed = { i, ch -> Modifier.parity("settings-ibroadcast.at-once", Contract.label("settings-ibroadcast.at-once", i)).clickable(enabled = !asking) { save(JSONObject().put("at_once", ch.value.toInt())) } })
        SwitchRow("Upload while music plays at home", c.home, Modifier.parity("settings-ibroadcast.home", Contract.label("settings-ibroadcast.home")).clickable(enabled = !asking) { save(JSONObject().put("home", !c.home)) })
        if (c.home) CountRow("Files at once then", counts, c.homeAtOnce, keyed = { i, ch -> Modifier.parity("settings-ibroadcast.home-at-once", Contract.label("settings-ibroadcast.home-at-once", i)).clickable(enabled = !asking) { save(JSONObject().put("home_at_once", ch.value.toInt())) } })
        SwitchRow("Upload while music plays away from home", c.away, Modifier.parity("settings-ibroadcast.away", Contract.label("settings-ibroadcast.away")).clickable(enabled = !asking) { save(JSONObject().put("away", !c.away)) })
        if (c.away) CountRow("Files at once then", counts, c.awayAtOnce, keyed = { i, ch -> Modifier.parity("settings-ibroadcast.away-at-once", Contract.label("settings-ibroadcast.away-at-once", i)).clickable(enabled = !asking) { save(JSONObject().put("away_at_once", ch.value.toInt())) } })
    }
}

/** A count to choose (1 to 3), its [name] beside it; [keyed] each choice's parity and tap, written out at each call. */
@Composable
private fun CountRow(name: String, counts: List<SegChoice>, now: Int, keyed: (Int, SegChoice) -> Modifier) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(name, Modifier.parity("settings-ibroadcast.name").weight(1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
        Box(Modifier.widthIn(max = 150.dp)) {
            Seg(counts, "$now", key = keyed)
        }
    }
}

/** A switch with its [name] beside it; [modifier] its parity and tap. */
@Composable
private fun SwitchRow(name: String, on: Boolean, modifier: Modifier) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(name, Modifier.parity("settings-ibroadcast.name").weight(1f), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
        Toggle(on, modifier)
    }
}

/** The upload on a schedule (item 447): its switch, its note, on its hours, and the Library Scanner's ([save]: the change POSTed). */
@Composable
private fun ScheduleRows(a: com.musicd.server.client.IBroadcastAccount, asking: Boolean, save: (JSONObject) -> Unit) {
    val context = LocalContext.current
    Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Upload on a schedule", Modifier.parity("settings-ibroadcast.name").weight(1f), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
            Toggle(a.schedule, Modifier.parity("settings-ibroadcast.schedule", Contract.label("settings-ibroadcast.schedule")).clickable(enabled = !asking) { save(JSONObject().put("on", !a.schedule)) })
        }
        StatusLine(IBroadcastSettings.scheduleNote(a.schedule), Modifier.parity("settings-ibroadcast.schedule-note"))
        if (a.schedule) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            fun set(which: String, now: String) = pickTime(context, now) { t -> save(JSONObject().put(which, t)) }
            Text("From", Modifier.parity("settings-ibroadcast.name"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
            TimeBox(a.start, Modifier.parity("settings-ibroadcast.start", Contract.label("settings-ibroadcast.start")).clickable(enabled = !asking) { set("start", a.start) })
            Text("to", Modifier.parity("settings-ibroadcast.name"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
            TimeBox(a.end, Modifier.parity("settings-ibroadcast.end", Contract.label("settings-ibroadcast.end")).clickable(enabled = !asking) { set("end", a.end) })
        }
        if (a.scannerHours.isNotEmpty()) StatusLine(a.scannerHours, Modifier.parity("settings-ibroadcast.scanner-hours"))
    }
}

/** A fact of the account (.settings-row): its [name] in 16, what is said of it under or beside it, dim. */
@Composable
private fun Fact(name: String, said: String, modifier: Modifier) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(name, Modifier.parity("settings-ibroadcast.name").weight(1f), color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
        Text(said, modifier.weight(1f), color = paletteColor(Palette.TEXT_DIM), fontSize = 11.sp, lineHeight = 15.sp, textAlign = TextAlign.End)
    }
}

private fun openLink(context: android.content.Context, url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
