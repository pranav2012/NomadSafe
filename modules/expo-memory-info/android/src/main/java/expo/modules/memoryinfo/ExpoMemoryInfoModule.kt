package expo.modules.memoryinfo

import android.app.ActivityManager
import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoMemoryInfoModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ExpoMemoryInfo")

    Function("getAvailableMemoryBytes") {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val info = ActivityManager.MemoryInfo()
      manager.getMemoryInfo(info)
      info.availMem.toDouble()
    }
  }
}
