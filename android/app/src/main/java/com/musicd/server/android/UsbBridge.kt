package com.musicd.server.android

import android.app.Activity
import android.webkit.JavascriptInterface

/**
 * The USB DAC, for the page (Stage 9.1) — only inside the app.
 *
 *   MusicdUsb.info()         → {attached, permission, direct, error, device, info}
 *   MusicdUsb.request()      ask the user's permission for the DAC (Android remembers a yes)
 *   MusicdUsb.refresh()      look at the port again
 *   MusicdUsb.phoneZone()    this phone's zone id, so the page knows whose device page to put it on
 *   MusicdUsb.setDirect(on)  the USB direct switch (plays through the driver from 9.2)
 *   MusicdUsb.diagnostics()  everything as text, for a report
 *
 * The app calls window.__musicdUsbChanged() when the port changes.
 */
class UsbBridge(private val activity: Activity) {
    companion object { const val NAME = "MusicdUsb" }

    @JavascriptInterface
    fun info(): String = UsbDac.json(activity).toString()

    @JavascriptInterface
    fun request() { activity.runOnUiThread { UsbDac.requestPermission(activity) } }

    @JavascriptInterface
    fun refresh() { UsbDac.refresh(activity) }

    @JavascriptInterface
    fun phoneZone(): String = Store.phoneZone(activity)

    @JavascriptInterface
    fun setDirect(on: Boolean) {
        Store.setUsbDirect(activity, on)
        activity.runOnUiThread { PhonePlayerService.current?.usbChanged() }
    }

    @JavascriptInterface
    fun diagnostics(): String = UsbDac.diagnostics(activity)
}
