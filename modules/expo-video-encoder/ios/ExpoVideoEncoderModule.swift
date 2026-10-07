import Accelerate
import AVFoundation
import ExpoModulesCore

final class VideoEncoderException: GenericException<String> {
  override var reason: String { "Video encoder: \(param)" }
}

/// Encodes RGBA frames from JS into an H.264 MP4. Frames are copied on the JS thread and encoded in
/// order on a serial queue, so `appendFrame` returns straight away; JS keeps the backlog small with
/// `pendingFrames`.
public class ExpoVideoEncoderModule: Module {
  private var writer: AVAssetWriter?
  private var input: AVAssetWriterInput?
  private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var outputURL: URL?
  private var width = 0
  private var height = 0
  private var fps: Int32 = 30
  private var frameIndex: Int64 = 0
  private var failure: String?
  private let queue = DispatchQueue(label: "com.pranav.nomadsafe.video-encoder")
  private let lock = NSLock()
  private var pending = 0

  public func definition() -> ModuleDefinition {
    Name("ExpoVideoEncoder")

    Function("begin") { (path: String, width: Int, height: Int, fps: Int) throws in
      try self.start(path: path, width: width, height: height, fps: fps)
    }

    Function("appendFrame") { (pixels: Uint8Array) throws -> Int in
      guard self.writer != nil else { throw VideoEncoderException("not started") }
      if let failure = self.failure { throw VideoEncoderException(failure) }
      let expected = self.width * self.height * 4
      guard pixels.byteLength == expected else { throw VideoEncoderException("frame is \(pixels.byteLength) bytes, expected \(expected)") }
      let frame = Data(bytes: pixels.rawPointer, count: expected)
      let count = self.changePending(by: 1)
      self.queue.async {
        self.encode(frame)
        _ = self.changePending(by: -1)
      }
      return count
    }

    Function("pendingFrames") { () -> Int in
      self.changePending(by: 0)
    }

    AsyncFunction("finish") { (promise: Promise) in
      self.finishVideo { result in
        switch result {
        case .success(let url): promise.resolve(url.absoluteString)
        case .failure(let error): promise.reject(error)
        }
      }
    }

    // Like `finish`, then adds `audioPath` (an AAC file) under the video, trimmed to its length with a
    // fade-out. If the music can't be added, the silent video is still returned.
    AsyncFunction("finishWithAudio") { (audioPath: String, fadeSeconds: Double, promise: Promise) in
      self.finishVideo { result in
        switch result {
        case .failure(let error):
          promise.reject(error)
        case .success(let url):
          let audioURL = audioPath.hasPrefix("file://") ? URL(string: audioPath) : URL(fileURLWithPath: audioPath)
          guard let audioURL else {
            promise.resolve(url.absoluteString)
            return
          }
          Self.addAudio(video: url, audio: audioURL, fadeSeconds: fadeSeconds) {
            promise.resolve(url.absoluteString)
          }
        }
      }
    }

    Function("cancel") {
      self.queue.async {
        self.writer?.cancelWriting()
        if let url = self.outputURL { try? FileManager.default.removeItem(at: url) }
        self.reset()
      }
    }
  }

  private func finishVideo(_ done: @escaping (Result<URL, VideoEncoderException>) -> Void) {
    queue.async {
      guard let writer = self.writer, let input = self.input, let url = self.outputURL else {
        done(.failure(VideoEncoderException("not started")))
        return
      }
      if let failure = self.failure {
        writer.cancelWriting()
        self.reset()
        done(.failure(VideoEncoderException(failure)))
        return
      }
      input.markAsFinished()
      writer.finishWriting {
        if writer.status == .completed {
          done(.success(url))
        } else {
          done(.failure(VideoEncoderException(writer.error?.localizedDescription ?? "writing failed")))
        }
        self.queue.async { self.reset() }
      }
    }
  }

  /// Rewrites `video` with `audio` as its soundtrack: the video samples are copied as they are, the
  /// music is looped or trimmed to the video's length, faded in and out, and encoded to AAC.
  private static func addAudio(video: URL, audio: URL, fadeSeconds: Double, done: @escaping () -> Void) {
    let videoAsset = AVURLAsset(url: video)
    let musicAsset = AVURLAsset(url: audio)
    let duration = videoAsset.duration
    guard
      let videoTrack = videoAsset.tracks(withMediaType: .video).first,
      let musicTrack = musicAsset.tracks(withMediaType: .audio).first,
      let formatHint = videoTrack.formatDescriptions.first,
      duration.seconds > 0, musicAsset.duration.seconds > 0
    else {
      done()
      return
    }
    let output = video.deletingLastPathComponent().appendingPathComponent("with-audio-\(video.lastPathComponent)")
    try? FileManager.default.removeItem(at: output)
    do {
      let composition = AVMutableComposition()
      guard let soundtrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        done()
        return
      }
      var cursor = CMTime.zero
      while cursor < duration {
        let length = CMTimeMinimum(musicAsset.duration, CMTimeSubtract(duration, cursor))
        try soundtrack.insertTimeRange(CMTimeRange(start: .zero, duration: length), of: musicTrack, at: cursor)
        cursor = CMTimeAdd(cursor, length)
      }
      let ramp = AVMutableAudioMixInputParameters(track: soundtrack)
      let fadeIn = CMTime(seconds: 0.3, preferredTimescale: 600)
      let fadeOut = CMTime(seconds: min(fadeSeconds, duration.seconds / 2), preferredTimescale: 600)
      ramp.setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: CMTimeRange(start: .zero, duration: fadeIn))
      ramp.setVolumeRamp(fromStartVolume: 1, toEndVolume: 0, timeRange: CMTimeRange(start: CMTimeSubtract(duration, fadeOut), duration: fadeOut))
      let mix = AVMutableAudioMix()
      mix.inputParameters = [ramp]

      let videoReader = try AVAssetReader(asset: videoAsset)
      let videoOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: nil)
      videoReader.add(videoOutput)
      let audioReader = try AVAssetReader(asset: composition)
      audioReader.timeRange = CMTimeRange(start: .zero, duration: duration)
      let audioOutput = AVAssetReaderAudioMixOutput(
        audioTracks: composition.tracks(withMediaType: .audio),
        audioSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsNonInterleaved: false,
          AVSampleRateKey: 44_100,
          AVNumberOfChannelsKey: 2,
        ]
      )
      audioOutput.audioMix = mix
      audioReader.add(audioOutput)

      let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
      let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: (formatHint as! CMFormatDescription))
      videoInput.expectsMediaDataInRealTime = false
      let audioInput = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 2, AVSampleRateKey: 44_100, AVEncoderBitRateKey: 128_000]
      )
      audioInput.expectsMediaDataInRealTime = false
      guard writer.canAdd(videoInput), writer.canAdd(audioInput) else {
        done()
        return
      }
      writer.add(videoInput)
      writer.add(audioInput)
      guard videoReader.startReading(), audioReader.startReading(), writer.startWriting() else {
        writer.cancelWriting()
        done()
        return
      }
      writer.startSession(atSourceTime: .zero)

      let group = DispatchGroup()
      copy(from: videoOutput, to: videoInput, on: DispatchQueue(label: "com.pranav.nomadsafe.video-mux.video"), group: group)
      copy(from: audioOutput, to: audioInput, on: DispatchQueue(label: "com.pranav.nomadsafe.video-mux.audio"), group: group)
      group.notify(queue: .global(qos: .userInitiated)) {
        guard videoReader.status != .failed, audioReader.status != .failed else {
          writer.cancelWriting()
          try? FileManager.default.removeItem(at: output)
          done()
          return
        }
        writer.finishWriting {
          if writer.status == .completed {
            _ = try? FileManager.default.replaceItemAt(video, withItemAt: output)
          }
          try? FileManager.default.removeItem(at: output)
          done()
        }
      }
    } catch {
      try? FileManager.default.removeItem(at: output)
      done()
    }
  }

  private static func copy(from output: AVAssetReaderOutput, to input: AVAssetWriterInput, on queue: DispatchQueue, group: DispatchGroup) {
    group.enter()
    var finished = false
    input.requestMediaDataWhenReady(on: queue) {
      while !finished && input.isReadyForMoreMediaData {
        guard let sample = output.copyNextSampleBuffer(), input.append(sample) else {
          finished = true
          input.markAsFinished()
          group.leave()
          return
        }
      }
    }
  }

  private func changePending(by delta: Int) -> Int {
    lock.lock()
    defer { lock.unlock() }
    pending += delta
    return pending
  }

  private func start(path: String, width: Int, height: Int, fps: Int) throws {
    guard writer == nil else { throw VideoEncoderException("already encoding") }
    guard width > 0, height > 0, width % 2 == 0, height % 2 == 0, fps > 0 else { throw VideoEncoderException("invalid size") }
    let url = path.hasPrefix("file://") ? URL(string: path)! : URL(fileURLWithPath: path)
    try? FileManager.default.removeItem(at: url)

    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: 6_000_000,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoExpectedSourceFrameRateKey: fps,
          AVVideoMaxKeyFrameIntervalKey: fps,
        ],
      ]
    )
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
      ]
    )
    guard writer.canAdd(input) else { throw VideoEncoderException("can't add the video track") }
    writer.add(input)
    guard writer.startWriting() else { throw VideoEncoderException(writer.error?.localizedDescription ?? "can't start writing") }
    writer.startSession(atSourceTime: .zero)

    self.writer = writer
    self.input = input
    self.adaptor = adaptor
    self.outputURL = url
    self.width = width
    self.height = height
    self.fps = Int32(fps)
    self.frameIndex = 0
    self.failure = nil
  }

  /// Converts one RGBA frame to BGRA in a pooled pixel buffer and appends it at the next frame time.
  private func encode(_ frame: Data) {
    guard failure == nil, let writer, let input, let adaptor else { return }
    while !input.isReadyForMoreMediaData {
      if writer.status != .writing {
        failure = writer.error?.localizedDescription ?? "writer stopped"
        return
      }
      usleep(2_000)
    }
    guard let pool = adaptor.pixelBufferPool else {
      failure = "no pixel buffer pool"
      return
    }
    var buffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
      failure = "no pixel buffer"
      return
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    frame.withUnsafeBytes { raw in
      var source = vImage_Buffer(
        data: UnsafeMutableRawPointer(mutating: raw.baseAddress!),
        height: vImagePixelCount(height),
        width: vImagePixelCount(width),
        rowBytes: width * 4
      )
      var target = vImage_Buffer(
        data: CVPixelBufferGetBaseAddress(buffer),
        height: vImagePixelCount(height),
        width: vImagePixelCount(width),
        rowBytes: CVPixelBufferGetBytesPerRow(buffer)
      )
      // RGBA → BGRA.
      let map: [UInt8] = [2, 1, 0, 3]
      vImagePermuteChannels_ARGB8888(&source, &target, map, vImage_Flags(kvImageNoFlags))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    if !adaptor.append(buffer, withPresentationTime: CMTime(value: frameIndex, timescale: fps)) {
      failure = writer.error?.localizedDescription ?? "append failed"
      return
    }
    frameIndex += 1
  }

  private func reset() {
    writer = nil
    input = nil
    adaptor = nil
    outputURL = nil
    failure = nil
    frameIndex = 0
  }
}
