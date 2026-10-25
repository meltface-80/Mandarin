package com.musicd.server.android

import android.app.AlertDialog
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AudioDevices
import com.musicd.server.client.Choice
import com.musicd.server.client.Contract
import com.musicd.server.client.DeviceList
import com.musicd.server.client.DeviceRow
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * Settings → Audio Devices natively (the group T of old/plan-android-native.md, T6; bug list item 89), as the page's
 * (docs/specs/screens.json, settings-audio; audio-devices.js renderList; style.css .dev-row): the zone the controls play to,
 * every player the server sees (Sonos rooms, phones, renderers, the server's own sound devices) a row with its switch where
 * it can be switched off, Hide / unhide and Look again, and Waveform. A row opens the device's own page (SettingsDevice.kt)
 * over the list, Back returning to it. Asked again every ten seconds while open, as the page's.
 */

private val ICONS = mapOf("sonos" to R.drawable.dv_sonos, "phone" to R.drawable.dv_phone, "upnp" to R.drawable.dv_upnp, "local" to R.drawable.dv_local)

/** Settings' Audio Devices ([client]: the server's, [onBack]: back to Settings). */
@Composable
internal fun SettingsAudio(client: () -> ServerClient?, onBack: () -> Unit) {
    var device by rememberSaveable { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(info) { val t = info ?: return@LaunchedEffect; delay(minOf(25_000L, 4_000L + t.split(Regex("\\s+")).size * 220L)); info = null }
    val open = device
    Box(Modifier.fillMaxSize()) {
        if (open != null) {
            BackHandler { device = null }
            DevicePane(open, client, { device = null }) { info = it }
        } else DeviceListPane(client, onBack, { device = it }) { info = it }
        info?.let { InfoTip(it, Modifier.parity("settings-audio.info")) }
    }
}

@Composable
private fun DeviceListPane(client: () -> ServerClient?, onBack: () -> Unit, onOpen: (String) -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<DeviceList?>(null) }
    var zones by remember { mutableStateOf<List<Choice>>(emptyList()) }
    var zone by remember { mutableStateOf(NativeShell.zone) }
    var waveform by remember { mutableStateOf(false) }
    var hiding by remember { mutableStateOf(false) }
    var picks by remember { mutableStateOf(setOf<String>()) }
    var looking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    suspend fun load() {
        val c = client() ?: return
        val got = withContext(Dispatchers.IO) { runCatching { c.getJson("/api/audio-devices") } }
        got.onSuccess { list = AudioDevices.parse(it); error = "" }.onFailure { error = com.musicd.server.client.Failure.said(it, "Couldn't reach the server") }
    }
    LaunchedEffect(Unit) {
        val c = client()
        if (c != null) {
            withContext(Dispatchers.IO) { runCatching { c.zones().zones.map { z -> Choice(z.id, z.name) } } }.onSuccess { zones = it }
            readSetting(client, "waveform")?.let { waveform = it.optBoolean("enabled") }
        }
        while (true) { untilOnScreen(); if (!busy) load(); delay(10_000) }
    }
    // A device switched on or off from its row: said, and the list read again.
    fun enable(r: DeviceRow, on: Boolean) {
        val c = client() ?: return
        if (busy) return
        busy = true
        val made = ServerWrites.write { c.patch(devicePath(r.id), JSONObject().put("enabled", on)) }
        scope.launch {
            ServerWrites.await(made).onSuccess { setupToast(context, AudioDevices.enabledSaid(it.optString("name", r.name), on)) }.onFailure { error = com.musicd.server.client.Failure.said(it, "") }
            busy = false; load()
        }
    }
    // OK: each ticked one hidden or shown again, in turn, then what came of it said.
    fun applyHide() {
        val c = client() ?: return
        val chosen = list?.rows.orEmpty().filter { it.id in picks }
        hiding = false; picks = emptySet()
        if (chosen.isEmpty()) return
        busy = true
        val made = ServerWrites.write { for (d in chosen) c.patch(devicePath(d.id), JSONObject().put("hidden", !d.hidden)) }
        scope.launch {
            ServerWrites.await(made).onFailure { error = com.musicd.server.client.Failure.said(it, "") }
            busy = false; load()
            AlertDialog.Builder(context).setMessage(AudioDevices.hideSaid(chosen.count { !it.hidden }, chosen.count { it.hidden })).setPositiveButton("OK", null).show()
        }
    }
    val l = list
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-audio.back", Contract.label("settings-audio.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            "Audio Devices", Modifier.parity("settings-audio.heading"))
        Block {
            SetupRow("Zone / output", Modifier.parity("settings-audio.name"), Modifier.parity("settings-audio.info", Contract.label("settings-audio.info", 0, "Zone / output")).clickable { info(AudioDevices.ZONE_INFO) }) {
                SelectBox(choiceWords(zones, zone), zones, Modifier.parity("settings-audio.caret"),
                    Modifier.parity("settings-audio.zone", Contract.label("settings-audio.zone")).clickable {
                        if (zones.isNotEmpty()) pickChoice(context, zones, zone) { id -> zone = id; NativeShell.roomChosen(id) }
                    })
            }
        }
        SettingsDivider(18, 18)
        Block {
            SetupRow("Devices", Modifier.parity("settings-audio.name"), Modifier.parity("settings-audio.info", Contract.label("settings-audio.info", 0, "Devices")).clickable { info(AudioDevices.DEVICES_INFO) }) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (l != null && !l.away && l.rows.isNotEmpty()) {
                        val word = AudioDevices.hideWord(hiding, picks.size)
                        val primary = hiding && picks.isNotEmpty()
                        Box(Modifier.parity("settings-audio.hide", Contract.label("settings-audio.hide", if (!hiding) 0 else if (primary) 1 else 2)).clip(RoundedCornerShape(8.dp))
                            .clickable(enabled = !busy) { if (!hiding) { hiding = true; picks = emptySet() } else applyHide() }
                            .background(paletteColor(if (primary) Palette.ACCENT else Palette.BG_ELEV_2)).border(1.dp, paletteColor(if (primary) Palette.ACCENT else Palette.BORDER), RoundedCornerShape(8.dp))
                            .heightIn(min = 36.dp).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                            Text(word, color = paletteColor(if (primary) Palette.ON_ACCENT else Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = if (primary) FontWeight.W700 else FontWeight.W400)
                        }
                    }
                    if (l != null && !l.away && !hiding) SetupButton(if (looking) "Looking…" else "Look again", looking,
                        Modifier.parity("settings-audio.rescan", Contract.label("settings-audio.rescan", if (looking) 1 else 0)).clickable(enabled = !looking) {
                            val c = client() ?: return@clickable
                            looking = true
                            val made = ServerWrites.write { c.post("/api/audio-devices/rescan", JSONObject(), 60_000) }
                            scope.launch { ServerWrites.await(made).onSuccess { list = AudioDevices.parse(it); error = "" }.onFailure { error = com.musicd.server.client.Failure.said(it, "") }; looking = false }
                        })
                }
            }
            if (hiding) SetupNote(AudioDevices.HIDE_NOTE, Modifier.parity("settings-audio.hide-note"))
            Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    l == null -> {}
                    l.away && l.rows.isEmpty() -> ListNote(AudioDevices.AWAY_ONLY, Modifier.parity("settings-audio.note"))
                    l.rows.isEmpty() -> {
                        ListNote(error.ifEmpty { AudioDevices.NOTHING }, Modifier.parity("settings-audio.note"))
                        if (l.localNote.isNotEmpty()) ListNote(l.localNote, Modifier.parity("settings-audio.note"))
                    }
                    else -> {
                        for ((i, r) in l.shown.withIndex()) DeviceRowView(r, hiding, r.id in picks, i > 0,
                            (if (hiding) Modifier.parity("settings-audio.pick", Contract.label("settings-audio.pick", 0, r.name))
                                else Modifier.parity("settings-audio.device", Contract.label("settings-audio.device", 0, r.name))).clickable { if (hiding) picks = if (r.id in picks) picks - r.id else picks + r.id else onOpen(r.id) },
                            Modifier.parity("settings-audio.device-on", Contract.label("settings-audio.device-on", 0, r.name)).clickable(enabled = !busy) { enable(r, !r.enabled) })
                        if (hiding && l.hidden.isNotEmpty()) {
                            Row(Modifier.parity("settings-audio.rule").padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("HIDDEN", color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.W700, letterSpacing = 0.12.em)
                                Box(Modifier.weight(1f).height(1.dp).background(paletteColor(Palette.BORDER)))
                            }
                            for (r in l.hidden) DeviceRowView(r, true, r.id in picks, true,
                                Modifier.parity("settings-audio.pick", Contract.label("settings-audio.pick", 0, r.name)).clickable { picks = if (r.id in picks) picks - r.id else picks + r.id }, null)
                        } else if (!hiding && l.hidden.isNotEmpty()) ListNote(AudioDevices.hiddenCount(l.hidden.size), Modifier.parity("settings-audio.note").padding(horizontal = 4.dp, vertical = 2.dp))
                        if (l.localNote.isNotEmpty()) ListNote(l.localNote, Modifier.parity("settings-audio.note"))
                        if (l.away) ListNote(AudioDevices.awayNote(Store.offlineMode(context)), Modifier.parity("settings-audio.note"))
                        if (error.isNotEmpty()) ListNote(error, Modifier.parity("settings-audio.note"), danger = true)
                    }
                }
            }
        }
        SettingsDivider(18, 18)
        Block {
            SetupRow("Waveform", Modifier.parity("settings-audio.name"), Modifier.parity("settings-audio.info", Contract.label("settings-audio.info", 0, "Waveform")).clickable { info(AudioDevices.WAVEFORM_INFO) }) {
                Toggle(waveform, Modifier.parity("settings-audio.waveform", Contract.label("settings-audio.waveform")).clickable {
                    val was = waveform; waveform = !waveform
                    saveSetting(scope, context, client, "waveform", JSONObject().put("enabled", waveform),
                        if (waveform) "Waveform on — local files show the track’s shape" else "Waveform off", undo = { waveform = was })
                })
            }
            SetupNote(AudioDevices.waveformNote(waveform), Modifier.parity("settings-audio.note"))
        }
    }
}

/**
 * A player's row (.dev-row): 12 and 14 in, 14 round on the raised ground; its icon on a 36 tile, its name in 15/600 over
 * what it is, its state in small capitals, ›; [switch] beside it where it can be switched off. Hiding, a tick circle first.
 */
@Composable
private fun DeviceRowView(r: DeviceRow, hiding: Boolean, picked: Boolean, after: Boolean, open: Modifier, switch: Modifier?) {
    val shape = RoundedCornerShape(14.dp)
    val ground = if (picked) Palette.ACCENT_SOFT else Palette.BG_ELEV_2
    Row(Modifier.padding(top = if (after) 6.dp else 0.dp).fillMaxWidth().alpha(if (hiding && r.hidden) 0.8f else 1f).clip(shape).background(paletteColor(ground))
        .then(if (hiding && r.hidden) Modifier.dashed(paletteColor(Palette.BORDER), 14.dp) else Modifier.border(1.dp, paletteColor(if (picked) Palette.ACCENT else Palette.BORDER), shape))
        .padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(open.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (hiding) Box(Modifier.size(22.dp).clip(CircleShape).background(if (picked) paletteColor(Palette.ACCENT) else Color.Transparent)
                .border(1.dp, paletteColor(if (picked) Palette.ACCENT else Palette.TEXT_FAINT), CircleShape), contentAlignment = Alignment.Center) {
                if (picked) Icon(painterResource(R.drawable.dv_tick), contentDescription = null, tint = paletteColor(Palette.ON_ACCENT), modifier = Modifier.size(14.dp))
            }
            val dim = if (r.off) 0.5f else if (!r.online) 0.55f else 1f
            Box(Modifier.size(36.dp).alpha(dim).clip(RoundedCornerShape(10.dp)).background(paletteColor(Palette.BG_ELEV)), contentAlignment = Alignment.Center) {
                Icon(painterResource(ICONS[r.kind] ?: R.drawable.dv_upnp), contentDescription = null, tint = paletteColor(Palette.ACCENT_TEXT), modifier = Modifier.size(20.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(r.name, Modifier.alpha(dim), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (r.sub.isNotEmpty()) Text(r.sub, Modifier.alpha(if (r.off) 0.5f else 1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (!(hiding && r.hidden)) Text(r.stateShown.uppercase(), color = paletteColor(if (r.playing && !r.off) Palette.ACCENT_TEXT else Palette.TEXT_FAINT),
                fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.W700, letterSpacing = 0.08.em)
            if (!hiding) Text("›", color = paletteColor(Palette.TEXT_FAINT), fontSize = 20.sp, lineHeight = 20.sp)
        }
        if (!hiding && r.canToggle && switch != null) Toggle(r.enabled, switch.padding(start = 4.dp))
    }
}

/** A note of the list's (.settings-note): 12 faint, or red for what went wrong. */
@Composable
private fun ListNote(text: String, modifier: Modifier, danger: Boolean = false) {
    Text(text, modifier, color = paletteColor(if (danger) Palette.DANGER else Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
}

/** A border of dashes, [radius] round (.dev-row.is-hidden, .cap-chip.is-later: border-style dashed). */
internal fun Modifier.dashed(color: Color, radius: Dp): Modifier = drawBehind {
    val r = radius.toPx(); val w = 1.dp.toPx()
    drawRoundRect(color, Offset(w / 2, w / 2), Size(size.width - w, size.height - w), CornerRadius(r, r),
        style = Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3 * w, 3 * w))))
}

/** A device's address on the server (/api/audio-devices/:id), its id as one segment. */
internal fun devicePath(id: String) = "/api/audio-devices/" + java.net.URLEncoder.encode(id, "UTF-8").replace("+", "%20")
