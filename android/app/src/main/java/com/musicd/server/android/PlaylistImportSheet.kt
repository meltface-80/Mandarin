package com.musicd.server.android

import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.ImportReport
import com.musicd.server.client.Palette
import com.musicd.server.client.PlaylistShare
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ServerClient.ServerException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * A shared playlist imported, natively (docs/specs/screens.json, playlist-import; bug list item 94), as the page's
 * openImportSheet and renderImportResult draw it (playlist-import.js; style.css .share-note, .share-blob, .import-file,
 * .import-result, .import-missing): the page's sheet up from the foot, what to paste and why, the box to paste into (no
 * corrections: the text is case-sensitive), Choose a file… (the phone's own file picker, for a .musicd file a share's
 * Download wrote), and what came of Import: how many of its tracks the library has, those it couldn't match and those found
 * on another album, each listed (25 at most), then Save as a playlist, which asks its name (PromptDialog) and makes it; the
 * library's albums searched for the rest first where the server can. Import and Close along the foot. The playlist made
 * goes on the app's lane of changes (ServerWrites), and [onSaved] has the Playlists screen read its list again.
 */

/** Import a playlist ([client]: the server's; [onSaved]: a playlist was made; [onClose]: the sheet closed). */
@Composable
internal fun PlaylistImportSheet(client: () -> ServerClient?, onSaved: () -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_LONG).show()
    var blob by remember { mutableStateOf("") }
    var said by remember { mutableStateOf("") }
    var report by remember { mutableStateOf<ImportReport?>(null) }
    var busy by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    var deepFailed by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf(false) }
    // The phone's file picker: any file (a .musicd has no type the phone knows), read as text into the box.
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val text = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrNull()
        if (text == null) { said = "Couldn't read that file."; return@rememberLauncherForActivityResult }
        val fileName = runCatching { context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } }.getOrNull()
        blob = text; report = null; said = "Loaded ${fileName ?: "the file"} — press Import."
    }
    // What the server made of the playlist ([deep]: the library's albums searched too): the answer, or what it said went wrong.
    suspend fun ask(c: ServerClient, deep: Boolean): JSONObject = withContext(Dispatchers.IO) {
        try { c.post("/api/share/import", JSONObject().put("blob", blob.trim()).put("deep", deep), 120_000).put("ok", true) }
        catch (e: ServerException) { JSONObject().put("ok", false).put("error", e.message ?: "") }
    }
    fun import() {
        val c = client() ?: return
        if (blob.isBlank()) { toast("Paste the playlist first"); return }
        busy = true; report = null; saved = false; deepFailed = false; said = "Matching against your library…"
        scope.launch {
            try {
                val j = ask(c, false)
                if (!j.optBoolean("ok")) { said = j.optString("error").ifEmpty { "Couldn't read that playlist" }; return@launch }
                val first = ImportReport.parse(j)
                report = first; said = ""
                // What names alone couldn't place, looked for on the library's albums: second, so the fast answer shows first.
                if (first.deepAvailable) {
                    searching = true
                    val deep = ask(c, true)
                    searching = false
                    if (deep.optBoolean("ok")) report = ImportReport.parse(deep) else deepFailed = true
                }
            } catch (e: Exception) {
                said = "Couldn't reach the extension"
            } finally { busy = false; searching = false }
        }
    }
    SheetPanel(onClose, head = {
        SheetTitle("Import a playlist", Modifier.parity("playlist-import.title"))
        SheetClose(Modifier.parity("playlist-import.close", Contract.label("playlist-import.close")).clip(CircleShape).clickable(onClick = onClose))
    }, foot = {
        Pill("Import", true, Modifier.parity("playlist-import.import", Contract.label("playlist-import.import")).weight(1f).clip(CircleShape).clickable(enabled = !busy) { import() }, enabled = !busy)
        Pill("Close", false, Modifier.parity("playlist-import.done", Contract.label("playlist-import.done")).weight(1f).clip(CircleShape).clickable(onClick = onClose))
    }) {
        ShareNote(PlaylistShare.IMPORT_NOTE, Modifier.parity("playlist-import.note"))
        BasicTextField(blob, { blob = it; report = null }, Modifier.parity("playlist-import.blob", Contract.label("playlist-import.blob")).fillMaxWidth(),
            textStyle = BLOB_STYLE.copy(color = paletteColor(Palette.TEXT)), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
            decorationBox = { inner -> BlobBox { if (blob.isEmpty()) Text("MDRP1:…", color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.48.sp, lineHeight = 16.848.sp); inner() } })
        Pill("Choose a file…", false, Modifier.parity("playlist-import.file", Contract.label("playlist-import.file")).padding(top = 15.dp).fillMaxWidth().clip(CircleShape)
            .clickable { pick.launch(arrayOf("*/*")) })
        // What came of it (.import-result), 12 under the button: the count's own 4 over it falls within those 12, as the page's margins do.
        val r0 = report
        Column(Modifier.parity("playlist-import.result").padding(top = if (r0 != null) 8.dp else 12.dp).fillMaxWidth()) {
            if (said.isNotEmpty()) Text(said, color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)
            val r = r0 ?: return@Column
            SheetSum(r.sum, Modifier.parity("playlist-import.sum"))
            if (r.truncated) SheetWarn(ImportReport.TRUNCATED, Modifier.parity("playlist-import.warn"))
            r.missingWarn?.let { SheetWarn(it, Modifier.parity("playlist-import.warn")) }
            // The list's 12 under it, of which the next count's own 4 is a part.
            if (r.missingShown.isNotEmpty()) Column(Modifier.padding(bottom = if (r.subNote != null) 8.dp else 12.dp)) {
                for (m in r.missingShown) Bullet(m, Modifier.parity("playlist-import.missing"), faint = false)
            }
            r.subNote?.let { SheetSum(it, Modifier.parity("playlist-import.sub-note"), dim = true) }
            if (r.substitutedShown.isNotEmpty()) Column(Modifier.padding(bottom = 12.dp)) {
                for (m in r.substitutedShown) Bullet(m, Modifier.parity("playlist-import.substituted"), faint = true)
            }
            if (r.found == 0) { SheetWarn(ImportReport.NOTHING, Modifier.parity("playlist-import.warn")); return@Column }
            val label = if (saved) "Saved" else if (searching) "Searching your library…" else r.saveLabel
            Pill(label, true, Modifier.parity("playlist-import.save", Contract.label("playlist-import.save", if (saved) 2 else if (searching) 1 else 0, r.saveLabel.removePrefix("Save ").removeSuffix(" as a playlist")))
                .padding(top = 8.dp).fillMaxWidth().clip(CircleShape).clickable(enabled = !saved && !searching) { naming = true }, enabled = !saved && !searching)
            // The deeper search's line, after the button, as the page adds it.
            if (searching) SheetSum(r.searching, Modifier.parity("playlist-import.searching"), dim = true)
            if (deepFailed) SheetSum("Couldn't finish the deeper search — the matches above still stand.", Modifier.parity("playlist-import.searching"), dim = true)
        }
    }
    val r = report
    if (naming && r != null) NamePrompt("Name this playlist", r.name) { name ->
        naming = false
        val trimmed = name?.trim() ?: return@NamePrompt
        if (trimmed.isEmpty()) { toast("Give it a name"); return@NamePrompt }
        val c = client() ?: return@NamePrompt
        // On the app's lane of changes (item 85): Home's Playlists row reads it after it is made.
        val made = ServerWrites.write { c.post("/api/user-playlists/add", JSONObject().put("name", trimmed).put("tracks", r.resolved)) }
        scope.launch {
            ServerWrites.await(made).onSuccess { j -> saved = true; toast(PlaylistShare.added(j)); onSaved() }
                .onFailure { toast(it.message ?: "Couldn't save that") }
        }
    }
}

/** A line of a list (.import-missing li): 13.76 in 20.64, 18 in after its dot; dim, or faint for a track found elsewhere. */
@Composable
private fun Bullet(text: String, modifier: Modifier, faint: Boolean) {
    val colour = paletteColor(if (faint) Palette.TEXT_FAINT else Palette.TEXT_DIM)
    Row(modifier.fillMaxWidth()) {
        Text("•", Modifier.width(18.dp), color = colour, fontSize = 13.76.sp, lineHeight = 20.64.sp)
        Text(text, Modifier.weight(1f), color = colour, fontSize = 13.76.sp, lineHeight = 20.64.sp)
    }
}
