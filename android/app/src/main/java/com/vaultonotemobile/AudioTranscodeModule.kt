package com.vaultonotemobile

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.facebook.react.bridge.*
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

class AudioTranscodeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioTranscode"

    @ReactMethod
    fun convertToWav(inputUri: String, promise: Promise) {
        try {
            val outputUri = transcodeToWav(inputUri)
            promise.resolve(outputUri)
        } catch (error: Exception) {
            promise.reject("AUDIO_TRANSCODE_FAILED", error)
        }
    }

    private fun transcodeToWav(inputUri: String): String {
        val inputPath = normalizeUri(inputUri)
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null

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

            val sampleRate = if (inputFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            } else {
                TARGET_SAMPLE_RATE
            }
            val channelCount = if (inputFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                max(1, inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
            } else {
                1
            }

            val pcmBytes = decodeToPcm(decoder, extractor)
            val whisperPcm = convertPcmToWhisperFormat(pcmBytes, sampleRate, channelCount)

            val outputFile = createOutputFile()
            FileOutputStream(outputFile).use { output ->
                writeWavHeader(output, TARGET_SAMPLE_RATE, 1, 16, whisperPcm.size.toLong())
                output.write(whisperPcm)
            }

            return "file://${outputFile.absolutePath}"
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

    private fun decodeToPcm(decoder: MediaCodec, extractor: MediaExtractor): ByteArray {
        val rawPcm = ByteArrayOutputStream()
        val bufferInfo = MediaCodec.BufferInfo()
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
                MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> Unit
                else -> {
                    if (outputBufferIndex >= 0) {
                        val outputBuffer = decoder.getOutputBuffer(outputBufferIndex)
                            ?: throw IOException("Unable to access decoder output buffer")

                        if (bufferInfo.size > 0) {
                            outputBuffer.position(bufferInfo.offset)
                            outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                            val chunk = ByteArray(bufferInfo.size)
                            outputBuffer.get(chunk)
                            rawPcm.write(chunk)
                        }

                        decoder.releaseOutputBuffer(outputBufferIndex, false)
                        if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            sawOutputEos = true
                        }
                    }
                }
            }
        }

        return rawPcm.toByteArray()
    }

    private fun convertPcmToWhisperFormat(
        pcmBytes: ByteArray,
        sourceSampleRate: Int,
        sourceChannelCount: Int,
    ): ByteArray {
        if (pcmBytes.isEmpty()) {
            return pcmBytes
        }

        val frameSize = max(1, sourceChannelCount) * 2
        val totalFrames = pcmBytes.size / frameSize
        if (totalFrames <= 0) {
            return ByteArray(0)
        }

        val monoSamples = FloatArray(totalFrames)
        val pcmBuffer = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN)

        for (frameIndex in 0 until totalFrames) {
            var mixed = 0f
            for (channelIndex in 0 until sourceChannelCount) {
                mixed += pcmBuffer.short.toFloat() / 32768f
            }
            monoSamples[frameIndex] = mixed / sourceChannelCount
        }

        val resampled = if (sourceSampleRate == TARGET_SAMPLE_RATE) {
            monoSamples
        } else {
            resampleLinear(monoSamples, sourceSampleRate, TARGET_SAMPLE_RATE)
        }

        val output = ByteBuffer.allocate(resampled.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (sample in resampled) {
            val clamped = min(1f, max(-1f, sample))
            output.putShort((clamped * 32767f).toInt().toShort())
        }
        return output.array()
    }

    private fun resampleLinear(input: FloatArray, fromRate: Int, toRate: Int): FloatArray {
        if (input.isEmpty() || fromRate <= 0 || toRate <= 0) {
            return FloatArray(0)
        }

        val outputLength = max(1, (input.size.toLong() * toRate / fromRate).toInt())
        val output = FloatArray(outputLength)
        val ratio = fromRate.toDouble() / toRate.toDouble()

        for (i in 0 until outputLength) {
            val sourcePosition = i * ratio
            val leftIndex = sourcePosition.toInt().coerceIn(0, input.size - 1)
            val rightIndex = min(leftIndex + 1, input.size - 1)
            val fraction = (sourcePosition - leftIndex).toFloat()
            val left = input[leftIndex]
            val right = input[rightIndex]
            output[i] = left + (right - left) * fraction
        }

        return output
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
        return File(dir, "tx-${System.currentTimeMillis()}.wav")
    }

    private fun normalizeUri(uri: String): String {
        return if (uri.startsWith("file://")) uri.removePrefix("file://") else uri
    }

    private fun writeWavHeader(
        output: FileOutputStream,
        sampleRate: Int,
        channelCount: Int,
        bitsPerSample: Int,
        pcmDataLength: Long,
    ) {
        val byteRate = sampleRate * channelCount * bitsPerSample / 8
        val blockAlign = channelCount * bitsPerSample / 8
        val totalDataLength = pcmDataLength + 36

        val header = ByteBuffer.allocate(44)
            .order(ByteOrder.LITTLE_ENDIAN)
            .put("RIFF".toByteArray(Charsets.US_ASCII))
            .putInt(totalDataLength.toInt())
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
            .putInt(pcmDataLength.toInt())
            .array()

        output.write(header)
    }

    companion object {
        private const val TIMEOUT_US = 10_000L
        private const val TARGET_SAMPLE_RATE = 16_000
    }
}
