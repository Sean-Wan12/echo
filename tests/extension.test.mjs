import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
  const onMessage = event(), onClicked = event(), onCommand = event(), onConnect = event(), onActivated = event(), onUpdated = event();
  const actions = [], requests = [];
  let title = "Calculus notes", pageText = "Theorem 3.2.1. A differentiable function is continuous.";
  let url = "https://example.com/notes", imageBlocked = false, changeTabDuringCapture = false;
  let refreshDuringCapture = false;
  let blocked = false, cancelCapture = false;
  let sidebarOpen = false;
  let sidebarPort;
  let heldResponse = null, responseStarted = null;
  let holdResponse = false;
  let heldRead = null, readStarted = null;
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
            if (holdResponse) {
              heldResponse = { id, port: this };
              responseStarted();
              break;
            }
            ok({ text: "Here is the explanation." });
            break;
          default:
            throw new Error(`Unexpected native operation: ${method}`);
        }
      });
    },
    disconnect() { this.onDisconnect.emit(this); }
  };
  globalThis.browser = {
    runtime: {
      onMessage, onConnect,
      getManifest: () => JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url))),
      connectNative: () => ({ ...nativePort, onMessage: event(), onDisconnect: event() })
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    browserAction: { onClicked },
    commands: { onCommand },
    sidebarAction: {
      toggle: async () => {
        sidebarOpen = !sidebarOpen;
        actions.push(sidebarOpen ? "open" : "close");
        if (sidebarOpen) {
          sidebarPort = { name: "sidebar:1", onDisconnect: event(), postMessage() {} };
          onConnect.emit(sidebarPort);
        } else sidebarPort.onDisconnect.emit();
      }
    },
    tabs: {
      onActivated, onUpdated,
      query: async ({ windowId }) => [{ id: windowId, title, url, width: 900, height: 830 }],
      executeScript: async () => {
        actions.push("read");
        if (blocked) throw new Error("Restricted page");
        return [{ title, text: pageText }];
      },
      captureVisibleTab: async (windowId, options) => {
        assert.equal(windowId, 1);
        assert.deepEqual(options, { format: "jpeg", quality: 90, scale: 2 });
        actions.push("tab image");
        if (imageBlocked) throw new Error("No activeTab grant");
        if (refreshDuringCapture) onUpdated.emit(1, { status: "complete" }, { active: true, windowId });
        if (changeTabDuringCapture) url = "https://example.com/other";
        if (heldRead) {
          readStarted();
          await heldRead;
        }
        return image;
      }
    },
    windows: { onRemoved: event() }
  };
  await import("../extension/background.js");
  const action = (type, extra = {}) => onMessage.emit({ type, windowId: 1, ...extra })[0];
  await onClicked.emit({ windowId: 1 })[0];
  assert.deepEqual(actions, ["open"]);
  assert.equal(requests.length, 0);
  assert.deepEqual((await action("state")).page, { status: "waiting" });
  assert.equal((await action("state")).tabCaptureReady, true);
  await action("status");
  pageText += "\nThe proof uses the definition of the derivative.";
  refreshDuringCapture = true;
  const chat = await action("send", { text: "Explain theorem 3.2.1" });
  refreshDuringCapture = false;
  assert.match(requests[0].input[0].content[0].text, /inspect the image first/);
  assert.equal(requests[0].input[0].content[1].image_url, image);
  assert.match(requests[0].input[0].content[2].text, /definition of the derivative/);
  assert.equal(chat.messages[0].tabImage, true);
  assert.equal(chat.messages.length, 2);
  await onClicked.emit({ windowId: 1 })[0];
  assert.equal(actions.at(-1), "close");
  assert.equal((await action("state")).messages.length, 0);
  assert.equal((await action("state")).busy, false);
  await onCommand.emit("toggle-echo")[0];
  assert.deepEqual(actions.slice(-2), ["close", "open"]);
  const beforeSwitch = [...actions];
  url = "https://example.com/quiz";
  onActivated.emit({ windowId: 1 });
  onUpdated.emit(1, { status: "complete" }, { active: true, windowId: 1 });
  assert.deepEqual(actions, beforeSwitch);
  pageText = "Q9 Feedback: Use symbol=? to compare two symbols.";
  await action("send", { text: "What is the correct solution to the visible Q10?" });
  const scanQuestion = requests.at(-1).input.at(-1).content;
  assert.match(scanQuestion[0].text, /printed problem in this image/);
  assert.equal(scanQuestion[1].image_url, image);
  assert.match(scanQuestion[2].text, /feedback from other questions/);
  assert.match(scanQuestion[2].text, /Q9 Feedback/);
  assert.match(scanQuestion.at(-1).text, /Q10/);
  blocked = true;
  await action("send", { text: "What animal is this?" });
  assert.equal(requests[2].input.length, 3);
  assert.equal(requests[2].input.at(-1).content[1].image_url, image);
  assert.equal(requests[2].input.at(-1).content.at(-1).text, "What animal is this?");
  imageBlocked = true;
  blocked = false;
  const beforeMissingView = requests.length;
  const beforeMessages = (await action("state")).messages.length;
  const unavailable = await action("send", { text: "What is a derivative?" });
  assert.equal(unavailable.page.status, "ready");
  assert.equal(unavailable.accepted, false);
  assert.match(unavailable.contextError, /couldn’t attach a view/);
  assert.equal(requests.length, beforeMissingView);
  assert.equal(unavailable.messages.length, beforeMessages);
  const textOnly = await action("send", { text: "What is a derivative?", allowTextOnly: true });
  assert.equal(textOnly.accepted, true);
  assert.equal(textOnly.contextError, "");
  assert.equal(textOnly.messages.at(-2).tabImage, false);
  assert.equal(requests[3].input.at(-1).content.some(part => part.type === "input_image"), false);
  imageBlocked = false;
  changeTabDuringCapture = true;
  const changed = await action("send", { text: "Can you see this?" });
  assert.equal(changed.page.status, "unavailable");
  assert.equal(changed.accepted, false);
  assert.equal(requests.length, 4);
  changeTabDuringCapture = false;
  const recovered = await action("send", { text: "Can you see this?" });
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.contextError, "");
  assert.equal(recovered.messages.at(-2).tabImage, true);
  await action("capture");
  assert.equal(requests[5].input.at(-1).content[1].image_url, image);
  cancelCapture = true;
  await action("capture");
  assert.equal(requests.length, 6);
  assert.equal((await action("new")).messages.length, 0);

  changeTabDuringCapture = false;
  blocked = false;
  holdResponse = true;
  const started = new Promise(resolve => { responseStarted = resolve; });
  const oldSend = action("send", { text: "Old question" });
  await started;
  await onCommand.emit("toggle-echo")[0];
  await oldSend;
  assert.equal((await action("state")).messages.length, 0);
  assert.equal((await action("state")).busy, false);

  holdResponse = false;
  await onCommand.emit("toggle-echo")[0];
  await action("send", { text: "Fresh question" });
  assert.equal(requests.at(-1).input.length, 1);
  assert.equal(requests.at(-1).input[0].content.at(-1).text, "Fresh question");
  heldResponse.port.onMessage.emit({ id: heldResponse.id, event: "delta", text: "Late text" });
  heldResponse.port.onMessage.emit({ id: heldResponse.id, ok: true, result: { text: "Old answer" } });
  assert.equal((await action("state")).messages.at(-1).text, "Here is the explanation.");

  let finishRead;
  heldRead = new Promise(resolve => { finishRead = resolve; });
  const reading = new Promise(resolve => { readStarted = resolve; });
  const oldRead = action("send", { text: "Close before reading finishes" });
  await reading;
  const beforeClose = requests.length;
  sidebarPort.onDisconnect.emit();
  finishRead();
  await oldRead;
  assert.equal(requests.length, beforeClose);
  assert.equal((await action("state")).messages.length, 0);
  assert.equal((await action("state")).busy, false);
});
