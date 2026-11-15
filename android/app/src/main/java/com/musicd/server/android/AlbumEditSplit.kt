package com.musicd.server.android

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumSplitEdit
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Edit album's Folders and copies (bug list item 424), as the page's .ae-split (album-editor-split.js): under a rule,
 * its heading and what it is for; the folders its tracks are in where they are in more than one; Split by folder,
 * Split… (its ways, each a row of its parts with Split), Join back for a part of a split (or just after Split by folder,
 * the albums it made), Look at this album again; and what was done. The album's page is told once its tracks moved.
 */

/** What the section holds: the change under way, what was said, whether Split…'s ways are open, the albums Split by folder just made. */
internal class SplitEditor(private val ed: AlbumEditor) {
    var busy by mutableStateOf<String?>(null)
    var said by mutableStateOf<String?>(null)
    var waysOpen by mutableStateOf(false)
    var made by mutableStateOf<List<Long>>(emptyList())

    /** [action] "split" (by [by]), "join" or "look-again", then the editor's view read again; the sheet closes where the album kept is another. */
    fun act(action: String, by: String? = null) {
        val c = ed.client() ?: return
        if (busy != null) return
        busy = if (action == "split") "split:$by" else action
        said = null
        ed.scope.launch {
            val r = withContext(Dispatchers.IO) {
                runCatching { when (action) { "split" -> c.splitAlbum(ed.offset, by ?: "folder"); "join" -> c.joinAlbum(ed.offset, made); else -> c.lookAgain(ed.offset) } }
            }
            busy = null
            r.onSuccess { albums ->
                made = if (action == "split" && by == "folder") albums.drop(1) else emptyList()
                waysOpen = false
                said = AlbumSplitEdit.said(action, albums.size)
                Toast.makeText(ed.context, AlbumSplitEdit.toast(action), Toast.LENGTH_SHORT).show()
                ed.onChanged()
                if (albums.isNotEmpty() && albums[0] != ed.offset) ed.onClose()
                else withContext(Dispatchers.IO) { runCatching { c.albumEditState(ed.offset) }.getOrNull() }?.let { ed.state = it }
            }.onFailure { said = com.musicd.server.client.Failure.said(it, "Couldn't reach the server") }
        }
    }
}

/** The section: nothing until the server says what the album's folders and copies are (one before item 424 doesn't). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun EditSplit(ed: AlbumEditor) {
    val sp = ed.state?.split ?: return
    val s = ed.split
    val idle = s.busy == null
    HorizontalDivider(Modifier.padding(top = 18.dp), color = paletteColor(Palette.BORDER))
    Column(Modifier.fillMaxWidth().padding(top = 14.dp)) {
        Column(Modifier.parity("album-edit.split")) {
            Text(AlbumSplitEdit.HEADING, color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
            Text(AlbumSplitEdit.NOTE, Modifier.padding(top = 4.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.5.sp, lineHeight = 17.5.sp)
        }
        sp.foldersLine?.let { Text(it, Modifier.parity("album-edit.split-folders").padding(top = 6.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.2.sp) }
        FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (sp.byFolder) {
                val i = if (s.busy == "split:folder") 1 else 0
                AePill(Contract.label("album-edit.split-folder", i), Modifier.parity("album-edit.split-folder", Contract.label("album-edit.split-folder", i))
                    .clickable(enabled = idle) { s.act("split", "folder") }, enabled = idle)
            }
            if (sp.ways.isNotEmpty()) AePill(Contract.label("album-edit.split-open"), Modifier.parity("album-edit.split-open", Contract.label("album-edit.split-open"))
                .clickable { s.waysOpen = !s.waysOpen })
            if (sp.part || s.made.isNotEmpty()) {
                val i = if (s.busy == "join") 1 else 0
                AePill(Contract.label("album-edit.join", i), Modifier.parity("album-edit.join", Contract.label("album-edit.join", i)).clickable(enabled = idle) { s.act("join") }, enabled = idle)
            }
            val again = if (s.busy == "look-again") 1 else 0
            AePill(Contract.label("album-edit.look-again", again), Modifier.parity("album-edit.look-again", Contract.label("album-edit.look-again", again))
                .clickable(enabled = idle) { s.act("look-again") }, enabled = idle)
        }
        if (s.waysOpen) Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (w in sp.ways) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(w.line, Modifier.parity("album-edit.split-way").weight(1f), color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.2.sp)
                val i = if (s.busy == "split:" + w.by) 1 else 0
                AePill(Contract.label("album-edit.split-go", i), Modifier.parity("album-edit.split-go", Contract.label("album-edit.split-go", i))
                    .clickable(enabled = idle) { s.act("split", w.by) }, enabled = idle)
            }
        }
        s.said?.let { Text(it, Modifier.parity("album-edit.split-status").padding(top = 6.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.2.sp) }
    }
}
