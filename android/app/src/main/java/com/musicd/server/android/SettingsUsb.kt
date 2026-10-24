package com.musicd.server.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.CapChip
import com.musicd.server.client.Contract
import com.musicd.server.client.DevicePage
import com.musicd.server.client.Palette
import com.musicd.server.client.UsbView
import kotlinx.coroutines.delay

/*
 * This phone's USB DAC on its own page in Settings → Audio Devices natively (T6; bug list item 89), as the page's
 * (audio-devices-page.js renderUsb): what is on the port, Allow, what its descriptors say it takes, USB direct, fixed
 * volume, the volume limit, how DSD goes to it, what it is being fed now, Copy for a report. Read from the app's own driver
 * (UsbDac) every two seconds while shown, and at once after each change.
 */

/** The USB DAC block on this phone's page; [info] shows an ⓘ's help. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun UsbBlock(info: (String) -> Unit) {
    val context = LocalContext.current
    val activity = context as? Activity ?: return
    val bridge = remember { UsbBridge(activity) }
    var usb by remember { mutableStateOf(UsbView(UsbDac.json(context))) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) { while (true) { untilOnScreen(); usb = UsbView(UsbDac.json(context)); delay(2_000) } }
    val again = { tick++ }
    SettingsDivider(18, 18)
    Block {
        DeviceTitle("USB DAC", Modifier.parity("settings-device.title"))
        val u = usb
        if (!u.attached) { DeviceNote(UsbView.NOTHING, Modifier.parity("settings-device.note")); return@Block }
        SetupRow(u.name, Modifier.parity("settings-device.name"), null) {
            if (!u.permission) SetupButton("Allow", false, Modifier.parity("settings-device.usb-allow", Contract.label("settings-device.usb-allow")).clickable { bridge.request(); again() })
        }
        if (!u.permission) {
            DeviceNote(UsbView.ASK, Modifier.parity("settings-device.note"))
            u.error?.let { DeviceNote(it, Modifier.parity("settings-device.note"), danger = true) }
            return@Block
        }
        if (!u.hasInfo) { DeviceNote(u.error ?: UsbView.READING, Modifier.parity("settings-device.note"), danger = true); return@Block }
        CapGroup("Class", Modifier.parity("settings-device.cap-label")) { UsbValue(u.classLine, Modifier.parity("settings-device.value")) }
        for ((label, chips) in listOf("Sample rates (kHz)" to u.rates.map { CapChip("rate", it, DevicePage.rateWord(it), true, "confirmed") },
            "Bit depth" to u.bits.map { CapChip("bits", it, "$it-bit", true, "confirmed") })) CapGroup(label, Modifier.parity("settings-device.cap-label")) {
            if (chips.isEmpty()) UsbValue("not stated", Modifier.parity("settings-device.value"))
            else FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (c in chips) CapChipView(c, Modifier.parity("settings-device.cap"))
            }
        }
        CapGroup("DSD", Modifier.parity("settings-device.cap-label")) { UsbValue(u.dsdLine, Modifier.parity("settings-device.value")) }
        CapGroup("Volume", Modifier.parity("settings-device.cap-label")) { UsbValue(u.volumeLine, Modifier.parity("settings-device.value")) }
        u.clock?.let { CapGroup("Clock now", Modifier.parity("settings-device.cap-label")) { UsbValue(it, Modifier.parity("settings-device.value")) } }
        Box(Modifier.padding(top = 14.dp)) {
            NameRow("USB direct", Modifier.parity("settings-device.name"), Modifier.parity("settings-device.info", Contract.label("settings-device.info", 0, "USB direct")).clickable { info(UsbView.DIRECT_INFO) }) {
                Toggle(u.direct, Modifier.parity("settings-device.usb-direct", Contract.label("settings-device.usb-direct")).clickable { bridge.setDirect(!u.direct); again() })
            }
        }
        DeviceNote(u.directNote, Modifier.parity("settings-device.note"))
        if (u.direct) {
            Box(Modifier.padding(top = 14.dp)) {
                SetupRow("Fixed volume", Modifier.parity("settings-device.name"), null) {
                    Toggle(u.fixed, Modifier.parity("settings-device.usb-fixed", Contract.label("settings-device.usb-fixed")).clickable { bridge.setFixed(!u.fixed); again() })
                }
            }
            DeviceNote(u.fixedNote, Modifier.parity("settings-device.note"))
            if (!u.fixed) {
                var limit by remember(u.limit) { mutableIntStateOf(u.limit) }
                Box(Modifier.padding(top = 10.dp)) {
                    SetupRow("Volume limit", Modifier.parity("settings-device.name"), null) {
                        Text("$limit%", Modifier.parity("settings-device.value"), color = paletteColor(Palette.TEXT), fontSize = 13.5.sp, lineHeight = 18.9.sp)
                    }
                }
                // The page's range (10 to 100 in fives), the value beside it as it moves, kept once let go.
                fun at(x: Float, w: Int) { limit = (10 + Math.round((x / w).coerceIn(0f, 1f) * 18) * 5) }
                LimitTrack((limit - 10) / 90f, Modifier.parity("settings-device.usb-limit", Contract.label("settings-device.usb-limit")).fillMaxWidth().height(22.dp)
                    .pointerInput(Unit) { detectTapGestures { at(it.x, size.width); bridge.setLimit(limit); again() } }
                    .pointerInput(Unit) { detectHorizontalDragGestures(onDragEnd = { bridge.setLimit(limit); again() }) { change, _ -> at(change.position.x, size.width) } })
                DeviceNote(UsbView.LIMIT_NOTE, Modifier.parity("settings-device.note"))
            }
        }
        if (u.showDsd) {
            Box(Modifier.padding(top = 14.dp)) {
                SetupRow("DSD", Modifier.parity("settings-device.name"), null) {
                    SelectBox(choiceWords(u.dsdChoices, u.dsdMode), u.dsdChoices, null, Modifier.parity("settings-device.usb-dsd", Contract.label("settings-device.usb-dsd")).clickable {
                        pickChoice(context, u.dsdChoices, u.dsdMode) { m -> bridge.setDsdMode(m); again() }
                    })
                }
            }
            DeviceNote(u.dsdNote, Modifier.parity("settings-device.note"))
        }
        u.streaming?.let { CapGroup("Streaming now", Modifier.parity("settings-device.cap-label")) { UsbValue(it, Modifier.parity("settings-device.value")) } }
        u.streamError?.let { DeviceNote(it, Modifier.parity("settings-device.note"), danger = true) }
        Box(Modifier.padding(top = 10.dp)) {
            SetupRow("Diagnostics", Modifier.parity("settings-device.name"), null) {
                SetupButton("Copy", false, Modifier.parity("settings-device.usb-copy", Contract.label("settings-device.usb-copy")).clickable {
                    runCatching {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Mandarin USB DAC", bridge.diagnostics()))
                    }.fold({ setupToast(context, "Copied — paste it into a report") }, { setupToast(context, "Couldn't copy: " + (it.message ?: "")) })
                })
            }
        }
        DeviceNote(UsbView.DIAGNOSTICS_NOTE, Modifier.parity("settings-device.note"))
        u.error?.let { DeviceNote(it, Modifier.parity("settings-device.note"), danger = true) }
    }
}

/** A value of the DAC's (.cap-group .dev-v): 13.5, 6 under its label. */
@Composable
private fun UsbValue(text: String, modifier: Modifier) {
    Text(text, modifier.padding(top = 6.dp), color = paletteColor(Palette.TEXT), fontSize = 13.5.sp, lineHeight = 18.sp)
}

/** The limit's track (the page's range in the accent): the part chosen in the accent, the rest light, the 16 thumb at [frac]. */
@Composable
private fun LimitTrack(frac: Float, modifier: Modifier) {
    val accent = paletteColor(Palette.ACCENT)
    Canvas(modifier) {
        val r = 8.dp.toPx(); val h = 4.dp.toPx(); val y = size.height / 2
        val x = r + (size.width - 2 * r) * frac.coerceIn(0f, 1f)
        drawRoundRect(Color(0xFFEFEFEF), Offset(0f, y - h / 2), Size(size.width, h), CornerRadius(h / 2))
        drawRoundRect(accent, Offset(0f, y - h / 2), Size(x, h), CornerRadius(h / 2))
        drawCircle(accent, r, Offset(x, y))
    }
}
