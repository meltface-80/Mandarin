package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Facets
import com.musicd.server.client.LibraryView
import com.musicd.server.client.Palette

/*
 * The Library wall's sheets (bug list item 52; the page's openLibSheet,
 * library-focus.js, playlist-share.js's sort sheet; style.css .lib-sheet):
 * a panel up from the foot of the screen over a dimmed page, its title and
 * ✕ at the top, its body scrolling, its buttons along the foot. Focus: the
 * listening, then each facet as a section that opens to its chips, a chip
 * tapped once included, again excluded, once more cleared; Clear all, Save
 * as… (a Dynamic Playlist, the page's prompt) and Show albums. Sort: a row
 * each way, the one on in brass with its arrow, tapped again to reverse
 * (Random reshuffles).
 */

/** The panel: [title] and the close at its head, [body] scrolling, [foot] along its bottom; a tap on the dimmed page closes it too (Material's sheet does the dimming and the drag). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Sheet(title: String, onClose: () -> Unit, foot: (@Composable RowScope.() -> Unit)?, body: @Composable ColumnScope.() -> Unit) {
    val hairline = Color(0x12FFFFFF)   // the page's --panel-hairline, white at .07
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.82).dp
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = null,
        shape = RoundedCornerShape(16.dp, 16.dp, 0.dp, 0.dp), containerColor = MaterialTheme.colorScheme.surfaceVariant, scrimColor = Color(0x8C000000)) {
        Column(Modifier.fillMaxWidth().heightIn(max = maxHeight).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp, 16.dp, 0.dp, 0.dp))) {
            Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(title, Modifier.parity("library.focus-title library.sort-title"), color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, fontWeight = FontWeight.W700)
                Box(Modifier.parity("library.focus-close library.sort-close", Contract.label("library.focus-close")).size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
                    .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                    Text("✕", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 16.sp)
                }
            }
            HorizontalDivider(color = hairline)
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 14.dp), content = body)
            if (foot != null) {
                HorizontalDivider(color = hairline)
                Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), content = foot)
            }
        }
    }
}

/** A sheet's buttons along the foot (.action-btn): their colours, [primary] in brass, and the plain ones' edge. */
@Composable
private fun footColors(primary: Boolean) = if (primary) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary)
    else ButtonDefaults.buttonColors(containerColor = paletteColor(Palette.BG_ELEV_2), contentColor = MaterialTheme.colorScheme.onSurface)

/** Why a facet's chips don't add up to the library (the page's COVERAGE_NOTE). */
private val COVERAGE_NOTE = mapOf(
    "decade" to "Release years come from your file tags (ORIGINALDATE, then DATE) and from MusicBrainz. Undated albums aren't in any decade.",
    "genre" to "Genres are read from your files' GENRE tags. An album with no genre tag won't appear here.",
    "label" to "Labels are collected during the label scan, which runs in the background and fills in over time.",
    "format" to "Read from your own files.",
    "added" to "Date added is when the files arrived in your music folder, as Mandarin could work out for itself — file timestamps, and albums appearing between scans."
)
private val COVERAGE_OF = mapOf("rate" to "format", "bits" to "format", "chan" to "format")

/** The Focus sheet over [view] with [facets] (null until they come); each change [onChange]; [onSave] the view as a Dynamic Playlist; [onShow] closes with the view applied. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FocusSheet(view: LibraryView, facets: Facets?, onChange: (LibraryView) -> Unit, onSave: () -> Unit, onShow: () -> Unit, onClose: () -> Unit) {
    // Which sections are open: a section with something on opens by itself, and stays open until its head is tapped.
    val open = remember { mutableStateMapOf<String, Boolean>() }
    val faint = paletteColor(Palette.TEXT_FAINT)
    Sheet("Focus", onClose, foot = {
        val edge = Modifier.border(1.dp, MaterialTheme.colorScheme.outline, ButtonDefaults.shape)
        val pad = PaddingValues(horizontal = 8.dp)
        Button(onClick = { onChange(view.cleared()); onClose() }, colors = footColors(false), contentPadding = pad,
            modifier = Modifier.parity("library.focus-clear", Contract.label("library.focus-clear")).weight(1f).defaultMinSize(minHeight = 40.dp).then(edge)) {
            Text(Contract.label("library.focus-clear"), fontSize = 13.sp, fontWeight = FontWeight.W500, maxLines = 1)
        }
        Button(onClick = onSave, colors = footColors(false), contentPadding = pad,
            modifier = Modifier.parity("library.focus-save", Contract.label("library.focus-save")).weight(1f).defaultMinSize(minHeight = 40.dp).then(edge)) {
            Text(Contract.label("library.focus-save"), fontSize = 13.sp, fontWeight = FontWeight.W500, maxLines = 1)
        }
        Button(onClick = onShow, colors = footColors(true), contentPadding = pad,
            modifier = Modifier.parity("library.focus-show", Contract.label("library.focus-show")).weight(1f).defaultMinSize(minHeight = 40.dp)) {
            Text(Contract.label("library.focus-show"), fontSize = 13.sp, fontWeight = FontWeight.W500, maxLines = 1)
        }
    }) {
        @Composable fun Section(id: String, label: String, active: Int, chips: @Composable () -> Unit, notes: List<String>) {
            if (open[id] == null && active > 0) open[id] = true
            val expanded = open[id] == true
            Column(Modifier.fillMaxWidth()) {
                HorizontalDivider(color = Color(0x12FFFFFF))
                Row(Modifier.parity("library.focus-section", Contract.label("library.focus-section", 0, label)).fillMaxWidth().clickable { open[id] = !expanded }.padding(vertical = 13.dp, horizontal = 2.dp)
                    .defaultMinSize(minHeight = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(label.uppercase(), Modifier.weight(1f), color = if (expanded) MaterialTheme.colorScheme.onSurface else faint, fontSize = 10.5.sp, fontWeight = FontWeight.W700, letterSpacing = 0.14.em)
                    if (active > 0) Text("$active", Modifier.defaultMinSize(minWidth = 18.dp).height(18.dp).clip(RoundedCornerShape(999.dp)).background(MaterialTheme.colorScheme.primary).padding(horizontal = 5.dp),
                        color = MaterialTheme.colorScheme.onPrimary, fontSize = 11.sp, fontWeight = FontWeight.W700, lineHeight = 18.sp)
                    Text(if (expanded) "⌃" else "⌄", color = faint, fontSize = 13.sp)
                }
                if (expanded) {
                    FlowRow(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) { chips() }
                    for (n in notes) Text(n, Modifier.parity("library.focus-note").padding(top = 8.dp, bottom = 4.dp), color = faint, fontSize = 11.5.sp, lineHeight = 17.sp)
                }
            }
        }
        @Composable fun Chip(label: String, state: String, onTap: () -> Unit) {
            val on = state == "on"; val not = state == "not"
            Box(Modifier.parity("library.focus-chip", Contract.label("library.focus-chip", if (not) 1 else 0, label)).clip(RoundedCornerShape(999.dp))
                .background(if (on) paletteColor(Palette.ACCENT_SOFT) else if (not) Color(0x29E8836B) else paletteColor(Palette.BG_ELEV_2))
                .border(1.dp, if (on) MaterialTheme.colorScheme.primary else if (not) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp))
                .clickable(onClick = onTap).padding(horizontal = 12.dp, vertical = 7.dp)) {
                Text(label, color = if (on || not) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.5.sp, fontWeight = FontWeight.W600,
                    textDecoration = if (not) TextDecoration.LineThrough else null)
            }
        }
        // Listening first: the one facet always there, from this server's own play history.
        Section("played", "Listening", if (view.played != "any") 1 else 0, chips = {
            for (p in LibraryView.PLAYED) Chip(p.label, if (view.played == p.id) "on" else "off") { onChange(view.copy(played = p.id)) }
        }, notes = if (facets != null && !facets.hasPlays) listOf("Mandarin hasn't seen anything play yet, so these use an empty history — everything counts as never played.") else emptyList())
        for (f in facets?.facets ?: emptyList()) {
            if (f.id !in LibraryView.FACET_IDS) continue
            val sel = view.facets[f.id] ?: emptyList()
            val notes = ArrayList<String>()
            if (f.totalValues > f.values.size) notes += "Showing the ${f.values.size} most common of ${f.totalValues}."
            val cov = COVERAGE_OF[f.id] ?: f.id
            val have = facets?.coverage?.get(cov)
            if (COVERAGE_NOTE[cov] != null && have != null && facets != null && facets.total > 0 && have < facets.total) notes += "$have of ${facets.total} albums. " + COVERAGE_NOTE[cov]
            if (f.id == "source" && facets?.sourcesDerived == true) notes += "Every album in your library came from your own files."
            Section(f.id, f.label, sel.size, chips = {
                for (v in f.values) Chip(v.label + " (" + v.count + ")", view.state(f.id, v.value)) { onChange(view.cycle(f.id, v.value)) }
                // Anything selected the server didn't send back (a value past the commonest): a chip of its own, so it can be cleared.
                val listed = f.values.map { it.value }
                for (raw in sel) { val value = raw.removePrefix("!"); if (value !in listed) Chip(value, view.state(f.id, value)) { onChange(view.cycle(f.id, value)) } }
            }, notes = notes)
        }
        Text("Tap a filter once to include it, again to exclude it, once more to clear it. Everything here is read from your files' own tags.",
            Modifier.parity("library.focus-help").padding(top = 16.dp), color = faint, fontSize = 11.5.sp, lineHeight = 17.sp)
    }
}

/** The Sort sheet: a row each way; the one on in brass with its arrow, tapped again to reverse (Random: to reshuffle). */
@Composable
internal fun SortSheet(view: LibraryView, onChoose: (String) -> Unit, onClose: () -> Unit) {
    Sheet("Sort by", onClose, foot = null) {
        for (o in LibraryView.SORTS) {
            val on = view.sort == o.id
            Row(Modifier.parity("library.sort-row", Contract.label("library.sort-row", if (on && o.hasDir) 1 else 0, o.label, view.dirLabel)).fillMaxWidth().padding(top = 4.dp)
                .clip(RoundedCornerShape(10.dp)).background(if (on) paletteColor(Palette.ACCENT_SOFT) else Color.Transparent).clickable { onChoose(o.id) }.padding(horizontal = 12.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (on && o.hasDir) (if (view.dir == "desc") "↓" else "↑") else "", Modifier.width(20.dp), color = MaterialTheme.colorScheme.secondary, fontSize = 19.sp, lineHeight = 19.sp)
                Column {
                    Text(o.label, color = if (on) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp, fontWeight = if (on) FontWeight.W700 else FontWeight.W600)
                    o.note?.let { Text(it, Modifier.padding(top = 2.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.5.sp) }
                }
            }
        }
    }
}

/** The Focus and Sort pills at the top right of the wall (the touch layout's), each a tap to its sheet; [focus] how many filters are on. */
@Composable
internal fun BoxScope.LibraryPills(focus: Int, onFocus: () -> Unit, onSort: () -> Unit) {
    Row(Modifier.align(Alignment.TopEnd).padding(end = 14.dp, top = 12.dp).height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.parity("library.focus", if (focus == 0) Contract.label("library.focus") else Contract.label("library.focus", if (focus == 1) 1 else 2, focus.toString())).clip(RoundedCornerShape(8.dp)).clickable(onClick = onFocus).padding(horizontal = 2.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Focus", color = if (focus > 0) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, fontWeight = FontWeight.W600)
            if (focus > 0) Text("$focus", Modifier.defaultMinSize(minWidth = 18.dp).height(18.dp).clip(RoundedCornerShape(999.dp)).background(MaterialTheme.colorScheme.primary).padding(horizontal = 5.dp),
                color = MaterialTheme.colorScheme.onPrimary, fontSize = 11.sp, fontWeight = FontWeight.W700, lineHeight = 18.sp)
        }
        Row(Modifier.parity("library.sort", Contract.label("library.sort", 0, "")).clip(RoundedCornerShape(8.dp)).clickable(onClick = onSort).padding(horizontal = 2.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Sort", color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, fontWeight = FontWeight.W600)
            Text("⌄", color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp)
        }
    }
}
