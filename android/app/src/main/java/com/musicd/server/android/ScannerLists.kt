package com.musicd.server.android

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.Scanner
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShellRoute
import kotlinx.coroutines.CoroutineScope
import org.json.JSONObject

/*
 * The Library Scanner's lists (bug list item 90; the page's section and albumRow, settings-scanner-albums.js): the proposed,
 * unidentified, applied and declined albums, each under its title and count, the first 60 until Show all. An album's name
 * opens it; its buttons (Accept and Reject, Undo, or Check again; Barcode… but on the applied) sit beside it where they fit
 * and under it where they don't, as the page's row wraps; Barcode… opens the box a barcode or a MusicBrainz link is typed in.
 */

/** Every list that has albums, in the page's order. */
@Composable
internal fun ScanLists(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, context: Context) {
    val lists = k.lists ?: return
    val st = k.st ?: return
    val itunes = st.optJSONObject("settings")?.opt("itunes") != false
    for (sec in Scanner.SECTIONS) {
        val list = Scanner.list(lists, sec.kind)
        if (list.isEmpty()) continue
        val count = lists.optJSONObject("counts")?.takeIf { it.has(sec.kind) }?.optInt(sec.kind) ?: list.size
        val shown = if (sec.kind in k.more) list else list.take(Scanner.SHOW)
        ScanDivider()
        Block {
            ScanTitle(sec.title + " (" + Scanner.num(count.toLong()) + ")", null)
            sec.note?.let { ScanNote(it, top = 0); Box(Modifier.height(10.dp)) }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (it in shown) AlbumRow(k, it, sec.kind, itunes, client, scope, context)
            }
            if (shown.size < Scanner.showAll(sec.kind, count)) {
                val words = "Show all " + Scanner.num(count.toLong())
                Text(words, Modifier.parity("settings-scanner.more", Contract.label("settings-scanner.more", 0, Scanner.num(count.toLong()))).padding(top = 10.dp).clickable {
                    k.more = k.more + sec.kind
                    if ((lists.optJSONArray(sec.kind)?.length() ?: 0) < count) client()?.let { loadLists(k, it, scope) }
                }, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 13.sp, lineHeight = 18.sp, textDecoration = TextDecoration.Underline)
            }
        }
    }
}

/** An album on a list (.id-row): its name and what the scan made of it, its buttons, and Barcode…'s box while it is open. */
@Composable
private fun AlbumRow(k: ScanKept, it: JSONObject, kind: String, itunes: Boolean, client: () -> ServerClient?, scope: CoroutineScope, context: Context) {
    val a = it.optJSONObject("album") ?: return
    val offset = a.optLong("offset")
    val shape = RoundedCornerShape(12.dp)
    val name = Scanner.names(a.optString("artist"), a.optString("title"))
    Column(Modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 12.dp, vertical = 10.dp)) {
        WrapBeside {
            Column(Modifier.parity("settings-scanner.album", Contract.label("settings-scanner.album", 0, name)).clickable { NativeShell.open(ShellRoute.album(offset, NativeShell.zone)) },
                verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name, color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val line2 = Scanner.line2(it, kind, itunes)
                if (line2.isNotEmpty()) Text(line2, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.2.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (b in Scanner.actions(kind)) {
                    val go = { scanAct(k, client, scope, context, "/api/identify/" + b.action, JSONObject().put("offset", offset), Scanner.actDone(b.action)) }
                    when (b.action) {
                        "accept" -> IdButton(b.label, b.primary, !k.busy, Modifier.parity("settings-scanner.accept", Contract.label("settings-scanner.accept")).clickable(enabled = !k.busy, onClick = go))
                        "reject" -> IdButton(b.label, b.primary, !k.busy, Modifier.parity("settings-scanner.reject", Contract.label("settings-scanner.reject")).clickable(enabled = !k.busy, onClick = go))
                        "undo" -> IdButton(b.label, b.primary, !k.busy, Modifier.parity("settings-scanner.undo", Contract.label("settings-scanner.undo")).clickable(enabled = !k.busy, onClick = go))
                        else -> IdButton(b.label, b.primary, !k.busy, Modifier.parity("settings-scanner.recheck", Contract.label("settings-scanner.recheck")).clickable(enabled = !k.busy, onClick = go))
                    }
                }
                if (kind != "applied") IdButton("Barcode…", false, !k.busy, Modifier.parity("settings-scanner.barcode", Contract.label("settings-scanner.barcode")).clickable(enabled = !k.busy) {
                    k.matching = if (k.matching == offset) null else offset; k.draft = ""
                })
            }
        }
        if (k.matching == offset) MatchBox(k, offset, client, scope, context)
    }
}

/** Barcode…'s box (.id-match): the barcode or link typed in, and Match; what to type, under them. */
@Composable
private fun MatchBox(k: ScanKept, offset: Long, client: () -> ServerClient?, scope: CoroutineScope, context: Context) {
    fun match() {
        val q = k.draft.trim()
        if (q.isEmpty()) return
        scanAct(k, client, scope, context, "/api/identify/match", JSONObject().put("offset", offset).put("query", q), "Matched and applied") { k.matching = null; k.draft = "" }
    }
    val shape = RoundedCornerShape(10.dp)
    Row(Modifier.fillMaxWidth().padding(top = 10.dp).height(39.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BasicTextField(k.draft, { k.draft = it }, Modifier.parity("settings-scanner.match-input", Contract.label("settings-scanner.match-input")).weight(1f), singleLine = true,
            textStyle = TextStyle(color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 20.sp), cursorBrush = SolidColor(paletteColor(Palette.ACCENT)),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { match() }),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().height(39.dp).clip(shape).background(paletteColor(Palette.BG_ELEV)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 12.dp),
                    contentAlignment = Alignment.CenterStart) {
                    if (k.draft.isEmpty()) Text("Barcode, or a MusicBrainz release link", color = paletteColor(Palette.TEXT_FAINT), fontSize = 15.sp, lineHeight = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    inner()
                }
            })
        IdButton("Match", true, !k.busy, Modifier.parity("settings-scanner.match", Contract.label("settings-scanner.match")).clickable(enabled = !k.busy) { match() }, height = 39)
    }
    ScanNote("The digits under the bars on the sleeve, or the address of the release (or album) on musicbrainz.org. That release is written to the album whatever the scan thought.", top = 8)
}

/**
 * The page's wrapping row (.id-row: the name grows, the buttons keep their size): both on one line, the buttons at the end
 * and the two centred, where the name's whole width and the buttons fit side by side; else the name across the row and
 * the buttons under it, 10 below.
 */
@Composable
private fun WrapBeside(content: @Composable () -> Unit) {
    Layout(content) { measurables, c ->
        val gap = 10.dp.roundToPx()
        val open = measurables[0]; val acts = measurables[1]
        val ap = acts.measure(Constraints(maxWidth = c.maxWidth))
        val wide = open.maxIntrinsicWidth(Constraints.Infinity)
        if (wide + gap + ap.width <= c.maxWidth) {
            val op = open.measure(Constraints.fixedWidth(c.maxWidth - gap - ap.width))
            val h = maxOf(op.height, ap.height)
            layout(c.maxWidth, h) { op.place(0, (h - op.height) / 2); ap.place(c.maxWidth - ap.width, (h - ap.height) / 2) }
        } else {
            val op = open.measure(Constraints.fixedWidth(c.maxWidth))
            layout(c.maxWidth, op.height + gap + ap.height) { op.place(0, 0); ap.place(0, op.height + gap) }
        }
    }
}
