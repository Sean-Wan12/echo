# Echo private signing submission

Distribution: **On your own** (unlisted). This is a personal Zen/macOS study assistant, not a public store listing. Keep extension ID `study-lens@local` so it matches the installed native messaging host.

## Build

The first-party extension JavaScript, HTML and CSS in `extension/` are original readable source, without transpilation, bundling or minification. Python 3.10 or later and its standard library are sufficient:

```
python3 scripts/package-extension.py
```

This archives the extension directory into `dist/Echo.xpi`. Do not upload the whole browser profile, Keychain, or any sign-in credentials. Download Mozilla's signed result separately as `dist/Echo-signed.xpi`.

## Third-party library

The unmodified bundled KaTeX release is **0.19.1**, including auto-render, CSS, fonts and its MIT license. Official release/source: https://github.com/KaTeX/KaTeX/releases/tag/v0.19.1 . Repository: https://github.com/KaTeX/KaTeX . These are the only minified JavaScript libraries in the package; first-party code does not need a source build. Every bundled library file was compared byte-for-byte with the official npm `katex@0.19.1` release before submission. Declare source processing in Mozilla’s form and supply `dist/Echo-source.zip`, which includes the upstream KaTeX source and lockfile alongside Echo’s readable source.

To rebuild KaTeX, use its supplied `package.json`, `pnpm-lock.yaml`, and build configuration in `third-party/KaTeX-0.19.1/`: install Node.js and pnpm 11.4.0, then run `pnpm install --frozen-lockfile` and `pnpm build`. The extension uses the official release’s `dist/katex.min.js`, `dist/katex.min.css`, `dist/contrib/auto-render.min.js`, `dist/fonts/`, and LICENSE. The included official release tarball also permits independent byte comparison without rebuilding the upstream library.

## Functionality and permissions

Echo opens a temporary conversation in a persistent installed sidebar. `activeTab` supplies text and a visible-tab image upon sending; optional `<all_urls>` access permits the same after switching tabs. No background page harvesting or continuous capture occurs. `storage` persists preferences. `theme` matches the native sidebar title row to Echo’s selected appearance while its sidebar is open, retaining the existing theme’s other supplied properties and restoring the previous sidebar theme on close. Zen must allow lightweight extension themes for those colors to render. `nativeMessaging` connects to `com.studylens.helper`, the local Swift helper installed by `Echo Setup.command` (source in `native/`). The native helper handles ChatGPT account authorization and authenticated responses and optional user-selected screen captures. It requires macOS and an eligible ChatGPT account. It does not automate ChatGPT's browser UI.

Data sent to OpenAI includes the submitted question, relevant page text/title/URL, and the tab image or selected capture. Data declarations include website content, browsing activity, communications, identifying information and authentication information. See `PRIVACY.md`. No analytics or advertising is included.

For testing, install the native helper, open Echo on a normal webpage, connect a reviewer-owned eligible ChatGPT account, and submit a question about the page. Do not supply the developer's personal account credentials. Native-helper-less tests can inspect sidebar appearance, themes, shortcut behavior and connection errors. `tests/zen-smoke.py` uses an isolated browser profile and test fixtures; it is not shipped in the extension.
