const handoffs = new Map();

function pageText() {
  const selection = window.getSelection()?.toString().trim() || "";
  const source = selection || document.body?.innerText || "";
  const text = source.replace(/\n{3,}/g, "\n\n").trim();
  return { text: text.slice(0, 16000), selected: Boolean(selection), truncated: text.length > 16000 };
}

async function createHandoff(tab) {
  const handoff = {
    title: tab.title || "Current page",
    url: tab.url || "",
    text: "",
    selected: false,
    truncated: false,
    image: "",
    notes: []
  };

  // Capture the visible tab before opening our own page, which becomes the active tab.
  try {
    handoff.image = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch {
    handoff.notes.push("Zen could not capture this tab. You can still send its text and your question.");
  }

  if (/^https?:\/\//.test(tab.url || "")) {
    try {
      const result = await browser.tabs.executeScript(tab.id, {
        code: `(${pageText.toString()})()`,
        runAt: "document_idle"
      });
      Object.assign(handoff, result[0] || {});
    } catch {
      handoff.notes.push("Zen could not read page text. The screenshot may still be useful.");
    }
  } else {
    handoff.notes.push("Page text is unavailable for this tab. Use the screenshot if it was captured.");
  }

  const id = crypto.randomUUID();
  handoffs.set(id, handoff);
  try {
    const opened = await browser.tabs.create({ url: browser.runtime.getURL(`handoff.html#${id}`) });
    handoff.tabId = opened.id;
  } catch {
    handoffs.delete(id);
  }
}

browser.browserAction.onClicked.addListener(createHandoff);

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "get-handoff" || !sender.url?.startsWith(browser.runtime.getURL("handoff.html"))) return;
  const handoff = handoffs.get(message.id);
  return Promise.resolve(handoff || null);
});

browser.tabs.onRemoved.addListener(tabId => {
  for (const [id, handoff] of handoffs) {
    if (handoff.tabId === tabId) handoffs.delete(id);
  }
});
