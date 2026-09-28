package expo.modules.systemdownloader

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * Thin wrapper over Android's system DownloadManager. Downloads continue after
 * the app is killed and across reboots; the app polls status on next launch.
 * Files land in the app-specific external dir (no storage permission needed,
 * removed on uninstall).
 */
class ExpoSystemDownloaderModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val manager: DownloadManager
    get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  // getExternalFilesDir is null while shared storage is unavailable; DownloadManager can't write internal storage.
  private fun modelsDir(): File {
    val root = context.getExternalFilesDir(null) ?: throw IllegalStateException("External storage unavailable")
    val dir = File(root, "models")
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  private fun missing() = mapOf(
    "status" to "missing",
    "reason" to null,
    "bytesDownloaded" to 0.0,
    "totalBytes" to -1.0,
    "localPath" to null,
  )

  override fun definition() = ModuleDefinition {
    Name("ExpoSystemDownloader")

    Function("getModelsDirectory") {
      modelsDir().absolutePath
    }

    Function("enqueue") { url: String, fileName: String, title: String, description: String, wifiOnly: Boolean ->
      val target = File(modelsDir(), fileName)
      if (target.exists()) target.delete()
      val request = DownloadManager.Request(Uri.parse(url))
        .setTitle(title)
        .setDescription(description)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
        .setDestinationUri(Uri.fromFile(target))
        .setAllowedOverMetered(!wifiOnly)
        .setAllowedOverRoaming(!wifiOnly)
        .setRequiresCharging(false)
      manager.enqueue(request).toString()
    }

    Function("query") { id: String ->
      val downloadId = id.toLongOrNull() ?: return@Function missing()
      val cursor = manager.query(DownloadManager.Query().setFilterById(downloadId))
        ?: return@Function missing()
      cursor.use {
        if (!it.moveToFirst()) return@Function missing()
        val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
        val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
        val done = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
        val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
        val localUri = it.getString(it.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
        mapOf(
          "status" to when (status) {
            DownloadManager.STATUS_PENDING -> "pending"
            DownloadManager.STATUS_RUNNING -> "running"
            DownloadManager.STATUS_PAUSED -> "paused"
            DownloadManager.STATUS_SUCCESSFUL -> "successful"
            DownloadManager.STATUS_FAILED -> "failed"
            else -> "unknown"
          },
          "reason" to when {
            status == DownloadManager.STATUS_PAUSED && reason == DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "queuedForWifi"
            status == DownloadManager.STATUS_PAUSED && reason == DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "waitingForNetwork"
            status == DownloadManager.STATUS_PAUSED && reason == DownloadManager.PAUSED_WAITING_TO_RETRY -> "waitingToRetry"
            status == DownloadManager.STATUS_FAILED && reason == DownloadManager.ERROR_INSUFFICIENT_SPACE -> "insufficientSpace"
            status == DownloadManager.STATUS_FAILED && reason == DownloadManager.ERROR_DEVICE_NOT_FOUND -> "storageUnavailable"
            status == DownloadManager.STATUS_FAILED && reason in 400..599 -> "http$reason"
            status == DownloadManager.STATUS_FAILED -> "failed$reason"
            else -> null
          },
          "bytesDownloaded" to done.toDouble(),
          "totalBytes" to total.toDouble(),
          "localPath" to localUri?.let { uri -> Uri.parse(uri).path },
        )
      }
    }

    // Also deletes the downloaded file, so never call it after a successful download.
    Function("remove") { id: String ->
      val downloadId = id.toLongOrNull() ?: return@Function false
      manager.remove(downloadId) > 0
    }

    AsyncFunction("fileSize") { path: String ->
      val file = File(path)
      if (file.exists()) file.length().toDouble() else -1.0
    }

    AsyncFunction("sha256") { path: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(File(path)).use { input ->
        val buffer = ByteArray(1 shl 20)
        while (true) {
          val read = input.read(buffer)
          if (read <= 0) break
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    AsyncFunction("deleteFile") { path: String ->
      val file = File(path)
      !file.exists() || file.delete()
    }
  }
}
