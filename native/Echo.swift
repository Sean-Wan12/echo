import AppKit
import Foundation

@MainActor
final class Helper: NSObject {
    private let chatgpt = ChatGPTClient()
    private var menuItem: NSStatusItem?
    private var selecting = false

    func start(native: Bool) {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let url = Bundle.main.url(forResource: "EchoMenu", withExtension: "png"),
           let icon = NSImage(contentsOf: url) {
            icon.size = NSSize(width: 18, height: 18)
            icon.isTemplate = false
            icon.accessibilityDescription = "Echo"
            item.button?.image = icon
        } else {
            item.button?.image = NSImage(systemSymbolName: "viewfinder", accessibilityDescription: "Echo")
        }
        item.button?.toolTip = "Echo · Mac capture helper"
        let menu = NSMenu()
        let label = NSMenuItem(title: "Echo", action: nil, keyEquivalent: ""); menu.addItem(label)
        let settings = NSMenuItem(title: "Screen Recording Settings…", action: #selector(openSettings), keyEquivalent: ""); settings.target = self; menu.addItem(settings)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Echo Helper", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); quit.target = app; menu.addItem(quit)
        item.menu = menu; menuItem = item
        if native {
            Thread.detachNewThread { [self] in
                do {
                    while let request = try NativeWire.read(.standardInput) {
                        DispatchQueue.main.async { self.receive(request) }
                    }
                    exit(0)
                } catch {
                    FileHandle.standardError.write(Data("Echo: invalid native message stream.\n".utf8)); exit(1)
                }
            }
        }
        app.run()
    }

    @objc private func openSettings() { ScreenCapture.settings() }

    private func receive(_ request: JSONObject) {
        guard let id = request["id"] as? String, let method = request["method"] as? String else { return }
        let params = request["params"] as? JSONObject ?? [:]
        Task {
            do {
                let result: Any
                switch method {
                case "status": result = try chatgpt.status()
                case "permissions": ScreenCapture.settings(); result = [:] as JSONObject
                case "capture":
                    guard !selecting else { throw LensError("Finish the current screenshot first.") }
                    selecting = true; defer { selecting = false }
                    result = try await ScreenCapture.select()
                case "signin": try await chatgpt.signIn(); result = try chatgpt.status()
                case "signout": try chatgpt.signOut(); result = try chatgpt.status()
                case "models": result = try await chatgpt.models()
                case "respond":
                    guard let model = params["model"] as? String, !model.isEmpty,
                          let input = params["input"] as? [JSONObject], !input.isEmpty else { throw LensError("A model and question are needed.") }
                    let answer = try await chatgpt.respond(model: model, input: input) { delta in
                        self.write(["id": id, "event": "delta", "text": delta])
                    }
                    result = ["text": answer]
                default: throw LensError("Unknown Echo helper request.")
                }
                try FileHandle.standardOutput.write(contentsOf: NativeWire.frame(["id": id, "ok": true, "result": result]))
            } catch {
                // Keep tokens, screenshots, and request bodies out of stderr and errors.
                let reason = (error as? LensError)?.message ?? "Echo could not complete this request. Check your connection and try again."
                write(["id": id, "ok": false, "error": reason])
            }
        }
    }
    private func write(_ object: JSONObject) {
        if let frame = try? NativeWire.frame(object) { try? FileHandle.standardOutput.write(contentsOf: frame) }
    }
}

@main
enum Echo {
    @MainActor static func main() {
        umask(0o077)
        let helper = Helper()
        let first = CommandLine.arguments.dropFirst().first
        // Gecko passes the native messaging manifest path as its first argument.
        helper.start(native: first == "--native-host" || first?.hasSuffix("/com.studylens.helper.json") == true)
    }
}
