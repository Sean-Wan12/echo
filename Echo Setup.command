#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
python3 "$root/scripts/package-extension.py"
archive="$root/dist/Echo-mac.zip"
for source in "$root/scripts/build-mac.sh" "$root/extension/icons/apple-cutout.png" "$root"/native/*; do
  if [[ ! -f "$archive" || "$source" -nt "$archive" ]]; then
    /bin/bash "$root/scripts/build-mac.sh"
    break
  fi
done

apps="$HOME/Applications"
app="$apps/Echo.app"
legacy="$apps/StudyLens.app"
is_echo() {
  [[ ! -L "$1" && $(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null) == com.studylens.helper ]]
}
if [[ -e "$app" || -L "$app" ]] && ! is_echo "$app"; then
  printf 'Another app is already at %s. Move it first and run setup again.\n' "$app" >&2
  exit 1
fi
mkdir -p "$apps"
scratch="$(mktemp -d "$apps/.echo-setup.XXXXXX")"
installed=0
registered=0
cleanup() {
  if (( ! registered )); then
    if (( installed )); then mv "$app" "$scratch/failed-Echo.app" || return; fi
    if [[ -d "$scratch/previous-Echo.app" ]]; then mv "$scratch/previous-Echo.app" "$app" || return; fi
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
/usr/bin/ditto -x -k "$archive" "$scratch"
/usr/bin/codesign --verify --strict "$scratch/Echo.app"
if [[ -e "$app" ]]; then mv "$app" "$scratch/previous-Echo.app"; fi
mv "$scratch/Echo.app" "$app"
installed=1
hosts="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
mkdir -p "$hosts"
/usr/bin/osascript -l JavaScript - "$hosts/com.studylens.helper.json" "$app/Contents/MacOS/Echo" <<'JXA'
ObjC.import('Foundation');
function run(args) {
  const manifest = {name: 'com.studylens.helper', description: 'Echo Mac capture and ChatGPT helper',
    path: args[1], type: 'stdio', allowed_extensions: ['study-lens@local']};
  if (!$(JSON.stringify(manifest, null, 2) + '\n').writeToFileAtomicallyEncodingError($(args[0]), true, $.NSUTF8StringEncoding, null)) {
    throw Error('Could not register the Echo helper.');
  }
}
JXA
registered=1
if is_echo "$legacy"; then mv "$legacy" "$scratch/previous-StudyLens.app"; fi
printf '\nEcho helper installed at %s. In Zen, open about:addons,\nchoose the gear menu → Install Add-on From File, and select the signed update:\n\n%s\n\nOpen Echo with Command+Shift+U. The unsigned Echo.xpi is for Mozilla signing or temporary development only.\n' "$app" "$root/dist/Echo-signed.xpi"
