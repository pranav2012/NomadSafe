import AppIntents
import SwiftUI
import WidgetKit

private let appGroup = UserDefaults(suiteName: "group.com.pranav.NomadSafe")

struct SharedTrip: Codable {
  let id: String
  let name: String
}

struct SharedLabels: Codable {
  var eyebrow = "Speak to add"
  var speak = "Speak"
  var noTrip = "No trip yet"
  var defaultTrip = "Active trip"
}

// The app writes these as JSON strings via ExtensionStorage (see src/features/widget/syncWidgets.ts).
private func decode<T: Decodable>(_ key: String, as type: T.Type) -> T? {
  guard let raw = appGroup?.string(forKey: key), let data = raw.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(T.self, from: data)
}

private func sharedTrips() -> [SharedTrip] { decode("trips", as: [SharedTrip].self) ?? [] }
private func sharedLabels() -> SharedLabels { decode("labels", as: SharedLabels.self) ?? SharedLabels() }

struct TripEntity: AppEntity {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Trip"
  static var defaultQuery = TripQuery()
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct TripQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [TripEntity] {
    sharedTrips().filter { identifiers.contains($0.id) }.map { TripEntity(id: $0.id, name: $0.name) }
  }

  func suggestedEntities() async throws -> [TripEntity] {
    sharedTrips().map { TripEntity(id: $0.id, name: $0.name) }
  }
}

struct SelectTripIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Choose trip"
  static var description = IntentDescription("Trip that spoken expenses are added to. Leave empty to follow the app's active trip.")

  @Parameter(title: "Trip")
  var trip: TripEntity?
}

struct VoiceEntry: TimelineEntry {
  let date: Date
  let tripId: String?
  let tripName: String
  let labels: SharedLabels
}

struct VoiceProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> VoiceEntry {
    VoiceEntry(date: .now, tripId: nil, tripName: "Lisbon", labels: SharedLabels())
  }

  func snapshot(for configuration: SelectTripIntent, in context: Context) async -> VoiceEntry {
    entry(for: configuration)
  }

  func timeline(for configuration: SelectTripIntent, in context: Context) async -> Timeline<VoiceEntry> {
    Timeline(entries: [entry(for: configuration)], policy: .never)
  }

  /// A picked trip that was since deleted falls back to the app's default trip.
  private func entry(for configuration: SelectTripIntent) -> VoiceEntry {
    let labels = sharedLabels()
    let trips = sharedTrips()
    let defaultId = appGroup?.string(forKey: "defaultTripId")
    let trip = trips.first { $0.id == configuration.trip?.id } ?? trips.first { $0.id == defaultId }
    return VoiceEntry(date: .now, tripId: trip?.id, tripName: trip?.name ?? labels.noTrip, labels: labels)
  }
}

private func captureURL(tripId: String?, autostart: Bool, pickTrip: Bool = false) -> URL {
  var components = URLComponents(string: "nomadsafe://voice-expense")!
  var items = [URLQueryItem(name: "source", value: "widget")]
  if let tripId { items.append(URLQueryItem(name: "tripId", value: tripId)) }
  if autostart { items.append(URLQueryItem(name: "autostart", value: "1")) }
  if pickTrip { items.append(URLQueryItem(name: "pickTrip", value: "1")) }
  components.queryItems = items
  return components.url!
}

struct VoiceExpenseWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: VoiceEntry

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: "mic.fill").font(.title2)
      }
      .widgetURL(captureURL(tripId: entry.tripId, autostart: true))
    case .systemSmall:
      content(tripLink: false)
        .widgetURL(captureURL(tripId: entry.tripId, autostart: true))
    default:
      content(tripLink: true)
    }
  }

  private func content(tripLink: Bool) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      tripHeader(tappable: tripLink)
      Spacer(minLength: 0)
      speakButton
    }
    .containerBackground(Color("widgetPaper"), for: .widget)
  }

  @ViewBuilder
  private func tripHeader(tappable: Bool) -> some View {
    let header = VStack(alignment: .leading, spacing: 2) {
      Text(entry.labels.eyebrow.uppercased())
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(.secondary)
      HStack(spacing: 4) {
        Text(entry.tripName).font(.headline).lineLimit(1)
        if tappable { Image(systemName: "chevron.down").font(.caption).foregroundStyle(.secondary) }
      }
    }
    if tappable {
      Link(destination: captureURL(tripId: entry.tripId, autostart: false, pickTrip: true)) { header }
    } else {
      header
    }
  }

  private var speakButton: some View {
    let label = HStack(spacing: 6) {
      Image(systemName: "mic.fill")
      Text(entry.labels.speak).fontWeight(.semibold)
    }
    .frame(maxWidth: .infinity, minHeight: 40)
    .foregroundStyle(.white)
    .background(Capsule().fill(Color("widgetTeal")))

    return Group {
      if family == .systemSmall {
        label
      } else {
        Link(destination: captureURL(tripId: entry.tripId, autostart: true)) { label }
      }
    }
  }
}

@main
struct VoiceExpenseWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "VoiceExpenseWidget", intent: SelectTripIntent.self, provider: VoiceProvider()) {
      VoiceExpenseWidgetView(entry: $0)
    }
    .configurationDisplayName("Speak to add")
    .description("Add a trip expense by speaking.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
  }
}
