package com.vaultonotemobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * Content shared to Vaulto from another app ("Share -> Vaulto"). Text arrives in
 * the intent; audio arrives as a content:// URI that only this process may read
 * for a short time, so it is copied into the app cache right away.
 */
object ShareIntentStore {
    private var pending: Map<String, String?>? = null
    var reactContext: ReactApplicationContext? = null

    fun capture(context: Context, intent: Intent?) {
        if (intent == null || intent.action != Intent.ACTION_SEND) return
        val type = intent.type ?: return
        val payload: Map<String, String?>? = when {
            type.startsWith("text/") -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (text.isNullOrBlank()) null else mapOf(
                    "kind" to "text",
                    "text" to text,
                    "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT),
                )
            }
            type.startsWith("audio/") -> {
                @Suppress("DEPRECATION")
                val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                copyToCache(context, uri)?.let { path ->
                    mapOf("kind" to "audio", "path" to path, "mimeType" to type, "name" to displayName(context, uri))
                }
            }
            else -> null
        }
        // Consume the intent so a rotation or relaunch does not import it twice.
        intent.action = null
        if (payload == null) return
        pending = payload
        emit()
    }

    fun take(): Map<String, String?>? {
        val value = pending
        pending = null
        return value
    }

    private fun emit() {
        val ctx = reactContext ?: return
        if (!ctx.hasActiveReactInstance()) return
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("VaultoShareReceived", null)
    }

    private fun displayName(context: Context, uri: Uri?): String? {
        if (uri == null) return null
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun copyToCache(context: Context, uri: Uri?): String? {
        if (uri == null) return null
        return try {
            val dir = File(context.cacheDir, "shared").apply { mkdirs() }
            val name = displayName(context, uri)?.substringAfterLast('.', "")?.takeIf { it.length in 1..5 } ?: "m4a"
            val target = File(dir, "shared_${System.currentTimeMillis()}.$name")
            context.contentResolver.openInputStream(uri)?.use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            } ?: return null
            "file://${target.absolutePath}"
        } catch (error: Exception) {
            Log.w("VaultoShare", "Could not read shared audio $uri", error)
            null
        }
    }
}

class ShareIntentModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        ShareIntentStore.reactContext = reactContext
    }

    override fun getName(): String = "VaultoShareIntent"

    /** Returns the content shared most recently (once), or null. */
    @ReactMethod
    fun takePendingShare(promise: Promise) {
        val payload = ShareIntentStore.take()
        if (payload == null) {
            promise.resolve(null)
            return
        }
        val map: WritableMap = Arguments.createMap()
        payload.forEach { (key, value) -> if (value != null) map.putString(key, value) else map.putNull(key) }
        promise.resolve(map)
    }

    // Required by NativeEventEmitter on the JS side.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Int) = Unit
}
