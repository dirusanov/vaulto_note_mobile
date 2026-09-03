package com.vaultonotemobile

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * Decodes a recording into the 16 kHz mono PCM WAV that whisper.cpp accepts.
 *
 * Everything is streamed: a one-hour note decodes to hundreds of megabytes of raw
 * PCM, so nothing but a few kilobytes of the current chunk is ever held in memory.
 */
class AudioTranscodeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // Decoding blocks for as long as the recording is long; keep it off the bridge thread.
    private val executor = Executors.newSingleThreadExecutor()

    override fun getName(): String = "AudioTranscode"

    @ReactMethod
    fun convertToWav(inputUri: String, promise: Promise) {
        executor.execute {
            try {
                promise.resolve(transcodeToWav(inputUri))
            } catch (error: Exception) {
                promise.reject("AUDIO_TRANSCODE_FAILED", error)
            }
        }
    }

    private fun transcodeToWav(inputUri: String): String {
        val inputPath = normalizeUri(inputUri)
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        val outputFile = createOutputFile()
        var writer: WavWriter? = null

        try {
            extractor.setDataSource(inputPath)

            val trackIndex = findAudioTrack(extractor)
            if (trackIndex < 0) {
                throw IOException("No audio track found in input file")
            }

            extractor.selectTrack(trackIndex)
            val inputFormat = extractor.getTrackFormat(trackIndex)
            val mimeType = inputFormat.getString(MediaFormat.KEY_MIME)
                ?: throw IOException("Audio mime type is missing")

            decoder = MediaCodec.createDecoderByType(mimeType)
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            writer = WavWriter(outputFile, TARGET_SAMPLE_RATE)
            decodeInto(decoder, extractor, readFormat(inputFormat), writer)
            writer.finish()

            return "file://${outputFile.absolutePath}"
        } catch (error: Exception) {
            try {
                writer?.close()
            } catch (_: Exception) {
            }
            outputFile.delete()
            throw error
        } finally {
            try {
                decoder?.stop()
            } catch (_: Exception) {
            }
            try {
                decoder?.release()
            } catch (_: Exception) {
            }
            try {
                extractor.release()
            } catch (_: Exception) {
            }
        }
    }

    private fun decodeInto(
        decoder: MediaCodec,
        extractor: MediaExtractor,
        inputPcmFormat: PcmFormat,
        writer: WavWriter,
    ) {
        val bufferInfo = MediaCodec.BufferInfo()
        var pcmFormat = inputPcmFormat
        var resampler = Resampler(pcmFormat.sampleRate, TARGET_SAMPLE_RATE)
        var sawInputEos = false
        var sawOutputEos = false

        while (!sawOutputEos) {
            if (!sawInputEos) {
                val inputBufferIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
                if (inputBufferIndex >= 0) {
                    val inputBuffer = decoder.getInputBuffer(inputBufferIndex)
                        ?: throw IOException("Unable to access decoder input buffer")
                    val sampleSize = extractor.readSampleData(inputBuffer, 0)
                    if (sampleSize < 0) {
                        decoder.queueInputBuffer(
                            inputBufferIndex,
                            0,
                            0,
                            0,
                            MediaCodec.BUFFER_FLAG_END_OF_STREAM
                        )
                        sawInputEos = true
                    } else {
                        decoder.queueInputBuffer(
                            inputBufferIndex,
                            0,
                            sampleSize,
                            extractor.sampleTime,
                            0
                        )
                        extractor.advance()
                    }
                }
            }

            when (val outputBufferIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)) {
                MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                // The decoder, not the container, decides the PCM it hands back: sample
                // rate, channel count and even float vs. 16-bit can all differ here.
                MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val updated = readFormat(decoder.outputFormat)
                    if (updated.sampleRate != pcmFormat.sampleRate) {
                        resampler.flush { writer.writeSample(it) }
                        resampler = Resampler(updated.sampleRate, TARGET_SAMPLE_RATE)
                    }
                    pcmFormat = updated
                }
                else -> {
                    if (outputBufferIndex >= 0) {
                        if (bufferInfo.size > 0) {
                            val outputBuffer = decoder.getOutputBuffer(outputBufferIndex)
                                ?: throw IOException("Unable to access decoder output buffer")
                            outputBuffer.position(bufferInfo.offset)
                            outputBuffer.limit(bufferInfo.offset + bufferInfo.size)

                            val mono = toMonoSamples(outputBuffer, pcmFormat)
                            resampler.process(mono) { writer.writeSample(it) }
                        }

                        decoder.releaseOutputBuffer(outputBufferIndex, false)
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            sawOutputEos = true
                        }
                    }
                }
            }
        }

        resampler.flush { writer.writeSample(it) }
    }

    private data class PcmFormat(val sampleRate: Int, val channelCount: Int, val encoding: Int)

    private fun readFormat(format: MediaFormat): PcmFormat {
        val sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
            format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        } else {
            TARGET_SAMPLE_RATE
        }
        val channelCount = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
            max(1, format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
        } else {
            1
        }
        val encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
            format.getInteger(MediaFormat.KEY_PCM_ENCODING)
        } else {
            AudioFormat.ENCODING_PCM_16BIT
        }
        return PcmFormat(max(1, sampleRate), channelCount, encoding)
    }

    /** Downmixes one decoder buffer to mono floats in [-1, 1]. */
    private fun toMonoSamples(buffer: ByteBuffer, format: PcmFormat): FloatArray {
        val ordered = buffer.order(ByteOrder.LITTLE_ENDIAN)
        val channels = format.channelCount

        if (format.encoding == AudioFormat.ENCODING_PCM_FLOAT) {
            val floats = ordered.asFloatBuffer()
            val frames = floats.remaining() / channels
            val mono = FloatArray(max(0, frames))
            for (frameIndex in 0 until frames) {
                var mixed = 0f
                for (channelIndex in 0 until channels) {
                    mixed += floats.get()
                }
                mono[frameIndex] = mixed / channels
            }
            return mono
        }

        val shorts = ordered.asShortBuffer()
        val frames = shorts.remaining() / channels
        val mono = FloatArray(max(0, frames))
        for (frameIndex in 0 until frames) {
            var mixed = 0f
            for (channelIndex in 0 until channels) {
                mixed += shorts.get().toFloat() / 32768f
            }
            mono[frameIndex] = mixed / channels
        }
        return mono
    }

    /**
     * Linear resampler that keeps its position and the trailing sample between
     * chunks, so no click is introduced at buffer boundaries.
     */
    private class Resampler(sourceRate: Int, targetRate: Int) {
        private val step = sourceRate.toDouble() / targetRate.toDouble()
        private var carry = FloatArray(0)
        private var position = 0.0

        fun process(chunk: FloatArray, sink: (Float) -> Unit) {
            if (chunk.isEmpty()) return

            val samples = if (carry.isEmpty()) chunk else carry + chunk
            var cursor = position

            while (cursor + 1 < samples.size) {
                val index = cursor.toInt()
                val fraction = (cursor - index).toFloat()
                val left = samples[index]
                val right = samples[index + 1]
                sink(left + (right - left) * fraction)
                cursor += step
            }

            val keepFrom = min(cursor.toInt(), samples.size)
            carry = samples.copyOfRange(keepFrom, samples.size)
            position = cursor - keepFrom
        }

        /** Emits whatever is left once the stream ends. */
        fun flush(sink: (Float) -> Unit) {
            if (carry.isEmpty()) return
            var cursor = position
            while (cursor < carry.size) {
                sink(carry[min(cursor.toInt(), carry.size - 1)])
                cursor += step
            }
            carry = FloatArray(0)
            position = 0.0
        }
    }

    /** Writes a 16-bit mono WAV, patching the length fields once the size is known. */
    private class WavWriter(file: File, private val sampleRate: Int) {
        private val output = RandomAccessFile(file, "rw")
        private val buffer = ByteArray(BUFFER_BYTES)
        private var bufferOffset = 0
        private var dataBytes = 0L

        init {
            output.setLength(0)
            output.write(buildHeader(sampleRate, 0))
        }

        fun writeSample(sample: Float) {
            val clamped = min(1f, max(-1f, sample))
            val value = (clamped * 32767f).toInt()
            buffer[bufferOffset++] = (value and 0xff).toByte()
            buffer[bufferOffset++] = ((value shr 8) and 0xff).toByte()
            if (bufferOffset == buffer.size) {
                flushBuffer()
            }
        }

        fun finish() {
            flushBuffer()
            writeLittleEndianInt(4, (36 + dataBytes).toInt())
            writeLittleEndianInt(40, dataBytes.toInt())
            output.close()
        }

        fun close() {
            try {
                output.close()
            } catch (_: Exception) {
            }
        }

        private fun flushBuffer() {
            if (bufferOffset == 0) return
            output.write(buffer, 0, bufferOffset)
            dataBytes += bufferOffset
            bufferOffset = 0
        }

        private fun writeLittleEndianInt(position: Long, value: Int) {
            output.seek(position)
            output.write(
                byteArrayOf(
                    (value and 0xff).toByte(),
                    ((value shr 8) and 0xff).toByte(),
                    ((value shr 16) and 0xff).toByte(),
                    ((value shr 24) and 0xff).toByte(),
                )
            )
        }

        private fun buildHeader(sampleRate: Int, pcmDataLength: Int): ByteArray {
            val channelCount = 1
            val bitsPerSample = 16
            val byteRate = sampleRate * channelCount * bitsPerSample / 8
            val blockAlign = channelCount * bitsPerSample / 8

            return ByteBuffer.allocate(44)
                .order(ByteOrder.LITTLE_ENDIAN)
                .put("RIFF".toByteArray(Charsets.US_ASCII))
                .putInt(36 + pcmDataLength)
                .put("WAVE".toByteArray(Charsets.US_ASCII))
                .put("fmt ".toByteArray(Charsets.US_ASCII))
                .putInt(16)
                .putShort(1)
                .putShort(channelCount.toShort())
                .putInt(sampleRate)
                .putInt(byteRate)
                .putShort(blockAlign.toShort())
                .putShort(bitsPerSample.toShort())
                .put("data".toByteArray(Charsets.US_ASCII))
                .putInt(pcmDataLength)
                .array()
        }

        private companion object {
            const val BUFFER_BYTES = 32 * 1024
        }
    }

    private fun findAudioTrack(extractor: MediaExtractor): Int {
        for (i in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(i)
            val mimeType = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (mimeType.startsWith("audio/")) {
                return i
            }
        }
        return -1
    }

    private fun createOutputFile(): File {
        val dir = File(reactContext.cacheDir, "whisper-audio")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        purgeStaleFiles(dir)
        return File(dir, "tx-${System.currentTimeMillis()}.wav")
    }

    /** A crash mid-transcode leaves the converted audio behind; it is never needed again. */
    private fun purgeStaleFiles(dir: File) {
        val threshold = System.currentTimeMillis() - STALE_FILE_AGE_MS
        dir.listFiles()?.forEach { file ->
            if (file.isFile && file.lastModified() < threshold) {
                file.delete()
            }
        }
    }

    private fun normalizeUri(uri: String): String {
        return if (uri.startsWith("file://")) uri.removePrefix("file://") else uri
    }

    companion object {
        private const val TIMEOUT_US = 10_000L
        private const val TARGET_SAMPLE_RATE = 16_000
        private const val STALE_FILE_AGE_MS = 6 * 60 * 60 * 1000L
    }
}
