package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.DeviceFilters
import com.musicd.server.client.DevicePage
import com.musicd.server.client.DeviceRecipes
import com.musicd.server.client.Palette
import org.json.JSONObject

/*
 * A device's Output as recipes natively (item 320), as the page's (app/device-recipes.js; style.css .recipe-card,
 * .recipe-advanced): a card each under Sound, the one in use outlined in brass with what it does for this device; a tap
 * sends its settings. Custom opens Advanced, a fold holding every row of the Output as before; it stays open where it
 * was opened, and is open while Custom is the one in use.
 */

/** The Sound group of the device's page [d]: its recipes as cards; [patch] sends one picked. Custom opens Advanced ([custom]). */
@Composable
internal fun RecipesGroup(d: DevicePage, busy: Boolean, custom: () -> Unit, patch: (JSONObject) -> Unit) {
    CapGroup(DeviceRecipes.TITLE, Modifier.parity("settings-device.cap-label")) {
        for (r in d.recipes) RecipeCard(r, busy) { DeviceRecipes.pick(r)?.let(patch) ?: run { if (r.output == null) custom() } }
    }
}

/** A card (.recipe-card): 12 round on the raised ground, its name; the one in use outlined in brass, with its words. */
@Composable
private fun RecipeCard(r: DeviceRecipes.Recipe, busy: Boolean, onTap: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.parity("settings-device.recipe", Contract.label("settings-device.recipe", 0, r.name))
        .padding(top = 8.dp).fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV))
        .border(1.dp, paletteColor(if (r.on) Palette.ACCENT_TEXT else Palette.BORDER), shape)
        .clickable(enabled = !busy, onClick = onTap).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Text(r.name, color = paletteColor(if (r.on) Palette.ACCENT_TEXT else Palette.TEXT), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.W600)
        if (r.on) Text(r.words, Modifier.padding(top = 4.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp)
    }
}

/** The recipes and the Advanced fold under them (.recipe-advanced), its head opening and closing it; [patch] sends a change. */
@Composable
internal fun RecipesAndAdvanced(d: DevicePage, busy: Boolean, patch: (JSONObject) -> Unit) {
    var opened by remember(d.id) { mutableStateOf(false) }
    RecipesGroup(d, busy, custom = { opened = true }, patch = patch)
    val open = DeviceRecipes.advancedOpen(d.recipes, opened)
    Row(Modifier.parity("settings-device.advanced", Contract.label("settings-device.advanced")).padding(top = 14.dp).fillMaxWidth()
        .clickable { opened = !open }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(DeviceRecipes.ADVANCED.uppercase(), color = paletteColor(Palette.ACCENT_TEXT), fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.W700, letterSpacing = 0.16.em)
        Text(if (open) DeviceRecipes.ADVANCED_OPEN else DeviceRecipes.ADVANCED_SHUT, Modifier.weight(1f), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 17.sp)
        Icon(painterResource(R.drawable.dl_chevron), contentDescription = null, tint = paletteColor(Palette.TEXT_DIM), modifier = Modifier.size(18.dp).rotate(if (open) 90f else 0f))
    }
    if (open) Column(Modifier.fillMaxWidth()) { OutputRows(d, busy, patch) }
}

/** Every row of the Output but DSD as PCM, as they were before the recipes: the mode to the modulator; [patch] sends a change. */
@Composable
internal fun OutputRows(d: DevicePage, busy: Boolean, patch: (JSONObject) -> Unit) {
    CapGroup("Mode", Modifier.parity("settings-device.cap-label")) {
        Seg(d.modes, d.mode, key = { i, c -> Modifier.parity("settings-device.mode", Contract.label("settings-device.mode", i)).clickable(enabled = !busy) { patch(d.segment("mode", c.value)) } })
    }
    if (d.showMaxRate) CapGroup("Highest rate", Modifier.parity("settings-device.cap-label")) {
        Seg(d.maxRates, d.maxRateValue, key = { i, c -> Modifier.parity("settings-device.maxrate", Contract.label("settings-device.maxrate", i)).clickable(enabled = !busy) { patch(d.segment("max_rate", c.value)) } })
        DeviceNote(d.maxRateNote, Modifier.parity("settings-device.note"))
    }
    if (d.showFilter) CapGroup("Filter", Modifier.parity("settings-device.cap-label")) { FilterGroup(d, busy) { patch(it) } }
    if (d.showFilter) CapGroup("Phase", Modifier.parity("settings-device.cap-label")) {   // item 318
        Seg(DeviceFilters.PHASES, d.phase, key = { i, c -> Modifier.parity("settings-device.phase", Contract.label("settings-device.phase", i)).clickable(enabled = !busy) { patch(d.segment("phase", c.value)) } })
        DeviceNote(DeviceFilters.PHASE_NOTE, Modifier.parity("settings-device.note"))
    }
    if (d.has32) CapGroup("Bit depth", Modifier.parity("settings-device.cap-label")) {
        Seg(d.depths, d.outBits, key = { i, c -> Modifier.parity("settings-device.depth", Contract.label("settings-device.depth", i)).clickable(enabled = !busy && !c.off) { patch(d.segment("bits", c.value)) } })
        if (!d.flac32) DeviceNote("32-bit needs an ffmpeg that writes 32-bit FLAC; this one stops at 24.", Modifier.parity("settings-device.note"))
    }
    d.ditherRow?.let { r -> DitherGroups(d, r, busy) { patch(it) } }   // the DAC's real bits and the dither (item 301)
    d.headroom?.let { h -> HeadroomGroup(h, busy) { patch(it) } }   // and its headroom when upsampling (item 348)
    DeviceNote(d.example, Modifier.parity("settings-device.note"))
    if (d.showDsdOut) CapGroup("PCM as DSD", Modifier.parity("settings-device.cap-label")) {
        Seg(d.dsdOuts, d.dsdOutValue, key = { i, c -> Modifier.parity("settings-device.dsdout", Contract.label("settings-device.dsdout", i)).clickable(enabled = !busy && !c.off) { patch(d.segment("dsd_out", c.value)) } })
        DeviceNote(d.dsdOutNote, Modifier.parity("settings-device.note"))
        d.dsdOutLine?.let { DeviceNote(it, Modifier.parity("settings-device.note")) }
    }
    d.modRow?.let { r -> CapGroup("Modulator", Modifier.parity("settings-device.cap-label")) { ModulatorGroup(d, r, busy) { patch(it) } } }
}
