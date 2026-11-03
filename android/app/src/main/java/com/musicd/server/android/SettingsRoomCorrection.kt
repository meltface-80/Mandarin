package com.musicd.server.android

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musicd.server.client.Contract
import com.musicd.server.client.DevicePage
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Room correction (item 252), as the page's: the impulse response loaded for this renderer or sound device (its name
 * and facts), or a word on what one is; a WAV picked on the phone and sent to the server as it is, or the one there
 * taken off. The server answers with the device, handed to [onDevice].
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun RoomCorrection(d: DevicePage, client: () -> ServerClient?, busy: Boolean, onDevice: (JSONObject) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    fun send(call: (ServerClient) -> JSONObject, said: String) {
        val c = client() ?: return
        working = true
        scope.launch {
            withContext(Dispatchers.IO) { runCatching { call(c) } }
                .onSuccess { onDevice(it); setupToast(context, said) }
                .onFailure { setupToast(context, com.musicd.server.client.Failure.said(it, "Couldn't reach the server")) }
            working = false
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val bytes = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
        if (bytes == null) { setupToast(context, "Couldn't read that file."); return@rememberLauncherForActivityResult }
        val name = runCatching { context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } }.getOrNull()
        send({ it.loadImpulse(d.id, name ?: "Impulse response", bytes) }, "Room correction loaded")
    }
    CapGroup("Room correction", Modifier.parity("settings-device.cap-label")) {
        val meta = d.irMeta
        if (meta != null) {
            val box = RoundedCornerShape(10.dp)
            Column(Modifier.padding(top = 8.dp).fillMaxWidth().clip(box).background(paletteColor(Palette.BG_ELEV_2)).border(1.dp, paletteColor(Palette.BORDER), box).padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text(d.irName, Modifier.parity("settings-device.ir-name"), color = paletteColor(Palette.TEXT), fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.W600)
                Text(meta, Modifier.parity("settings-device.ir-meta").padding(top = 2.dp), color = paletteColor(Palette.TEXT_DIM), fontSize = 12.5.sp, lineHeight = 17.sp)
            }
        } else DeviceNote(DevicePage.IR_NONE, Modifier.parity("settings-device.note"))
        FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SetupButton(d.irLoad, false, Modifier.parity("settings-device.ir-load", Contract.label("settings-device.ir-load", if (meta != null) 1 else 0))
                .clickable(enabled = !busy && !working) { pick.launch("audio/*") })
            if (meta != null) SetupButton("Remove", false, Modifier.parity("settings-device.ir-remove", Contract.label("settings-device.ir-remove"))
                .clickable(enabled = !busy && !working) { send({ it.removeImpulse(d.id) }, "Room correction removed") })
        }
    }
}
