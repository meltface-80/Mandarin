package com.musicd.server.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.ServerClient

/**
 * An album's booklet, natively (docs/specs/screens.json, booklet), as the
 * page's viewer (public/app/page-state.js, style.css `.booklet-viewer`): over
 * everything on its near-black ground, the brass Close, the booklet's name
 * and which page is at the top ("3 / 12"), and the pages one under another,
 * each drawn by the server as wide as the screen (up to 1100px), square
 * until it comes. Back closes it, back to the album.
 */
@Composable
internal fun BookletScreen(offset: Long, id: String, name: String, pages: Int, client: () -> ServerClient?, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val config = LocalConfiguration.current
    val density = LocalDensity.current
    // Drawn as wide as it is shown, on this screen's pixels, as the page asks.
    val width = remember(config.screenWidthDp) { with(density) { minOf(config.screenWidthDp.dp.toPx(), 1100f * density.density).toInt() } }
    val list = rememberLazyListState()
    val brass = MaterialTheme.colorScheme.primary
    Surface(Modifier.fillMaxSize(), color = Color(0xFF0A0C10)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 10.dp, end = 12.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledIconButton(onClick = onBack, colors = IconButtonDefaults.filledIconButtonColors(containerColor = brass, contentColor = MaterialTheme.colorScheme.onPrimary),
                    modifier = Modifier.parity("booklet.close", Contract.label("booklet.close")).size(40.dp)) {
                    Icon(painterResource(R.drawable.np_close), contentDescription = null, modifier = Modifier.size(20.dp))
                }
                Text(name, Modifier.parity("booklet.title").weight(1f), color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                // The page counted is the one at the top of what is in view, as the page counts it.
                Text("${list.firstVisibleItemIndex + 1} / $pages", Modifier.parity("booklet.count"), color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp)
            }
            LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                items(pages) { i -> BookletPage(client()?.bookletPageUrl(offset, id, i + 1, width), client) }
            }
        }
    }
}

/** One page: square and faintly lit until drawn, then its own shape. */
@Composable
private fun BookletPage(url: String?, client: () -> ServerClient?) {
    val image = rememberImage(url, client)
    var ratio by remember(url) { mutableStateOf(1f) }
    image?.let { if (it.height > 0) ratio = it.width.toFloat() / it.height }
    Box(Modifier.parity("booklet.page").fillMaxWidth().widthIn(max = 1100.dp).aspectRatio(ratio).background(Color.White.copy(alpha = 0.06f))) {
        image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
    }
}
