package com.musicd.server.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.AlbumEdit
import com.musicd.server.client.ArtCandidate
import com.musicd.server.client.Contract
import com.musicd.server.client.CoverPick
import com.musicd.server.client.Palette
import com.musicd.server.client.ReleaseCandidate
import com.musicd.server.client.Said
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * The album editor's sections (bug list item 74), each as the page's style.css draws it (.ae-*): the cover and the
 * covers found, the names from MusicBrainz and the releases offered, the fields with Save; and the pieces they are
 * made of (a line with its first words in bold, a field's name over it, a pill, a link, a field, what went wrong).
 */

/** The page's red for what went wrong (.ae-err). */
private val ERR = Color(0xFFE06C6C)

/** The cover row (.ae-cover-row): the 112 cover, what is said of it, Find cover, Remove found cover or Keep current cover; under it, once searched, the covers found and an address to paste. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun EditCover(ed: AlbumEditor, client: () -> ServerClient?) {
    val d = ed.state
    val p = ed.pick
    Row(Modifier.fillMaxWidth().padding(bottom = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        val picture = if (p != null && !p.remove) rememberWebImage(p.thumb ?: p.url) else rememberCover(d?.imageKey, 300, client)
        Box(Modifier.parity("album-edit.cover").size(112.dp).clip(RoundedCornerShape(8.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
            picture?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            AeSaid(if (d == null) Said("", AlbumEdit.LOADING) else AlbumEdit.coverStatus(d, p), Modifier.parity("album-edit.cover-status"))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                val can = d != null && !ed.searching
                AePill("Find cover", Modifier.parity("album-edit.find", Contract.label("album-edit.find")).clickable(enabled = can) { ed.search() }, enabled = can)
                if (d != null && d.artFound && p == null) AeLink("Remove found cover", Modifier.parity("album-edit.remove", Contract.label("album-edit.remove")).clickable { ed.pick = CoverPick.REMOVE })
                if (p != null) AeLink("Keep current cover", Modifier.parity("album-edit.undo", Contract.label("album-edit.undo")).clickable { ed.pick = null })
            }
        }
    }
    val said = ed.searchSaid ?: return
    // .ae-search: between two rules, 12 over and 14 under, 14 under the lower rule.
    HorizontalDivider(color = paletteColor(Palette.BORDER))
    Column(Modifier.padding(top = 12.dp, bottom = 14.dp)) {
        AeSaid(said, Modifier.parity("album-edit.search-status").padding(bottom = 10.dp))
        // As the page's grid: as many 104 or wider as fit across, 12 apart.
        val across = maxOf(1, (LocalConfiguration.current.screenWidthDp - 40 + 12) / 116)
        ed.found.chunked(across).forEach { line ->
            Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                line.forEach { c ->
                    AeCandidate(c, c == ed.sure, p?.url == c.url, onDead = { ed.found = ed.found - c },
                        Modifier.parity("album-edit.candidate", Contract.label("album-edit.candidate", 0, c.label)).weight(1f).clickable { ed.choose(c) })
                }
                repeat(across - line.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        AeLabel("Or paste an image address", Modifier.parity("album-edit.url"))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val focus = remember { MutableInteractionSource() }
            BasicTextField(ed.url, { ed.url = it }, Modifier.parity("album-edit.url", Contract.label("album-edit.url")).weight(1f), singleLine = true, textStyle = aeText(),
                cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), interactionSource = focus, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { ed.useUrl() }), decorationBox = { AeBox(ed.url, "https://…/cover.jpg", focus, it) })
            AePill("Use", Modifier.parity("album-edit.url-use", Contract.label("album-edit.url-use")).clickable { ed.useUrl() })
        }
        ed.urlErr?.let { AeErr(it, Modifier.parity("album-edit.url-err")) }
    }
    HorizontalDivider(Modifier.padding(bottom = 14.dp), color = paletteColor(Palette.BORDER))
}

/** The names from MusicBrainz (.ae-match-row): what is said, the album's folder, Find match; once asked, the releases offered and a barcode's box. */
@Composable
internal fun EditMatch(ed: AlbumEditor) {
    val d = ed.state
    Column(Modifier.padding(bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        AeSaid(ed.matchSaid, Modifier.parity("album-edit.match-status"))
        d?.folder?.let { AeFolder(it, d.boxLine, Modifier.parity("album-edit.folder")) }
        val can = d != null && !ed.finding
        AePill("Find match", Modifier.parity("album-edit.match-find", Contract.label("album-edit.match-find")).clickable(enabled = can) { ed.findMatch() }, enabled = can)
    }
    val said = ed.asked ?: return
    HorizontalDivider(color = paletteColor(Palette.BORDER))
    Column(Modifier.padding(top = 12.dp, bottom = 14.dp)) {
        AeSaid(said, Modifier.parity("album-edit.match-search-status").padding(bottom = 10.dp))
        ed.releases?.takeIf { it.candidates.isNotEmpty() }?.let { m ->
            Column(Modifier.padding(bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                m.candidates.forEachIndexed { i, r ->
                    AeRelease(r, m.badge(i), ed.applied == r.mbid, ed.matching,
                        Modifier.parity("album-edit.release", Contract.label("album-edit.release", 0, r.name)).clickable(enabled = !ed.matching) { ed.match(r.mbid, "pick") })
                }
            }
        }
        AeLabel("Or the barcode, or a MusicBrainz link", Modifier.parity("album-edit.barcode"))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val focus = remember { MutableInteractionSource() }
            BasicTextField(ed.barcode, { ed.barcode = it }, Modifier.parity("album-edit.barcode", Contract.label("album-edit.barcode")).weight(1f), singleLine = true, textStyle = aeText(),
                cursorBrush = SolidColor(paletteColor(Palette.ACCENT)), interactionSource = focus, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { ed.useBarcode() }), decorationBox = { AeBox(ed.barcode, "Digits under the bars, or musicbrainz.org/release/…", focus, it) })
            val word = Contract.label("album-edit.barcode-use", if (ed.matching) 1 else 0)
            AePill(word, Modifier.parity("album-edit.barcode-use", Contract.label("album-edit.barcode-use", if (ed.matching) 1 else 0)).clickable(enabled = !ed.matching) { ed.useBarcode() },
                enabled = !ed.matching)
        }
        ed.barcodeErr?.let { AeErr(it, Modifier.parity("album-edit.barcode-err")) }
    }
    HorizontalDivider(Modifier.padding(bottom = 14.dp), color = paletteColor(Palette.BORDER))
}

/** The title, the artist and the year (.ae-fields), each with what the files say under it once they differ; what went wrong; Save and Cancel; Undo all edits. */
@Composable
internal fun EditFields(ed: AlbumEditor) {
    val d = ed.state
    val focus = remember { List(3) { MutableInteractionSource() } }
    val accent = SolidColor(paletteColor(Palette.ACCENT))
    AeLabel("Title", Modifier.parity("album-edit.title"))
    BasicTextField(ed.title, { ed.title = it }, Modifier.parity("album-edit.title", Contract.label("album-edit.title")).fillMaxWidth(), singleLine = true, textStyle = aeText(),
        cursorBrush = accent, interactionSource = focus[0], decorationBox = { AeBox(ed.title, "", focus[0], it) })
    d?.let { s -> AlbumEdit.was(s.scanned["title"].orEmpty(), ed.title)?.let { AeWas(it, Modifier.parity("album-edit.was")) { AePutBack(Modifier.parity("album-edit.put-back", Contract.label("album-edit.put-back")).clickable { ed.title = s.scanned["title"].orEmpty() }) } } }
    AeLabel("Artist", Modifier.parity("album-edit.artist"))
    BasicTextField(ed.artist, { ed.artist = it }, Modifier.parity("album-edit.artist", Contract.label("album-edit.artist")).fillMaxWidth(), singleLine = true, textStyle = aeText(),
        cursorBrush = accent, interactionSource = focus[1], decorationBox = { AeBox(ed.artist, "", focus[1], it) })
    d?.let { s -> AlbumEdit.was(s.scanned["artist"].orEmpty(), ed.artist)?.let { AeWas(it, Modifier.parity("album-edit.was")) { AePutBack(Modifier.parity("album-edit.put-back", Contract.label("album-edit.put-back")).clickable { ed.artist = s.scanned["artist"].orEmpty() }) } } }
    AeLabel("Release year", Modifier.parity("album-edit.year"))
    BasicTextField(ed.year, { ed.year = it.filter(Char::isDigit).take(4) }, Modifier.parity("album-edit.year", Contract.label("album-edit.year")).widthIn(max = 120.dp).fillMaxWidth(), singleLine = true,
        textStyle = aeText(), cursorBrush = accent, interactionSource = focus[2], keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        decorationBox = { AeBox(ed.year, "", focus[2], it) })
    d?.let { s -> AlbumEdit.was(s.scanned["year"].orEmpty(), ed.year)?.let { AeWas(it, Modifier.parity("album-edit.was")) { AePutBack(Modifier.parity("album-edit.put-back", Contract.label("album-edit.put-back")).clickable { ed.year = s.scanned["year"].orEmpty() }) } } }
    ed.err?.let { AeErr(it, Modifier.parity("album-edit.err")) }
    // .ae-foot: Save in the accent and Cancel, side by side, 10 apart, 20 over them.
    Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val can = d != null && ed.saving == null
        AePill(Contract.label("album-edit.save", if (ed.saving == "save") 1 else 0), Modifier.parity("album-edit.save", Contract.label("album-edit.save", if (ed.saving == "save") 1 else 0))
            .weight(1f).clickable(enabled = can) { ed.send("save") }, primary = true, enabled = can)
        AePill("Cancel", Modifier.parity("album-edit.cancel", Contract.label("album-edit.cancel")).weight(1f).clickable { ed.close() })
    }
    if (d?.edited == true) Box(Modifier.fillMaxWidth().padding(top = 14.dp), contentAlignment = Alignment.Center) {
        AeLink(Contract.label("album-edit.reset", if (ed.saving == "reset") 1 else 0), Modifier.parity("album-edit.reset", Contract.label("album-edit.reset", if (ed.saving == "reset") 1 else 0))
            .clickable(enabled = ed.saving == null) { ed.send("reset") })
    }
}

/** The fields' words: 16 in the text's colour. */
@Composable
private fun aeText() = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 16.sp, lineHeight = 22.sp)

/** A field's box (.ae-input): the raised ground, 10 round, 10 and 12 in, its edge the accent while it is typed in; [placeholder] while it is empty. */
@Composable
private fun AeBox(value: String, placeholder: String, focus: MutableInteractionSource, field: @Composable () -> Unit) {
    val focused by focus.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Box(Modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(if (focused) Palette.ACCENT else Palette.BORDER), shape)
        .padding(horizontal = 12.dp, vertical = 10.dp)) {
        if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, color = paletteColor(Palette.TEXT_FAINT), fontSize = 16.sp, lineHeight = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        field()
    }
}

/** A line the page writes with its first words in bold (.ae-cover-status, .ae-search-status): 14 in 1.4, dim, the bold in the text's colour. */
@Composable
private fun AeSaid(said: Said, modifier: Modifier) {
    Text(buildAnnotatedString {
        if (said.bold.isNotEmpty()) withStyle(SpanStyle(color = paletteColor(Palette.TEXT), fontWeight = FontWeight.W600)) { append(said.bold) }
        append(said.rest)
    }, modifier, color = paletteColor(Palette.TEXT_DIM), fontSize = 14.sp, lineHeight = 19.6.sp)
}

/** A field's name over it (.ae-label): 12, bold, spaced and in capitals, faint; 12 over it and 6 under. */
@Composable
private fun AeLabel(text: String, modifier: Modifier) {
    Text(text.uppercase(), modifier.padding(top = 12.dp, bottom = 6.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp,
        fontWeight = FontWeight.W600, letterSpacing = 0.06.em)
}

/** A pill (.action-btn): 40 tall, 18 in at the sides, 13 in 500, the raised ground and its edge, or the accent for [primary]; dim while it can't be tapped. */
@Composable
private fun AePill(text: String, modifier: Modifier, primary: Boolean = false, enabled: Boolean = true) {
    val shape = RoundedCornerShape(999.dp)
    Box(modifier.height(40.dp).alpha(if (enabled) 1f else 0.55f).clip(shape).background(paletteColor(if (primary) Palette.ACCENT else Palette.BG_ELEV_2))
        .border(1.dp, if (primary) Color.Transparent else paletteColor(Palette.BORDER), shape).padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
        Text(text, color = paletteColor(if (primary) Palette.ON_ACCENT else Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.W500, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A link (.ae-link): 14 in the accent's text colour, 4 over and under. */
@Composable
private fun AeLink(text: String, modifier: Modifier) {
    Text(text, modifier.padding(vertical = 4.dp), color = paletteColor(Palette.ACCENT_TEXT), fontSize = 14.sp, lineHeight = 19.6.sp)
}

/** What went wrong (.ae-err): 13, red, 8 over it. */
@Composable
private fun AeErr(text: String, modifier: Modifier) {
    Text(text, modifier.padding(top = 8.dp), color = ERR, fontSize = 13.sp, lineHeight = 18.sp)
}

/** What the files say under a field that differs from them (.ae-was): 12, faint, 5 over it, and Put back ([putBack]) after it. */
@Composable
private fun AeWas(text: String, modifier: Modifier, putBack: @Composable () -> Unit) {
    Row(modifier.padding(top = 5.dp)) {
        Text(text, Modifier.weight(1f, fill = false), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 17.sp)
        putBack()
    }
}

/** Put back (.ae-was button): 12, in the accent's text colour. */
@Composable
private fun AePutBack(modifier: Modifier) {
    Text("Put back", modifier, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 12.sp, lineHeight = 17.sp)
}

/** The brass badge on a cover or a release (.ae-cand-best): 10 in 700, dark on the accent. */
private val BADGE_INK = Color(0xFF0D1418)

/**
 * A cover found (.ae-cand): its picture square, 6 round (ringed in the accent once [picked]; "Match" on the sure one),
 * its title, its source and how well it matches. A picture that never comes drops it ([onDead]), as the page's does.
 */
@Composable
private fun AeCandidate(c: ArtCandidate, sure: Boolean, picked: Boolean, onDead: () -> Unit, modifier: Modifier) {
    var image by remember(c.picture) { mutableStateOf<ImageBitmap?>(Covers.get(c.picture)) }
    LaunchedEffect(c.picture) {
        if (image != null) return@LaunchedEffect
        val got = withContext(Dispatchers.IO) { fetchWebImage(c.picture) }
        if (got == null) onDead() else image = got
    }
    val accent = paletteColor(Palette.ACCENT)
    Column(modifier) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).drawBehind {
            if (picked) {
                val gap = 3.dp.toPx()
                drawRoundRect(accent, Offset(-gap, -gap), Size(size.width + 2 * gap, size.height + 2 * gap), CornerRadius(9.dp.toPx()), style = Stroke(2.dp.toPx()))
            }
        }.clip(RoundedCornerShape(6.dp)).background(paletteColor(Palette.BG_ELEV_2))) {
            image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            if (sure) Text("Match", Modifier.padding(start = 4.dp, top = 4.dp).clip(RoundedCornerShape(999.dp)).background(paletteColor(Palette.ACCENT)).padding(horizontal = 6.dp, vertical = 2.dp),
                color = BADGE_INK, fontSize = 10.sp, lineHeight = 13.sp, fontWeight = FontWeight.W700)
        }
        Text(c.title.ifEmpty { "—" }, Modifier.padding(top = 6.dp), color = paletteColor(Palette.TEXT), fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(c.source, color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, lineHeight = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(c.line, color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, lineHeight = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * A release offered (.ae-mcand): a row 12 round on the raised ground (its edge the accent once [picked]), the scan's
 * [badge] on the first, its artist and title in 600, how alike it is (in the accent when sure), and what sets it apart.
 */
@Composable
private fun AeRelease(r: ReleaseCandidate, badge: String?, picked: Boolean, busy: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(12.dp)
    Column(modifier.fillMaxWidth().alpha(if (busy) 0.6f else 1f).clip(shape).background(paletteColor(Palette.BG_ELEV_2))
        .border(1.dp, paletteColor(if (picked) Palette.ACCENT else Palette.BORDER), shape).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            badge?.let { Text(it, Modifier.clip(RoundedCornerShape(999.dp)).background(paletteColor(Palette.ACCENT)).padding(horizontal = 6.dp, vertical = 2.dp),
                color = BADGE_INK, fontSize = 10.sp, lineHeight = 13.sp, fontWeight = FontWeight.W700) }
            Text(r.name, Modifier.weight(1f), color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 19.6.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${r.similarity} %", color = paletteColor(if (r.sure) Palette.ACCENT_TEXT else Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.sp,
                fontWeight = if (r.sure) FontWeight.W700 else FontWeight.W400, fontFeatureSettings = "tnum")
        }
        if (r.line.isNotEmpty()) Text(r.line, color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, lineHeight = 15.sp)
    }
}

/** The folder the album's files are in (.ae-folder): "Folder" small and faint over it, and the box set it is a disc of under it. */
@Composable
private fun AeFolder(folder: String, box: String?, modifier: Modifier) {
    Column(modifier.padding(top = 6.dp)) {
        Text("FOLDER", color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.sp, lineHeight = 15.4.sp, letterSpacing = 0.06.em)
        Text(folder, color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.2.sp)
        box?.let { Text(it, Modifier.padding(top = 4.dp), color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 18.2.sp) }
    }
}
