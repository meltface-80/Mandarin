package com.musicd.server.android

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Palette
import com.musicd.server.client.Scanner
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Locale

/*
 * The Library Scanner's MusicBrainz pack (bug list item 90; the page's packBlock and packBrowser, settings-scanner.js): what
 * is downloaded and from when, Download, Update or Remove, the download's progress asked for every second, and where the
 * pack is kept, chosen among the server's folders (its mounted drives and shares, and each folder's own).
 */

private const val PACK_INFO = "Every MusicBrainz release with a barcode, with its tracks, kept on the server and refreshed weekly. Barcodes are matched here first, without asking musicbrainz.org; anything the pack lacks is asked for as before."
private const val FOLDER_INFO = "The pack can live on any drive the server can write to. In Docker, mount the drive into the container first (for example -v /mnt/ssd/mandarin:/packs). A pack already downloaded is moved there."

/** The pack's block: as it is, or the folder browser while its place is being chosen. */
@Composable
internal fun PackBlock(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, info: (String) -> Unit) {
    val context = LocalContext.current
    val pack = k.pack
    val browse = k.browse
    ScanDivider()
    Block {
        if (pack == null) {
            ScanRow("MusicBrainz pack", PACK_INFO, info = info) {}
            ScanNote("…")
            return@Block
        }
        if (browse != null) { PackBrowser(k, browse, client, scope); return@Block }
        val view = Scanner.pack(pack, k.busy, { iso -> day(iso) })
        ScanRow("MusicBrainz pack", PACK_INFO, info = info) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (b in view.buttons) IdButton(b.label, b.primary, view.enabled, Modifier.parity("settings-scanner.pack", Contract.label("settings-scanner.pack", if (b.label == "Remove") 2 else if (b.label == "Update") 1 else 0))
                    .clickable(enabled = view.enabled) { packAct(k, client, scope, b.action) })
            }
        }
        ScanNote(view.state, view.error)
        ScanRow("Folder", FOLDER_INFO, info = info) {
            if (pack.optBoolean("dir_fixed")) Text("Set by MBPACK_DIR", Modifier.parity("settings-scanner.pack-fixed"), color = paletteColor(Palette.TEXT_DIM), fontSize = 14.sp, lineHeight = 19.sp, textAlign = TextAlign.End)
            else Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (pack.optString("dir") != pack.optString("data_dir")) IdButton("Data folder", false, !k.busy, Modifier.parity("settings-scanner.pack-folder-reset", Contract.label("settings-scanner.pack-folder-reset"))
                    .clickable(enabled = !k.busy) { packFolder(k, client, scope, null) { setupToast(context, "The pack’s folder is set") } })
                IdButton("Change…", false, !k.busy, Modifier.parity("settings-scanner.pack-folder", Contract.label("settings-scanner.pack-folder")).clickable(enabled = !k.busy) {
                    k.err = ""; packGo(k, client, scope, pack.optString("dir").ifEmpty { "/" })
                })
            }
        }
        val (where, problem) = Scanner.packFolder(pack)
        ScanNote(where, problem)
    }
}

/** Choosing the pack's folder (the page's packBrowser): Cancel and where it is, the drives, the folders in it, and Keep the pack here. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PackBrowser(k: ScanKept, b: JSONObject, client: () -> ServerClient?, scope: CoroutineScope) {
    val context = LocalContext.current
    val path = b.optString("path", "/")
    ScanTitle("Where to keep the MusicBrainz pack", null)
    Row(Modifier.padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        SetupButton("Cancel", false, Modifier.parity("settings-scanner.browse-cancel", Contract.label("settings-scanner.browse-cancel")).clickable { k.browse = null; k.err = "" })
        Text(path, Modifier.parity("settings-scanner.browse-path").weight(1f), color = paletteColor(Palette.TEXT_DIM), fontSize = 13.sp, lineHeight = 18.sp)
    }
    if (k.places.isNotEmpty()) {
        Text("Mounted drives and shares".uppercase(), Modifier.parity("settings-scanner.browse-places").padding(bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT),
            fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        FlowRow(Modifier.padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (p in k.places) {
                val on = p == path
                val pill = RoundedCornerShape(999.dp)
                Text(p, Modifier.parity("settings-scanner.place", Contract.label("settings-scanner.place", 0, p)).clip(pill).background(paletteColor(Palette.BG_ELEV_2))
                    .border(1.dp, paletteColor(if (on) Palette.ACCENT else Palette.BORDER), pill).clickable { k.err = ""; packGo(k, client, scope, p) }.padding(horizontal = 12.dp, vertical = 6.dp),
                    color = paletteColor(if (on) Palette.ACCENT_TEXT else Palette.TEXT), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    val list = RoundedCornerShape(14.dp)
    Column(Modifier.fillMaxWidth().clip(list).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), list)) {
        val parent = if (b.isNull("parent")) null else b.optString("parent").ifEmpty { null }
        val dirs = b.optJSONArray("dirs")
        val rows = (if (parent != null) listOf(Triple("Up", parent, true)) else emptyList()) +
            (0 until (dirs?.length() ?: 0)).mapNotNull { dirs?.optJSONObject(it) }.map { Triple(it.optString("name"), it.optString("path"), false) }
        for ((i, r) in rows.withIndex()) {
            val (name, to, up) = r
            Row(Modifier.parity("settings-scanner.dir", Contract.label("settings-scanner.dir", 0, name)).fillMaxWidth().clickable { k.err = ""; packGo(k, client, scope, to) }.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(paletteColor(Palette.BG_ELEV)), contentAlignment = Alignment.Center) {
                    if (up) Text("↰", color = paletteColor(Palette.ACCENT_TEXT), fontSize = 18.sp, lineHeight = 18.sp)
                    else Icon(painterResource(R.drawable.st_folders), contentDescription = null, tint = paletteColor(Palette.ACCENT_TEXT), modifier = Modifier.size(20.dp))
                }
                Text(name, Modifier.weight(1f), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.W500, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (i < rows.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(paletteColor(Palette.BORDER)))
        }
        if (rows.none { !it.third }) ScanNote("No folders in here.")
    }
    val last = path.trimEnd('/').substringAfterLast('/').ifEmpty { path }
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.End) {
        val words = "Keep the pack in “$last”"
        SetupButton(words, k.busy || path == "/", Modifier.parity("settings-scanner.browse-choose", Contract.label("settings-scanner.browse-choose", 0, last))
            .clickable(enabled = !k.busy && path != "/") { packFolder(k, client, scope, path) { setupToast(context, "The pack’s folder is set") } })
    }
    if (k.err.isNotEmpty()) ScanNote("", k.err)
}

/** A button of the scanner's (.id-btn): 12.5 in 600, 6 and 11 in, a pill; the accent for the one that goes ahead ([primary]); faded while it can't be pressed. */
@Composable
internal fun IdButton(words: String, primary: Boolean, enabled: Boolean, modifier: Modifier, height: Int = 31) {
    val pill = RoundedCornerShape(999.dp)
    Box(modifier.heightIn(min = height.dp).alpha(if (enabled) 1f else 0.5f).clip(pill).background(if (primary) paletteColor(Palette.ACCENT) else Color.Transparent)
        .border(1.dp, paletteColor(if (primary) Palette.ACCENT else Palette.BORDER), pill).padding(horizontal = 11.dp), contentAlignment = Alignment.Center) {
        Text(words, color = paletteColor(Palette.TEXT), fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.W600, maxLines = 1)
    }
}

/** Download, Update or Remove ([what]); a download followed until it is done. */
private fun packAct(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, what: String) {
    if (k.busy) return
    val c = client() ?: return
    k.busy = true
    scope.launch {
        withContext(Dispatchers.IO) { runCatching { c.post("/api/identify/pack/$what", JSONObject()) } }.onSuccess { k.pack = it; k.err = "" }.onFailure { k.err = it.message ?: "" }
        k.busy = false
        if (what == "download") followPack(k, c, scope)
    }
}

/** The download's progress, asked for every second until it is done (the page's followPack). */
internal fun followPack(k: ScanKept, c: ServerClient, scope: CoroutineScope) {
    fun going() = k.pack?.optJSONObject("job")?.let { it.optString("error").isEmpty() && it.optString("phase") != "done" } == true
    if (!going() || following) return
    following = true
    scope.launch {
        while (going()) {
            delay(1_000)
            k.pack = withContext(Dispatchers.IO) { runCatching { c.getJson("/api/identify/pack") }.getOrNull() } ?: break
        }
        following = false
        if (k.pack?.optJSONObject("job")?.optString("phase") == "done") toast?.invoke("MusicBrainz pack ready")
    }
}
private var following = false
/** Where "MusicBrainz pack ready" is said (the page's toast), while the page is open. */
internal var toast: ((String) -> Unit)? = null

/** The server's folders at [path] (and its drives, once), for choosing the pack's place. */
private fun packGo(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, path: String) {
    val c = client() ?: return
    scope.launch {
        withContext(Dispatchers.IO) {
            runCatching {
                if (k.places.isEmpty()) k.places = c.getJson("/api/library/folders").optJSONArray("mounts")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optString("path") } }.orEmpty()
                c.getJson("/api/library/browse?path=" + URLEncoder.encode(path, "UTF-8"))
            }
        }.onSuccess { k.browse = it; k.err = "" }.onFailure { k.err = it.message ?: ""; if (k.browse == null) k.browse = JSONObject().put("path", "/").put("dirs", org.json.JSONArray()) }
    }
}

/** The pack's folder set to [dir] (none: the data folder); a pack already there is moved, which can take a minute. */
private fun packFolder(k: ScanKept, client: () -> ServerClient?, scope: CoroutineScope, dir: String?, done: () -> Unit) {
    if (k.busy) return
    val c = client() ?: return
    k.busy = true
    if (k.pack?.optJSONObject("installed") != null) k.pack = JSONObject(k.pack.toString()).put("job", JSONObject().put("phase", "moving"))
    scope.launch {
        withContext(Dispatchers.IO) { runCatching { c.post("/api/identify/pack/folder", JSONObject().put("dir", dir ?: JSONObject.NULL), 600_000) } }
            .onSuccess { k.pack = it; k.browse = null; k.err = ""; done() }
            .onFailure { e -> k.err = e.message ?: ""; withContext(Dispatchers.IO) { runCatching { c.getJson("/api/identify/pack") }.getOrNull() }?.let { k.pack = it } }
        k.busy = false
    }
}

/** An ISO date as the phone writes it (the page's day: Oct 12, 2026). */
private fun day(iso: String): String = runCatching {
    DateFormat.getDateInstance(DateFormat.MEDIUM).format(SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).parse(iso.take(10))!!)
}.getOrDefault("")
