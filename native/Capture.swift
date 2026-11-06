import AppKit
import ImageIO
import UniformTypeIdentifiers
import CoreGraphics

@MainActor
enum ScreenCapture {
    static func settings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
    }

    static func select() async throws -> JSONObject {
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            throw LensError("Allow screen recording for Echo (or Zen if macOS lists it) in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen Zen and try again.")
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Echo-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("snapshot.png")

        // Use the system's interactive region selector, the same interaction as Cmd–Shift–4.
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-i", "-s", "-x", file.path]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int32, Error>) in
            process.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
            do { try process.run() } catch { continuation.resume(throwing: error) }
        }
        guard FileManager.default.fileExists(atPath: file.path) else { return ["cancelled": true] }
        return ["cancelled": false, "image": try imageForBrowser(file)]
    }

    static func imageForBrowser(_ file: URL) throws -> String {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil) else { throw LensError("The snapshot could not be read.") }
        for dimension in [1900, 1500, 1100, 800, 550] {
            let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: dimension, kCGImageSourceCreateThumbnailWithTransform: true]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { break }
            let output = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { break }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
            if CGImageDestinationFinalize(destination), output.length <= 600_000 {
                return "data:image/jpeg;base64," + (output as Data).base64EncodedString()
            }
        }
        throw LensError("The snapshot was too large. Try selecting a smaller area.")
    }
}
