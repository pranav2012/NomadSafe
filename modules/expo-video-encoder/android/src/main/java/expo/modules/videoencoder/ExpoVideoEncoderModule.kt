package expo.modules.videoencoder

import android.media.AudioFormat
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

private class VideoEncoderException(message: String) : CodedException("ERR_VIDEO_ENCODER", "Video encoder: $message", null)

private class EncodedSample(val data: ByteArray, val timeUs: Long, val flags: Int)

private class EncodedAudio(val format: MediaFormat, val samples: List<EncodedSample>)

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

    // Like `finish`, then adds `audioPath` (an AAC file) under the video, trimmed to its length with a
    // fade-out. If the music can't be added, the silent video is still returned.
    AsyncFunction("finishWithAudio") { audioPath: String, fadeSeconds: Double, promise: Promise ->
      executor.execute {
        val output = file
        try {
          failure?.let { throw VideoEncoderException(it) }
          if (codec == null || output == null) throw VideoEncoderException("not started")
          endStream()
          release()
          try {
            addAudio(output, audioPath, (fadeSeconds * 1_000_000).toLong())
          } catch (_: Exception) {
          }
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

  /** Rewrites `video` with the music as its soundtrack; the video samples are copied as they are. */
  private fun addAudio(video: File, audioPath: String, fadeUs: Long) {
    val extractor = MediaExtractor()
    val temp = File(video.parentFile, "with-audio-${video.name}")
    var muxer: MediaMuxer? = null
    try {
      extractor.setDataSource(video.absolutePath)
      val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true } ?: return
      val videoFormat = extractor.getTrackFormat(track)
      val durationUs = if (videoFormat.containsKey(MediaFormat.KEY_DURATION)) videoFormat.getLong(MediaFormat.KEY_DURATION) else frameIndex * 1_000_000L / fps
      val music = encodeMusic(Uri.parse(audioPath).path ?: audioPath, durationUs, fadeUs) ?: return

      val mux = MediaMuxer(temp.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      muxer = mux
      val videoTrack = mux.addTrack(videoFormat)
      val audioTrack = mux.addTrack(music.format)
      mux.start()
      extractor.selectTrack(track)
      val size = if (videoFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) videoFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 0
      val buffer = ByteBuffer.allocate(maxOf(size, width * height * 3 / 2))
      val info = MediaCodec.BufferInfo()
      while (true) {
        val read = extractor.readSampleData(buffer, 0)
        if (read < 0) break
        val key = extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0
        info.set(0, read, extractor.sampleTime, if (key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        mux.writeSampleData(videoTrack, buffer, info)
        extractor.advance()
      }
      for (sample in music.samples) {
        info.set(0, sample.data.size, sample.timeUs, sample.flags)
        mux.writeSampleData(audioTrack, ByteBuffer.wrap(sample.data), info)
      }
      mux.stop()
      mux.release()
      muxer = null
      if (!temp.renameTo(video)) {
        video.delete()
        temp.renameTo(video)
      }
    } finally {
      muxer?.release()
      extractor.release()
      temp.delete()
    }
  }

  /**
   * Decodes the music up to `durationUs`, fades it in briefly and out over the last `fadeUs`, and
   * re-encodes it as AAC. Null when the file can't be read as 16-bit audio.
   */
  private fun encodeMusic(path: String, durationUs: Long, fadeUs: Long): EncodedAudio? {
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    var encoder: MediaCodec? = null
    try {
      extractor.setDataSource(path)
      val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: return null
      extractor.selectTrack(track)
      val inputFormat = extractor.getTrackFormat(track)
      val dec = MediaCodec.createDecoderByType(inputFormat.getString(MediaFormat.KEY_MIME)!!)
      decoder = dec
      dec.configure(inputFormat, null, null, 0)
      dec.start()

      var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      val pcm = ArrayDeque<ByteArray>()
      val samples = mutableListOf<EncodedSample>()
      var outputFormat: MediaFormat? = null
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var decodeDone = false
      var encoderInputDone = false
      var encodeDone = false
      var framesIn = 0L
      var spins = 0

      while (!encodeDone) {
        if (++spins > 50_000) return null
        if (!inputDone) {
          val index = dec.dequeueInputBuffer(2_000)
          if (index >= 0) {
            val read = extractor.readSampleData(dec.getInputBuffer(index)!!, 0)
            if (read < 0 || extractor.sampleTime > durationUs) {
              dec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              dec.queueInputBuffer(index, 0, read, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        if (!decodeDone) {
          val index = dec.dequeueOutputBuffer(info, 2_000)
          if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            val format = dec.outputFormat
            sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            if (format.containsKey(MediaFormat.KEY_PCM_ENCODING) && format.getInteger(MediaFormat.KEY_PCM_ENCODING) != AudioFormat.ENCODING_PCM_16BIT) return null
          } else if (index >= 0) {
            if (info.size > 0) {
              val buffer = dec.getOutputBuffer(index)!!
              buffer.position(info.offset)
              buffer.limit(info.offset + info.size)
              pcm.addLast(ByteArray(info.size).also { buffer.get(it) })
            }
            dec.releaseOutputBuffer(index, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) decodeDone = true
          }
        }
        if (encoder == null && (pcm.isNotEmpty() || decodeDone)) {
          val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
          }
          encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).also {
            it.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            it.start()
          }
        }
        val enc = encoder ?: continue
        val totalFrames = durationUs * sampleRate / 1_000_000L
        if (!encoderInputDone && (pcm.isNotEmpty() || decodeDone)) {
          val index = enc.dequeueInputBuffer(2_000)
          if (index >= 0) {
            val buffer = enc.getInputBuffer(index)!!
            buffer.clear()
            if (pcm.isEmpty() || framesIn >= totalFrames) {
              enc.queueInputBuffer(index, 0, 0, framesIn * 1_000_000L / sampleRate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              encoderInputDone = true
            } else {
              val frameBytes = 2 * channels
              var chunk = pcm.removeFirst()
              val room = (buffer.capacity() / frameBytes) * frameBytes
              if (chunk.size > room) {
                pcm.addFirst(chunk.copyOfRange(room, chunk.size))
                chunk = chunk.copyOf(room)
              }
              val frames = minOf(chunk.size / frameBytes.toLong(), totalFrames - framesIn).toInt()
              fade(chunk, frames, channels, framesIn, sampleRate, durationUs, fadeUs)
              buffer.put(chunk, 0, frames * frameBytes)
              enc.queueInputBuffer(index, 0, frames * frameBytes, framesIn * 1_000_000L / sampleRate, 0)
              framesIn += frames
            }
          }
        }
        val out = enc.dequeueOutputBuffer(info, 2_000)
        if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          outputFormat = enc.outputFormat
        } else if (out >= 0) {
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) {
            val buffer = enc.getOutputBuffer(out)!!
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            val data = ByteArray(info.size).also { buffer.get(it) }
            samples.add(EncodedSample(data, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM.inv()))
          }
          enc.releaseOutputBuffer(out, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) encodeDone = true
        }
      }
      return outputFormat?.let { EncodedAudio(it, samples) }
    } finally {
      for (codec in listOf(decoder, encoder)) {
        try {
          codec?.stop()
        } catch (_: Exception) {
        }
        codec?.release()
      }
      extractor.release()
    }
  }

  /** Scales 16-bit little-endian PCM in place: a 0.3 s fade-in, and a fade-out over the last `fadeUs`. */
  private fun fade(pcm: ByteArray, frames: Int, channels: Int, firstFrame: Long, sampleRate: Int, durationUs: Long, fadeUs: Long) {
    for (f in 0 until frames) {
      val timeUs = (firstFrame + f) * 1_000_000L / sampleRate
      var gain = minOf(1.0, timeUs / 300_000.0)
      if (fadeUs > 0 && timeUs > durationUs - fadeUs) gain = minOf(gain, maxOf(0.0, (durationUs - timeUs).toDouble() / fadeUs))
      if (gain >= 1.0) continue
      for (ch in 0 until channels) {
        val i = (f * channels + ch) * 2
        val sample = ((pcm[i].toInt() and 0xff) or (pcm[i + 1].toInt() shl 8)).toShort()
        val scaled = (sample * gain).toInt()
        pcm[i] = (scaled and 0xff).toByte()
        pcm[i + 1] = ((scaled shr 8) and 0xff).toByte()
      }
    }
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
