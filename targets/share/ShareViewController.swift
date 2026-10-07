import UIKit
import UniformTypeIdentifiers

/// Share sheet entry ("NomadSafe"): takes the shared link (or text holding one) and opens the app,
/// which asks which trip to save it to. Nothing is stored here.
class ShareViewController: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Task { await handOff() }
  }

  private func handOff() async {
    var link: String?
    var text: String?
    for item in (extensionContext?.inputItems as? [NSExtensionItem]) ?? [] {
      if text == nil, let content = item.attributedContentText?.string, !content.isEmpty { text = content }
      for provider in item.attachments ?? [] {
        if link == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
           url.scheme == "http" || url.scheme == "https" {
          link = url.absoluteString
        }
        if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
           let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
          text = value
        }
      }
    }

    var components = URLComponents()
    components.scheme = "nomadsafe"
    components.host = "save-link"
    // Long captions are cut; the app only needs enough to find the link and the place.
    components.queryItems = [
      link.map { URLQueryItem(name: "url", value: $0) },
      text.map { URLQueryItem(name: "text", value: String($0.prefix(1000))) },
    ].compactMap { $0 }
    await MainActor.run {
      if let url = components.url, link != nil || text != nil { openHostApp(url) }
      extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }

  // Extensions can't reach UIApplication.shared; walk the responder chain to the app instead.
  private func openHostApp(_ url: URL) {
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(url)
        return
      }
      responder = current.next
    }
  }
}
