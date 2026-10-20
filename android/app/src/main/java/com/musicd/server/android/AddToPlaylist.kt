package com.musicd.server.android

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AddToPlaylist
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.PlaylistAdd
import com.musicd.server.client.PlaylistChoice
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Add to playlist natively (docs/specs/screens.json, add-to-playlist and prompt; the page's openAddToPlaylistSheet and
 * addToUserPlaylist; bug list item 93): an album's ⋯ → Add to playlist, tracks picked on its page, albums picked on a wall
 * or an artist's page. The page's sheet up from the foot: how many are being added and ✕, then ＋ New playlist… (a name
 * asked, My playlist suggested) and each of your playlists with how many tracks it holds, as pills. A row tapped closes the
 * sheet and adds them there; what came of it is said as the page says it. Made on the app's lane of changes to what Home
 * shows (ServerWrites), so Home's Playlists row has it when Home is back. Asked for by any screen ([PlaylistAddAsk]); drawn
 * by the shell over every screen ([PlaylistAddOver]).
 */

/** The Add to playlist asked for, over whichever screen asked; none while none is. */
internal object PlaylistAddAsk {
    val asked = mutableStateOf<PlaylistAdd?>(null)
    fun ask(add: PlaylistAdd) { if (add.count > 0) asked.value = add }
}

/** The sheet and the name it asks for, drawn by the shell over every screen. */
@Composable
internal fun PlaylistAddOver(client: () -> ServerClient?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var add by PlaylistAddAsk.asked
    var naming by remember { mutableStateOf<PlaylistAdd?>(null) }
    add?.let { a ->
        AddToPlaylistSheet(a, client, onClose = { add = null }, onNew = { add = null; naming = a }) { p -> add = null; addTo(context, scope, client, a, p.id, null) }
    }
    naming?.let { n ->
        NamePrompt(AddToPlaylist.ASK, AddToPlaylist.SUGGESTED) { name ->
            naming = null
            val trimmed = name?.trim() ?: return@NamePrompt
            if (trimmed.isEmpty()) toast(context, AddToPlaylist.NO_NAME) else addTo(context, scope, client, n, null, trimmed)
        }
    }
}

/** The sheet: your playlists read first (the page opens it once it has them); ✕ or a tap outside closes it. */
@Composable
private fun AddToPlaylistSheet(add: PlaylistAdd, client: () -> ServerClient?, onClose: () -> Unit, onNew: () -> Unit, onPick: (PlaylistChoice) -> Unit) {
    val context = LocalContext.current
    var list by remember(add) { mutableStateOf<List<PlaylistChoice>?>(null) }
    LaunchedEffect(add) {
        val c = client() ?: return@LaunchedEffect onClose()
        val got = withContext(Dispatchers.IO) { runCatching { AddToPlaylist.choices(c.getJson("/api/user-playlists")) } }
        got.onSuccess { list = it }.onFailure { toast(context, "Couldn't read your playlists"); onClose() }
    }
    val shown = list ?: return
    SheetPanel(onClose, head = {
        SheetTitle(add.title, Modifier.parity("add-to-playlist.title"))
        SheetClose(Modifier.parity("add-to-playlist.close", Contract.label("add-to-playlist.close")).clip(CircleShape).clickable(onClick = onClose))
    }, foot = null) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SheetRow(AddToPlaylist.NEW, Modifier.parity("add-to-playlist.new", Contract.label("add-to-playlist.new")).clip(PILL).clickable(onClick = onNew))
            for (p in shown) SheetRow(p.label, Modifier.parity("add-to-playlist.playlist", Contract.label("add-to-playlist.playlist", 0, p.name, p.label.substringAfter(" · "))).clip(PILL).clickable { onPick(p) })
        }
    }
}

private val PILL = RoundedCornerShape(999.dp)

/** A row of the sheet (.action-btn.sheet-row): a pill 40 tall the sheet's width on the raised ground with its edge, its words 13 in 500 from the left. */
@Composable
private fun SheetRow(words: String, modifier: Modifier) {
    Box(modifier.fillMaxWidth().heightIn(min = 40.dp).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, MaterialTheme.colorScheme.outline, PILL).padding(horizontal = 9.dp),
        contentAlignment = Alignment.CenterStart) {
        Text(words, color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** [add] put in the playlist [id], or a new one called [name], on the app's lane; what came of it said, an album not read as an error, longer. */
private fun addTo(context: Context, scope: CoroutineScope, client: () -> ServerClient?, add: PlaylistAdd, id: String?, name: String?) {
    val c = client() ?: return
    add.reading?.let { toast(context, it) }
    val made = ServerWrites.write { c.post(add.path, add.body(id, name), 180_000) }
    scope.launch {
        ServerWrites.await(made).onSuccess { j -> toast(context, AddToPlaylist.said(j).first, long = true) }
            .onFailure { toast(context, it.message ?: "Couldn't save that") }
    }
}

private fun toast(context: Context, text: String, long: Boolean = false) = Toast.makeText(context, text, if (long) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()
