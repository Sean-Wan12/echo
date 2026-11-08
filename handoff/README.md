# Echo Handoff

Echo Handoff is a separate Zen add-on for people who want to use ChatGPT on the web. It does not change or require the main Echo add-on, a ChatGPT Plus account, or an API key.

## Try it in Zen

1. Open `about:debugging#/runtime/this-firefox` in Zen.
2. Choose **Load Temporary Add-on…** and select this folder's `manifest.json`.
3. Open a study page and click **Echo Handoff** in Zen's extensions menu.
4. Write your question. Click **Copy question & open ChatGPT**, then paste into ChatGPT.
5. For a diagram or PDF, switch back to the handoff tab, click **Copy screenshot & switch to ChatGPT**, and paste the image into the same message. Send the message in ChatGPT when ready.

The add-on captures the visible tab and up to 16,000 characters of page text when you click it. Selected text takes priority over the full page. You can edit the text before copying it. Some browser pages and PDF viewers do not expose readable text; the screenshot may still work. The captured data stays in the add-on's memory until you close its handoff tab or quit Zen. The add-on does not send data to ChatGPT itself. ChatGPT's Free plan limits still apply.

This temporary add-on unloads when Zen quits. A normal permanent installation would require Mozilla signing.
