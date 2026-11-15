package com.musicd.server.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.musicd.server.client.UsbView

/*
 * Settings, opened from Now Playing's cog (item 430), Back returning there: the player and the server, the
 * DAC as Mandarin's page shows it (Settings → Audio Devices → this phone →
 * USB DAC, through core's UsbView), the USB settings the driver has, and
 * what keeps the device awake.
 */
@Composable
internal fun StatusScreen(activity: MainActivity, s: MainActivity.Snapshot, crash: String?, again: () -> Unit, back: () -> Unit) {
    val u = s.usb
    var crashShown by remember { mutableStateOf(crash != null) }
    Column(Modifier.fillMaxWidth().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp)) {
        // Back to Now Playing (item 430), the chevron in line with the words below it.
        Row(Modifier.offset(x = (-12).dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(back) { Icon(BackArrow, contentDescription = "Back to Now Playing", tint = MaterialTheme.colorScheme.primary) }
            Text("Settings", Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineMedium)
        }
        Text(s.statusLine, Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
        if (s.title != null) {
            Text(s.title, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.titleMedium)
            Text(listOfNotNull(s.artist, s.album).joinToString(" — "), style = MaterialTheme.typography.bodyMedium)
        }
        if (crashShown && crash != null) {
            Note("The app stopped last time:\n" + crash.take(600), danger = true)
            Row { TextButton({ copy(activity, "Mandarin Bridge crash", crash) }) { Text("Copy details") }; TextButton({ crashShown = false }) { Text("Close") } }
        }

        Section("The Bridge")
        Line("It finds Mandarin on the network by itself: Settings → Audio Devices lists “${Store.friendlyName(activity)}”. Switch it on there, pick it as the speaker, and play.")
        Line(s.server?.let { "Played by Mandarin at $it, over SlimProto." } ?: "Looking for Mandarin on the network (SlimProto, port 3483)…")
        Line(s.address?.let { "At $it. The DAC’s capabilities, as read: $it/dac.json" } ?: "No network address yet.")
        if (s.lastHeard > 0) Line("Last heard from Mandarin ${ago(s.lastHeard)}.")
        var name by remember { mutableStateOf(Store.friendlyName(activity)) }
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Name on the network") }, singleLine = true)
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton({ Store.setFriendlyName(activity, name); DacService.stop(activity); DacService.start(activity); again() }, enabled = name.isNotBlank() && name.trim() != Store.friendlyName(activity)) { Text("Rename") }
            OutlinedButton({ DacService.stop(activity); DacService.start(activity); again() }) { Text("Restart the Bridge") }
        }

        Section("USB DAC")
        if (!u.attached) Note(UsbView.NOTHING)
        else {
            Line(u.name, strong = true)
            if (u.devices.size > 1) {
                // More than one USB audio device (a FiiO R7's own DAC is one): the one to play through, the driver's own choice marked.
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (c in u.devices) FilterChip(u.chosenDevice == c.value, { Store.setUsbDevice(activity, c.value); UsbDriver.close(); UsbDac.refresh(activity); again() }, { Text(c.words) })
                }
                Note("Which USB audio device to play through. The DAC plugged into the port is chosen by itself over the device’s own; tap the other to change.")
            }
            if (!u.permission) {
                Note(UsbView.ASK)
                u.error?.let { Note(it, danger = true) }
                Button({ UsbDac.requestPermission(activity) }, Modifier.padding(top = 4.dp)) { Text("Allow") }
            } else if (!u.hasInfo) Note(u.error ?: UsbView.READING, danger = u.error != null)
            else {
                Cap("Class", u.classLine)
                Cap("Sample rates (kHz)", if (u.rates.isEmpty()) "not stated" else u.rates.joinToString(", ") { com.musicd.server.client.DevicePage.rateWord(it) })
                Cap("Bit depth", if (u.bits.isEmpty()) "not stated" else u.bits.joinToString(", ") { "$it-bit" })
                Cap("DSD", u.dsdLine)
                Cap("Volume", u.volumeLine)
                u.clock?.let { Cap("Clock now", it) }
                u.streaming?.let { Cap("Streaming now", it) }
                u.streamError?.let { Note(it, danger = true) }

                Spacer(Modifier.height(8.dp))
                ToggleRow("Fixed volume", u.fixed) { Store.setUsbFixed(activity, it); UsbDriver.settingsChanged(); evented(); again() }
                Note(u.fixedNote)
                if (!u.fixed) {
                    var limit by remember(u.limit) { mutableFloatStateOf(u.limit.toFloat()) }
                    Line("Volume limit ${limit.toInt()}% · volume now ${s.volume}%")
                    Slider(limit, { limit = (Math.round(it / 5f) * 5).toFloat() }, Modifier.fillMaxWidth(), valueRange = 10f..100f, steps = 17,
                        onValueChangeFinished = { Store.setUsbLimit(activity, limit.toInt()); UsbDriver.settingsChanged(); evented(); again() })
                    Note(UsbView.LIMIT_NOTE + " The volume itself is set from Mandarin, or with this device's volume buttons while the app is in front.")
                }
                if (u.showDsd) {
                    Line("DSD", strong = true)
                    Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (c in u.dsdChoices) FilterChip(u.dsdMode == c.value, { Store.setUsbDsd(activity, c.value); DacService.current?.let { d -> d.main.post { d.usbChanged() } }; again() }, { Text(c.words) })
                    }
                    s.caps?.let { c -> Note("Advertised to Mandarin: " + c.rates.joinToString(", ") { com.musicd.server.client.DevicePage.rateWord(it) } + " kHz · " + c.bits.joinToString(", ") { "$it-bit" } +
                        (if (c.dsd.isNotEmpty()) " · DSD" + c.dsd.joinToString(", DSD") else " · no DSD")) }
                    Note(u.dsdNote)
                }
                Row(Modifier.padding(top = 8.dp)) {
                    OutlinedButton({ copy(activity, "Mandarin Bridge DAC", UsbDac.diagnostics(activity)) }) { Text("Copy diagnostics") }
                }
                Note(UsbView.DIAGNOSTICS_NOTE)
            }
            u.error?.takeIf { u.permission }?.let { Note(it, danger = true) }
        }

        OwnDacSection(activity, again)

        Section("Keep awake")
        Line(if (s.awake) "The device is held awake: the CPU and Wi-Fi never doze while the Bridge runs." else "The Bridge isn't running, so nothing holds the device awake.")
        ToggleRow("Keep the screen on while this app is in front", Store.keepScreenOn(activity)) { Store.setKeepScreenOn(activity, it); activity.keepScreen(it); again() }
        ToggleRow("Start the Bridge when the device starts", Store.startOnBoot(activity)) { Store.setStartOnBoot(activity, it); again() }
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (s.batteryExempt) "Battery optimisation is off for this app." else "Battery optimisation is on: Android may still stop the Bridge after hours idle.", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            if (!s.batteryExempt) TextButton({ activity.askBatteryExemption() }) { Text("Turn off") }
        }
        Note("On a FiiO R7 also set Settings → Display → Screen timeout as you like it: the screen may go off, the device stays awake.")
        Spacer(Modifier.height(24.dp))
        // Which Mandarin the driver came from: its version and the commit, packed into the APK by app/build.gradle.kts.
        Text("Mandarin Bridge ${BuildConfig.VERSION_NAME} · driver from Mandarin ${BuildConfig.MANDARIN_VERSION}", style = MaterialTheme.typography.bodySmall)
    }
}

/** "just now", "3 min ago", "2 h ago". */
private fun ago(at: Long): String {
    val s = (System.currentTimeMillis() - at) / 1000
    return when { s < 5 -> "just now"; s < 60 -> "$s s ago"; s < 3600 -> "${s / 60} min ago"; else -> "${s / 3600} h ago" }
}

/** A USB setting changed: Mandarin told again what it plays (a hello). */
private fun evented() { DacService.current?.let { d -> d.main.post { if (d.ready) d.slim.rehello() } } }

@Composable private fun Section(title: String) {
    HorizontalDivider(Modifier.padding(top = 20.dp, bottom = 12.dp))
    Text(title, style = MaterialTheme.typography.titleLarge)
}

@Composable private fun Line(text: String, strong: Boolean = false) {
    Text(text, Modifier.padding(top = 6.dp), style = if (strong) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium)
}

@Composable private fun Note(text: String, danger: Boolean = false) {
    Text(text, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodySmall,
        color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
}

@Composable private fun Cap(label: String, value: String) {
    Text(label, Modifier.padding(top = 10.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
    Text(value, style = MaterialTheme.typography.bodyMedium)
}

@Composable private fun ToggleRow(label: String, on: Boolean, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(on, set)
    }
}

private fun copy(c: Context, label: String, text: String) {
    runCatching { (c.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, text)) }
        .fold({ Toast.makeText(c, "Copied", Toast.LENGTH_SHORT).show() }, { Toast.makeText(c, "Couldn't copy: ${it.message}", Toast.LENGTH_SHORT).show() })
}

/**
 * This device's own DAC (item 432, OwnDac.kt): played when no DAC is on the USB port, on by itself on a music player's;
 * what Android takes from an app here, and Android's outputs as it lists them, the evidence of how far it goes.
 */
@Composable private fun OwnDacSection(activity: MainActivity, again: () -> Unit) {
    Section("This device's own DAC")
    val on = OwnDac.on(activity)
    ToggleRow("Play through it when no USB DAC is plugged in", on) {
        Store.setOwnDac(activity, it)
        DacService.current?.let { d -> d.main.post { d.usbChanged() } }
        again()
    }
    Note(if (OwnDac.isPlayer(android.os.Build.MANUFACTURER ?: "", android.os.Build.MODEL ?: "", android.os.Build.BRAND ?: "")) OWN_PLAYER else OWN_PHONE)
    if (!on) return
    Line(OwnDac.name(), strong = true)
    // Whether Android's output follows a track's rate (item 433): taking a rate isn't playing at it.
    val out = OwnDac.outputRate()
    Cap("Android's output now", if (out > 0) OwnDac.khz(out) + " kHz" else "not said")
    Cap("Follows a track's rate", when (OwnDac.follows) { true -> "yes: each track at its own rate"; false -> "no: it stays at ${OwnDac.khz(OwnDac.probedRate)} kHz"; null -> "not tried yet" })
    Cap("Audio focus", if (OwnDac.focusHeld) "held by the Bridge" else "not held")
    OwnDac.way?.let { Cap("Played by", it.words) }
    if (OwnDac.reached.size > 1 || (OwnDac.reached.isNotEmpty() && OwnDac.way != null)) Cap("Reaches the DAC at (kHz)", OwnDac.reached.joinToString(", ") { OwnDac.khz(it) })
    if (OwnDac.follows == false) Note(OWN_FIXED.replace("{rate}", OwnDac.khz(OwnDac.probedRate)), danger = true)
    // Each way an app may ask for a track, and what the output did (item 434).
    for (t in OwnDac.tried) Cap(t.way.words + " at " + OwnDac.khz(t.rate), t.error ?: ((if (t.followed) "followed: " else "not followed: ") + OwnDac.khz(t.fed) + " kHz"))
    OutlinedButton({ if (DacService.current?.probeOwnAgain() != true) Toast.makeText(activity, "Not while music plays", Toast.LENGTH_SHORT).show(); again() }, Modifier.padding(top = 4.dp)) { Text("Test again") }
    Cap("Sent by Mandarin at (kHz)", (DacService.current?.caps()?.rates ?: OwnDac.rates).joinToString(", ") { OwnDac.khz(it) })
    Cap("Android takes from an app (kHz)", if (OwnDac.rates.isEmpty()) "none" else OwnDac.rates.joinToString(", ") { OwnDac.khz(it) })
    Cap("Bit depth", "16, 24 (sent as 32-bit float, every bit kept)")
    Cap("DSD", "as PCM, converted by Mandarin")
    Cap("Volume", "this device's own; Mandarin's is fixed at 100%")
    Note(OWN_MQA)
    val outs = OwnDac.outputs(activity)
    if (outs.length() > 0) {
        Line("Android's outputs here", strong = true)
        for (i in 0 until outs.length()) {
            val o = outs.getJSONObject(i)
            val rates = o.getJSONArray("rates"); val enc = o.getJSONArray("encodings")
            val r = if (rates.length() == 0) "any rate" else (0 until rates.length()).joinToString(", ") { OwnDac.khz(rates.getInt(it)) } + " kHz"
            val e = if (enc.length() == 0) "" else " · " + (0 until enc.length()).joinToString(", ") { enc.getString(it) }
            Cap(o.getString("kind") + (o.getString("name").takeIf { it.isNotBlank() }?.let { " ($it)" } ?: ""), r + e)
        }
    }
}

private const val OWN_PLAYER = "A music player: its firmware passes an app's audio on at the track's own rate, unmixed, so the Bridge plays to its DAC untouched, at each track's rate. A USB DAC plugged in is played instead."
private const val OWN_PHONE = "On a phone, Android mixes an app's audio at its own rate before the DAC, so it isn't bit-perfect: off unless you switch it on."
private const val OWN_FIXED = "Android's output here stays at {rate} kHz whatever rate a track is given at, and Android would resample anything else to it. So Mandarin sends {rate} kHz (or a rate listed as reaching the DAC), converting other rates itself with its own resampler, and its signal path says so: bit-perfect only for {rate} kHz tracks. Every way an app may ask Android for a track was tried (below); none made the output follow."
private const val OWN_MQA = "MQA: in Mandarin, Settings → Audio Devices, switch on “This DAC decodes MQA” for this Bridge. An MQA track is then sent untouched, at full scale, for this player's DAC to decode and unfold."
