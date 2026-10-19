package com.musicd.server.android

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.Credit
import com.musicd.server.client.NowPlayingView
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Now playing, native (stage N2 of docs/specs/plan-android-native.md, a
 * preview: Settings → Setup → UI Settings, on this phone). The room's track,
 * its cover, where it is, and its transport. The room is followed as the
 * notification follows it: each answer waits on the next change (the server
 * holds it up to 20 s); between answers the clock moves the track on.
 */
@Composable
internal fun NowPlayingScreen(zoneId: String, client: () -> ServerClient?, onBack: () -> Unit, onRoom: (String) -> Unit, onPage: (String, String?) -> Unit) {
    var view by remember { mutableStateOf<NowPlayingView?>(null) }
    var answered by remember { mutableStateOf(false) }
    var queueTab by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val scope = rememberCoroutineScope()
    BackHandler(onBack = onBack)

    LaunchedEffect(zoneId) {
        var revision: Long? = null
        while (isActive) {
            val c = client()
            val st = if (c == null) null else withContext(Dispatchers.IO) { runCatching { c.zoneState(zoneId, revision) }.getOrNull() }
            if (st == null) { delay(2000); continue }
            revision = st.revision
            view = NowPlayingView.of(st, System.currentTimeMillis())
            answered = true
        }
    }
    LaunchedEffect(view) {
        now = System.currentTimeMillis()
        while (view?.playing == true) { delay(500); now = System.currentTimeMillis() }
    }

    val key = view?.imageKey
    var cover by remember(key) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(key) {
        val c = client() ?: return@LaunchedEffect
        if (key == null) return@LaunchedEffect
        cover = withContext(Dispatchers.IO) {
            runCatching { c.bytes(c.imageUrl(key, 1000)).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull()
        }
    }

    // A command to the room; the answer it waits on shows what it did.
    fun act(block: (ServerClient) -> Unit) {
        val c = client() ?: return
        scope.launch(Dispatchers.IO) { runCatching { block(c) } }
    }

    // Each item is the screens contract's (docs/specs/screens.json), keyed as
    // the page's is: tools/quality/parity.js holds this screen to the page's.
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            // The corner buttons and the tabs are the Queue's too (docs/specs/screens.json, queue).
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack, modifier = Modifier.parity("now-playing.back queue.back", Contract.label("now-playing.back"))) {
                    Text("‹", fontSize = 32.sp, color = MaterialTheme.colorScheme.onSurface)
                }
                Spacer(Modifier.weight(1f))
                Tab(selected = !queueTab, onClick = { queueTab = false },
                    modifier = Modifier.parity("now-playing.tab-now-playing queue.tab-now-playing", Contract.label("now-playing.tab-now-playing")).width(120.dp),
                    text = { Text(Contract.label("now-playing.tab-now-playing").uppercase(), fontSize = 12.sp, maxLines = 1) },
                    selectedContentColor = MaterialTheme.colorScheme.onSurface, unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant)
                Tab(selected = queueTab, onClick = { queueTab = true },
                    modifier = Modifier.parity("now-playing.tab-queue queue.tab-queue", Contract.label("now-playing.tab-queue")).width(80.dp),
                    text = { Text(Contract.label("now-playing.tab-queue").uppercase(), fontSize = 12.sp, maxLines = 1) },
                    selectedContentColor = MaterialTheme.colorScheme.onSurface, unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { onPage("share", null) }, enabled = view != null,
                    modifier = Modifier.parity("now-playing.share queue.share", Contract.label("now-playing.share"))) {
                    Icon(painterResource(R.drawable.np_share), contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
                }
            }
            if (queueTab) {
                QueueScreen(zoneId, client, changed = view?.answeredAtMs, modifier = Modifier.weight(1f))
                return@Column
            }
            val v = view
            if (v == null) {
                Spacer(Modifier.weight(1f))
                Text(if (answered) "Nothing is playing here" else "", Modifier.parity("now-playing.track"),
                    style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                return@Column
            }
            Spacer(Modifier.weight(1f))
            Box(Modifier.parity("now-playing.cover").fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
                cover?.let { Image(it, contentDescription = v.album, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            }
            Spacer(Modifier.height(24.dp))
            Text(v.title, Modifier.parity("now-playing.track"), style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            // The artists as the page links them: each with a page of their own a tap away, the rest plain.
            Row(horizontalArrangement = Arrangement.Center) {
                val credits = v.artists.ifEmpty { listOf(Credit(v.artist, false)) }
                credits.forEachIndexed { i, c ->
                    val name = if (i > 0) " · ${c.name}" else c.name
                    if (c.linkable) Text(name, Modifier.parity("now-playing.artist", Contract.label("now-playing.artist", 0, c.name)).clickable { onPage("artist", c.name) },
                        style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.secondary, maxLines = 1)
                    else Text(name, Modifier.parity("now-playing.artist"), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
                }
            }
            Text(v.album, Modifier.parity("now-playing.album", Contract.label("now-playing.album", 0, v.album)).clickable { onPage("album", null) },
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            v.formatText?.let {
                Text(it, Modifier.parity("now-playing.format").padding(top = 6.dp).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp))
                    .padding(horizontal = 8.dp, vertical = 2.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(16.dp))
            SeekBar(v, now, client) { to -> act { it.seek(zoneId, to) } }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                val on = MaterialTheme.colorScheme.secondary
                val off = MaterialTheme.colorScheme.onSurfaceVariant
                IconButton(onClick = { act { it.zoneSettings(zoneId, shuffle = !v.shuffle) } },
                    modifier = Modifier.parity("now-playing.shuffle", Contract.label("now-playing.shuffle", v.shuffleState))) {
                    Icon(painterResource(R.drawable.np_shuffle), contentDescription = null, tint = if (v.shuffle) on else off)
                }
                IconButton(onClick = { act { it.control(zoneId, "previous") } }, enabled = v.canPrevious,
                    modifier = Modifier.parity("now-playing.previous", Contract.label("now-playing.previous"))) {
                    Icon(painterResource(R.drawable.np_previous), contentDescription = null, tint = on)
                }
                FilledIconButton(onClick = { act { it.control(zoneId, "playpause") } }, shape = CircleShape,
                    modifier = Modifier.parity("now-playing.playpause", Contract.label("now-playing.playpause", if (v.playing) 1 else 0)).size(72.dp)) {
                    Icon(painterResource(if (v.playing) R.drawable.np_pause else R.drawable.np_play), contentDescription = null, modifier = Modifier.size(32.dp))
                }
                IconButton(onClick = { act { it.control(zoneId, "next") } }, enabled = v.canNext,
                    modifier = Modifier.parity("now-playing.next", Contract.label("now-playing.next"))) {
                    Icon(painterResource(R.drawable.np_next), contentDescription = null, tint = on)
                }
                IconButton(onClick = { act { it.zoneSettings(zoneId, loop = v.loopNext) } },
                    modifier = Modifier.parity("now-playing.repeat", Contract.label("now-playing.repeat", v.loopState))) {
                    Box {
                        Icon(painterResource(R.drawable.np_repeat), contentDescription = null, tint = if (v.loopState > 0) on else off)
                        if (v.loop == "loop_one") Text("1", Modifier.align(Alignment.TopEnd), fontSize = 9.sp, color = on)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                PlayOnMenu(zoneId, client, ::act, onRoom, onPage)
                Spacer(Modifier.weight(1f))
                VolumeMenu(zoneId, v, ::act)
            }
            Spacer(Modifier.weight(1f))
        }
    }
}
