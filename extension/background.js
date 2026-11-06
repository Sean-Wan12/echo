import { apiInput } from "./store.js";

let messages = [];
let busy = false, activity = "", error = "", lastPage = null;
let account = { connected: false }, models = [], model = "", nativePort = null;
const pending = new Map(), subscribers = new Map(), pages = new Map();
let streamUpdate = null;
const ready = browser.storage.local.get("model").then(saved => { model = saved.model || ""; });

function snapshot(windowId) {
  const page = pages.get(windowId);
  const pageInfo = page ? { status: page.status, title: page.title } : { status: "waiting" };
  return { messages, page: pageInfo, busy, activity, error, account, models, model };
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

async function readPage(windowId) {
  const reading = { status: "reading" };
  pages.set(windowId, reading);
  publish();
  let page = { status: "unavailable" };
  try {
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (tab?.id !== undefined) {
      const frames = await browser.tabs.executeScript(tab.id, {
        file: "read-page.js",
        allFrames: true,
        runAt: "document_idle"
      });
      const [currentTab] = await browser.tabs.query({ active: true, windowId });
      if (currentTab?.id === tab.id && currentTab.url === tab.url) {
        const readable = frames.filter(frame => frame?.text);
        const text = [...new Set(readable.map(frame => frame.text))].join("\n\n");
        if (text) page = { status: "ready", title: tab.title || readable[0].title || "Current page", text };
      }
    }
  } catch {
    // Zen restricts access to browser pages, its PDF viewer, and tabs without an active grant.
  }
  if (pages.get(windowId) !== reading) return null;
  pages.set(windowId, page);
  publish();
  return page.status === "ready" ? page : null;
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

function addQuestion(text, image) {
  messages.push({ id: crypto.randomUUID(), role: "user", text, image, status: "complete" });
}

async function capture() {
  if (!account.connected) throw new Error("Connect ChatGPT first.");
  activity = "Drag around your question · Esc to cancel";
  publish();
  const result = await native("capture");
  if (result.cancelled) return;
  lastPage = null;
  addQuestion("", result.image);
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
        addQuestion(text);
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

browser.browserAction.onClicked.addListener(tab => {
  // The sidebar toggle must run inside the toolbar click or shortcut handler.
  return browser.sidebarAction.toggle()
    .then(async () => {
      if (await browser.sidebarAction.isOpen({ windowId: tab.windowId })) {
        await readPage(tab.windowId);
      }
    })
    .catch(e => { error = e.message; publish(); });
});

browser.tabs.onActivated.addListener(({ windowId }) => {
  if ([...subscribers.values()].includes(windowId)) void readPage(windowId);
});

browser.tabs.onUpdated.addListener((tabId, changes, tab) => {
  if (!tab.active || ![...subscribers.values()].includes(tab.windowId)) return;
  if (changes.status === "loading") {
    pages.set(tab.windowId, { status: "waiting" });
    publish();
  } else if (changes.status === "complete") {
    void readPage(tab.windowId);
  }
});

browser.windows.onRemoved.addListener(windowId => pages.delete(windowId));
