"""Check local sign-in handoff/cancellation without opening OpenAI or changing credentials."""
import argparse
import json
from pathlib import Path
import select
import struct
import subprocess
import uuid
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", type=Path, default=Path.home() / "Applications/Echo.app/Contents/MacOS/Echo")
    args = parser.parse_args()
    with subprocess.Popen([str(args.host), "--native-host"], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        def send(method, params=None):
            ident = str(uuid.uuid4())
            body = json.dumps({"id": ident, "method": method, "params": params or {}}).encode()
            process.stdin.write(struct.pack("=I", len(body)) + body)
            process.stdin.flush()
            return ident

        def receive(ident):
            assert select.select([process.stdout], [], [], 15)[0], "Native sign-in handoff timed out"
            header = process.stdout.read(4)
            assert len(header) == 4, "Native helper ended before responding"
            size = struct.unpack("=I", header)[0]
            assert 0 < size < 1_048_576
            message = json.loads(process.stdout.read(size))
            assert message["id"] == ident
            return message

        try:
            baseline = receive(send("status"))
            assert baseline["ok"] and baseline["result"]["browserSignIn"] is True
            ident = send("signin", {"browserAuthorization": True})
            handoff = receive(ident)
            assert handoff.get("event") == "authorization", "Missing browser authorization event"
            target = urlsplit(handoff["url"])
            assert target.scheme == "https" and target.netloc == "auth.openai.com"
            assert target.path == "/api/accounts/authorize"
            fields = parse_qs(target.query)
            assert "id_token_hint" not in fields and "code_verifier" not in fields
            assert fields["code_challenge_method"] == ["S256"]
            callback = urlsplit(fields["redirect_uri"][0])
            assert callback.scheme == "http" and callback.hostname == "127.0.0.1"
            assert callback.path == "/auth/callback"
            # Exercise the error callback locally: no OpenAI token request is made.
            denial = fields["redirect_uri"][0] + "?" + urlencode({"state": fields["state"][0], "error": "access_denied"})
            with urlopen(denial, timeout=5) as response:
                assert response.status == 200
            result = receive(ident)
            assert result.get("ok") is False and "declined" in result.get("error", "")
            after = receive(send("status"))
            assert after["result"]["connected"] == baseline["result"]["connected"]
            print("Native sign-in hands a token-free authorization URL to Zen and handles a cancelled callback.")
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
