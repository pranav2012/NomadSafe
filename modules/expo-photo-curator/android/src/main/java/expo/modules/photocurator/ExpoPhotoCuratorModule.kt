package expo.modules.photocurator

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeler
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.InputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/**
 * Labels photos (ML Kit's bundled model) and scores their sharpness and exposure on the device, to help
 * pick a trip's best photos. Nothing leaves the phone. Photos are read one at a time, downscaled.
 */
class ExpoPhotoCuratorModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private var labeler: ImageLabeler? = null
  private var textRecognizer: TextRecognizer? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoPhotoCurator")

    AsyncFunction("analyze") { uris: List<String>, promise: Promise ->
      executor.execute {
        try {
          promise.resolve(uris.map { analyze(it) })
        } catch (e: Exception) {
          promise.reject("ERR_PHOTO_CURATOR", e.message ?: "analysis failed", e)
        }
      }
    }

    OnDestroy {
      executor.execute {
        labeler?.close()
        labeler = null
        textRecognizer?.close()
        textRecognizer = null
      }
      executor.shutdown()
    }
  }

  private fun analyze(uri: String): Map<String, Any?> {
    val bitmap = decode(uri, 512) ?: return mapOf("labels" to emptyList<Any>())
    try {
      val (sharpness, exposure) = quality(bitmap)
      return mapOf("labels" to labels(bitmap), "sharpness" to sharpness, "exposure" to exposure, "textCoverage" to textCoverage(bitmap))
    } finally {
      bitmap.recycle()
    }
  }

  private fun labels(bitmap: Bitmap): List<Map<String, Any>> {
    val client = labeler ?: ImageLabeling.getClient(ImageLabelerOptions.Builder().setConfidenceThreshold(0.2f).build()).also { labeler = it }
    return try {
      Tasks.await(client.process(InputImage.fromBitmap(bitmap, 0)), 15, TimeUnit.SECONDS)
        .sortedByDescending { it.confidence }
        .take(12)
        .map { mapOf("label" to it.text, "confidence" to it.confidence.toDouble()) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /** Share of the picture covered by text (receipts, tickets, screenshots), 0..1; null when it can't be read. */
  private fun textCoverage(bitmap: Bitmap): Double? {
    val client = textRecognizer ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { textRecognizer = it }
    return try {
      val text = Tasks.await(client.process(InputImage.fromBitmap(bitmap, 0)), 15, TimeUnit.SECONDS)
      val area = text.textBlocks.sumOf { block -> block.boundingBox?.let { it.width().toDouble() * it.height() } ?: 0.0 }
      min(1.0, area / (bitmap.width.toDouble() * bitmap.height))
    } catch (e: Exception) {
      null
    }
  }

  private fun open(uri: String): InputStream? {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      "content" -> appContext.reactContext?.contentResolver?.openInputStream(parsed)
      "file" -> parsed.path?.let { File(it).inputStream() }
      else -> File(uri).takeIf { it.exists() }?.inputStream()
    }
  }

  /** Decodes at the smallest power-of-two size that keeps the long side at least `maxEdge`. */
  private fun decode(uri: String, maxEdge: Int): Bitmap? {
    return try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      open(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      var sample = 1
      while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
      val options = BitmapFactory.Options().apply { inSampleSize = sample }
      open(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
    } catch (e: Exception) {
      null
    }
  }

  /** Sharpness from the variance of the Laplacian, and exposure from mean brightness and clipping, on a 256 px grey copy. */
  private fun quality(bitmap: Bitmap): Pair<Double, Double> {
    val scale = min(1.0, 256.0 / max(bitmap.width, bitmap.height))
    val width = max(8, (bitmap.width * scale).toInt())
    val height = max(8, (bitmap.height * scale).toInt())
    val small = Bitmap.createScaledBitmap(bitmap, width, height, true)
    val argb = IntArray(width * height)
    small.getPixels(argb, 0, width, 0, 0, width, height)
    if (small !== bitmap) small.recycle()

    val grey = IntArray(argb.size)
    var sum = 0.0
    var clipped = 0
    for (i in argb.indices) {
      val c = argb[i]
      val value = (((c shr 16) and 0xff) * 299 + ((c shr 8) and 0xff) * 587 + (c and 0xff) * 114) / 1000
      grey[i] = value
      sum += value
      if (value < 12 || value > 243) clipped++
    }
    val count = argb.size.toDouble()
    val mean = sum / count / 255

    var lapSum = 0.0
    var lapSquares = 0.0
    var samples = 0.0
    for (y in 1 until height - 1) {
      for (x in 1 until width - 1) {
        val i = y * width + x
        val v = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width]
        lapSum += v
        lapSquares += (v * v).toDouble()
        samples++
      }
    }
    val lapMean = lapSum / samples
    val variance = lapSquares / samples - lapMean * lapMean
    val sharpness = 1 - exp(-variance / 300)
    val exposure = max(0.0, 1 - abs(mean - 0.5) * 1.6 - clipped / count * 1.5)
    return sharpness to exposure
  }
}
