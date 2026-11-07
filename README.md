# Echo

Echo opens a temporary chat beside the page you’re studying in Zen on macOS. Click its toolbar button or press **⌘⇧U** to open or close the sidebar. When you send a question, Echo includes accessible page text and an image of the visible tab when Zen allows access. For unusually long pages, it picks text passages related to what you asked. Echo typesets each equation as soon as the reply contains the complete formula.

**Snapshot** is available in the sidebar for diagrams, image-only content, and Zen’s built-in PDF viewer. Selecting a region sends the image for an explanation. **New chat** clears the current conversation. Closing Echo clears the conversation and stops its pending request. Press **⌘⇧U** to reopen it with a fresh chat.

## Install Echo permanently

Echo needs a Mozilla signature for a normal permanent installation in Zen. The unsigned `dist/Echo.xpi` is a submission package, not an installable signed release. A temporary add-on disappears when Zen quits, including its shortcut.

1. Run `python3 scripts/package-extension.py` to build the submission package.
2. Sign in to [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/) and submit an extension with distribution **On your own**. This signs Echo for private installation without a public store listing. Upload `dist/Echo.xpi`; use `MOZILLA-REVIEW.md` for reviewer information. The account owner must accept Mozilla's developer agreement.
3. Download Mozilla's signed XPI to `dist/Echo-signed.xpi`. Keep this separate from `Echo.xpi`, which the packaging script overwrites.
4. In Zen, open `about:addons`, click the gear, choose **Install Add-on From File…**, and select the signed XPI. Confirm the requested permissions. Echo should appear in Extensions and remain installed after restarting Zen.
5. In `about:addons`, open the gear → **Manage Extension Shortcuts** and assign **⌘⇧U** to Echo's **Open or close Echo** command. Resolve any displayed conflict with another extension. The manifest suggests this shortcut, but Zen can retain a different assignment or leave it unassigned.
6. Open Echo and use **Continue with ChatGPT** if needed. For automatic active-tab access, use **Settings → Enable tab access** and approve Zen's website access prompt.

If the Mac helper is unavailable, double-click **Echo Setup.command** to install/register `~/Applications/Echo.app`. A signed extension update does not require rebuilding the helper. Future extension changes require a higher version and a newly signed XPI installed through Add-ons Manager; editing the source folder does not update a permanent installation.

For development only, open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** and select `dist/Echo.xpi`. This installation lasts only until Zen quits. Do not use it as the everyday installation.

Echo’s Light, Dark, and System appearance also colors Zen’s native Echo title/close row while Echo is open. Zen must allow extension themes: in `about:config`, set `zen.theme.disable-lightweight` to `false`. With that setting enabled, changing Echo’s appearance updates its title row automatically; closing Echo restores the previous sidebar theme. Install the newly signed XPI when updating from 0.5.0, since edits to source files do not change the installed extension.

The sidebar uses Zen’s sidebar position setting. With automatic access off, open Echo from the tab with **⌘⇧U** to grant access to that tab. Scroll images, diagrams, and PDF slides into view before sending. **Tab image included** confirms that Echo attached the visible area. Use **Snapshot** to select a smaller region or if Zen blocks access to the tab.

If the tab image cannot be attached, Echo keeps your draft and asks you to enable access or retry. **Enable tab access and retry** resumes that question after approval. **Send without tab image** explicitly allows a text-only request.

## How it works

When you send a question, the extension reads the active tab’s accessible text and captures its visible area. The image excludes other windows and the desktop. Page context and manual snapshots go to OpenAI with the question you submit. You can turn off automatic access in Echo’s settings. Zen starts the Mac helper when Echo needs it. The helper waits for requests when idle and exits when Zen closes its connection. It handles sign-in, model requests, and optional screen capture, and stores your sign-in credentials in the Mac Keychain. The extension holds the chat in memory.

## Development

```sh
bash scripts/build-mac.sh
python3 scripts/package-extension.py
node --test tests/*.test.mjs
python3 tests/host-smoke.py
python3 tests/zen-smoke.py --require-helper
```

The Zen smoke test uses a separate temporary profile. Account authorization and screen recording permission are checked when you first use them.
