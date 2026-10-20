package com.musicd.server.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import java.io.File

/**
 * Where a share card, a playlist's file or a copied link goes from the app's own share sheets (ShareSheet,
 * PlaylistShareSheet): Android's share sheet, the clipboard, or Pictures/Mandarin. Once the page's way to them too,
 * from its WebView (window.MusicDShare), until that went (bug list item 111).
 */
class ShareBridge(private val activity: Activity) {

    companion object {
        private const val TAG = "ShareBridge"

        /** Cleared on every share so the cache cannot grow without bound. */
        private const val SHARE_DIR = "shared"
    }

    private fun decode(base64: String): ByteArray? = try {
        Base64.decode(base64, Base64.DEFAULT)
    } catch (e: Exception) {
        Log.w(TAG, "the page sent something that is not base64", e)
        null
    }

    @JavascriptInterface
    fun copyText(text: String): Boolean = try {
        val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Mandarin", text))
        true
    } catch (e: Exception) {
        Log.w(TAG, "copy text failed", e)
        false
    }

    /**
     * The card's Download, in the app (v0.6.0-RC4): saved to the phone's
     * Pictures/Mandarin, where the gallery shows it. A download link does
     * nothing in a WebView. Android 10 on needs no permission for this; before
     * that, the storage permission the app already asks for.
     */
    @JavascriptInterface
    fun saveImage(base64: String, fileName: String, mime: String): Boolean = decode(base64)?.let { save(it, fileName, mime) } ?: false

    /** [bytes] saved to the phone's Pictures/Mandarin as [fileName] (the page's Download, and the native card's: item 75). */
    fun save(bytes: ByteArray, fileName: String, mime: String): Boolean {
        val name = safeName(fileName)
        val type = mime.ifEmpty { "image/png" }
        return try {
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, type)
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_PICTURES + "/Mandarin")
                    put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val r = activity.contentResolver
                val uri = r.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
                try {
                    r.openOutputStream(uri)?.use { it.write(bytes) } ?: throw java.io.IOException("no stream")
                    r.update(uri, android.content.ContentValues().apply { put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                } catch (e: Exception) { r.delete(uri, null, null); throw e }
            } else {
                @Suppress("DEPRECATION")
                val dir = File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES), "Mandarin").apply { mkdirs() }
                val f = File(dir, name).apply { writeBytes(bytes) }
                android.media.MediaScannerConnection.scanFile(activity, arrayOf(f.path), arrayOf(type), null)
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "save failed", e)
            false
        }
    }

    /**
     * [bytes] saved to the phone's Download/Mandarin as [fileName] (a playlist shared, the native sheet's Download; item 94):
     * where the phone's Files app and every other app's file picker find it, Import's Choose a file… among them.
     */
    fun saveDownload(bytes: ByteArray, fileName: String, mime: String): Boolean {
        val name = safeName(fileName)
        return try {
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/Mandarin")
                    put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val r = activity.contentResolver
                val uri = r.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
                try {
                    r.openOutputStream(uri)?.use { it.write(bytes) } ?: throw java.io.IOException("no stream")
                    r.update(uri, android.content.ContentValues().apply { put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                } catch (e: Exception) { r.delete(uri, null, null); throw e }
            } else {
                @Suppress("DEPRECATION")
                val dir = File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), "Mandarin").apply { mkdirs() }
                File(dir, name).writeBytes(bytes)
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "save to downloads failed", e)
            false
        }
    }

    @JavascriptInterface
    fun shareImage(base64: String, fileName: String, mime: String) { decode(base64)?.let { share(it, fileName, mime) } }

    /** [bytes] offered to the phone's share sheet as [fileName] (the page's Share, and the native card's: item 75). */
    fun share(bytes: ByteArray, fileName: String, mime: String) {
        activity.runOnUiThread {
            try {
                val uri = FileProvider.getUriForFile(
                    activity, "${activity.packageName}.shares", write(bytes, fileName)
                )
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = mime.ifEmpty { "image/png" }
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(Intent.createChooser(send, "Share card"))
            } catch (e: Exception) {
                Log.w(TAG, "share failed", e)
            }
        }
    }

    /** A share cache holding exactly the file being shared right now. */
    private fun write(bytes: ByteArray, fileName: String): File {
        val dir = File(activity.cacheDir, SHARE_DIR)
        dir.listFiles()?.forEach { it.delete() }
        dir.mkdirs()
        return File(dir, safeName(fileName)).apply { writeBytes(bytes) }
    }

    /** The page names the file; it must not be able to choose the path. */
    private fun safeName(raw: String): String {
        val name = raw.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
            .take(96)
        return name.ifEmpty { "card.png" }
    }
}
