import SwiftUI
import WidgetKit

struct SosLabels: Codable {
  var title = "SOS"
  var hint = "Tap to alert contacts"
}

struct SosEntry: TimelineEntry {
  let date: Date
  let labels: SosLabels
}

struct SosProvider: TimelineProvider {
  func placeholder(in context: Context) -> SosEntry { SosEntry(date: .now, labels: SosLabels()) }

  func getSnapshot(in context: Context, completion: @escaping (SosEntry) -> Void) {
    completion(entry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SosEntry>) -> Void) {
    completion(Timeline(entries: [entry()], policy: .never))
  }

  private func entry() -> SosEntry {
    SosEntry(date: .now, labels: decode("sosLabels", as: SosLabels.self) ?? SosLabels())
  }
}

// Opens the app's 5-second cancellable SOS countdown (see src/features/safety/store/quickSosStore.ts).
// Without the app's token (not synced yet) the link only opens the Safety tab.
private var sosURL: URL {
  var components = URLComponents(string: "nomadsafe://sos")!
  var items = [URLQueryItem(name: "trigger", value: "widget")]
  if let token = widgetToken() { items.append(URLQueryItem(name: "t", value: token)) }
  components.queryItems = items
  return components.url!
}
private let sosRed = Color(red: 1, green: 0.302, blue: 0.369)

struct SosWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SosEntry

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        Text(entry.labels.title).font(.system(size: 15, weight: .heavy))
      }
      .widgetURL(sosURL)
    default:
      VStack(spacing: 8) {
        ZStack {
          Circle().fill(sosRed).frame(width: 60, height: 60)
          Image(systemName: "exclamationmark.shield.fill").font(.system(size: 28)).foregroundStyle(.white)
        }
        Text(entry.labels.title).font(.headline)
        Text(entry.labels.hint).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
      }
      .containerBackground(Color("widgetPaper"), for: .widget)
      .widgetURL(sosURL)
    }
  }
}

struct SosWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SosWidget", provider: SosProvider()) { SosWidgetView(entry: $0) }
      .configurationDisplayName("SOS")
      .description("One tap starts a 5-second countdown, then alerts your emergency contacts.")
      .supportedFamilies([.systemSmall, .accessoryCircular])
  }
}

@main
struct NomadSafeWidgets: WidgetBundle {
  var body: some Widget {
    VoiceExpenseWidget()
    SosWidget()
  }
}
