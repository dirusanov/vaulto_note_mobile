import AVFoundation
import Foundation

/**
 * Decodes a recording into the 16 kHz mono PCM WAV that whisper.cpp accepts.
 *
 * Notes are recorded as AAC/m4a, which whisper.cpp cannot read at all, so local
 * transcription on iOS depends entirely on this conversion. Sample buffers are
 * written out as they arrive: an hour-long note is hundreds of megabytes of PCM.
 */
@objc(AudioTranscode)
class AudioTranscodeModule: NSObject {

  private static let targetSampleRate: Double = 16000
  private static let staleFileAge: TimeInterval = 6 * 60 * 60

  private let queue = DispatchQueue(label: "com.vaultonote.audiotranscode")

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(convertToWav:resolver:rejecter:)
  func convertToWav(
    _ inputUri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      do {
        resolve(try self.transcodeToWav(inputUri: inputUri))
      } catch {
        reject("AUDIO_TRANSCODE_FAILED", error.localizedDescription, error)
      }
    }
  }

  private func transcodeToWav(inputUri: String) throws -> String {
    let inputURL = normalizedURL(from: inputUri)
    let asset = AVURLAsset(url: inputURL)

    guard let track = asset.tracks(withMediaType: .audio).first else {
      throw transcodeError("No audio track found in input file")
    }

    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: Self.targetSampleRate,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ]
    )
    output.alwaysCopiesSampleData = false

    guard reader.canAdd(output) else {
      throw transcodeError("Cannot read audio from this recording")
    }
    reader.add(output)

    let outputURL = try makeOutputURL()
    guard FileManager.default.createFile(atPath: outputURL.path, contents: nil) else {
      throw transcodeError("Cannot create the converted audio file")
    }

    let handle = try FileHandle(forWritingTo: outputURL)
    var wroteFile = false
    defer {
      try? handle.close()
      if !wroteFile {
        try? FileManager.default.removeItem(at: outputURL)
      }
    }

    handle.write(wavHeader(sampleRate: Int(Self.targetSampleRate), dataLength: 0))

    guard reader.startReading() else {
      throw reader.error ?? transcodeError("Failed to start reading the recording")
    }

    var dataLength = 0
    while let sampleBuffer = output.copyNextSampleBuffer() {
      guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { continue }
      let length = CMBlockBufferGetDataLength(blockBuffer)
      if length == 0 { continue }

      var chunk = Data(count: length)
      let status: OSStatus = chunk.withUnsafeMutableBytes { raw in
        guard let base = raw.baseAddress else { return kCMBlockBufferBadPointerParameterErr }
        return CMBlockBufferCopyDataBytes(
          blockBuffer, atOffset: 0, dataLength: length, destination: base
        )
      }
      guard status == noErr else {
        throw transcodeError("Failed to read decoded audio (status \(status))")
      }

      handle.write(chunk)
      dataLength += length
    }

    if reader.status == .failed {
      throw reader.error ?? transcodeError("Failed to decode the recording")
    }

    // Sizes are only known once the whole track is decoded.
    try handle.seek(toOffset: 4)
    handle.write(littleEndianUInt32(UInt32(36 + dataLength)))
    try handle.seek(toOffset: 40)
    handle.write(littleEndianUInt32(UInt32(dataLength)))

    wroteFile = true
    return "file://\(outputURL.path)"
  }

  private func normalizedURL(from uri: String) -> URL {
    if uri.hasPrefix("file://"), let url = URL(string: uri) {
      return url
    }
    return URL(fileURLWithPath: uri)
  }

  private func makeOutputURL() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("whisper-audio")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    purgeStaleFiles(in: directory)
    return directory.appendingPathComponent("tx-\(Int(Date().timeIntervalSince1970 * 1000)).wav")
  }

  /// A failure mid-conversion leaves the partial audio behind; it is never needed again.
  private func purgeStaleFiles(in directory: URL) {
    let threshold = Date().addingTimeInterval(-Self.staleFileAge)
    let contents = try? FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: [.contentModificationDateKey]
    )
    contents?.forEach { url in
      let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
        .contentModificationDate
      if let modified, modified < threshold {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }

  private func littleEndianUInt32(_ value: UInt32) -> Data {
    var little = value.littleEndian
    return Data(bytes: &little, count: 4)
  }

  private func wavHeader(sampleRate: Int, dataLength: Int) -> Data {
    let channels = 1
    let bitsPerSample = 16
    let byteRate = sampleRate * channels * bitsPerSample / 8
    let blockAlign = channels * bitsPerSample / 8

    var header = Data()
    header.append(contentsOf: Array("RIFF".utf8))
    header.append(littleEndianUInt32(UInt32(36 + dataLength)))
    header.append(contentsOf: Array("WAVE".utf8))
    header.append(contentsOf: Array("fmt ".utf8))
    header.append(littleEndianUInt32(16))
    header.append(contentsOf: [1, 0]) // PCM
    header.append(contentsOf: [UInt8(channels), 0])
    header.append(littleEndianUInt32(UInt32(sampleRate)))
    header.append(littleEndianUInt32(UInt32(byteRate)))
    header.append(contentsOf: [UInt8(blockAlign), 0])
    header.append(contentsOf: [UInt8(bitsPerSample), 0])
    header.append(contentsOf: Array("data".utf8))
    header.append(littleEndianUInt32(UInt32(dataLength)))
    return header
  }

  private func transcodeError(_ message: String) -> NSError {
    return NSError(
      domain: "AudioTranscode",
      code: -1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
