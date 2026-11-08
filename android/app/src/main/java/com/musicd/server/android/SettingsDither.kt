package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.musicd.server.client.Contract
import com.musicd.server.client.DeviceDither
import com.musicd.server.client.DevicePage
import com.musicd.server.client.Palette
import org.json.JSONObject

/*
 * Where Mandarin makes the PCM (upsampled, not made DSD), a device's DAC's real bits and Dither natively (item 301), as
 * the page's (app/device-dither.js): the real bits a row of buttons; the dither one row, the one in use, opening the
 * list up from the foot, each with what it measured, the one in use ticked in brass; a tap chooses it and the list
 * closes. Drawn as the Modulator's (SettingsModulator.kt).
 */

/** The DAC's real bits and the Dither's groups for the device's page [d] (its row [r]); [patch] sends a choice. */
@Composable
internal fun DitherGroups(d: DevicePage, r: DeviceDither.Row, busy: Boolean, patch: (JSONObject) -> Unit) {
    CapGroup("DAC’s real bits", Modifier.parity("settings-device.cap-label")) {
        Seg(DeviceDither.REAL_BITS, d.realBitsValue, key = { i, c -> Modifier.parity("settings-device.realbits", Contract.label("settings-device.realbits", i)).clickable(enabled = !busy) { patch(DeviceDither.pickBits(c.value)) } })
        DeviceNote(DeviceDither.REAL_BITS_NOTE, Modifier.parity("settings-device.note"))
    }
    CapGroup("Dither", Modifier.parity("settings-device.cap-label")) { DitherRow(d, r, busy, patch) }
}

/** Headroom when upsampling (item 348), set to [v] ("auto" or "off"), as the page's headroomGroup. */
@Composable
internal fun HeadroomGroup(v: String, busy: Boolean, patch: (JSONObject) -> Unit) {
    CapGroup(DeviceDither.HEADROOM_TITLE, Modifier.parity("settings-device.cap-label")) {
        Seg(DeviceDither.HEADROOM, v, key = { i, c -> Modifier.parity("settings-device.upsample-headroom", Contract.label("settings-device.upsample-headroom", i)).clickable(enabled = !busy) { patch(DeviceDither.pickHeadroom(c.value)) } })
        DeviceNote(DeviceDither.headroomNote(v == "off"), Modifier.parity("settings-device.note"))
    }
}

@Composable
private fun ColumnScope.DitherRow(d: DevicePage, r: DeviceDither.Row, busy: Boolean, patch: (JSONObject) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(12.dp)
    Row(Modifier.parity("settings-device.dither", Contract.label("settings-device.dither"))
        .padding(top = 8.dp).fillMaxWidth().heightIn(min = 56.dp).clip(shape).background(paletteColor(Palette.BG_ELEV)).border(1.dp, paletteColor(Palette.BORDER), shape)
        .clickable(enabled = !busy) { open = true }.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(r.label, color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600)
            Text(r.sub, Modifier.padding(top = 2.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 17.sp)
        }
        Text(r.value, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 14.5.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600, maxLines = 1)
        Icon(painterResource(R.drawable.dl_chevron), contentDescription = null, tint = paletteColor(Palette.TEXT_DIM), modifier = Modifier.size(18.dp))
    }
    DeviceNote(DeviceDither.NOTE, Modifier.parity("settings-device.note"))
    if (open) DitherSheet(DeviceDither.used(d.dither).value, onClose = { open = false }) { v -> open = false; patch(DeviceDither.pick(v)) }
}

/** The list up from the foot: its grip, its title in brass capitals, each dither with its figures; [current] ticked. */
@Composable
private fun DitherSheet(current: String, onClose: () -> Unit, onPick: (String) -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect { window?.setDimAmount(0.55f) }
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.parity("settings-device.dither-close", Contract.label("settings-device.dither-close")).fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose))
            val top = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.88f).dp).clip(top)
                .background(paletteColor(Palette.BG_ELEV)).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(start = 16.dp, top = 10.dp, end = 16.dp, bottom = 18.dp)) {
                Box(Modifier.align(Alignment.CenterHorizontally).padding(top = 2.dp, bottom = 12.dp).size(40.dp, 4.dp).clip(CircleShape).background(paletteColor(Palette.BORDER)))
                Text(DeviceDither.TITLE.uppercase(), Modifier.parity("settings-device.dither-sheet-title").padding(start = 2.dp, end = 2.dp, bottom = 10.dp),
                    color = paletteColor(Palette.ACCENT_TEXT), fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.W700, letterSpacing = 0.16.em)
                for ((i, m) in DeviceDither.ALL.withIndex()) {
                    val on = m.value == current
                    Column(Modifier.parity("settings-device.dither-choice", Contract.label("settings-device.dither-choice", i)).fillMaxWidth().clickable { onPick(m.value) }) {
                        Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
                        Row(Modifier.padding(horizontal = 4.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(m.name, color = paletteColor(if (on) Palette.ACCENT_TEXT else Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
                                Text(m.note, Modifier.padding(top = 3.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp)
                            }
                            Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                                if (on) Icon(painterResource(R.drawable.dv_tick), contentDescription = null, tint = paletteColor(Palette.ACCENT_TEXT), modifier = Modifier.size(22.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}
