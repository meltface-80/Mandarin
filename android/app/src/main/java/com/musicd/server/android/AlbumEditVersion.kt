package com.musicd.server.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumVersionEdit
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette

/*
 * Edit album's Version (bug list item 420), as the page's .ae-version (album-editor-version.js): under a rule, Version
 * and what it is; the version name across, the label, catalogue number, barcode, country, this pressing's year and
 * format two a row; each field with what the match or the files say under it once its words differ, and Put back.
 */

/** The copy's version: nothing until the server says it (one from before item 420 doesn't). */
@Composable
internal fun EditVersion(ed: AlbumEditor) {
    val d = ed.state ?: return
    if (d.version.isEmpty()) return
    HorizontalDivider(Modifier.padding(top = 18.dp), color = paletteColor(Palette.BORDER))
    Column(Modifier.fillMaxWidth().padding(top = 14.dp)) {
        Column(Modifier.parity("album-edit.version")) {
            Text(AlbumVersionEdit.HEADING, color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
            Text(AlbumVersionEdit.NOTE, Modifier.padding(top = 4.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.5.sp, lineHeight = 17.5.sp)
        }
        VersionField(ed, "name", Modifier.fillMaxWidth())
        AlbumVersionEdit.FIELDS.drop(1).chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { VersionField(ed, it, Modifier.weight(1f)) }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** One of the version's fields: its name over it, its box, and what the match or the files say under it once they differ. */
@Composable
private fun VersionField(ed: AlbumEditor, f: String, modifier: Modifier) {
    val d = ed.state ?: return
    val words = ed.version[f].orEmpty()
    val focus = remember(f) { MutableInteractionSource() }
    Column(modifier) {
        // Each field's key written out, as the gate reads them: its name over it, then its box.
        AeLabel(Contract.label("album-edit.version-$f"), when (f) {
            "name" -> Modifier.parity("album-edit.version-name"); "label" -> Modifier.parity("album-edit.version-label")
            "catno" -> Modifier.parity("album-edit.version-catno"); "barcode" -> Modifier.parity("album-edit.version-barcode")
            "country" -> Modifier.parity("album-edit.version-country"); "year" -> Modifier.parity("album-edit.version-year")
            else -> Modifier.parity("album-edit.version-format")
        })
        BasicTextField(words, { ed.setVersion(f, if (f == "year") it.filter(Char::isDigit).take(4) else it) }, when (f) {
            "name" -> Modifier.parity("album-edit.version-name", Contract.label("album-edit.version-name"))
            "label" -> Modifier.parity("album-edit.version-label", Contract.label("album-edit.version-label"))
            "catno" -> Modifier.parity("album-edit.version-catno", Contract.label("album-edit.version-catno"))
            "barcode" -> Modifier.parity("album-edit.version-barcode", Contract.label("album-edit.version-barcode"))
            "country" -> Modifier.parity("album-edit.version-country", Contract.label("album-edit.version-country"))
            "year" -> Modifier.parity("album-edit.version-year", Contract.label("album-edit.version-year"))
            else -> Modifier.parity("album-edit.version-format", Contract.label("album-edit.version-format"))
        }.fillMaxWidth(),
            singleLine = true, textStyle = aeText(), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), interactionSource = focus,
            keyboardOptions = KeyboardOptions(keyboardType = if (f == "year" || f == "barcode") KeyboardType.Number else KeyboardType.Text),
            decorationBox = { AeBox(words, AlbumVersionEdit.PLACEHOLDER[f].orEmpty(), focus, it) })
        val field = d.version[f]
        AlbumVersionEdit.was(field, words, d.match != null)?.let {
            AeWas(it, Modifier.parity("album-edit.was")) {
                AePutBack(Modifier.parity("album-edit.put-back", Contract.label("album-edit.put-back")).clickable { ed.setVersion(f, field?.was.orEmpty(), typed = false) })
            }
        }
    }
}
