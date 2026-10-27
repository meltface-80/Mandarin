package com.musicd.server.android

import android.app.AlertDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.CapChip
import com.musicd.server.client.Contract
import com.musicd.server.client.DevicePage
import com.musicd.server.client.Palette
import com.musicd.server.client.SegChoice
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SettingsKept
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/*
 * A device's page in Settings → Audio Devices natively (T6; bug list item 89), as the page's (docs/specs/screens.json,
 * settings-device; audio-devices.js renderDetail, audio-devices-page.js renderLevelling; style.css .cap-chip, .seg, .dev-kv):
 * on or off, Random album radio, a phone's sharing, its name, About, its capabilities (each a chip, tapped where they can be
 * set), Output, Volume levelling, the DSP (SettingsDsp.kt), this phone's USB DAC (SettingsUsb.kt), Forget. Each change is a
 * PATCH of the device, made on the app's lane of changes; the page is drawn again from the answer, and read again every ten
 * seconds while open.
 */

/** A device's page ([id]), Back to the list ([onBack]); [info] shows an ⓘ's help. */
@Composable
internal fun DevicePane(id: String, client: () -> ServerClient?, onBack: () -> Unit, info: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // As last seen, then the server's (item 198): before, "Device" and nothing under it until the server answered.
    var page by remember(id) { mutableStateOf(SettingsKept.last(devicePath(id)) { DevicePage(it) }) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val dates = remember { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT) }
    val at = { ms: Long -> dates.format(Date(ms)) }
    suspend fun load() {
        val c = client() ?: return
        withContext(Dispatchers.IO) { runCatching { c.getJson(devicePath(id)) } }.onSuccess { page = DevicePage(it); error = "" }.onFailure { error = com.musicd.server.client.Failure.said(it, "") }
    }
    LaunchedEffect(id) { while (true) { untilOnScreen(); if (!busy) load(); delay(10_000) } }
    // A change to the device (PATCH), on the lane: the page drawn from the answer; [said] once it is made.
    fun patch(body: JSONObject, said: ((DevicePage) -> String)? = null) {
        val c = client() ?: return
        if (busy) return
        busy = true
        // Shown with the change at once (item 200), the server's answer taking its place; back as it was if refused.
        val before = page
        page = before?.with(body)
        val made = ServerWrites.write { c.patch(devicePath(id), body) }
        scope.launch {
            ServerWrites.await(made).onSuccess { page = DevicePage(it); error = ""; said?.let { s -> setupToast(context, s(page!!)) } }
                .onFailure { page = before; error = com.musicd.server.client.Failure.said(it, "") }
            busy = false
        }
    }
    val d = page
    SettingsFrame {
        SettingsHead(Modifier.parity("settings-device.back", Contract.label("settings-device.back")).clip(CircleShape).clickable(onClick = onBack), R.drawable.np_back,
            d?.name ?: "Device", Modifier.parity("settings-device.heading"))
        if (d == null) { if (error.isNotEmpty()) DeviceNote(error, Modifier.parity("settings-device.note"), danger = true); return@SettingsFrame }
        if (d.canToggle) {
            Block {
                SetupRow(if (d.enabled) "On" else "Off", Modifier.parity("settings-device.name"), null) {
                    Toggle(d.enabled, Modifier.parity("settings-device.enabled", Contract.label("settings-device.enabled")).clickable { patch(JSONObject().put("enabled", !d.enabled)) { p -> com.musicd.server.client.AudioDevices.enabledSaid(p.name, p.enabled) } })
                }
                DeviceNote(d.onNote, Modifier.parity("settings-device.note"))
            }
            SettingsDivider(18, 18)
        }
        if (d.showRadio) {
            Block {
                SetupRow("Random album radio", Modifier.parity("settings-device.name"), null) {
                    Toggle(d.radio, Modifier.parity("settings-device.radio", Contract.label("settings-device.radio")).clickable { patch(JSONObject().put("radio", !d.radio)) { p -> DevicePage.radioSaid(p.name, p.radio) } })
                }
                DeviceNote(d.radioNote, Modifier.parity("settings-device.note"))
            }
            SettingsDivider(18, 18)
        }
        if (d.showShared) {
            Block {
                SetupRow("Other devices can play here", Modifier.parity("settings-device.name"),
                    Modifier.parity("settings-device.info", Contract.label("settings-device.info", 0, "Other devices can play here")).clickable { info(DevicePage.SHARED_INFO) }) {
                    Toggle(d.shared, Modifier.parity("settings-device.shared", Contract.label("settings-device.shared")).clickable { patch(JSONObject().put("shared", !d.shared)) { p -> DevicePage.sharedSaid(p.name, p.shared) } })
                }
                DeviceNote(d.sharedNote, Modifier.parity("settings-device.note"))
            }
            SettingsDivider(18, 18)
        }
        Block {
            DeviceTitle("Name", Modifier.parity("settings-device.title"))
            if (d.kind == "phone") {
                Text(d.networkName, Modifier.parity("settings-device.kv").fillMaxWidth(), color = paletteColor(Palette.TEXT), fontSize = 13.5.sp, lineHeight = 18.9.sp, textAlign = TextAlign.End)
                DeviceNote(d.nameNote, Modifier.parity("settings-device.note"))
            } else {
                var name by remember(d.name) { mutableStateOf(d.name) }
                val save = { if (name.trim() != d.name) patch(JSONObject().put("name", name.trim())) }
                val shape = RoundedCornerShape(10.dp)
                BasicTextField(name, { if (it.length <= 60) name = it }, Modifier.parity("settings-device.rename", Contract.label("settings-device.rename")).fillMaxWidth()
                    .onFocusChanged { if (!it.isFocused) save() }, singleLine = true, textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp),
                    cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { save() }),
                    decorationBox = { inner -> Box(Modifier.fillMaxWidth().height(44.dp).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)
                        .padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) { inner() } })
                NameNote(d, Modifier.parity("settings-device.note"), Modifier.parity("settings-device.reset", Contract.label("settings-device.reset")).clickable {
                    patch(JSONObject().put("name", "")) { "Back to its network name" }
                })
            }
        }
        SettingsDivider(18, 18)
        Block {
            DeviceTitle("About", Modifier.parity("settings-device.title"))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((k, v) in d.about(at)) Row(Modifier.parity("settings-device.kv").fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(k, color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.5.sp, lineHeight = 18.9.sp)
                    Text(v, Modifier.weight(1f), color = paletteColor(Palette.TEXT), fontSize = 13.5.sp, lineHeight = 18.9.sp, textAlign = TextAlign.End)
                }
            }
            for (t in d.troubles(at)) DeviceNote(t, Modifier.parity("settings-device.note"), danger = true)
        }
        SettingsDivider(18, 18)
        Block {
            DeviceTitle("Capabilities", Modifier.parity("settings-device.title"))
            for ((label, chips) in listOf("Sample rates (kHz)" to d.rates, "Bit depth" to d.bits, "DSD" to d.dsd)) CapGroup(label, Modifier.parity("settings-device.cap-label")) {
                ChipFlow {
                    for (c in chips) if (d.chipEditable(c)) CapChipView(c, Modifier.parity("settings-device.chip", Contract.label("settings-device.chip", 0, c.label)).clickable(enabled = !busy) {
                        val body = d.tapped(c)
                        if (body == null) setupToast(context, "Leave at least one on") else patch(body)
                    }) else CapChipView(c, Modifier.parity("settings-device.cap"))
                }
            }
            if (d.containers.isNotEmpty()) CapGroup("Formats", Modifier.parity("settings-device.cap-label")) {
                Text(d.formats, Modifier.parity("settings-device.value").padding(top = 6.dp), color = paletteColor(Palette.TEXT), fontSize = 13.5.sp, lineHeight = 18.sp)
            }
            Text(d.legend, Modifier.parity("settings-device.legend").padding(top = 10.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.5.sp, lineHeight = 16.675.sp)
            for (n in d.capNotes) DeviceNote(n, Modifier.parity("settings-device.note"))
        }
        if (d.showOutput) {
            SettingsDivider(18, 18)
            Block {
                DeviceTitle("Output", Modifier.parity("settings-device.title"), Modifier.parity("settings-device.info", Contract.label("settings-device.info", 0, "Output")).clickable { info(d.outputInfo) })
                CapGroup("Mode", Modifier.parity("settings-device.cap-label")) {
                    Seg(d.modes, d.mode, key = { i, c -> Modifier.parity("settings-device.mode", Contract.label("settings-device.mode", i)).clickable(enabled = !busy) { patch(d.segment("mode", c.value)) } })
                }
                if (d.has32) CapGroup("Bit depth", Modifier.parity("settings-device.cap-label")) {
                    Seg(d.depths, d.outBits, key = { i, c -> Modifier.parity("settings-device.depth", Contract.label("settings-device.depth", i)).clickable(enabled = !busy && !c.off) { patch(d.segment("bits", c.value)) } })
                    if (!d.flac32) DeviceNote("32-bit needs an ffmpeg that writes 32-bit FLAC; this one stops at 24.", Modifier.parity("settings-device.note"))
                }
                DeviceNote(d.example, Modifier.parity("settings-device.note"))
                if (d.canFixVolume) {
                    Box(Modifier.padding(top = 14.dp)) {
                        SetupRow("Fixed volume", Modifier.parity("settings-device.name"), null) {
                            Toggle(d.volumeFixed, Modifier.parity("settings-device.fixvol", Contract.label("settings-device.fixvol")).clickable {
                                patch(JSONObject().put("output", JSONObject().put("volume", if (d.volumeFixed) "upnp" else "fixed")))
                            })
                        }
                    }
                    DeviceNote(d.fixedNote, Modifier.parity("settings-device.note"))
                }
            }
        }
        d.levelling?.let { lv ->
            SettingsDivider(18, 18)
            Block {
                NameRow("Volume levelling", Modifier.parity("settings-device.name"), Modifier.parity("settings-device.info", Contract.label("settings-device.info", 0, "Volume levelling")).clickable { info(d.levelInfo) }) {
                    SelectBox(choiceWords(DevicePage.LEVEL_MODES, d.levelMode), DevicePage.LEVEL_MODES, null, Modifier.parity("settings-device.lv-mode", Contract.label("settings-device.lv-mode")).clickable(enabled = !busy) {
                        pickChoice(context, DevicePage.LEVEL_MODES, d.levelMode) { v -> patch(JSONObject().put("levelling", JSONObject().put("mode", v))) { DevicePage.levelSaid(v) } }
                    })
                }
                if (d.levelMode != "off") {
                    val target = lv.optInt("target", -14).toString(); val unknown = lv.optInt("unknown", -5).toString()
                    NameRow("Target volume level", Modifier.parity("settings-device.name"), Modifier.parity("settings-device.info", Contract.label("settings-device.info", 0, "Target volume level")).clickable { info(DevicePage.TARGET_INFO) }) {
                        SelectBox(choiceWords(DevicePage.TARGETS, target), DevicePage.TARGETS, null, Modifier.parity("settings-device.lv-target", Contract.label("settings-device.lv-target")).clickable(enabled = !busy) {
                            pickChoice(context, DevicePage.TARGETS, target) { v -> patch(JSONObject().put("levelling", JSONObject().put("target", v.toInt()))) }
                        })
                    }
                    NameRow("Volume adjustment when loudness is unknown", Modifier.parity("settings-device.name"),
                        Modifier.parity("settings-device.info", Contract.label("settings-device.info", 0, "Volume adjustment when loudness is unknown")).clickable { info(DevicePage.UNKNOWN_INFO) }) {
                        SelectBox(choiceWords(DevicePage.UNKNOWNS, unknown), DevicePage.UNKNOWNS, null, Modifier.parity("settings-device.lv-unknown", Contract.label("settings-device.lv-unknown")).clickable(enabled = !busy) {
                            pickChoice(context, DevicePage.UNKNOWNS, unknown) { v -> patch(JSONObject().put("levelling", JSONObject().put("unknown", v.toInt()))) }
                        })
                    }
                }
            }
        }
        if (d.showDsp) DspBlock(d, client, busy, info) { body, said -> patch(body, said?.let { s -> { _: DevicePage -> s } }) }
        if (d.kind == "phone" && Store.phoneZone(context) == d.id) UsbBlock(info)
        if (!d.online) {
            SettingsDivider(18, 18)
            Block {
                SetupRow(d.forgetName, Modifier.parity("settings-device.name"), null) {
                    SetupButton("Forget this device", busy, Modifier.parity("settings-device.forget", Contract.label("settings-device.forget")).clickable(enabled = !busy) {
                        AlertDialog.Builder(context).setMessage(DevicePage.forgetAsk(d.name)).setNegativeButton("Cancel", null).setPositiveButton("Forget") { _, _ ->
                            val c = client() ?: return@setPositiveButton
                            busy = true
                            val made = ServerWrites.write { c.post(devicePath(d.id) + "/forget", JSONObject()) }
                            scope.launch { ServerWrites.await(made).onSuccess { setupToast(context, "Forgotten"); onBack() }.onFailure { error = com.musicd.server.client.Failure.said(it, "") }; busy = false }
                        }.show()
                    })
                }
                DeviceNote(DevicePage.FORGET_NOTE, Modifier.parity("settings-device.note"))
            }
        }
        if (error.isNotEmpty()) DeviceNote(error, Modifier.parity("settings-device.note"), danger = true)
    }
}

/** A note of the device's page (.settings-note): 12 faint, 6 over it, or red for what went wrong. */
@Composable
internal fun DeviceNote(text: String, modifier: Modifier, danger: Boolean = false) {
    Text(text, modifier.padding(top = 6.dp), color = paletteColor(if (danger) Palette.DANGER else Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
}

/** The note under the name's field: its network name, Use the network name where renamed ([reset]), a Sonos's own name kept. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NameNote(d: DevicePage, modifier: Modifier, reset: Modifier) {
    FlowRow(modifier.padding(top = 6.dp)) {
        Text(d.nameNote + if (d.renamed) " · " else "", color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
        if (d.renamed) Text("Use the network name", reset, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 12.sp, lineHeight = 17.4.sp, textDecoration = TextDecoration.Underline)
        if (d.sonosNameNote.isNotEmpty()) Text(d.sonosNameNote, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
    }
}

/** A block's title (.settings-block-title): 13 in 700, spaced, in capitals, faint, 10 under it; its ⓘ beside it ([info]). */
@Composable
internal fun DeviceTitle(text: String, modifier: Modifier, info: Modifier? = null) {
    Row(Modifier.padding(bottom = 10.dp).heightIn(min = if (info != null) 32.dp else 18.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), modifier, color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        if (info != null) Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 13.sp) }
    }
}

/**
 * A setting's row whose name may wrap (.settings-row): its name in 16 with its ⓘ after it, the ⓘ on the next line where the
 * name leaves it no room, as the page's inline one goes; [control] on the right, 16 from them.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun NameRow(name: String, nameMod: Modifier, info: Modifier, control: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        FlowRow(Modifier.weight(1f), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(name, nameMod, color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
            Box(info.size(32.dp).padding(start = 4.dp), contentAlignment = Alignment.Center) { Text("ⓘ", color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 16.sp) }
        }
        control()
    }
}

/** A group of capabilities (.cap-group): its label in 12/700 spaced capitals, faint, 12 over it, then [content]. */
@Composable
internal fun CapGroup(label: String, modifier: Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.padding(top = 12.dp).fillMaxWidth()) {
        Text(label.uppercase(), modifier, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        content()
    }
}

/** The chips of a group (.cap-chips): 6 apart, wrapping, 8 under the label. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipFlow(content: @Composable () -> Unit) {
    FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() }
}

/** A chip (.cap-chip): 13 in a pill, 5 and 11 in; on, on the brass's wash with its mark; one not sent as DSD, dashed. */
@Composable
internal fun CapChipView(c: CapChip, modifier: Modifier) {
    val pill = RoundedCornerShape(999.dp)
    Row(modifier.clip(pill).background(if (c.on) paletteColor(Palette.ACCENT_SOFT) else Color.Transparent)
        .then(if (c.later) Modifier.dashed(paletteColor(if (c.on) Palette.ACCENT else Palette.BORDER), 999.dp) else Modifier.border(1.dp, paletteColor(if (c.on) Palette.ACCENT else Palette.BORDER), pill))
        .padding(horizontal = 11.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(c.label, color = paletteColor(if (c.on) Palette.TEXT else Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
        c.mark?.let { Text(it, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 10.sp, lineHeight = 13.sp) }
    }
}

/**
 * A segmented choice (.seg): its choices side by side in one 10-round box on the raised ground, 1 apart, 9 tall in, 13.5 dim;
 * the one chosen ([current]) on the brass in 600. [key] gives each its key and tap.
 */
@Composable
internal fun Seg(choices: List<SegChoice>, current: String, key: (Int, SegChoice) -> Modifier) {
    val shape = RoundedCornerShape(10.dp)
    Row(Modifier.padding(top = 8.dp).fillMaxWidth().height(IntrinsicSize.Min).clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)) {
        for ((i, c) in choices.withIndex()) {
            if (i > 0) Box(Modifier.width(1.dp).fillMaxHeight().background(paletteColor(Palette.BORDER)))
            val on = c.value == current
            Box(key(i, c).weight(1f).alpha(if (c.off) 0.4f else 1f).background(if (on) paletteColor(Palette.ACCENT) else Color.Transparent).padding(horizontal = 6.dp, vertical = 9.dp),
                contentAlignment = Alignment.Center) {
                Text(c.label, color = paletteColor(if (on) Palette.TEXT else Palette.TEXT_DIM), fontSize = 13.5.sp, lineHeight = 18.sp, fontWeight = if (on) FontWeight.W600 else FontWeight.W400,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
