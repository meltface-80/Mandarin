package com.musicd.server.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The device started: the Bridge with it, when Start on boot is on. Updated (item 291): started again, always. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        when (i.action) {
            Intent.ACTION_BOOT_COMPLETED -> if (Store.startOnBoot(c)) DacService.start(c)
            Intent.ACTION_MY_PACKAGE_REPLACED -> DacService.start(c)
        }
    }
}
