import ExpoModulesCore
import os

public class ExpoMemoryInfoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoMemoryInfo")

    Function("getAvailableMemoryBytes") {
      Double(os_proc_available_memory())
    }
  }
}
