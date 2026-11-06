import Foundation

typealias JSONObject = [String: Any]

struct LensError: LocalizedError {
    var message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum NativeWire {
    static let outgoingLimit = 1_048_576
    static let incomingLimit = 40_000_000

    static func read(_ handle: FileHandle) throws -> JSONObject? {
        guard let header = try readExactly(4, from: handle, allowEOF: true) else { return nil }
        let length = header.withUnsafeBytes { Int($0.loadUnaligned(as: UInt32.self)) }
        guard length > 0, length <= incomingLimit else { throw LensError("Invalid native message size.") }
        guard let data = try readExactly(length, from: handle),
              let object = try JSONSerialization.jsonObject(with: data) as? JSONObject else { throw LensError("Invalid native message.") }
        return object
    }

    private static func readExactly(_ count: Int, from handle: FileHandle, allowEOF: Bool = false) throws -> Data? {
        var result = Data()
        while result.count < count {
            guard let chunk = try handle.read(upToCount: count - result.count), !chunk.isEmpty else {
                if allowEOF && result.isEmpty { return nil }
                throw LensError("Native message ended unexpectedly.")
            }
            result.append(chunk)
        }
        return result
    }

    static func frame(_ object: JSONObject) throws -> Data {
        let json = try JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
        guard json.count < outgoingLimit else { throw LensError("This snapshot is too large. Try selecting a smaller area.") }
        var size = UInt32(json.count)
        var data = withUnsafeBytes(of: &size) { Data($0) }
        data.append(json)
        return data
    }
}

struct SSEEvents {
    private var data: [String] = []
    private var lineBytes = Data()
    mutating func byte(_ byte: UInt8) -> JSONObject? {
        guard byte == 10 else { lineBytes.append(byte); return nil }
        let value = String(decoding: lineBytes, as: UTF8.self)
        lineBytes.removeAll(keepingCapacity: true)
        return line(value)
    }
    mutating func line(_ line: String) -> JSONObject? {
        let clean = line.hasSuffix("\r") ? String(line.dropLast()) : line
        if clean.isEmpty {
            guard !data.isEmpty else { return nil }
            let text = data.joined(separator: "\n")
            data.removeAll(keepingCapacity: true)
            guard let bytes = text.data(using: .utf8) else { return nil }
            return (try? JSONSerialization.jsonObject(with: bytes)) as? JSONObject
        }
        if clean.hasPrefix("data:") {
            let payload = clean.dropFirst(5)
            data.append(String(payload.first == " " ? payload.dropFirst() : payload))
        }
        return nil
    }
}

extension Data {
    var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    init?(base64URL text: String) {
        let base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        self.init(base64Encoded: base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4))
    }
}
