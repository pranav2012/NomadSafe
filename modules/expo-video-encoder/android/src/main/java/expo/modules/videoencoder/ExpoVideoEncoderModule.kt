package expo.modules.videoencoder

import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

private class VideoEncoderException(message: String) : CodedException("ERR_VIDEO_ENCODER", "Video encoder: $message", null)

/**
 * Encodes RGBA frames from JS into an H.264 MP4 with MediaCodec. Frames are copied on the JS thread and
 * encoded in order on one background thread, so `appendFrame` returns straight away; JS keeps the
 * backlog small with `pendingFrames`.
 */
class ExpoVideoEncoderModule : Module() {
  private var codec: MediaCodec? = null
  private var muxer: MediaMuxer? = null
  private var track = -1
  private var muxing = false
  private var file: File? = null
  private var width = 0
  private var height = 0
  private var fps = 30
  private var frameIndex = 0L
  @Volatile private var failure: String? = null
  private val pending = AtomicInteger(0)
  private val executor = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("ExpoVideoEncoder")

    Function("begin") { path: String, width: Int, height: Int, fps: Int ->
      start(path, width, height, fps)
    }

    Function("appendFrame") { pixels: Uint8Array ->
      if (codec == null) throw VideoEncoderException("not started")
      failure?.let { throw VideoEncoderException(it) }
      val expected = width * height * 4
      if (pixels.byteLength != expected) throw VideoEncoderException("frame is ${pixels.byteLength} bytes, expected $expected")
      val frame = ByteArray(expected)
      pixels.read(frame, 0, expected)
      val count = pending.incrementAndGet()
      executor.execute {
        try {
          if (failure == null) encode(frame)
        } catch (e: Exception) {
          failure = e.message ?: "encode failed"
        } finally {
          pending.decrementAndGet()
        }
      }
      count
    }

    Function("pendingFrames") {
      pending.get()
    }

    AsyncFunction("finish") { promise: Promise ->
      executor.execute {
        val output = file
        try {
          failure?.let { throw VideoEncoderException(it) }
          if (codec == null || output == null) throw VideoEncoderException("not started")
          endStream()
          release()
          promise.resolve(Uri.fromFile(output).toString())
        } catch (e: Exception) {
          release()
          output?.delete()
          promise.reject("ERR_VIDEO_ENCODER", e.message ?: "finish failed", e)
        } finally {
          reset()
        }
      }
    }

    Function("cancel") {
      executor.execute {
        release()
        file?.delete()
        reset()
      }
    }
  }

  private fun start(path: String, width: Int, height: Int, fps: Int) {
    if (codec != null) throw VideoEncoderException("already encoding")
    if (width <= 0 || height <= 0 || width % 16 != 0 || height % 16 != 0 || fps <= 0) throw VideoEncoderException("invalid size")
    val output = File(Uri.parse(path).path ?: path)
    output.delete()

    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      setInteger(MediaFormat.KEY_BIT_RATE, 6_000_000)
      setInteger(MediaFormat.KEY_FRAME_RATE, fps)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    encoder.start()

    codec = encoder
    muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    file = output
    this.width = width
    this.height = height
    this.fps = fps
    frameIndex = 0
    track = -1
    muxing = false
    failure = null
  }

  private fun encode(rgba: ByteArray) {
    val encoder = codec ?: return
    val index = dequeueInput(encoder)
    val image = encoder.getInputImage(index) ?: throw IllegalStateException("no input image")
    writeYuv(image, rgba)
    encoder.queueInputBuffer(index, 0, width * height * 3 / 2, frameIndex * 1_000_000L / fps, 0)
    frameIndex++
    drain(false)
  }

  private fun dequeueInput(encoder: MediaCodec): Int {
    while (true) {
      val index = encoder.dequeueInputBuffer(10_000)
      if (index >= 0) return index
      drain(false)
    }
  }

  /** RGBA → YUV 4:2:0 (BT.601, limited range), through each plane's own row and pixel strides. */
  private fun writeYuv(image: Image, rgba: ByteArray) {
    val (yPlane, uPlane, vPlane) = image.planes
    val yBuffer = yPlane.buffer
    val uBuffer = uPlane.buffer
    val vBuffer = vPlane.buffer
    for (row in 0 until height) {
      for (col in 0 until width) {
        val i = (row * width + col) * 4
        val r = rgba[i].toInt() and 0xff
        val g = rgba[i + 1].toInt() and 0xff
        val b = rgba[i + 2].toInt() and 0xff
        yBuffer.put(row * yPlane.rowStride + col * yPlane.pixelStride, (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte())
        if (row % 2 == 0 && col % 2 == 0) {
          uBuffer.put((row / 2) * uPlane.rowStride + (col / 2) * uPlane.pixelStride, (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte())
          vBuffer.put((row / 2) * vPlane.rowStride + (col / 2) * vPlane.pixelStride, (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte())
        }
      }
    }
  }

  /** Moves encoded output into the muxer; with `endOfStream`, waits for the last buffer. */
  private fun drain(endOfStream: Boolean) {
    val encoder = codec ?: return
    val mux = muxer ?: return
    val info = MediaCodec.BufferInfo()
    var idle = 0
    while (true) {
      val index = encoder.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
      when {
        index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream || ++idle > 500) return
        }
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          track = mux.addTrack(encoder.outputFormat)
          mux.start()
          muxing = true
        }
        index >= 0 -> {
          val buffer = encoder.getOutputBuffer(index)
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
          if (buffer != null && info.size > 0 && muxing) {
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            mux.writeSampleData(track, buffer, info)
          }
          encoder.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  private fun endStream() {
    val encoder = codec ?: return
    val index = dequeueInput(encoder)
    encoder.queueInputBuffer(index, 0, 0, frameIndex * 1_000_000L / fps, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    drain(true)
  }

  private fun release() {
    try {
      codec?.stop()
    } catch (_: Exception) {
    }
    codec?.release()
    try {
      if (muxing) muxer?.stop()
    } catch (_: Exception) {
    }
    muxer?.release()
    codec = null
    muxer = null
    muxing = false
  }

  private fun reset() {
    file = null
    failure = null
    frameIndex = 0
    track = -1
  }
}
