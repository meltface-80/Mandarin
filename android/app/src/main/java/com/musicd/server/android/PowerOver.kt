package com.musicd.server.android

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.musicd.server.client.Palette
import com.musicd.server.client.Power
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * Restart and Shut down from the side menu's power button, natively (bug list item 96), as the page's power.js does them:
 * the question first (the page's yes-or-no sheet), then the call, then the screen over everything while the server is
 * away (docs/specs/screens.json, power-cover; style.css .power-cover), looked for again every second (every five once
 * shut down) and gone once it answers after having been away, the page under the app read afresh with it. Before, the
 * page was put in front to ask and to say so.
 */
internal object PowerKept {
    /** "power-restart" or "power-shutdown", asked for from the menu; none. */
    val asking = mutableStateOf<String?>(null)
}

/** The question, and the screen while the server is away, over whatever screen is on ([client]: the server's). */
@Composable
internal fun PowerOver(client: () -> ServerClient?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var what by PowerKept.asking
    var power by remember { mutableStateOf<JSONObject?>(null) }
    var cover by remember { mutableStateOf<Power.Cover?>(null) }
    // Shut down's question says how the server is started again: what the server says of it, read first.
    LaunchedEffect(what) {
        if (what == null) return@LaunchedEffect
        val c = client() ?: return@LaunchedEffect
        withContext(Dispatchers.IO) { runCatching { c.getJson("/api/system/power") }.getOrNull() }?.let { power = it }
    }
    what?.let { w ->
        ConfirmDialog(Power.ask(w, power)) { yes ->
            what = null
            val c = client()
            if (yes && c != null) scope.launch {
                withContext(Dispatchers.IO) { runCatching { c.post(Power.path(w), JSONObject()) } }
                    .onSuccess { cover = Power.cover(w, it, power) }
                    .onFailure { Toast.makeText(context, com.musicd.server.client.Failure.said(it, "The server said no"), Toast.LENGTH_SHORT).show() }
            }
        }
    }
    val shown = cover ?: return
    // Looked for again until it is back; then the screen goes, and the page under the app is read afresh, as the page reloads.
    LaunchedEffect(shown) {
        val watch = Power.BackWatch()
        while (true) {
            delay(shown.everyMs)
            val c = client() ?: continue
            val ok = withContext(Dispatchers.IO) { runCatching { c.health() }.isSuccess }
            if (watch.seen(ok)) { cover = null; HomeKept.reset(); break }
        }
    }
    // A window of its own over the whole screen, as the page's covers it: no tap reaches what is under it, Back leaves it be.
    Dialog(onDismissRequest = { }, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Box(Modifier.fillMaxSize().background(paletteColor(Palette.BG)).padding(16.dp), contentAlignment = Alignment.Center) {
            Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(shown.title, Modifier.parity("power-cover.title").padding(bottom = 10.dp), color = paletteColor(Palette.ACCENT_TEXT), fontSize = 21.6.sp,
                    lineHeight = 29.sp, fontWeight = FontWeight.W700, textAlign = TextAlign.Center)
                if (shown.text.isNotEmpty()) Text(shown.text, Modifier.parity("power-cover.text"), color = paletteColor(Palette.TEXT_DIM), fontSize = 16.sp, lineHeight = 24.sp,
                    textAlign = TextAlign.Center)
            }
        }
    }
}
