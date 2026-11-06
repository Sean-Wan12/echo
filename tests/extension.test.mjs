import assert from "node:assert/strict";
import test from "node:test";
import { apiInput } from "../extension/store.js";

const image = "data:image/jpeg;base64,c25hcHNob3Q=";

test("page references attach to the latest question and retain exact theorem numbers on long pages", () => {
  const messages = [
    { role: "user", text: "What is continuity?", status: "complete" },
    { role: "assistant", text: "Partial answer", status: "error" },
    { role: "assistant", text: "Here is continuity.", status: "complete" },
    { role: "user", text: "Explain theorem 3.2.1", status: "complete" }
  ];
  const page = { title: "Course notes", text: "Front matter ".repeat(20_000) + "Theorem 3.2.1: A continuous function..." };
  const input = apiInput(messages, page);
  assert.equal(input.length, 3);
  assert.equal(input[0].content.length, 1);
  assert.equal(input[1].content, "Here is continuity.");
  assert.match(input[2].content[0].text, /Theorem 3\.2\.1: A continuous function/);
  assert.equal(input[2].content[1].text, messages[3].text);
});

test("send captures only the current tab and keeps manual snapshots available", async () => {
  const event = () => ({
    listeners: [],
    addListener(fn) { this.listeners.push(fn); },
    emit(...args) { return this.listeners.map(fn => fn(...args)); }
  });
  const onMessage = event(), onClicked = event();
  const actions = [], requests = [];
  let title = "Calculus notes", pageText = "Theorem 3.2.1. A differentiable function is continuous.";
  let url = "https://example.com/notes", imageBlocked = false, changeTabDuringCapture = false;
  let blocked = false, cancelCapture = false;
  let sidebarOpen = false;
  const nativePort = {
    onMessage: event(), onDisconnect: event(),
    postMessage({ id, method, params }) {
      queueMicrotask(() => {
        const ok = result => this.onMessage.emit({ id, ok: true, result });
        switch (method) {
          case "status":
            ok({ connected: true });
            break;
          case "models":
            ok([{ id: "vision", name: "Vision" }]);
            break;
          case "capture":
            actions.push("capture");
            ok(cancelCapture ? { cancelled: true } : { image });
            break;
          case "respond":
            requests.push(structuredClone(params));
            ok({ text: "Here is the explanation." });
            break;
          default:
            throw new Error(`Unexpected native operation: ${method}`);
        }
      });
    }
  };
  globalThis.browser = {
    runtime: { onMessage, onConnect: event(), connectNative: () => nativePort },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    browserAction: { onClicked },
    sidebarAction: {
      toggle: async () => { sidebarOpen = !sidebarOpen; actions.push(sidebarOpen ? "open" : "close"); },
      isOpen: async () => sidebarOpen
    },
    tabs: {
      onActivated: event(), onUpdated: event(),
      query: async ({ windowId }) => [{ id: windowId, title, url, width: 2400, height: 1600 }],
      executeScript: async () => {
        actions.push("read");
        if (blocked) throw new Error("Restricted page");
        return [{ title, text: pageText }];
      },
      captureVisibleTab: async (windowId, options) => {
        assert.equal(windowId, 1);
        assert.deepEqual(options, { format: "jpeg", quality: 82, scale: 1600 / 2400 });
        actions.push("tab image");
        if (imageBlocked) throw new Error("No activeTab grant");
        if (changeTabDuringCapture) url = "https://example.com/other";
        return image;
      }
    },
    windows: { onRemoved: event() }
  };
  await import("../extension/background.js");
  const action = (type, extra = {}) => onMessage.emit({ type, windowId: 1, ...extra })[0];
  await onClicked.emit({ windowId: 1 })[0];
  assert.deepEqual(actions, ["open", "read"]);
  assert.equal(requests.length, 0);
  assert.deepEqual((await action("state")).page, { status: "ready", title });
  await action("status");
  pageText += "\nThe proof uses the definition of the derivative.";
  const chat = await action("send", { text: "Explain theorem 3.2.1" });
  assert.match(requests[0].input[0].content[0].text, /definition of the derivative/);
  assert.equal(requests[0].input[0].content.at(-1).image_url, image);
  assert.equal(chat.messages.length, 2);
  await onClicked.emit({ windowId: 1 })[0];
  assert.equal(actions.at(-1), "close");
  assert.equal((await action("state")).messages.length, 2);
  await onClicked.emit({ windowId: 1 })[0];
  assert.deepEqual(actions.slice(-2), ["open", "read"]);
  blocked = true;
  await action("send", { text: "What animal is this?" });
  assert.equal(requests[1].input[0].content.some(part => part.type === "input_image"), false);
  assert.equal(requests[1].input.at(-1).content.at(-1).image_url, image);
  assert.equal(requests[1].input.at(-1).content[1].text, "What animal is this?");
  imageBlocked = true;
  const unavailable = await action("send", { text: "What is a derivative?" });
  assert.equal(unavailable.page.status, "unavailable");
  assert.equal(requests[2].input.at(-1).content.length, 1);
  imageBlocked = false;
  changeTabDuringCapture = true;
  const changed = await action("send", { text: "Can you see this?" });
  assert.equal(changed.page.status, "unavailable");
  assert.equal(requests[3].input.at(-1).content.length, 1);
  await action("capture");
  assert.equal(requests[4].input.at(-1).content[1].image_url, image);
  cancelCapture = true;
  await action("capture");
  assert.equal(requests.length, 5);
  assert.equal((await action("new")).messages.length, 0);
});
