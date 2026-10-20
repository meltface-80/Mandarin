package com.musicd.server.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.musicd.server.client.CardFields
import com.musicd.server.client.Contract
import com.musicd.server.client.LibraryClient
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShareCard
import com.musicd.server.client.ShareLink
import com.musicd.server.client.SimilarAct
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** The default service held on a chip in this run of the app, ahead of what the page last said (item 75). */
internal object ShareKept { @Volatile var service: String? = null }

/**
 * The Share card, natively (the group B of docs/specs/plan-android-native.md, B4; bug list item 75), as the page's
 * (docs/specs/screens.json, share-card; share-card.js, share-card-links.js, share-card-suggestions.js, style.css
 * .share-*): a panel over the screen, centred above the mini player's room ([reserve]), ✕ in its corner; the card
 * drawn (ShareCardPainter.kt) from what the server has to hand, drawn again if the full answer says more; Share and
 * Download; the places to hear or read about the record, the default service held (its chip ticked); If you like
 * this, an act to queue from the library ([zone]) or to find on the default service; the hint.
 */
@Composable
internal fun ShareSheet(title: String, artist: String, imageKey: String?, zone: String, reserve: Dp, client: () -> ServerClient?, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val s = remember(title, artist) { ShareState(title, artist, imageKey, client, scope, context) }
    LaunchedEffect(title, artist) { s.load() }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect { window?.setDimAmount(0.55f) }
        Box(Modifier.parity("share-card.close", Contract.label("share-card.close")).fillMaxSize()
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose)
            .systemBarsPadding().padding(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 20.dp + reserve), contentAlignment = Alignment.Center) {
            val panel = RoundedCornerShape(20.dp)
            Box(Modifier.widthIn(max = 560.dp).fillMaxWidth().clip(panel).background(paletteColor(Palette.BG_VEIL)).border(1.dp, paletteColor(Palette.GLASS_EDGE), panel)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(start = 18.dp, top = 24.dp, end = 18.dp, bottom = 18.dp)) {
                    ShareFrame(s)
                    ShareActions(s)
                    if (s.links.isNotEmpty()) ShareLinks(s)
                    if (s.acts.isNotEmpty()) ShareActs(s, zone)
                    Text(ShareCard.HINT, Modifier.parity("share-card.hint").padding(start = 4.dp, top = 10.dp, end = 4.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp)
                    s.err?.let { Text(it, Modifier.parity("share-card.err").padding(start = 4.dp, top = 10.dp, end = 4.dp), color = paletteColor(Palette.DANGER), fontSize = 13.sp, lineHeight = 18.sp) }
                }
                Box(Modifier.parity("share-card.close", Contract.label("share-card.close")).align(Alignment.TopEnd).padding(top = 6.dp, end = 6.dp).size(40.dp).clip(CircleShape)
                    .background(paletteColor(Palette.ACCENT)).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                    Icon(painterResource(R.drawable.np_close), contentDescription = null, tint = paletteColor(Palette.ON_ACCENT), modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

/** The card's frame (.share-frame): 26 under the panel's top, its edge and corners, the card dark behind; the card, or the spinner and what is said. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ShareFrame(s: ShareState) {
    val frame = RoundedCornerShape(16.dp)
    Box(Modifier.parity("share-card.card").padding(top = 26.dp).fillMaxWidth().clip(frame).background(paletteColor(0xFF12151AL)).border(1.dp, paletteColor(Palette.GLASS_EDGE), frame),
        contentAlignment = Alignment.Center) {
        val card = s.card
        if (card != null) Image(card.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Fit,
            modifier = Modifier.parity("share-card.image", Contract.label("share-card.image")).fillMaxWidth().heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.64f).dp)
                .combinedClickable(onLongClick = { s.download() }, onClick = {}))
        else Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (!s.failed) CircularProgressIndicator(Modifier.padding(bottom = 10.dp).size(26.dp), color = paletteColor(Palette.ACCENT_TEXT), trackColor = paletteColor(Palette.BORDER), strokeWidth = 3.dp)
            Text(if (s.failed) ShareCard.FAILED else ShareCard.GENERATING, color = paletteColor(Palette.TEXT_FAINT), fontSize = 14.sp, lineHeight = 19.sp, textAlign = TextAlign.Center)
        }
    }
}

/** Share… in the accent and Download (.share-actions): side by side, 10 apart, 14 under the card, each 45 tall, 10 round, an 18 icon before the words. */
@Composable
private fun ShareActions(s: ShareState) {
    if (s.card == null) return
    Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        ShareButton("Share…", R.drawable.np_share, true, Modifier.parity("share-card.share", Contract.label("share-card.share")).weight(1f).clickable { s.share() })
        ShareButton(s.saved, R.drawable.sc_download, false, Modifier.parity("share-card.download", Contract.label("share-card.download")).weight(1f).clickable { s.download() })
    }
}

/** One of the card's buttons: the accent for [primary], else the raised ground with the glass's edge. */
@Composable
private fun ShareButton(words: String, icon: Int, primary: Boolean, modifier: Modifier) {
    val shape = RoundedCornerShape(10.dp)
    val ink = paletteColor(if (primary) Palette.ON_ACCENT else Palette.TEXT)
    Row(modifier.clip(shape).background(paletteColor(if (primary) Palette.ACCENT else Palette.BG_ELEV_2))
        .border(1.dp, if (primary) androidx.compose.ui.graphics.Color.Transparent else paletteColor(Palette.GLASS_EDGE), shape).padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), contentDescription = null, tint = ink, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(words, color = ink, fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W500, maxLines = 1)
    }
}

/** The places to hear or read about it (.share-links): chips 96 or wider, as many across as fit, 8 apart, every one as tall as the tallest; the default service's ticked. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ShareLinks(s: ShareState) {
    val chosen = s.preferred()
    EqualGrid(minCell = 96.dp, gap = 8.dp, modifier = Modifier.padding(top = 12.dp)) {
        for (link in s.links) {
            val mine = !link.review && link.id == chosen
            val shape = RoundedCornerShape(10.dp)
            Row(Modifier.parity("share-card.link", Contract.label("share-card.link", 0, link.words)).clip(shape).background(paletteColor(Palette.BG_ELEV_2))
                .border(1.dp, paletteColor(if (mine) Palette.ACCENT else Palette.BORDER), shape)
                .combinedClickable(onClick = { s.open(link.url) }, onLongClick = { if (!link.review) s.prefer(link) })
                .heightIn(min = 44.dp).padding(horizontal = 10.dp, vertical = 8.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text(link.words, color = paletteColor(Palette.TEXT), fontSize = 13.sp, lineHeight = 15.6.sp, fontWeight = FontWeight.W600, textAlign = TextAlign.Center)
                if (mine) Text("✓", Modifier.padding(start = 6.dp), color = paletteColor(Palette.ACCENT_TEXT), fontSize = 13.sp, lineHeight = 15.6.sp, fontWeight = FontWeight.W700)
            }
        }
    }
}

/** A grid of cells [minCell] wide or wider, as many across as fit, [gap] apart, every cell as tall as the tallest (the page's grid-auto-rows: 1fr). */
@Composable
private fun EqualGrid(minCell: Dp, gap: Dp, modifier: Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier.fillMaxWidth()) { cells, constraints ->
        val gapPx = gap.roundToPx()
        val w = constraints.maxWidth
        val across = maxOf(1, (w + gapPx) / (minCell.roundToPx() + gapPx))
        val cell = (w - gapPx * (across - 1)) / across
        val tall = cells.maxOfOrNull { it.minIntrinsicHeight(cell) } ?: 0
        val placed = cells.map { it.measure(Constraints.fixed(cell, tall)) }
        val rows = (placed.size + across - 1) / across
        layout(w, if (rows == 0) 0 else rows * tall + (rows - 1) * gapPx) {
            placed.forEachIndexed { i, p -> p.place((i % across) * (cell + gapPx), (i / across) * (tall + gapPx)) }
        }
    }
}

/** If you like this (.share-similar): its heading, then a row an act, 6 apart: the name, the record, what a tap does, and why it is here. */
@Composable
private fun ShareActs(s: ShareState, zone: String) {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Text("IF YOU LIKE THIS", Modifier.parity("share-card.similar-title").padding(bottom = 8.dp), color = paletteColor(Palette.TEXT_FAINT), fontSize = 13.sp, lineHeight = 18.sp,
            fontWeight = FontWeight.W700, letterSpacing = 0.06.em)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (act in s.acts) {
                val go = if (act.queues) null else act.service(s.preferred())
                val tag = if (act.queues) s.tags[act.name] ?: "Queue" else go?.name
                val shape = RoundedCornerShape(10.dp)
                Column(Modifier.parity("share-card.act", Contract.label("share-card.act", 0, act.name)).fillMaxWidth().clip(shape).background(paletteColor(Palette.BG_ELEV_2))
                    .border(1.dp, paletteColor(Palette.BORDER), shape).clickable(enabled = act.queues || go != null) { if (act.queues) s.queue(act, zone) else go?.let { s.open(it.url) } }
                    .heightIn(min = 44.dp).padding(horizontal = 10.dp, vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(act.name, color = paletteColor(Palette.TEXT), fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.W600, maxLines = 1)
                        Text(act.sub, Modifier.weight(1f), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 17.sp, maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        tag?.let {
                            Text(it.uppercase(), Modifier.clip(CircleShape).background(paletteColor(if (act.queues) Palette.ACCENT else Palette.BG_ELEV)).padding(horizontal = 8.dp, vertical = 3.dp),
                                color = paletteColor(if (act.queues) Palette.ON_ACCENT else Palette.TEXT_DIM), fontSize = 11.sp, lineHeight = 13.sp, fontWeight = FontWeight.W700, letterSpacing = 0.04.em)
                        }
                    }
                    if (act.reason.isNotEmpty()) Text(act.reason, color = paletteColor(Palette.TEXT_FAINT), fontSize = 11.5.sp, lineHeight = 16.sp, maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/**
 * What the card holds and does, as the page's share-card*.js: the card drawn (and its PNG, for Share and Download),
 * the links under it, the acts, the default service, what Download says for a moment after, what went wrong.
 */
internal class ShareState(private val title: String, private val artist: String, private val imageKey: String?, private val client: () -> ServerClient?,
                          private val scope: CoroutineScope, private val context: Context) {
    var card by mutableStateOf<Bitmap?>(null)
    var failed by mutableStateOf(false)
    var links by mutableStateOf<List<ShareLink>>(emptyList())
    var acts by mutableStateOf<List<SimilarAct>>(emptyList())
    var tags by mutableStateOf<Map<String, String>>(emptyMap())
    var service by mutableStateOf(ShareKept.service ?: WallPrefs.parse(NativeShell.prefs).shareService)
    var saved by mutableStateOf("Download")
    var err by mutableStateOf<String?>(null)
    private var png: ByteArray? = null
    private val bridge get() = (context as? Activity)?.let { ShareBridge(it) }

    /** The default of the services on the card. */
    fun preferred(): String = ShareCard.preferred(service, links.filter { !it.review }.map { it.id })

    /** The card from the cache's answer first, then the full one's if it says more; the links, the Qobuz chip's own address, the acts. */
    suspend fun load() {
        val c = client() ?: return
        val lib = LibraryClient(c)
        val painter = ShareCardPainter(context)
        try {
            withContext(Dispatchers.IO) {
                val full = async { runCatching { lib.shareCard(title, artist, false) }.getOrNull() }
                val cover = async { imageKey?.let { k -> runCatching { c.bytes(c.imageUrl(k, 800)).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull() } }
                val logo = async { runCatching { c.bytes(c.address.baseUrl + "/icons/duck-tile.png").let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull() }
                val first = runCatching { lib.shareCard(title, artist, true) }.getOrNull() ?: CardFields.NONE
                paint(painter, first, cover.await(), logo.await())
                scope.launch { upgradeQobuz(lib) }
                scope.launch { acts = withContext(Dispatchers.IO) { runCatching { lib.similarActs(artist) }.getOrDefault(emptyList()) } }
                val later = full.await() ?: return@withContext
                if (later.signature != first.signature) paint(painter, later, cover.await(), logo.await())
            }
        } catch (e: Exception) {
            if (card == null) failed = true
            err = e.message ?: e.toString()
        }
    }

    private suspend fun paint(painter: ShareCardPainter, f: CardFields, cover: Bitmap?, logo: Bitmap?) {
        val bmp = painter.draw(title, artist, f.releaseRaw, f.reviewText, f.reviewSource, f.score, f.bestNew, cover, logo)
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        withContext(Dispatchers.Main) { png = bytes; card = bmp; if (f.links.isNotEmpty() || links.isEmpty()) links = f.links }
    }

    /** The Qobuz chip on the album's own page, which opens Qobuz's app, where it is the default and found (a search link stays otherwise). */
    private suspend fun upgradeQobuz(lib: LibraryClient) {
        val q = links.firstOrNull { it.id == "qobuz" && !it.review } ?: return
        if (q.url.startsWith("https://open.qobuz.com") || preferred() != "qobuz") return
        val url = withContext(Dispatchers.IO) { runCatching { lib.qobuzLink(title, artist) }.getOrNull() } ?: return
        links = links.map { if (it === q) it.copy(url = url) else it }
    }

    fun open(url: String) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }

    /** A chip held: its service the default from now on, here and on the page. */
    fun prefer(link: ShareLink) {
        service = link.id; ShareKept.service = link.id
        NativeShell.keep("shareService", link.id)
        Toast.makeText(context, "${link.name.ifEmpty { link.id }} is now the default", Toast.LENGTH_SHORT).show()
        scope.launch { client()?.let { upgradeQobuz(LibraryClient(it)) } }
    }

    fun share() { val b = png ?: return; bridge?.share(b, ShareCard.fileName(title, artist), "image/png") }

    /** Saved to Pictures/Mandarin; Download says how it went for a moment. */
    fun download() {
        val b = png ?: return
        val br = bridge ?: return
        scope.launch {
            val ok = withContext(Dispatchers.IO) { br.save(b, ShareCard.fileName(title, artist), "image/png") }
            saved = if (ok) "Saved to Pictures" else "Couldn’t save"
            delay(2500)
            saved = "Download"
        }
    }

    /** An act in the library queued in [zone], by the library's own names. */
    fun queue(act: SimilarAct, zone: String) {
        val c = client() ?: return
        val offset = act.offset ?: return
        if (zone.isEmpty()) { Toast.makeText(context, "Pick a zone first", Toast.LENGTH_SHORT).show(); return }
        if (tags[act.name] == "…") return
        tags = tags + (act.name to "…")
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.playAlbum(offset, act.libraryTitle.ifEmpty { act.album }, act.librarySubtitle, zone, "queue") } }
            tags = tags + (act.name to if (r.isSuccess) "Queued" else "Queue")
            Toast.makeText(context, if (r.isSuccess) "Queued ${act.album.ifEmpty { act.name }}" else "Couldn't queue that", Toast.LENGTH_SHORT).show()
        }
    }
}
