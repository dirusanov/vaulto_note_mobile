package com.vaultonotemobile

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import java.nio.ByteBuffer

/**
 * Joins the AAC segments of a long (meeting) recording into one .m4a by copying
 * the encoded samples - no re-encoding, so it is fast and lossless. The
 * segments come from the same recorder settings, so their formats match.
 */
class AudioConcatModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioConcat"

    @ReactMethod
    fun concatM4a(inputUris: ReadableArray, promise: Promise) {
        Thread {
            try {
                val paths = (0 until inputUris.size()).map { toPath(inputUris.getString(it) ?: "") }
                require(paths.isNotEmpty()) { "No input files" }
                promise.resolve("file://" + concat(paths).absolutePath)
            } catch (error: Exception) {
                promise.reject("AUDIO_CONCAT_FAILED", error)
            }
        }.start()
    }

    private fun toPath(uri: String): String =
        if (uri.startsWith("file://")) Uri.parse(uri).path ?: uri.removePrefix("file://") else uri

    private fun concat(paths: List<String>): File {
        val output = File(reactContext.cacheDir, "meeting_${System.currentTimeMillis()}.m4a")
        val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var muxerTrack = -1
        var offsetUs = 0L
        val buffer = ByteBuffer.allocate(1 shl 20)
        val info = MediaCodec.BufferInfo()
        try {
            for (path in paths) {
                val extractor = MediaExtractor()
                try {
                    extractor.setDataSource(path)
                    val track = (0 until extractor.trackCount).firstOrNull { index ->
                        extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
                    } ?: continue
                    extractor.selectTrack(track)
                    if (muxerTrack < 0) {
                        muxerTrack = muxer.addTrack(extractor.getTrackFormat(track))
                        muxer.start()
                    }
                    var lastSampleUs = 0L
                    var lastDeltaUs = 23_220L // one AAC frame at 44.1 kHz
                    while (true) {
                        val size = extractor.readSampleData(buffer, 0)
                        if (size < 0) break
                        val sampleUs = extractor.sampleTime
                        if (sampleUs > lastSampleUs) lastDeltaUs = sampleUs - lastSampleUs
                        lastSampleUs = sampleUs
                        info.set(0, size, offsetUs + sampleUs, extractor.sampleFlags)
                        muxer.writeSampleData(muxerTrack, buffer, info)
                        extractor.advance()
                    }
                    offsetUs += lastSampleUs + lastDeltaUs
                } finally {
                    extractor.release()
                }
            }
            check(muxerTrack >= 0) { "No audio track in the segments" }
        } finally {
            try {
                if (muxerTrack >= 0) muxer.stop()
            } catch (_: Exception) {
            }
            muxer.release()
        }
        return output
    }
}
