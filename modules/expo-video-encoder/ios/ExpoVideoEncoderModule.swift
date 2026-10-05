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
      self.queue.async {
        guard let writer = self.writer, let input = self.input, let url = self.outputURL else {
          promise.reject(VideoEncoderException("not started"))
          return
        }
        if let failure = self.failure {
          writer.cancelWriting()
          self.reset()
          promise.reject(VideoEncoderException(failure))
          return
        }
        input.markAsFinished()
        writer.finishWriting {
          if writer.status == .completed {
            promise.resolve(url.absoluteString)
          } else {
            promise.reject(VideoEncoderException(writer.error?.localizedDescription ?? "writing failed"))
          }
          self.queue.async { self.reset() }
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
