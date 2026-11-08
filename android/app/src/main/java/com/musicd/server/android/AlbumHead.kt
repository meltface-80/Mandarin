package com.musicd.server.android

import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Album
import com.musicd.server.client.AlbumVersion
import com.musicd.server.client.Booklet
import com.musicd.server.client.Contract
import com.musicd.server.client.NavList
import com.musicd.server.client.Palette

/*
 * The album page's head beyond its lines (docs/specs/screens.json, album;
 * public/app/album-detail.js): the notes under the facts (named from its
 * folders; why a streamed album is here; a disc of a box set and the other
 * discs), the service's mark on the cover, and previous and next beside
 * Share, the album before and after this one in the list it was opened from.
 */

/**
 * A classical album's head lines (bug list item 49), in the artists' place: the composers, each a tap to
 * their page, and under them who performs it, the conductor named as such (the album's artist where no
 * one is named), as the page's `.modal-composers` and `.modal-performers`.
 */
@Composable
internal fun ComposerLines(a: Album, onPage: (String, String?) -> Unit) {
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    Row {
        a.composers.forEachIndexed { i, name ->
            if (i > 0) Text(" · ", Modifier.parity("album.composer"), color = dim, fontSize = 15.sp)
            Text(name, Modifier.parity("album.composer", Contract.label("album.composer", 0, name)).clickable { onPage("artist", name) },
                color = MaterialTheme.colorScheme.primary, fontSize = 15.sp, fontWeight = FontWeight.W600, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    val who = a.performers + listOfNotNull(a.conductor?.let { "$it, conductor" })
    Text(who.ifEmpty { listOf(a.album.subtitle) }.joinToString(" · "), Modifier.parity("album.performers").padding(top = 2.dp), color = dim, fontSize = 14.sp)
}

/**
 * The notes at the foot of the head, each only when it has something to say; a disc's tap opens it among the box's discs
 * ([onDisc]), as a version's opens it among its album's versions; [onMain] makes the one open the main version, saying
 * whether it was saved (item 345).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HeadNotes(a: Album, onMain: (Long, (Boolean) -> Unit) -> Unit = { _, _ -> }, onDisc: (NavList) -> Unit) {
    val faint = paletteColor(Palette.TEXT_FAINT)
    val dim = MaterialTheme.colorScheme.onSurfaceVariant
    if (a.namesFromFolders) Text("Names from its folders — the files carry no tags", Modifier.parity("album.names-note").fillMaxWidth().padding(top = 4.dp),
        color = faint, fontSize = 13.sp, textAlign = TextAlign.Center)
    a.serviceWhy?.let { Text(it.text(), Modifier.parity("album.why-note").fillMaxWidth().padding(top = 4.dp), color = faint, fontSize = 13.sp, textAlign = TextAlign.Center) }
    a.album.box?.let { box ->
        Column(Modifier.parity("album.box-note").fillMaxWidth().padding(top = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(box.text, color = dim, fontSize = 13.sp, textAlign = TextAlign.Center)
            val discs = a.boxDiscs
            FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                discs.forEachIndexed { i, d ->
                    if (d.offset == a.album.offset) return@forEachIndexed
                    val n = d.box?.disc ?: 0
                    Text("Disc $n · ${d.title}", color = paletteColor(Palette.MODAL_TEXT), fontSize = 12.sp,
                        modifier = Modifier.parity("album.box-disc", Contract.label("album.box-disc", 0, n.toString())).clip(RoundedCornerShape(999.dp))
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(999.dp))
                            .clickable { onDisc(NavList(discs.map { com.musicd.server.client.NavItem(it.offset, it.title) }, i)) }
                            .padding(horizontal = 11.dp, vertical = 5.dp))
                }
            }
        }
    }
    if (a.versions.size > 1) Versions(a, onMain, onDisc)
}

/** Its album's versions (item 345, as the page's album-versions.js): how many, a pill each (the one open ringed), and Make main. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Versions(a: Album, onMain: (Long, (Boolean) -> Unit) -> Unit, onOpen: (NavList) -> Unit) {
    val list = a.versions
    val brass = MaterialTheme.colorScheme.primary
    var said by remember(a.album.offset) { mutableStateOf(AlbumVersion.MAKE_MAIN) }
    Column(Modifier.parity("album.versions").fillMaxWidth().padding(top = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(AlbumVersion.head(list.size).uppercase(), color = paletteColor(Palette.TEXT_FAINT), fontSize = 12.sp, fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            list.forEachIndexed { i, v ->
                val pill = RoundedCornerShape(999.dp)
                Text(v.words, color = if (v.current) brass else paletteColor(Palette.MODAL_TEXT), fontSize = 12.sp,
                    modifier = Modifier.parity("album.version", Contract.label("album.version", 0, v.words)).clip(pill)
                        .border(1.dp, if (v.current) brass else MaterialTheme.colorScheme.outline, pill)
                        .clickable(enabled = !v.current) { onOpen(NavList(list.map { com.musicd.server.client.NavItem(it.album.offset, it.album.title) }, i)) }
                        .padding(horizontal = 11.dp, vertical = 5.dp))
            }
        }
        val cur = list.firstOrNull { it.current }
        if (cur != null && !cur.main) Text(said, color = brass, fontSize = 12.sp, textDecoration = if (said == AlbumVersion.MAKE_MAIN || said == AlbumVersion.FAILED) TextDecoration.Underline else null,
            modifier = Modifier.parity("album.version-main", Contract.label("album.version-main", listOf(AlbumVersion.MAKE_MAIN, AlbumVersion.SAVING, AlbumVersion.IS_MAIN, AlbumVersion.FAILED).indexOf(said).coerceAtLeast(0)))
                .padding(top = 8.dp).clickable(enabled = said == AlbumVersion.MAKE_MAIN || said == AlbumVersion.FAILED) {
                    said = AlbumVersion.SAVING
                    onMain(cur.album.offset) { ok -> said = if (ok) AlbumVersion.IS_MAIN else AlbumVersion.FAILED }
                }.padding(horizontal = 8.dp, vertical = 4.dp))
    }
}

/** The book on the cover (bottom right), as the page's: a brass disc; one booklet opens at once ([onOpen]), several are chosen from a list. */
@Composable
internal fun BookletButton(booklets: List<Booklet>, colors: IconButtonColors, modifier: Modifier = Modifier, onOpen: (Booklet) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier.padding(8.dp)) {
        FilledIconButton(onClick = { if (booklets.size == 1) onOpen(booklets[0]) else open = true }, colors = colors, shape = CircleShape,
            modifier = Modifier.parity("album.booklet", Contract.label("album.booklet", if (booklets.size == 1) 0 else 1, booklets.size.toString())).size(38.dp)) {
            Icon(painterResource(R.drawable.np_booklet), contentDescription = null, modifier = Modifier.size(20.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (b in booklets) DropdownMenuItem(text = { Text(b.text) }, onClick = { open = false; onOpen(b) },
                modifier = Modifier.parity("album.booklet-pick", Contract.label("album.booklet-pick", 0, b.text)))
        }
    }
}

/** The streaming service's mark on the cover (bottom left), as the page's badge: only a Qobuz or Tidal album wears one. */
@Composable
internal fun SourceBadge(source: String?, modifier: Modifier = Modifier) {
    val icon = when (source) { "qobuz" -> R.drawable.src_qobuz; "tidal" -> R.drawable.src_tidal; else -> return }
    Box(modifier.parity("album.source").padding(8.dp).size(28.dp).clip(RoundedCornerShape(8.dp)).background(Color(0x9E0A0E14)), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), contentDescription = null, tint = Color.White.copy(alpha = 0.92f), modifier = Modifier.size(16.dp))
    }
}

/** Previous and next: the album before and after this one in [nav], brass discs beside Share, each dimmed at the list's end; a tap opens it ([onStep], with its place). */
@Composable
internal fun NavDiscs(nav: NavList, colors: IconButtonColors, onStep: (Int) -> Unit) {
    val prev = nav.items.getOrNull(nav.index - 1)
    val next = nav.items.getOrNull(nav.index + 1)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledIconButton(onClick = { onStep(nav.index - 1) }, enabled = prev != null, colors = colors, shape = CircleShape,
            modifier = Modifier.parity("album.previous", if (prev == null) Contract.label("album.previous") else Contract.label("album.previous", 1, prev.title)).size(40.dp).alpha(if (prev == null) 0.35f else 1f)) {
            Icon(painterResource(R.drawable.np_back), contentDescription = null, modifier = Modifier.size(22.dp))
        }
        FilledIconButton(onClick = { onStep(nav.index + 1) }, enabled = next != null, colors = colors, shape = CircleShape,
            modifier = Modifier.parity("album.next", if (next == null) Contract.label("album.next") else Contract.label("album.next", 1, next.title)).size(40.dp).alpha(if (next == null) 0.35f else 1f)) {
            Icon(painterResource(R.drawable.np_forward), contentDescription = null, modifier = Modifier.size(22.dp))
        }
    }
}
