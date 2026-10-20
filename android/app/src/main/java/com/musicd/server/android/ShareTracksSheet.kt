package com.musicd.server.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.TrackShare
import java.io.File

/*
 * A playlist shared (bug list item 95; the page's openShareSheet in playlist-share.js; docs/specs/screens.json
 * share-tracks): the page's sheet up from the foot, "Share" and the playlist's name with the ✕; how many tracks went in,
 * each reason the file is less than the whole playlist in red, what the file is, the file's text in a box of four lines
 * (chosen and copied by hand too); Copy (to the phone's clipboard), Download (to Downloads/Mandarin) and Done.
 */

@Composable
internal fun ShareTracksSheet(s: SharedFile, onClose: () -> Unit) {
    val context = LocalContext.current
    val account = TrackShare.account(s.file, s.incomplete, s.albumsCapped)
    val blob = s.file.optString("blob")
    SheetPanel(onClose, head = {
        SheetTitle("Share " + s.name, Modifier.parity("share-tracks.title"))
        SheetClose(Modifier.parity("share-tracks.close", Contract.label("share-tracks.close")).clip(CircleShape).clickable(onClick = onClose))
    }, foot = {
        val edge = Modifier.border(1.dp, MaterialTheme.colorScheme.outline, ButtonDefaults.shape)
        val pad = PaddingValues(horizontal = 8.dp)
        Button(onClick = { copy(context, blob) }, colors = footColors(true), contentPadding = pad,
            modifier = Modifier.parity("share-tracks.copy", Contract.label("share-tracks.copy")).weight(1f).defaultMinSize(minHeight = 40.dp)) {
            Text(Contract.label("share-tracks.copy"), fontSize = 13.sp, fontWeight = FontWeight.W500, maxLines = 1)
        }
        Button(onClick = { download(context, TrackShare.fileName(s.name), blob) }, colors = footColors(false), contentPadding = pad,
            modifier = Modifier.parity("share-tracks.download", Contract.label("share-tracks.download")).weight(1f).defaultMinSize(minHeight = 40.dp).then(edge)) {
            Text(Contract.label("share-tracks.download"), fontSize = 13.sp, fontWeight = FontWeight.W500, maxLines = 1)
        }
        Button(onClick = onClose, colors = footColors(false), contentPadding = pad,
            modifier = Modifier.parity("share-tracks.done", Contract.label("share-tracks.done")).weight(1f).defaultMinSize(minHeight = 40.dp).then(edge)) {
            Text(Contract.label("share-tracks.done"), fontSize = 13.sp, fontWeight = FontWeight.W500, maxLines = 1)
        }
    }) {
        Text(account.sum, Modifier.parity("share-tracks.sum").padding(top = 4.dp, bottom = 6.dp), color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.W600)
        for (w in account.warnings) Text(w, Modifier.parity("share-tracks.warn").padding(bottom = 6.dp), color = paletteColor(Palette.DANGER), fontSize = 13.76.sp, lineHeight = 19.26.sp)
        // 10 over it, the 6 under the line above folded into it, as the page's margins fold.
        Text(TrackShare.NOTE, Modifier.parity("share-tracks.note").padding(top = 4.dp, bottom = 10.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.76.sp, lineHeight = 19.sp)
        // The file's text (.share-blob): monospace in 12.5, four lines high, scrolled within; read-only, still chosen and copied by hand.
        val corner = RoundedCornerShape(8.dp)
        BasicTextField(blob, {}, Modifier.parity("share-tracks.blob", Contract.label("share-tracks.blob")).fillMaxWidth().height(85.3.dp).clip(corner)
            .background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outline, corner).padding(8.dp), readOnly = true,
            textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontFamily = FontFamily.Monospace, fontSize = 12.48.sp, lineHeight = 16.85.sp))
    }
}

/** The file's text onto the phone's clipboard, as the page's Copy says it. */
private fun copy(context: Context, text: String) {
    val ok = runCatching { (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Mandarin", text)) }.isSuccess
    Toast.makeText(context, if (ok) TrackShare.COPIED else "Couldn't copy automatically — the text is selected, copy it by hand", Toast.LENGTH_SHORT).show()
}

/** The file saved to the phone's Downloads/Mandarin as [name] (what a browser's Download does with the page's). */
private fun download(context: Context, name: String, text: String) {
    val ok = runCatching {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, "text/plain")
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Mandarin")
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("no file")
            context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } ?: error("no stream")
        } else {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Mandarin").apply { mkdirs() }
            File(dir, name).writeText(text)
        }
    }.isSuccess
    Toast.makeText(context, if (ok) "Saved to Downloads/Mandarin as $name" else "Couldn't save the file", Toast.LENGTH_SHORT).show()
}
