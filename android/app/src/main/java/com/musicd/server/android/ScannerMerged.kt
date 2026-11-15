package com.musicd.server.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSplitEdit
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShellRoute
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Library clean-up's albums that look like two copies merged (bug list item 424), as the page's settings-scanner-merged.js:
 * a line saying how many with Show, under the clean-up's kinds; shown, Back, its title and note, and each album with why
 * (two folders, a track number twice on a disc) and Split…, which opens its Edit album at Folders and copies, Split…'s
 * ways open. The list is asked for as the page opens, and again with the clean-up's counts; once an editor closes, too.
 */

/** The list asked for: kept in [k] as it comes. */
internal fun loadMerged(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope) {
    val c = client() ?: return
    scope.launch { withContext(Dispatchers.IO) { runCatching { c.mergedAlbums() } }.onSuccess { k.merged = it } }
}

/** The clean-up's line for them, with Show; nothing where there are none. */
@Composable
internal fun MergedLine(k: ScanKept) {
    val words = AlbumSplitEdit.mergedLine(k.merged?.count ?: 0) ?: return
    Row(Modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(words, Modifier.parity("settings-scanner.note").weight(1f), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
        IdButton(Contract.label("settings-scanner.merged"), false, !k.busy, Modifier.parity("settings-scanner.merged", Contract.label("settings-scanner.merged"))
            .clickable(enabled = !k.busy) { k.folder = "merged"; k.splitting = null })
    }
}

/** The list open: Back, its title and note, each album with why and Split…; an album's Edit album over it while Split… is open. */
@Composable
internal fun MergedView(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope) {
    val m = k.merged
    Column(Modifier.fillMaxWidth()) {
        Text("‹ Library Scanner", Modifier.parity("settings-scanner.merged-close", Contract.label("settings-scanner.merged-close")).clickable { closeFolder(k) }
            .padding(top = 2.dp, bottom = 12.dp), color = paletteColor(Palette.ACCENT_TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600)
        ScanTitle(AlbumSplitEdit.mergedTitle(m?.count ?: 0))
        ScanNote(AlbumSplitEdit.MERGED_NOTE, top = 0)
        if (m == null) { ScanWait(); return@Column }
        val shape = RoundedCornerShape(12.dp)
        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (a in m.albums) Row(Modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape)
                .padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.parity("settings-scanner.album", Contract.label("settings-scanner.album", 0, a.name)).weight(1f)
                    .clickable { NativeShell.open(ShellRoute.album(a.offset, NativeShell.zone)) }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(a.name, color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(a.why, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.2.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                IdButton(Contract.label("settings-scanner.split"), false, !k.busy, Modifier.parity("settings-scanner.split", Contract.label("settings-scanner.split"))
                    .clickable(enabled = !k.busy) { k.splitting = a })
            }
        }
        k.splitting?.let { a ->
            AlbumEditSheet(a.offset, a.title, a.artist, client, split = true,
                onClose = { k.splitting = null; loadMerged(k, client, scope) }, onChanged = {})
        }
    }
}
