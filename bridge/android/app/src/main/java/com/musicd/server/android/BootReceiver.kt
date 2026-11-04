package com.musicd.server.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The device started: the renderer with it, when Start on boot is on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action != Intent.ACTION_BOOT_COMPLETED) return
        if (Store.startOnBoot(c)) DacService.start(c)
    }
}
