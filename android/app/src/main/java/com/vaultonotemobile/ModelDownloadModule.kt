package com.vaultonotemobile

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.Executors

/**
 * Offline models (up to ~3 GB) download through the system DownloadManager: the
 * transfer keeps going with the app closed or killed, resumes after network drops,
 * and shows its progress in the notification shade. The app only asks for the
 * status by id and moves the finished file into its private storage.
 */
class ModelDownloadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ModelDownload"

    private val manager by lazy {
        reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    }
    private val io = Executors.newSingleThreadExecutor()

    /** Starts a download into the app's own external files dir; resolves its id. */
    @ReactMethod
    fun enqueue(url: String, fileName: String, title: String, description: String, promise: Promise) {
        try {
            val dir = reactContext.getExternalFilesDir("models")
                ?: return promise.reject("MODEL_DOWNLOAD_NO_STORAGE", "Storage is not available")
            File(dir, fileName).delete()
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(title)
                .setDescription(description)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(reactContext, "models", fileName)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
            promise.resolve(manager.enqueue(request).toString())
        } catch (error: Exception) {
            promise.reject("MODEL_DOWNLOAD_ENQUEUE_FAILED", error)
        }
    }

    /** { status: pending|running|paused|successful|failed|missing, downloaded, total, path, reason } */
    @ReactMethod
    fun query(id: String, promise: Promise) {
        try {
            val result = Arguments.createMap()
            manager.query(DownloadManager.Query().setFilterById(id.toLong())).use { cursor ->
                if (cursor == null || !cursor.moveToFirst()) {
                    result.putString("status", "missing")
                    promise.resolve(result)
                    return
                }
                val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                result.putString(
                    "status",
                    when (status) {
                        DownloadManager.STATUS_PENDING -> "pending"
                        DownloadManager.STATUS_RUNNING -> "running"
                        DownloadManager.STATUS_PAUSED -> "paused"
                        DownloadManager.STATUS_SUCCESSFUL -> "successful"
                        else -> "failed"
                    },
                )
                result.putDouble(
                    "downloaded",
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).toDouble(),
                )
                result.putDouble(
                    "total",
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).toDouble(),
                )
                result.putInt("reason", cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)))
                val localUri = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
                result.putString("path", localUri?.let { Uri.parse(it).path })
            }
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("MODEL_DOWNLOAD_QUERY_FAILED", error)
        }
    }

    /** Cancels the download and deletes its partial file. */
    @ReactMethod
    fun remove(id: String, promise: Promise) {
        try {
            manager.remove(id.toLong())
            promise.resolve(true)
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    /** Moves a finished file into private storage (copies when it is on another volume). */
    @ReactMethod
    fun moveFile(fromPath: String, toPath: String, promise: Promise) {
        io.execute {
            try {
                val from = File(fromPath)
                val to = File(toPath.removePrefix("file://"))
                to.parentFile?.mkdirs()
                to.delete()
                if (!from.renameTo(to)) {
                    from.inputStream().use { input -> to.outputStream().use { output -> input.copyTo(output, 1 shl 20) } }
                    from.delete()
                }
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject("MODEL_DOWNLOAD_MOVE_FAILED", error)
            }
        }
    }
}
