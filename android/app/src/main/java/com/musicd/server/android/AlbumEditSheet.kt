package com.musicd.server.android

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.musicd.server.client.AlbumEdit
import com.musicd.server.client.ArtCandidate
import com.musicd.server.client.Contract
import com.musicd.server.client.CoverPick
import com.musicd.server.client.EditState
import com.musicd.server.client.MatchSearch
import com.musicd.server.client.Palette
import com.musicd.server.client.Said
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * An album's editor, natively (the group B of docs/specs/plan-android-native.md, B5; bug list item 74), as the page's
 * (docs/specs/screens.json, album-edit; album-editor.js, album-editor-match.js, style.css .album-edit-sheet): the sheet
 * from the foot over the album's page, its grip, Edit album and ✕ (a tap round it closes it too); the cover, the
 * names from MusicBrainz, the fields and Save (AlbumEditParts.kt); the note at its foot. [onChanged] once the album's
 * names or cover changed (a match applied, Save, Undo all edits), for its page to read it again.
 */
@Composable
internal fun AlbumEditSheet(offset: Long, title: String, artist: String, client: () -> ServerClient?, onClose: () -> Unit, onChanged: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ed = remember(offset) { AlbumEditor(offset, title, artist, client, scope, context, onChanged, onClose) }
    LaunchedEffect(offset) { ed.load() }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect { window?.setDimAmount(0.5f) }
        Box(Modifier.fillMaxSize().imePadding()) {
            Box(Modifier.parity("album-edit.close", Contract.label("album-edit.close")).fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose))
            // The page's .settings-sheet: the raised ground, 22 round at the top, 10 in at the top, 20 at the sides, 24 at the foot; 92% of the screen at most.
            val top = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.92f).dp).clip(top)
                .background(paletteColor(Palette.BG_ELEV)).border(1.dp, paletteColor(Palette.BORDER), top).verticalScroll(rememberScrollState())
                .navigationBarsPadding().padding(start = 20.dp, top = 10.dp, end = 20.dp, bottom = 24.dp)) {
                Box(Modifier.align(Alignment.CenterHorizontally).padding(top = 4.dp, bottom = 14.dp).size(40.dp, 4.dp).clip(CircleShape).background(paletteColor(Palette.BORDER)))
                Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(AlbumEdit.HEADING, Modifier.parity("album-edit.heading").weight(1f), color = paletteColor(Palette.TEXT), fontFamily = youngSerif, fontSize = 22.sp, lineHeight = 31.sp,
                        letterSpacing = 0.01.em)
                    Box(Modifier.parity("album-edit.close", Contract.label("album-edit.close")).size(40.dp).clip(CircleShape).background(paletteColor(Palette.BG_ELEV))
                        .border(1.dp, paletteColor(Palette.BORDER), CircleShape).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                        Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = paletteColor(Palette.TEXT_DIM), modifier = Modifier.size(20.dp))
                    }
                }
                EditCover(ed, client)
                EditMatch(ed)
                EditFields(ed)
                Text(AlbumEdit.NOTE, Modifier.parity("album-edit.note").padding(top = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.4.sp)
            }
        }
    }
}

/**
 * What the editor holds and does, as the page's aeState and its functions: the album's view, the fields, the cover
 * chosen; the covers searched for and found, an address pasted; the releases asked for and the one applied, a
 * barcode; Save and Undo all edits. Each request goes on [scope]; a cover search overtaken by another is dropped.
 */
internal class AlbumEditor(private val offset: Long, title: String, artist: String, private val client: () -> ServerClient?, private val scope: CoroutineScope,
                           private val context: Context, private val onChanged: () -> Unit, private val onClose: () -> Unit) {
    var state by mutableStateOf<EditState?>(null)
    var title by mutableStateOf(title)
    var artist by mutableStateOf(artist)
    var year by mutableStateOf("")
    var pick by mutableStateOf<CoverPick?>(null)
    var err by mutableStateOf<String?>(null)
    /** "save" or "reset", while it is on its way. */
    var saving by mutableStateOf<String?>(null)
    var searchSaid by mutableStateOf<Said?>(null)
    var searching by mutableStateOf(false)
    var found by mutableStateOf<List<ArtCandidate>>(emptyList())
    var sure by mutableStateOf<ArtCandidate?>(null)
    var url by mutableStateOf("")
    var urlErr by mutableStateOf<String?>(null)
    var matchSaid by mutableStateOf(Said("", AlbumEdit.MATCH_INTRO))
    var asked by mutableStateOf<Said?>(null)
    var finding by mutableStateOf(false)
    var releases by mutableStateOf<MatchSearch?>(null)
    var applied by mutableStateOf<String?>(null)
    var matching by mutableStateOf(false)
    var barcode by mutableStateOf("")
    var barcodeErr by mutableStateOf<String?>(null)
    private var searchSeq by mutableIntStateOf(0)

    private fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    private fun take(d: EditState) { state = d; title = d.title; artist = d.artist; year = d.year }

    /** The album's view; an album with no cover of its own is searched for at once. */
    suspend fun load() {
        val c = client() ?: return
        withContext(Dispatchers.IO) { runCatching { c.albumEditState(offset) } }
            .onSuccess { take(it); if (!it.artOwn) search() }
            .onFailure { err = it.message ?: "Couldn't reach the server" }
    }

    /** Covers found on the web; a sure one is chosen at once. */
    fun search() {
        val c = client() ?: return
        val seq = ++searchSeq
        searching = true; found = emptyList(); sure = null; searchSaid = Said("", AlbumEdit.SEARCHING)
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.albumArtSearch(offset) } }
            if (seq != searchSeq) return@launch
            searching = false
            r.onSuccess { s ->
                searchSaid = s.status; found = s.candidates; sure = s.sure
                s.sure?.let { pick = CoverPick(it.url, it.thumb, it.source) }
            }.onFailure { searchSaid = Said("", AlbumEdit.searchFailed(it.message ?: "no answer")) }
        }
    }

    fun choose(c: ArtCandidate) { pick = CoverPick(c.url, c.thumb, c.source) }
    fun close() = onClose()

    /** The address pasted: shown here first, as the page previews it (the server downloads and checks it on Save). */
    fun useUrl() {
        val u = url.trim()
        urlErr = AlbumEdit.urlError(u)
        if (urlErr != null) return
        scope.launch {
            if (withContext(Dispatchers.IO) { fetchWebImage(u) } == null) urlErr = AlbumEdit.NO_PICTURE
            else pick = CoverPick(u, u, CoverPick.PASTED)
        }
    }

    /** The releases MusicBrainz (and iTunes) has that the album could be. */
    fun findMatch() {
        val c = client() ?: return
        finding = true; releases = null; barcodeErr = null; asked = Said("", AlbumEdit.ASKING)
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.releaseCandidates(offset) } }
            finding = false
            r.onSuccess { releases = it; asked = it.status }.onFailure { asked = Said("", AlbumEdit.matchFailed(it.message ?: "no answer")) }
        }
    }

    /** A barcode, or a release's link. */
    fun useBarcode() { if (barcode.isBlank()) barcodeErr = AlbumEdit.NO_BARCODE else match(barcode.trim(), "barcode") }

    /** A release applied at once ([how] "pick": one offered, by its id): its names in the fields, the album's page told. */
    fun match(query: String, how: String) {
        val c = client() ?: return
        if (matching) return
        matching = true; barcodeErr = null; err = null
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.matchRelease(offset, query, how) } }
            if (r.isSuccess) withContext(Dispatchers.IO) { runCatching { c.albumEditState(offset) }.getOrNull() }?.let { take(it) }
            matching = false
            r.onSuccess {
                matchSaid = AlbumEdit.matched(it, offset)
                if (how == "pick") applied = query
                toast("Matched — names applied")
                onChanged()
            }.onFailure { if (how == "pick") err = it.message else barcodeErr = it.message }
        }
    }

    /** Save ([which] "save": the fields and the cover chosen) or Undo all edits ("reset"); the sheet closes once it is kept. */
    fun send(which: String) {
        val c = client() ?: return
        val d = state ?: return
        if (saving != null) return
        if (which == "save") AlbumEdit.yearError(year)?.let { err = it; return }
        err = null; saving = which
        scope.launch {
            val r = withContext(Dispatchers.IO) {
                runCatching { if (which == "save") c.saveAlbumEdit(AlbumEdit.saveBody(d.offset, title, artist, year, pick)) else c.resetAlbumEdit(d.offset) }
            }
            saving = null
            r.onSuccess { onChanged(); toast("Album saved"); onClose() }.onFailure { err = it.message ?: "Couldn't save" }
        }
    }
}
