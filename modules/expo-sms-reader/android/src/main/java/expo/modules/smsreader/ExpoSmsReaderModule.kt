package expo.modules.smsreader

import android.Manifest
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads bank/UPI/card alert SMS from the device inbox for the expense importer.
 * Android-only; requires the runtime READ_SMS permission.
 */
class ExpoSmsReaderModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ExpoSmsReader")

    Function("getPermissionStatus") {
      if (hasPermission()) "granted" else "undetermined"
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      val permissions = appContext.permissions
        ?: throw CodedException("Permissions module not available")
      Permissions.askForPermissionsWithPermissionsManager(
        permissions,
        promise,
        Manifest.permission.READ_SMS
      )
    }

    AsyncFunction("readInbox") { sinceEpochMs: Double, limit: Int ->
      if (!hasPermission()) {
        throw CodedException("READ_SMS permission not granted")
      }
      readInbox(sinceEpochMs.toLong(), limit)
    }
  }

  private fun hasPermission(): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
      PackageManager.PERMISSION_GRANTED

  private fun readInbox(sinceEpochMs: Long, limit: Int): List<Map<String, Any>> {
    val results = mutableListOf<Map<String, Any>>()
    val projection = arrayOf(
      Telephony.Sms.ADDRESS,
      Telephony.Sms.BODY,
      Telephony.Sms.DATE
    )
    val selection = "${Telephony.Sms.DATE} >= ?"
    val selectionArgs = arrayOf(sinceEpochMs.toString())
    val sortOrder = "${Telephony.Sms.DATE} DESC LIMIT $limit"

    context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      projection,
      selection,
      selectionArgs,
      sortOrder
    )?.use { cursor ->
      val addressIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
      val bodyIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
      val dateIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
      while (cursor.moveToNext()) {
        results.add(
          mapOf(
            "address" to (cursor.getString(addressIdx) ?: ""),
            "body" to (cursor.getString(bodyIdx) ?: ""),
            "date" to cursor.getLong(dateIdx)
          )
        )
      }
    }
    return results
  }
}
