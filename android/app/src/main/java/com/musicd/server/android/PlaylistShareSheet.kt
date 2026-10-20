package com.musicd.server.android

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.PlaylistShare
import com.musicd.server.client.PlaylistTrack
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShareCaveats
import com.musicd.server.client.ShareFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * A playlist shared, natively (docs/specs/screens.json, playlist-share; bug list item 94), as the page's openShareSheet
 * draws it (playlist-share.js; style.css .share-sum, .share-warn, .share-note, .share-blob, .lib-sheet-foot): the page's
 * sheet up from the foot, how many tracks, each reason the file is less than the whole playlist on its own line in red,
 * what sharing means, and the playlist as text to copy, in a box four lines tall; Copy (in brass), Download (the .musicd
 * file to the phone's Download/Mandarin, where Import's Choose a file… finds it) and Done.
 */

/** [name] made into text to share by the server ([tracks], field by field): the file, or what went wrong. */
internal suspend fun encodeShare(c: ServerClient, name: String, tracks: List<PlaylistTrack>): Result<ShareFile> = withContext(Dispatchers.IO) {
    runCatching { ShareFile.parse(c.post("/api/share/encode", PlaylistShare.body(name, tracks))) }
}

/** The sheet for [file], made of the playlist called [name]; [caveats]: what only the one asking knows was left out. */
@Composable
internal fun PlaylistShareSheet(name: String, file: ShareFile, caveats: ShareCaveats = ShareCaveats(), onClose: () -> Unit) {
    val context = LocalContext.current
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_LONG).show()
    SheetPanel(onClose, head = {
        SheetTitle("Share $name", Modifier.parity("playlist-share.title"))
        SheetClose(Modifier.parity("playlist-share.close", Contract.label("playlist-share.close")).clip(CircleShape).clickable(onClick = onClose))
    }, foot = {
        Pill("Copy", true, Modifier.parity("playlist-share.copy", Contract.label("playlist-share.copy")).weight(1f).clip(CircleShape).clickable {
            val ok = context.activity()?.let { ShareBridge(it).copyText(file.blob) } ?: false
            toast(if (ok) PlaylistShare.COPIED else "Couldn't copy automatically — hold the text to copy it by hand")
        })
        Pill("Download", false, Modifier.parity("playlist-share.download", Contract.label("playlist-share.download")).weight(1f).clip(CircleShape).clickable {
            val fileName = PlaylistShare.fileName(name)
            val ok = context.activity()?.let { ShareBridge(it).saveDownload(file.blob.toByteArray(Charsets.UTF_8), fileName, "text/plain") } ?: false
            toast(if (ok) "Saved to Download/Mandarin as $fileName" else "Couldn't save the file")
        })
        Pill("Done", false, Modifier.parity("playlist-share.done", Contract.label("playlist-share.done")).weight(1f).clip(CircleShape).clickable(onClick = onClose))
    }) {
        SheetSum(file.sum, Modifier.parity("playlist-share.sum"))
        for (w in file.warnings(caveats)) SheetWarn(w, Modifier.parity("playlist-share.warn"))
        ShareNote(PlaylistShare.SHARE_NOTE, Modifier.parity("playlist-share.note"))
        // readOnly, not disabled: the text stays selectable, so a long-press copy works where Copy can't (the page's).
        BasicTextField(file.blob, {}, Modifier.parity("playlist-share.blob", Contract.label("playlist-share.blob")).fillMaxWidth(), readOnly = true,
            textStyle = BLOB_STYLE.copy(color = paletteColor(Palette.TEXT)), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
            decorationBox = { inner -> BlobBox(inner) })
    }
}

/** The text of a playlist shared or to import (.share-blob): monospaced 12.48 in 16.85. */
internal val BLOB_STYLE = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.48.sp, lineHeight = 16.848.sp)

/** The box round it (.share-blob): 8 in, 8 round on the ground below with its edge, four lines tall, its text scrolling inside. */
@Composable
internal fun BlobBox(inner: @Composable () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.fillMaxWidth().height(85.dp).clip(shape).background(paletteColor(Palette.BG_ELEV)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(8.dp)) { inner() }
}

/** The line that counts (.share-sum): 16 in 600, 4 over and 6 under it; [dim] for the import's note of tracks found elsewhere (.share-sub-note). */
@Composable
internal fun SheetSum(text: String, modifier: Modifier, dim: Boolean = false) {
    Text(text, modifier.padding(top = 4.dp, bottom = 6.dp), color = paletteColor(if (dim) Palette.TEXT_DIM else Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
}

/** A reason in red (.share-warn): 13.76 in 19.26, 6 under it. */
@Composable
internal fun SheetWarn(text: String, modifier: Modifier) {
    Text(text, modifier.padding(bottom = 6.dp), color = paletteColor(Palette.DANGER), fontSize = 13.76.sp, lineHeight = 19.26.sp)
}

/** What the sheet means (.share-note): 13.76 dim, 10 over and under it. */
@Composable
internal fun ShareNote(text: String, modifier: Modifier) {
    Text(text, modifier.padding(vertical = 10.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.76.sp, lineHeight = 19.sp)
}

/**
 * A sheet's pill (.action-btn): 40 tall, round, its words in 13 and 500, 8 in at the sides; [primary] in brass, else on the
 * raised ground with its edge; dimmed while it can't be pressed ([enabled]). [modifier] carries its key, its place and its tap.
 */
@Composable
internal fun Pill(words: String, primary: Boolean, modifier: Modifier, enabled: Boolean = true) {
    val shape = CircleShape
    Box(modifier.heightIn(min = 40.dp).alpha(if (enabled) 1f else 0.5f).background(if (primary) MaterialTheme.colorScheme.primary else paletteColor(Palette.BG_ELEV_2), shape)
        .border(1.dp, if (primary) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, shape).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text(words, color = if (primary) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface, fontSize = 13.sp, lineHeight = 18.sp,
            fontWeight = FontWeight.W500, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The activity under a sheet's context (a sheet's own window wraps it). */
internal fun Context.activity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) { if (c is Activity) return c; c = c.baseContext }
    return null
}
