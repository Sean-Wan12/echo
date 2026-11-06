import { apiInput } from "./store.js";

let messages = [];
let busy = false, activity = "", error = "", lastPage = null;
let account = { connected: false }, models = [], model = "", nativePort = null;
const pending = new Map(), subscribers = new Map(), pages = new Map();
const navigations = new Map();
let streamUpdate = null;
const ready = browser.storage.local.get("model").then(saved => { model = saved.model || ""; });

function snapshot(windowId) {
  const page = pages.get(windowId);
  const pageInfo = page ? { status: page.status, title: page.title } : { status: "waiting" };
  return { messages, page: pageInfo, busy, activity, error, account, models, model, tabCaptureReady: true };
}

function publish() {
  if (streamUpdate !== null) {
    clearTimeout(streamUpdate);
    streamUpdate = null;
  }
  for (const [port, windowId] of subscribers) {
    try { port.postMessage(snapshot(windowId)); }
    catch { subscribers.delete(port); }
  }
}

async function captureTabImage(windowId, tab) {
  // Leave browser settings and other extension pages out even with automatic access.
  if (!/^(https?:|file:|blob:|data:)/i.test(tab.url ?? "")) return null;
  // Keep small print in scans legible on high-density displays.
  const scale = Math.min(2, 2400 / Math.max(tab.width || 0, tab.height || 0));
  const image = await browser.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 90, scale });
  return image.startsWith("data:image/jpeg;base64,") && image.length <= 5_000_000 ? image : null;
}

async function readPage(windowId) {
  const navigation = navigations.get(windowId);
  pages.set(windowId, { status: "reading" });
  publish();
  let page = { status: "unavailable" };
  let image = null;
  try {
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (tab?.id !== undefined) {
      // PDF viewers and image tabs can still be visible when script injection fails.
      const [frames, capture] = await Promise.allSettled([
        browser.tabs.executeScript(tab.id, { file: "read-page.js", allFrames: true, runAt: "document_idle" }),
        captureTabImage(windowId, tab)
      ]);
      const [currentTab] = await browser.tabs.query({ active: true, windowId });
      if (currentTab?.id === tab.id && currentTab.url === tab.url) {
        const readable = frames.status === "fulfilled" ? frames.value.filter(frame => frame?.text) : [];
        const text = [...new Set(readable.map(frame => frame.text))].join("\n\n");
        if (capture.status === "fulfilled") image = capture.value;
        if (text || image) page = { status: "ready", title: tab.title || readable[0]?.title || "Current page", text };
      }
    }
  } catch {
    // Zen restricts access to browser pages, its PDF viewer, and tabs without an active grant.
  }
  if (navigations.get(windowId) !== navigation) return null;
  pages.set(windowId, page);
  publish();
  return page.status === "ready" ? { ...page, image } : null;
}

function connectNative() {
  if (nativePort) return nativePort;
  nativePort = browser.runtime.connectNative("com.studylens.helper");
  nativePort.onMessage.addListener(message => {
    const request = pending.get(message.id);
    if (!request) return;
    if (message.event === "delta") { request.delta?.(message.text); return; }
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || "The Mac helper could not complete this request."));
  });
  nativePort.onDisconnect.addListener(port => {
    nativePort = null;
    const reason = port.error?.message;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason ? `Mac helper unavailable. Run Echo Setup.command from the project folder. (${reason})` : "The Mac helper disconnected. Please try again."));
    }
    pending.clear();
    account = { connected: false };
    publish();
  });
  return nativePort;
}
function native(method, params = {}, delta) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("This request timed out. Please try again.")); }, method === "signin" ? 310000 : method === "respond" ? 290000 : 180000);
    pending.set(id, { resolve, reject, delta, timer });
    try { connectNative().postMessage({ id, method, params }); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}
async function status() {
  account = await native("status");
  if (!account.connected) {
    models = [];
    return;
  }
  models = await native("models");
  if (!models.some(item => item.id === model)) {
    model = models[0]?.id || "";
    await browser.storage.local.set({ model });
  }
}

async function generate(page) {
  if (!model) throw new Error("No models are available. Reconnect ChatGPT or choose a model in settings.");
  const input = apiInput(messages, page);
  const assistant = { id: crypto.randomUUID(), role: "assistant", text: "", status: "streaming" };
  messages.push(assistant);
  activity = "Thinking through your question…";
  publish();
  try {
    const result = await native("respond", { model, input }, text => {
      assistant.text += text;
      activity = "Writing your explanation…";
      if (streamUpdate === null) streamUpdate = setTimeout(publish, 75);
    });
    assistant.text = result.text || assistant.text;
    if (!assistant.text.trim()) throw new Error("ChatGPT returned no explanation. Try again or choose a different model.");
    assistant.status = "complete";
  } catch (e) {
    assistant.status = "error";
    throw e;
  }
}

function addQuestion(text, { image, tabImage } = {}) {
  messages.push({ id: crypto.randomUUID(), role: "user", text, image, tabImage, status: "complete" });
}

async function capture() {
  if (!account.connected) throw new Error("Connect ChatGPT first.");
  activity = "Drag around your question · Esc to cancel";
  publish();
  const result = await native("capture");
  if (result.cancelled) return;
  lastPage = null;
  addQuestion("", { image: result.image });
  await generate(null);
}

async function action(message) {
  const { type, windowId } = message;
  await ready;
  if (type === "state") return snapshot(windowId);
  if (busy) {
    if (type === "status") return snapshot(windowId);
    throw new Error("Wait for the current explanation or capture to finish.");
  }
  error = "";
  busy = true;
  publish();
  try {
    switch (type) {
      case "status":
        await status();
        break;
      case "signin":
        activity = "Finish signing in in your browser…";
        publish();
        await native("signin");
        await status();
        break;
      case "signout":
        await native("signout");
        account = { connected: false };
        models = [];
        messages = [];
        lastPage = null;
        break;
      case "capture":
        await capture();
        break;
      case "send": {
        const text = message.text?.trim();
        if (!text) break;
        if (!account.connected) throw new Error("Connect ChatGPT first.");
        activity = "Reading the current page…";
        lastPage = await readPage(windowId);
        addQuestion(text, { tabImage: Boolean(lastPage?.image) });
        await generate(lastPage);
        break;
      }
      case "retry":
        if (!account.connected) throw new Error("Connect ChatGPT first.");
        messages = messages.filter(item => item.status !== "error");
        if (messages.at(-1)?.role !== "user") throw new Error("Send a question first.");
        await generate(lastPage);
        break;
      case "new":
        messages = [];
        lastPage = null;
        break;
      case "model":
        if (!models.some(item => item.id === message.model)) throw new Error("Choose an available model.");
        model = message.model;
        await browser.storage.local.set({ model });
        break;
      case "permissions":
        await native("permissions");
        break;
      case "dismiss":
        break;
      default:
        throw new Error("Unknown Echo action.");
    }
  } catch (e) {
    error = e.message;
  } finally {
    busy = false;
    activity = "";
    publish();
  }
  return snapshot(windowId);
}

browser.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith("sidebar:")) return;
  const windowId = Number(port.name.slice("sidebar:".length));
  subscribers.set(port, windowId);
  ready.then(() => {
    if (subscribers.has(port)) port.postMessage(snapshot(windowId));
  });
  port.onDisconnect.addListener(() => subscribers.delete(port));
});
browser.runtime.onMessage.addListener(action);

browser.browserAction.onClicked.addListener(() => {
  // The sidebar toggle must run inside the toolbar click or shortcut handler.
  return browser.sidebarAction.toggle().catch(e => { error = e.message; publish(); });
});

function invalidatePage(windowId) {
  navigations.set(windowId, Symbol());
  pages.delete(windowId);
  publish();
}

browser.tabs.onActivated.addListener(({ windowId }) => invalidatePage(windowId));
browser.tabs.onUpdated.addListener((tabId, changes, tab) => {
  if (tab.active && (changes.status === "loading" || changes.url !== undefined)) invalidatePage(tab.windowId);
});

browser.windows.onRemoved.addListener(windowId => {
  pages.delete(windowId);
  navigations.delete(windowId);
});
