package com.musicd.server.android

import android.app.Activity
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.musicd.server.client.Contract

/*
 * Settings → Setup → Logging (bug list item 121), under API Keys: the app's log, and the server's, for sending to the
 * developer when something is wrong. Off unless switched on, and off nothing is collected; on, the user is told to use
 * the app as usual for a day before saving it, and that it is made without personal data but theirs to look through
 * before sending. Saved to Downloads/Mandarin; switched off, deleted (AppLog).
 */

/** What the log leaves out, said under the switch whether it is on or off. */
internal const val LOG_PRIVACY = "The log is made without personal data: no IP addresses (home, Tailscale or internet), no names of " +
    "people, rooms or devices, nothing you play or search for, no files or folders, no account details. Before you send it, " +
    "please look through it: what you send is your choice."

/** What to do once it is on. */
internal const val LOG_ON = "Logging is on. Use the app as you normally would for 24 hours, then tap Save log: the log is saved " +
    "to Downloads/Mandarin on this phone, for you to send to the developer. Switching logging off deletes it, the server's " +
    "part too."

internal const val LOG_OFF = "Off: nothing is logged."

/** The Logging block of Setup's list. */
@Composable
internal fun LoggingBlock() {
    val context = LocalContext.current
    var on by remember { mutableStateOf(AppLog.on) }
    var about by remember { mutableStateOf(AppLog.about()) }
    SettingsDivider()
    Block {
        SetupRow("Logging", Modifier, null) {
            Toggle(on, Modifier.parity("settings-setup.logging", Contract.label("settings-setup.logging")).clickable {
                on = !on
                AppLog.switch(context, on)
                about = if (on) AppLog.about() else ""
            })
        }
        SetupNote((if (on) LOG_ON else LOG_OFF) + "\n\n" + LOG_PRIVACY, Modifier.parity("settings-setup.logging-note"))
        if (on) {
            SetupNote(about, Modifier.parity("settings-setup.log-about"))
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SetupButton(Contract.label("settings-setup.log-save"), busy = false, Modifier.parity("settings-setup.log-save", Contract.label("settings-setup.log-save")).clickable {
                    val a = context as? Activity ?: return@clickable
                    AppLog.save(a) { name ->
                        Toast.makeText(a, if (name != null) "Log saved to Downloads/Mandarin/$name" else "Couldn't save the log", Toast.LENGTH_LONG).show()
                        about = AppLog.about()
                    }
                })
                SetupButton(Contract.label("settings-setup.log-clear"), busy = false, Modifier.parity("settings-setup.log-clear", Contract.label("settings-setup.log-clear")).clickable {
                    AppLog.clear(context)
                    about = "Cleared"
                })
            }
        }
    }
}
