#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
build="$root/.build"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/echo-build.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
app="$scratch/Echo.app"
resources="$app/Contents/Resources"
mkdir -p "$build/module-cache" "$app/Contents/MacOS" "$resources" "$root/dist"
set --
swift_include="$(dirname "$(xcrun --find swiftc)")/../include/swift"
# Some CLT installations contain two identical SwiftBridging module maps.
# Mask the stale map for this build only; leave the system toolchain alone.
if [[ -f "$swift_include/bridging.modulemap" && -f "$swift_include/module.modulemap" && \
      $(<"$swift_include/module.modulemap") == *"module SwiftBridging"* ]]; then
  swift_include="$(cd "$swift_include" && pwd -P)"
  : > "$build/empty.modulemap"
  /usr/bin/osascript -l JavaScript - "$swift_include/module.modulemap" "$build/empty.modulemap" > "$build/swift-overlay.json" <<'JXA'
function run(args) { return JSON.stringify({version: 0, 'case-sensitive': 'false', roots: [{type: 'file', name: args[0], 'external-contents': args[1]}]}); }
JXA
  set -- -vfsoverlay "$build/swift-overlay.json" -Xcc -ivfsoverlay -Xcc "$build/swift-overlay.json"
fi
swiftc -swift-version 5 -O -whole-module-optimization -parse-as-library -module-cache-path "$build/module-cache" "$@" \
  -target "$(uname -m)-apple-macos13.0" "$root"/native/*.swift -o "$app/Contents/MacOS/Echo"
cp "$root/native/Info.plist" "$app/Contents/Info.plist"
cp "$root/extension/icons/apple-cutout.png" "$resources/EchoMenu.png"
/usr/bin/sips -s format icns "$resources/EchoMenu.png" --out "$resources/Echo.icns" >/dev/null
/usr/bin/xattr -cr "$app"
/usr/bin/codesign --force --sign - "$app"
/usr/bin/codesign --verify --strict "$app"
/usr/bin/ditto -c -k --keepParent --norsrc --noextattr "$app" "$scratch/Echo-mac.zip"
mv -f "$scratch/Echo-mac.zip" "$root/dist/Echo-mac.zip"
printf 'Built %s\n' "$root/dist/Echo-mac.zip"
