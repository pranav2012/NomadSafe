import CoreGraphics
import ExpoModulesCore
import ImageIO
import Vision

/// Labels photos and scores their quality on the device, to help pick a trip's best photos.
/// Nothing leaves the phone. Photos are read one at a time from small thumbnails.
public class ExpoPhotoCuratorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPhotoCurator")

    AsyncFunction("analyze") { (uris: [String]) async -> [[String: Any]] in
      var results: [[String: Any]] = []
      for uri in uris {
        results.append(await Self.analyze(uri))
      }
      return results
    }
  }

  private static func analyze(_ uri: String) async -> [String: Any] {
    guard let image = thumbnail(uri, maxEdge: 512) else { return ["labels": [[String: Any]]()] }
    var result: [String: Any] = ["labels": labels(image)]
    if let coverage = textCoverage(image) { result["textCoverage"] = coverage }
    if let scores = quality(image) {
      result["sharpness"] = scores.sharpness
      result["exposure"] = scores.exposure
    }
    if #available(iOS 18.0, *) {
      if let scores = try? await CalculateImageAestheticsScoresRequest().perform(on: image) {
        result["aesthetic"] = Double(scores.overallScore)
        result["utility"] = scores.isUtility
      }
    }
    return result
  }

  /// A thumbnail with the EXIF rotation applied, at most `maxEdge` px on its long side.
  private static func thumbnail(_ uri: String, maxEdge: Int) -> CGImage? {
    let url = uri.hasPrefix("file://") ? URL(string: uri) : URL(fileURLWithPath: uri)
    guard let url, let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxEdge,
      kCGImageSourceShouldCacheImmediately: true,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  private static func labels(_ image: CGImage) -> [[String: Any]] {
    let request = VNClassifyImageRequest()
    do {
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
      return []
    }
    return (request.results ?? [])
      .filter { $0.confidence >= 0.2 }
      .sorted { $0.confidence > $1.confidence }
      .prefix(12)
      .map { ["label": $0.identifier, "confidence": Double($0.confidence)] }
  }

  /// Share of the picture covered by text (receipts, tickets, screenshots), 0..1.
  private static func textCoverage(_ image: CGImage) -> Double? {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .fast
    request.usesLanguageCorrection = false
    do {
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
      return nil
    }
    let area = (request.results ?? []).reduce(0.0) { $0 + Double($1.boundingBox.width * $1.boundingBox.height) }
    return min(1, area)
  }

  /// Sharpness from the variance of the Laplacian, and exposure from mean brightness and clipping, on a 256 px grey copy.
  private static func quality(_ image: CGImage) -> (sharpness: Double, exposure: Double)? {
    let scale = min(1.0, 256.0 / Double(max(image.width, image.height)))
    let width = max(8, Int(Double(image.width) * scale))
    let height = max(8, Int(Double(image.height) * scale))
    var pixels = [UInt8](repeating: 0, count: width * height)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
      else { return false }
      context.interpolationQuality = .medium
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { return nil }

    var sum = 0.0
    var clipped = 0
    for value in pixels {
      sum += Double(value)
      if value < 12 || value > 243 { clipped += 1 }
    }
    let count = Double(pixels.count)
    let mean = sum / count / 255

    var lapSum = 0.0
    var lapSquares = 0.0
    var samples = 0.0
    for y in 1..<(height - 1) {
      for x in 1..<(width - 1) {
        let i = y * width + x
        let v = 4 * Int(pixels[i]) - Int(pixels[i - 1]) - Int(pixels[i + 1]) - Int(pixels[i - width]) - Int(pixels[i + width])
        lapSum += Double(v)
        lapSquares += Double(v * v)
        samples += 1
      }
    }
    let lapMean = lapSum / samples
    let variance = lapSquares / samples - lapMean * lapMean
    let sharpness = 1 - exp(-variance / 300)
    let exposure = max(0, 1 - abs(mean - 0.5) * 1.6 - Double(clipped) / count * 1.5)
    return (sharpness, exposure)
  }
}
