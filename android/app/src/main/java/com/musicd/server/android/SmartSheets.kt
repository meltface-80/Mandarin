package com.musicd.server.android

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Facets
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.LibraryView
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShareCaveats
import com.musicd.server.client.ShareFile
import com.musicd.server.client.SmartEdit
import com.musicd.server.client.SmartPlaylist
import com.musicd.server.client.SmartTarget
import com.musicd.server.client.TrackShare
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * A Dynamic Playlist's sheets natively (bug list item 95; the page's createSmartPlaylist, openLibFocusSheet with a playlist
 * to save, saveSmartPlaylistPrompt and shareSmartTracks; docs/specs/screens.json smart-new, prompt, playlist-share), over the
 * native screen that asked: New asks what it is made of, then opens the Focus sheet led by its Order and Playlist size;
 * Edit opens that sheet over the playlist's own view; Save as… asks its name in the page's box, and saves it, on the
 * app's lane of changes to what Home shows (ServerWrites); Share reads its tracks album by album, has the server make the
 * file, and shows the page's sheet of it (PlaylistShareSheet.kt, the one a playlist's Share opens).
 */

/** What is open of a Dynamic Playlist's sheets, over the screen that holds this. */
internal class SmartSheetState {
    /** New's first question: what it is made of. */
    var choosing by mutableStateOf(false)
    /** The Focus sheet over a playlist being made or edited. */
    var editing by mutableStateOf<SmartTarget?>(null)
    /** The name box: for the playlist ([first]; none for Save as… from the Library), saving the view [second]. */
    var naming by mutableStateOf<Pair<SmartTarget?, LibraryView>?>(null)
    /** The share sheet: the playlist's name, the server's file, and what reading found. */
    var sharing by mutableStateOf<SharedFile?>(null)

    fun new() { choosing = true }
    fun edit(p: SmartPlaylist) { editing = SmartEdit.editTarget(p) }
    fun saveAs(view: LibraryView) { naming = null to view }
}

/** A playlist's file as the server made it ([file]), with what reading its tracks found ([caveats]). */
internal class SharedFile(val name: String, val file: ShareFile, val caveats: ShareCaveats)

@Composable
internal fun rememberSmartSheets() = remember { SmartSheetState() }

/**
 * The sheets [state] has open. Once a playlist is saved the screens that list it read it again ([NativeShell.sheetsClosed]),
 * and [onSaved] is told whether it was an edit; Show albums or Clear all from a playlist's Focus show the Library in that
 * view ([onShowAlbums]), as the page's do.
 */
@Composable
internal fun SmartSheets(state: SmartSheetState, client: () -> ServerClient?, onSaved: (Boolean) -> Unit = {}, onShowAlbums: (LibraryView) -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var facets by remember { mutableStateOf<Facets?>(null) }
    if (state.choosing) SmartNewSheet(onPick = { mode ->
        state.choosing = false
        state.editing = SmartEdit.newTarget(LibraryView.parse(NativeShell.libraryView), mode)
    }, onClose = { state.choosing = false })
    val t = state.editing
    LaunchedEffect(t != null) {
        if (t == null) return@LaunchedEffect
        val c = client() ?: return@LaunchedEffect
        facets = withContext(Dispatchers.IO) { runCatching { LibraryClient { c.getJson(it) }.facets() }.getOrNull() } ?: facets
    }
    if (t != null) FocusSheet(t.view, facets, onChange = { v -> state.editing = t.copy(view = v) },
        onSave = { state.editing = null; state.naming = t to t.view },
        onShow = { state.editing = null; onShowAlbums(t.view) }, onClose = { state.editing = null },
        playlist = t, onPlaylist = { state.editing = it }, onClear = { v -> state.editing = null; onShowAlbums(v) })
    state.naming?.let { (target, view) ->
        NamePrompt(SmartEdit.PROMPT, SmartEdit.suggested(target)) { name ->
            state.naming = null
            if (name != null) save(scope, context, client, target, name, view, onSaved)
        }
    }
    state.sharing?.let { s -> PlaylistShareSheet(s.name, s.file, s.caveats) { state.sharing = null } }
}

/** The playlist named [name] saved (POST /api/smart-playlists), on the lane; what came of it said, the lists read again. */
private fun save(scope: CoroutineScope, context: android.content.Context, client: () -> ServerClient?, target: SmartTarget?, name: String, view: LibraryView, onSaved: (Boolean) -> Unit) {
    SmartEdit.nameError(name)?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show(); return }
    val c = client() ?: return
    val made = ServerWrites.write { c.post("/api/smart-playlists", SmartEdit.body(target, name, view)) }
    scope.launch {
        ServerWrites.await(made).onSuccess { j ->
            Toast.makeText(context, SmartEdit.saved(name, j), Toast.LENGTH_LONG).show()
            NativeShell.sheetsClosed.value++
            onSaved(target?.id != null)
        }.onFailure { Toast.makeText(context, it.message?.takeIf { m -> !m.startsWith("HTTP") } ?: "Couldn't save that", Toast.LENGTH_SHORT).show() }
    }
}

/** Share: [p]'s tracks read album by album, the file made by the server, then its sheet ([state]); what went wrong said. */
internal fun shareSmart(scope: CoroutineScope, context: android.content.Context, client: () -> ServerClient?, p: SmartPlaylist, state: SmartSheetState) {
    val c = client() ?: return
    scope.launch {
        val read = withContext(Dispatchers.IO) {
            TrackShare.gather { offset -> runCatching { c.getJson("/api/smart-playlist?id=" + java.net.URLEncoder.encode(p.id, "UTF-8") + "&offset=$offset") }.getOrNull() }
        }
        if (read.entries.isEmpty()) { Toast.makeText(context, TrackShare.NOTHING, Toast.LENGTH_SHORT).show(); return@launch }
        val name = p.name.ifEmpty { "Dynamic Playlist" }
        withContext(Dispatchers.IO) { runCatching { c.post("/api/share/encode", TrackShare.body(name, read.entries)) } }
            .onSuccess { j -> state.sharing = SharedFile(name, ShareFile.parse(j), ShareCaveats(read.incomplete, read.albumsCapped)) }
            .onFailure { Toast.makeText(context, it.message?.takeIf { m -> !m.startsWith("HTTP") } ?: "Couldn't build the share file", Toast.LENGTH_SHORT).show() }
    }
}

/**
 * New Dynamic Playlist (the page's createSmartPlaylist; .lib-sort-row): the question, then Albums and Tracks, each a row
 * of 13 and 12 in with its name in 15 and what it means under it; the note below them.
 */
@Composable
private fun SmartNewSheet(onPick: (String) -> Unit, onClose: () -> Unit) {
    val faint = paletteColor(Palette.TEXT_FAINT)
    SheetPanel(onClose, head = {
        SheetTitle(SmartEdit.NEW_TITLE, Modifier.parity("smart-new.title"))
        SheetClose(Modifier.parity("smart-new.close", Contract.label("smart-new.close")).clip(CircleShape).clickable(onClick = onClose))
    }, foot = null) {
        Text(SmartEdit.NEW_INTRO, Modifier.parity("smart-new.intro").padding(top = 8.dp), color = faint, fontSize = 11.5.sp, lineHeight = 17.25.sp)
        for ((i, m) in SmartEdit.MODES.withIndex()) {
            Column(Modifier.parity("smart-new.mode", Contract.label("smart-new.mode", i)).fillMaxWidth().padding(top = 4.dp).clip(RoundedCornerShape(10.dp))
                .clickable { onPick(m.id) }.padding(horizontal = 13.dp, vertical = 14.dp)) {
                Text(m.label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 15.sp, lineHeight = 20.5.sp, fontWeight = FontWeight.W600)
                Text(m.note, Modifier.padding(top = 2.dp), color = faint, fontSize = 11.5.sp, lineHeight = 15.7.sp)
            }
        }
        Text(SmartEdit.NEW_NOTE, Modifier.parity("smart-new.note").padding(top = 16.dp), color = faint, fontSize = 11.5.sp, lineHeight = 17.25.sp)
    }
}
