package com.musicd.server.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * Now Playing (item 430): the screen the app opens on. The track Mandarin plays here, its cover large, its title in the
 * serif, the artist in brass, the album, the format the DAC is fed, and the DAC at the foot; no controls (Mandarin plays
 * it). Nothing playing, a quiet placeholder. Never played yet, how to set the Bridge up: the settings cog circled in
 * brass, a line down from it to the help. The cog, top left, opens Settings (StatusScreen.kt). It fits a 360×640 screen
 * without scrolling, inside the system bars. What it shows is NowPlaying.kt's.
 */

private val COG_START = 12.dp   // the cog's box from the left; its centre is COG_START + COG / 2 (the line's x)
private val COG = 56.dp
private val Placeholder = Color(0xFF23262A)
private val Note = Color(0xFF4B4F55)
private val Body = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp)

@Composable
internal fun NowPlayingScreen(np: NowPlaying, name: String, openSettings: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Graphite).safeDrawingPadding()) {
        Top(np.firstRun, openSettings)
        val t = np.track
        when {
            np.firstRun -> FirstRun(np, name)
            t != null -> Playing(t, np.format)
            else -> Idle(np.idle, Modifier.weight(1f).fillMaxWidth())
        }
        Text(np.dac, Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 22.dp), color = Faint, fontFamily = Manrope,
            fontWeight = FontWeight.SemiBold, fontSize = 13.sp, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The top: the settings cog (circled in brass on first run) and the app's name. */
@Composable
private fun Top(ringed: Boolean, openSettings: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(64.dp)) {
        Text("MANDARIN BRIDGE", Modifier.align(Alignment.Center), color = Muted, fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 2.sp)
        val ring = if (!ringed) Modifier else Modifier.drawBehind {
            val r = size.minDimension / 2 - 1.5.dp.toPx()
            drawCircle(Brass.copy(alpha = 0.18f), radius = r + 4.5.dp.toPx(), style = Stroke(6.dp.toPx()))   // the soft glow
            drawCircle(Brass, radius = r, style = Stroke(3.dp.toPx()))
        }
        Box(Modifier.align(Alignment.CenterStart).padding(start = COG_START).size(COG).then(ring), contentAlignment = Alignment.Center) {
            IconButton(openSettings, Modifier.size(48.dp)) { Icon(Cog, contentDescription = "Settings", modifier = Modifier.size(26.dp), tint = Brass) }
        }
    }
}

/** Never played yet: a brass line from the cog to the help, the help, and the placeholder. */
@Composable
private fun ColumnScope.FirstRun(np: NowPlaying, name: String) {
    Canvas(Modifier.fillMaxWidth().weight(0.35f)) {
        val x = (COG_START + COG / 2).toPx()
        val dot = 6.5.dp.toPx()
        val end = size.height - dot
        if (end > 0) drawLine(Brass, Offset(x, -6.dp.toPx()), Offset(x, end), strokeWidth = 3.dp.toPx())
        drawCircle(Brass, radius = dot, center = Offset(x, end))
    }
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.padding(horizontal = 20.dp).fillMaxWidth().background(Card, shape).border(2.dp, Brass, shape)
        .padding(start = 20.dp, end = 18.dp, top = 16.dp, bottom = 14.dp)) {
        Text(NowPlaying.SETUP_TITLE, Modifier.semantics { heading() }, color = Ink, fontFamily = Manrope, fontWeight = FontWeight.ExtraBold, fontSize = 19.sp)
        Text(NowPlaying.SETUP_LEAD, Modifier.padding(top = 8.dp), color = Soft, style = Body)
        NowPlaying.steps(name).forEachIndexed { i, step ->
            Row(Modifier.padding(top = if (i == 0) 10.dp else 6.dp)) {
                Text("${i + 1}.", Modifier.width(20.dp), color = Ink, style = Body)
                Text(buildAnnotatedString {
                    for ((words, strong) in step) if (strong) withStyle(SpanStyle(color = BrassText, fontWeight = FontWeight.Bold)) { append(words) } else append(words)
                }, color = Ink, style = Body)
            }
        }
    }
    Idle(np.idle, Modifier.weight(0.65f).fillMaxWidth())
}

/** Nothing playing: a dashed disc, where there's room for it, and the words. */
@Composable
private fun Idle(words: String, modifier: Modifier) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val disc = minOf(96.dp, maxHeight - 56.dp)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (disc >= 40.dp) Disc(disc)
            Text(words, Modifier.padding(top = 14.dp), color = Faint, fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

@Composable
private fun Disc(side: Dp) {
    Box(Modifier.size(side).drawBehind {
        val w = 2.dp.toPx()
        drawCircle(Rule, radius = size.minDimension / 2 - w / 2, style = Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(7.dp.toPx(), 6.dp.toPx()))))
    }, contentAlignment = Alignment.Center) { Text("♪", color = Note, fontSize = (side.value * 0.4f).sp) }
}

/** A track: its cover as large as the screen allows, then what it is and the format it plays at. */
@Composable
private fun ColumnScope.Playing(t: NowPlaying.Track, format: String?) {
    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp, vertical = 6.dp), contentAlignment = Alignment.Center) {
        Art(t.art, Modifier.size(minOf(maxWidth, maxHeight)))
    }
    Column(Modifier.fillMaxWidth().padding(start = 28.dp, end = 28.dp, top = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(t.title, Modifier.semantics { heading() }, color = Ink, fontFamily = YoungSerif, fontSize = 27.sp, lineHeight = 32.sp,
            textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (t.artist.isNotEmpty()) Text(t.artist, Modifier.padding(top = 8.dp), color = Brass, fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 17.sp,
            textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (t.album.isNotEmpty()) Text(t.album, Modifier.padding(top = 4.dp), color = Muted, fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 15.sp,
            textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (format != null) Text(format, Modifier.padding(top = 16.dp).border(1.dp, Rule, RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 6.dp),
            color = Color(0xFFC9CBCF), fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 12.sp)
    }
}

/** The cover at [url], fetched once an album (Cover.kt) off the main thread; a plain square while there is none. */
@Composable
private fun Art(url: String, modifier: Modifier) {
    var shown by remember { mutableStateOf<Pair<String, ImageBitmap>?>(null) }
    LaunchedEffect(url) {
        if (shown?.let { NowPlaying.sameCover(it.first, url) } == true) return@LaunchedEffect
        shown = null
        if (url.isEmpty()) return@LaunchedEffect
        shown = withContext(Dispatchers.IO) { Cover.fetch(url) }?.let { url to it.asImageBitmap() }
    }
    val shape = RoundedCornerShape(14.dp)
    val pic = shown?.second
    if (pic != null) Image(pic, contentDescription = "Album cover", modifier = modifier.clip(shape), contentScale = ContentScale.Crop)
    else Box(modifier.clip(shape).background(Placeholder), contentAlignment = Alignment.Center) { Text("♪", color = Note, fontSize = 64.sp) }
}

/** A path of the 24-unit icons' kind, stroked 2 units wide with round ends, as an icon. */
private fun stroked(name: String, vararg paths: String): ImageVector = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
    for (p in paths) addPath(pathData = addPathNodes(p), fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
}.build()

/** The settings cog: its hub and its teeth. */
private val Cog: ImageVector = stroked("Cog", "M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
    "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09" +
        "A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3" +
        "a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3" +
        "a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21" +
        "a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z")

/** Back: a chevron to the left. */
internal val BackArrow: ImageVector = stroked("Back", "M15 18l-6-6 6-6")
