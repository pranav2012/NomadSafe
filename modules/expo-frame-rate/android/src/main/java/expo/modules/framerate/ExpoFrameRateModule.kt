package expo.modules.framerate

import android.os.Build
import android.view.Display
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoFrameRateModule : Module() {
  private var recentsHidden = false

  // Android 13+: a blank card in the recents screen instead of a screenshot of the app.
  private fun applyRecentsPreview() {
    if (Build.VERSION.SDK_INT < 33) return
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread { activity.setRecentsScreenshotEnabled(!recentsHidden) }
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoFrameRate")

    // Re-applied when the activity comes back, since it may not exist yet when JS first calls this.
    OnActivityEntersForeground { applyRecentsPreview() }

    Function("setRecentsPreviewHidden") { hidden: Boolean ->
      recentsHidden = hidden
      applyRecentsPreview()
    }

    // Asks for the display's top refresh rate (e.g. 120 Hz on adaptive screens) while `high` is true,
    // and hands the choice back to the system when it's false.
    Function("setHighFrameRate") { high: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        val window = activity.window ?: return@runOnUiThread
        val display: Display? = if (Build.VERSION.SDK_INT >= 30) activity.display else {
          @Suppress("DEPRECATION")
          activity.windowManager.defaultDisplay
        }
        val top = display?.supportedModes?.maxOfOrNull { it.refreshRate } ?: 0f
        val attrs = window.attributes
        val wanted = if (high) top else 0f
        if (attrs.preferredRefreshRate != wanted) {
          attrs.preferredRefreshRate = wanted
          window.attributes = attrs
        }
        if (Build.VERSION.SDK_INT >= 35) window.setFrameRatePowerSavingsBalanced(!high)
      }
    }
  }
}
