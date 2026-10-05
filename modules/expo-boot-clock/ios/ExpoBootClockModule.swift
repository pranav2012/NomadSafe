import ExpoModulesCore
import Darwin

public class ExpoBootClockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoBootClock")

    // Milliseconds since boot, including sleep (Darwin's CLOCK_MONOTONIC); the user can't change it.
    Function("getElapsedSinceBootMs") {
      Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1_000_000
    }
  }
}
