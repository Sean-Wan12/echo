#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
archive="$root/dist/StudyLens-mac.zip"
if [[ ! -f "$archive" ]]; then
  /bin/bash "$root/scripts/build-mac.sh"
fi
scratch="$(mktemp -d "${TMPDIR:-/tmp}/studylens-setup.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
/usr/bin/ditto -x -k "$archive" "$scratch"
/usr/bin/codesign --verify --strict "$scratch/StudyLens.app"
app="$HOME/Applications/StudyLens.app"
mkdir -p "$HOME/Applications"
if [[ -e "$app" ]]; then
  existing=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null || true)
  if [[ "$existing" != com.studylens.helper ]]; then
    printf 'Another app is already at %s. Move it first and run setup again.\n' "$app" >&2
    exit 1
  fi
fi
/usr/bin/ditto --norsrc --noextattr "$scratch/StudyLens.app" "$app"
/usr/bin/codesign --verify --strict "$app"
hosts="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
mkdir -p "$hosts"
/usr/bin/osascript -l JavaScript - "$hosts/com.studylens.helper.json" "$app/Contents/MacOS/StudyLens" <<'JXA'
ObjC.import('Foundation');
function run(args) {
  const manifest = {name: 'com.studylens.helper', description: 'Echo Mac capture and ChatGPT helper',
    path: args[1], type: 'stdio', allowed_extensions: ['study-lens@local']};
  if (!$(JSON.stringify(manifest, null, 2) + '\n').writeToFileAtomicallyEncodingError($(args[0]), true, $.NSUTF8StringEncoding, null)) {
    throw Error('Could not register the Echo helper.');
  }
}
JXA
printf '\nEcho helper registered. In Zen, open about:debugging#/runtime/this-firefox,\nchoose Load Temporary Add-on, and select:\n\n%s\n\nPin Echo, open its sidebar, and choose Continue with ChatGPT.\n' "$root/extension/manifest.json"
