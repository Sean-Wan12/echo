import Foundation
import Network

// The authorization listener accepts only a single valid callback on loopback.
// All mutable callback state is confined to `queue`.
final class Loopback: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "Echo.auth.callback")
    private let state: String
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private var portResult: Result<UInt16, Error>?
    private var portWaiter: CheckedContinuation<UInt16, Error>?
    private var result: Result<[String: String], Error>?
    private var resultWaiter: CheckedContinuation<[String: String], Error>?

    init(state: String) throws {
        self.state = state
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        listener.stateUpdateHandler = { [weak self] status in
            guard let self else { return }
            switch status {
            case .ready:
                if let port = self.listener.port?.rawValue { self.setPort(.success(port)) }
                else { self.finish(.failure(LensError("Could not start ChatGPT sign-in."))) }
            case .failed: self.finish(.failure(LensError("Could not open the local sign-in callback.")))
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 300) { [weak self] in self?.finish(.failure(LensError("Sign-in timed out. Try again from the sidebar."))) }
    }

    func port() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { if let result = self.portResult { continuation.resume(with: result) } else { self.portWaiter = continuation } }
        }
    }
    func callback() async throws -> [String: String] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { if let result = self.result { continuation.resume(with: result) } else { self.resultWaiter = continuation } }
        }
    }
    func close() { queue.async { self.finish(.failure(LensError("Sign-in was closed."))) } }
    private func setPort(_ value: Result<UInt16, Error>) {
        guard portResult == nil else { return }
        portResult = value; portWaiter?.resume(with: value); portWaiter = nil
    }
    private func finish(_ value: Result<[String: String], Error>) {
        guard result == nil else { return }
        if case .failure(let error) = value { setPort(.failure(error)) }
        result = value; resultWaiter?.resume(with: value); resultWaiter = nil
        listener.cancel()
        connections.values.forEach { $0.cancel() }; connections.removeAll()
    }
    private func accept(_ connection: NWConnection) {
        guard result == nil, connections.count < 12 else { connection.cancel(); return }
        let key = ObjectIdentifier(connection)
        connections[key] = connection
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 10) { [weak self] in self?.connections.removeValue(forKey: key)?.cancel() }
        read(connection, buffer: Data())
    }
    private func read(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] bytes, _, complete, error in
            guard let self, self.result == nil else { return }
            let data = buffer + (bytes ?? Data())
            if data.count > 16_384 || error != nil { self.reply(connection, status: "400 Bad Request", text: "Invalid request."); return }
            guard data.range(of: Data("\r\n\r\n".utf8)) != nil else {
                if complete { self.reply(connection, status: "400 Bad Request", text: "Invalid request.") }
                else { self.read(connection, buffer: data) }
                return
            }
            let request = String(decoding: data, as: UTF8.self).components(separatedBy: "\r\n").first?.split(separator: " ") ?? []
            guard request.count == 3, request[0] == "GET", request[1].hasPrefix("/"),
                  let url = URLComponents(string: "http://127.0.0.1" + request[1]), url.path == "/auth/callback" else {
                self.reply(connection, status: "404 Not Found", text: "Echo sign-in callback not found."); return
            }
            var fields: [String: String] = [:]
            for item in url.queryItems ?? [] {
                guard fields[item.name] == nil else { self.reply(connection, status: "400 Bad Request", text: "Invalid callback."); return }
                fields[item.name] = item.value ?? ""
            }
            guard fields["state"] == self.state else { self.reply(connection, status: "400 Bad Request", text: "This callback does not match the current sign-in."); return }
            self.reply(connection, status: "200 OK", text: "Return to the Echo sidebar to finish signing in.", completion: { self.finish(.success(fields)) })
        }
    }
    private func reply(_ connection: NWConnection, status: String, text: String, completion: (() -> Void)? = nil) {
        let body = "<!doctype html><meta charset=utf-8><title>Echo</title><style>body{font:18px system-ui;margin:12vh auto;padding:20px;max-width:32em;color:#754308}</style><h1>Echo</h1><p>\(text)</p>"
        let response = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n\(body)"
        connection.send(content: Data(response.utf8), completion: .contentProcessed { [weak self] _ in
            self?.connections.removeValue(forKey: ObjectIdentifier(connection)); connection.cancel(); completion?()
        })
    }
}
