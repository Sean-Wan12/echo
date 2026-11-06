# Echo

Echo opens a temporary chat beside the page you’re studying in Zen on macOS. Click its toolbar button or press **⌘⇧U** to open or close the sidebar. When you send a question, Echo includes accessible page text and an image of the visible tab when Zen allows access. For unusually long pages, it picks text passages related to what you asked. Echo typesets each equation as soon as the reply contains the complete formula.

**Snapshot** is available in the sidebar for diagrams, image-only content, and Zen’s built-in PDF viewer. Selecting a region sends the image for an explanation. **New chat** clears the current conversation. Conversations are held in memory and disappear when you quit Zen.

## Open Echo

1. Open **Zen**. Press **⌘L**, paste `about:debugging#/runtime/this-firefox` into the address bar, and press **Return**.
2. Click **Load Temporary Add-on…**. In the file chooser, press **⌘⇧G**, paste the absolute path to this folder’s `extension/manifest.json`, and press **Return**. Select **Open**.
3. Go to a study webpage, then press **⌘⇧U** or choose **Echo** from Zen’s extensions menu.
4. Choose **Continue with ChatGPT** to use your [ChatGPT plan](https://developers.openai.com/siwc/quickstart). Sign in with your Plus account and authorize Echo.
5. For automatic access after switching tabs, open Echo’s **Settings → Enable tab access** and approve Zen’s website access prompt. Then ask a question in the sidebar. If you use **Snapshot**, macOS may prompt for screen recording access for Echo or Zen.

If Zen reports that the Mac helper is unavailable, double-click **Echo Setup.command** in Finder to install and register `~/Applications/Echo.app`. This also replaces a previous `StudyLens.app` install. If Echo is already loaded from this folder, click **Reload** on Zen’s debugging page after updating. Zen unloads temporary add-ons when it quits. Repeat steps 1 and 2 after a restart.

The sidebar uses Zen’s sidebar position setting. With automatic access off, open Echo from the tab with **⌘⇧U** to grant access to that tab. Scroll images, diagrams, and PDF slides into view before sending. **Tab image included** confirms that Echo attached the visible area. Use **Snapshot** to select a smaller region or if Zen blocks access to the tab.

## How it works

When you send a question, the extension reads the active tab’s accessible text and captures its visible area. The image excludes other windows and the desktop. Page context and manual snapshots go to OpenAI with the question you submit. You can turn off automatic access in Echo’s settings. Zen starts the Mac helper when Echo needs it. The helper waits for requests when idle and exits when Zen closes its connection. It handles sign-in, model requests, and optional screen capture, and stores your sign-in credentials in the Mac Keychain. The extension holds the chat in memory.

## Development

```sh
bash scripts/build-mac.sh
node --test tests/*.test.mjs
python3 tests/host-smoke.py
python3 tests/zen-smoke.py --require-helper
```

The Zen smoke test uses a separate temporary profile. Account authorization and screen recording permission are checked when you first use them.
