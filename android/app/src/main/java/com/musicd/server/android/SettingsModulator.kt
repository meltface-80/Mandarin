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
import androidx.compose.ui.draw.alpha
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
import com.musicd.server.client.DeviceModulators
import com.musicd.server.client.DevicePage
import com.musicd.server.client.Palette
import org.json.JSONObject

/*
 * With PCM as DSD on, a device's Modulator natively (item 303), as the page's (app/device-modulators.js; style.css
 * .filter-row, .filter-sheet, .filter-choice.is-off): one row, the modulator in use at that DSD rate, opening the list
 * up from the foot, each with what it measured, the one in use ticked in brass, one not made at that rate dimmed and not
 * to be picked; a tap chooses it and the list closes. Drawn as the Filter's (SettingsFilters.kt).
 */

/** The Modulator's row [r] of the device's page [d] and its note; [patch] sends a modulator picked. */
@Composable
internal fun ColumnScope.ModulatorGroup(d: DevicePage, r: DeviceModulators.Row, busy: Boolean, patch: (JSONObject) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(12.dp)
    Row(Modifier.parity("settings-device.modulator", Contract.label("settings-device.modulator"))
        .padding(top = 8.dp).fillMaxWidth().heightIn(min = 56.dp).clip(shape).background(paletteColor(Palette.BG_ELEV)).border(1.dp, paletteColor(Palette.BORDER), shape)
        .clickable(enabled = !busy) { open = true }.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(r.label, color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600)
            Text(r.sub, Modifier.padding(top = 2.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 17.sp)
        }
        Text(r.value, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 14.5.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600, maxLines = 1)
        Icon(painterResource(R.drawable.dl_chevron), contentDescription = null, tint = paletteColor(Palette.TEXT_DIM), modifier = Modifier.size(18.dp))
    }
    DeviceNote(DeviceModulators.NOTE, Modifier.parity("settings-device.note"))
    if (open) ModulatorSheet(d.dsdOut, DeviceModulators.used(d.dsdMod, d.dsdOut).value, onClose = { open = false }) { v -> open = false; patch(DeviceModulators.pick(v)) }
}

/** The list at DSD[n] up from the foot: its grip, its title in brass capitals, each modulator with its figures; [current] ticked. */
@Composable
private fun ModulatorSheet(n: Int, current: String, onClose: () -> Unit, onPick: (String) -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect { window?.setDimAmount(0.55f) }
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.parity("settings-device.modulator-close", Contract.label("settings-device.modulator-close")).fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose))
            val top = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.88f).dp).clip(top)
                .background(paletteColor(Palette.BG_ELEV)).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(start = 16.dp, top = 10.dp, end = 16.dp, bottom = 18.dp)) {
                Box(Modifier.align(Alignment.CenterHorizontally).padding(top = 2.dp, bottom = 12.dp).size(40.dp, 4.dp).clip(CircleShape).background(paletteColor(Palette.BORDER)))
                Text(DeviceModulators.title(n).uppercase(), Modifier.parity("settings-device.modulator-sheet-title").padding(start = 2.dp, end = 2.dp, bottom = 10.dp),
                    color = paletteColor(Palette.ACCENT_TEXT), fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.W700, letterSpacing = 0.16.em)
                for ((i, m) in DeviceModulators.choices(n).withIndex()) {
                    val on = m.value == current
                    Column(Modifier.parity("settings-device.modulator-choice", Contract.label("settings-device.modulator-choice", i)).fillMaxWidth().alpha(if (m.offered) 1f else 0.45f)
                        .clickable(enabled = m.offered) { onPick(m.value) }) {
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
