package com.musicd.server.android

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.font.FontWeight
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
 * A Library Scanner folder opened (bug list item 411; the page's folderView and albumRow, settings-scanner-albums.js): the
 * albums identification couldn't place (Unidentified), or found but wasn't sure enough to apply (To confirm), under Back,
 * their title and count and a note, the first 60 until Show all. An album's name opens it, with how sure the scan is and
 * why under it (item 414b); its buttons (Apply and Not this, or Check again; Find…, Edit album's match search for it)
 * sit beside it where they fit and under it where they don't, as the page's row wraps; To confirm's other releases or
 * editions kept, a tap each, under them.
 */

/** The folder [kind] open: Back, its title and count, its note, Check them all again, and its albums. */
@Composable
internal fun FolderView(k: ScanKept, kind: String, client: () -> ServerClient?, scope: CoroutineScope, context: Context) {
    val f = Scanner.folder(kind, k.lists?.optJSONObject("counts")?.takeIf { it.has(kind) }?.optInt(kind) ?: k.scan?.optInt(kind) ?: 0)
    Column(Modifier.fillMaxWidth()) {
        if (kind == "proposed") FolderBack(Modifier.parity("settings-scanner.to-confirm-close", Contract.label("settings-scanner.to-confirm-close")).clickable { closeFolder(k) })
        else FolderBack(Modifier.parity("settings-scanner.unidentified-close", Contract.label("settings-scanner.unidentified-close")).clickable { closeFolder(k) })
        ScanTitle(f.title + " (" + Scanner.num(f.count.toLong()) + ")")
        ScanNote(f.note, top = 0)
        if (f.count > 0) Row(Modifier.padding(top = 12.dp)) {
            SetupButton("Check the proposed and unidentified again", k.busy, Modifier.parity("settings-scanner.recheck-all", Contract.label("settings-scanner.recheck-all")).clickable(enabled = !k.busy) {
                scanAct(k, client, scope, context, "/api/identify/recheck-all", JSONObject(), "They will be looked at again")
            })
        }
        val lists = k.lists
        if (lists == null) { Box(Modifier.height(12.dp)); ScanWait(); return@Column }
        val list = Scanner.list(lists, kind)
        val shown = if (k.more) list else list.take(Scanner.SHOW)
        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (it in shown) AlbumRow(k, it, kind, client, scope, context)
        }
        // Find…: Edit album's own match search for the album, over the folder (item 414b); its lists read again once it closes.
        k.finding?.let { a ->
            AlbumEditSheet(a.optLong("offset"), a.optString("title"), a.optString("subtitle"), client, find = true,
                onClose = { k.finding = null; client()?.let { loadLists(k, it, scope) } }, onChanged = {})
        }
        if (shown.size < Scanner.showAll(f.count)) {
            val words = "Show all " + Scanner.num(f.count.toLong())
            Text(words, Modifier.parity("settings-scanner.more", Contract.label("settings-scanner.more", 0, Scanner.num(f.count.toLong()))).padding(top = 10.dp).clickable {
                k.more = true
                client()?.let { loadLists(k, it, scope) }
            }, color = paletteColor(Palette.ACCENT_TEXT), fontSize = 13.sp, lineHeight = 18.sp, textDecoration = TextDecoration.Underline)
        }
    }
}

/** Back from a folder (.scan-back), [modifier] its key and tap: "‹ Library Scanner" in the brass. */
@Composable
private fun FolderBack(modifier: Modifier) {
    Text("‹ Library Scanner", modifier.padding(top = 2.dp, bottom = 12.dp), color = paletteColor(Palette.ACCENT_TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600)
}

/**
 * An album on a list (.id-row): its name, what the scan made of it and how sure it is and why (item 414b), its buttons;
 * in To confirm, the other releases or editions it kept, a tap each.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AlbumRow(k: ScanKept, it: JSONObject, kind: String, client: () -> ServerClient?, scope: CoroutineScope, context: Context) {
    val a = it.optJSONObject("album") ?: return
    val offset = a.optLong("offset")
    val shape = RoundedCornerShape(12.dp)
    val name = Scanner.names(a.optString("artist"), a.optString("title"))
    Column(Modifier.fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), shape).padding(horizontal = 12.dp, vertical = 10.dp)) {
        WrapBeside {
            Column(Modifier.parity("settings-scanner.album", Contract.label("settings-scanner.album", 0, name)).clickable { NativeShell.open(ShellRoute.album(offset, NativeShell.zone)) },
                verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name, color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val line2 = Scanner.line2(it, kind)
                if (line2.isNotEmpty()) Text(line2, color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, lineHeight = 16.2.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val why = Scanner.reasons(it)
                if (why.isNotEmpty()) Text(why, Modifier.parity("settings-scanner.reasons"), color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.5.sp, lineHeight = 15.5.sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val find = @Composable {
                    IdButton("Find…", false, !k.busy, Modifier.parity("settings-scanner.find", Contract.label("settings-scanner.find")).clickable(enabled = !k.busy) { k.finding = a })
                }
                if (kind != "proposed") find()
                for (b in Scanner.actions(kind)) {
                    val go = { scanAct(k, client, scope, context, "/api/identify/" + b.action, JSONObject().put("offset", offset), Scanner.actDone(b.action)) }
                    when (b.action) {
                        "accept" -> IdButton(b.label, b.primary, !k.busy, Modifier.parity("settings-scanner.accept", Contract.label("settings-scanner.accept")).clickable(enabled = !k.busy, onClick = go))
                        "reject" -> IdButton(b.label, b.primary, !k.busy, Modifier.parity("settings-scanner.reject", Contract.label("settings-scanner.reject")).clickable(enabled = !k.busy, onClick = go))
                        else -> IdButton(b.label, b.primary, !k.busy, Modifier.parity("settings-scanner.recheck", Contract.label("settings-scanner.recheck")).clickable(enabled = !k.busy, onClick = go))
                    }
                }
                if (kind == "proposed") find()
            }
        }
        val choices = if (kind == "proposed") Scanner.choices(it) else emptyList()
        if (choices.isNotEmpty()) FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
            itemVerticalAlignment = Alignment.CenterVertically) {
            for (c in choices) IdButton(c.name, false, !k.busy, Modifier.parity("settings-scanner.choice", Contract.label("settings-scanner.choice", 0, c.name)).clickable(enabled = !k.busy) {
                scanAct(k, client, scope, context, "/api/identify/match", JSONObject().put("offset", offset).put("query", c.mbid).put("how", c.how), "Applied")
            })
        }
    }
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
