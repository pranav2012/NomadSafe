package expo.modules.bootclock

import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoBootClockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoBootClock")

    // Milliseconds since boot, including deep sleep; the user can't change it.
    Function("getElapsedSinceBootMs") {
      SystemClock.elapsedRealtime().toDouble()
    }
  }
}
