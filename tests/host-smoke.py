"""Exercise the installed Swift host without network or capture."""
import json
from pathlib import Path
import struct
import subprocess
import uuid


def call(process, method, **params):
    ident = str(uuid.uuid4())
    request = json.dumps({"id": ident, "method": method, "params": params}).encode()
    process.stdin.write(struct.pack("=I", len(request)) + request)
    process.stdin.flush()
    chunks = []
    while True:
        header = process.stdout.read(4)
        assert len(header) == 4, "Host ended before responding"
        length = struct.unpack("=I", header)[0]
        assert 0 < length < 1_048_576, "Invalid response frame"
        message = json.loads(process.stdout.read(length))
        assert message["id"] == ident, message
        if message.get("event") == "delta":
            chunks.append(message["text"])
        else:
            assert message["ok"], message.get("error")
            return message["result"], "".join(chunks)


def main():
    manifest_path = Path.home() / "Library/Application Support/Mozilla/NativeMessagingHosts/com.studylens.helper.json"
    host = Path(json.loads(manifest_path.read_text())["path"])
    assert host == Path.home() / "Applications/Echo.app/Contents/MacOS/Echo", host
    with subprocess.Popen([str(host), "--native-host"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        try:
            result, _ = call(process, "status")
            assert isinstance(result["connected"], bool)
        finally:
            process.stdin.close()
        assert process.wait(timeout=5) == 0
    print("Installed Swift helper responds over native messaging.")


if __name__ == "__main__":
    main()
