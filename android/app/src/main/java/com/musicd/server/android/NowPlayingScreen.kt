package com.musicd.server.android

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
internal fun NowPlayingScreen(zoneId: String, client: () -> ServerClient?, onBack: () -> Unit) {
    var view by remember { mutableStateOf<NowPlayingView?>(null) }
    var answered by remember { mutableStateOf(false) }
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

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Text("‹", fontSize = 32.sp, color = MaterialTheme.colorScheme.onSurface) }
                Text(view?.zoneName.orEmpty(), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val v = view
            if (v == null) {
                Spacer(Modifier.weight(1f))
                Text(if (answered) "Nothing is playing here" else "", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                return@Column
            }
            Spacer(Modifier.weight(1f))
            Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
                cover?.let { Image(it, contentDescription = v.album, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            }
            Spacer(Modifier.height(24.dp))
            Text(v.title, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(v.artist, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(v.album, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(16.dp))
            var dragging by remember { mutableStateOf<Float?>(null) }
            val length = v.lengthSeconds
            Slider(
                value = dragging ?: v.fraction(now),
                onValueChange = { dragging = it },
                onValueChangeFinished = {
                    val f = dragging
                    dragging = null
                    if (f != null && length != null) act { it.seek(zoneId, f * length) }
                },
                enabled = length != null
            )
            Row(Modifier.fillMaxWidth()) {
                Text(NowPlayingView.clock(dragging?.let { it * (length ?: 0.0) } ?: v.position(now)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                Text(length?.let { NowPlayingView.clock(it) }.orEmpty(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { act { it.control(zoneId, "previous") } }, enabled = v.canPrevious) { Text("⏮", fontSize = 28.sp) }
                FilledIconButton(onClick = { act { it.control(zoneId, "playpause") } }, modifier = Modifier.size(72.dp), shape = CircleShape) {
                    Text(if (v.playing) "❚❚" else "▶", fontSize = 28.sp)
                }
                IconButton(onClick = { act { it.control(zoneId, "next") } }, enabled = v.canNext) { Text("⏭", fontSize = 28.sp) }
            }
            Spacer(Modifier.weight(1f))
        }
    }
}
