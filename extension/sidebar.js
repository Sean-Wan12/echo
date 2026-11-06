import { renderText } from "./render.js";
const $ = id => document.getElementById(id);
const { id: windowId } = await browser.windows.getCurrent();
let state;
const messageViews = new Map();
const preferences = await browser.storage.local.get(["theme", "planNoticeSeen"]);
let planNoticeShown = Boolean(preferences.planNoticeSeen);

function setTheme(theme) {
  const appearance = theme === "light" || theme === "dark" ? theme : "system";
  document.documentElement.dataset.theme = appearance;
  $("theme").value = appearance;
}

setTheme(preferences.theme);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.theme) setTheme(changes.theme.newValue);
});

const send = async (type, extra = {}) => {
  try { const next = await browser.runtime.sendMessage({ type, windowId, ...extra }); if (next) update(next); }
  catch (e) { $("error").hidden = false; $("error-text").textContent = e.message; }
};

function createMessageView(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = message.role === "assistant" ? "Echo" : message.image ? "Your snapshot" : "You";
  if (message.tabImage === true) label.textContent += " · Tab image included";
  if (message.tabImage === false) {
    label.textContent += " · No tab image";
    label.title = "Open Echo from this tab to grant access, or use Snapshot to select the image.";
  }
  const content = document.createElement("div");
  content.className = "message-content";
  if (message.image) {
    const image = document.createElement("img");
    image.className = "snapshot";
    image.src = message.image;
    image.alt = "Your captured question";
    image.tabIndex = 0;
    image.title = "Click to expand";
    const toggle = () => image.classList.toggle("expanded");
    image.onclick = toggle;
    image.onkeydown = event => { if (event.key === "Enter") toggle(); };
    content.append(image);
  }
  const body = document.createElement("div");
  const interrupted = document.createElement("p");
  interrupted.className = "interrupted";
  interrupted.textContent = "This response was interrupted. Try again below.";
  interrupted.hidden = true;
  content.append(body, interrupted);
  article.append(label, content);
  const view = { article, body, interrupted };
  if (message.role === "assistant") {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "quiet-button copy-reply";
    copy.textContent = "Copy reply";
    copy.hidden = true;
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(view.text);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy failed";
      }
    };
    copy.onblur = () => { copy.textContent = "Copy reply"; };
    article.append(copy);
    view.copy = copy;
  }
  return view;
}

function renderMessages() {
  const scroller = $("conversation");
  const container = $("messages");
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 110;
  const active = new Set(state.messages.map(message => message.id));
  for (const [id, view] of messageViews) {
    if (!active.has(id)) {
      view.article.remove();
      messageViews.delete(id);
    }
  }
  let updated = false;
  for (const [index, message] of state.messages.entries()) {
    let view = messageViews.get(message.id);
    if (!view) {
      view = createMessageView(message);
      messageViews.set(message.id, view);
      container.insertBefore(view.article, container.children[index] ?? null);
    }
    if (view.text === message.text && view.status === message.status) continue;
    renderText(view.body, message.text, { streaming: message.status === "streaming" });
    view.interrupted.hidden = message.status !== "error";
    if (view.copy) view.copy.hidden = message.status === "streaming" || !message.text.trim();
    view.text = message.text;
    view.status = message.status;
    updated = true;
  }
  if (nearBottom && updated) scroller.scrollTop = scroller.scrollHeight;
}
function update(next) {
  state = next;
  $("welcome").hidden = state.messages.length > 0;
  $("connect-card").hidden = state.account.connected;
  $("composer").hidden = !state.account.connected;
  $("status").hidden = !state.busy;
  $("status-text").textContent = state.activity || "One moment…";
  $("error").hidden = !state.error;
  $("error-text").textContent = state.error;
  $("retry").hidden = !state.messages.some(m => m.role === "user") || state.messages.at(-1)?.status === "complete" && state.messages.at(-1)?.role === "assistant";
  for (const id of ["signin", "capture", "send", "new-chat", "reconnect", "signout", "model", "permissions", "retry", "question"]) $(id).disabled = state.busy;
  $("account-detail").textContent = state.account.connected ? `Connected${state.account.email ? " as " + state.account.email : " to ChatGPT"}.` : "Connect ChatGPT to start studying.";
  $("connection-label").textContent = state.account.connected ? "● Using ChatGPT plan" : "Your space to understand.";
  $("signout").hidden = !state.account.connected;
  $("reconnect").textContent = state.account.connected ? "Reconnect ChatGPT" : "Continue with ChatGPT";
  if (JSON.stringify(state.models) !== $("model").dataset.models) {
    $("model").replaceChildren(...state.models.map(m => { const option = document.createElement("option"); option.value = m.id; option.textContent = m.name; return option; }));
    $("model").dataset.models = JSON.stringify(state.models);
  }
  $("model").value = state.model;
  renderMessages();
  if (state.account.connected && !planNoticeShown) {
    planNoticeShown = true;
    $("plan-dialog").showModal();
  }
}
for (const id of ["signin", "reconnect"]) $(id).onclick = () => send("signin");
$("capture").onclick = () => send("capture");
$("new-chat").onclick = () => send("new");
$("settings-toggle").onclick = () => { $("settings").hidden = !$("settings").hidden; };
$("settings-close").onclick = () => { $("settings").hidden = true; };
$("theme").onchange = async event => {
  const theme = event.target.value;
  setTheme(theme);
  await browser.storage.local.set({ theme });
};
$("signout").onclick = () => send("signout");
$("model").onchange = () => send("model", { model: $("model").value });
$("permissions").onclick = () => send("permissions");
$("retry").onclick = () => send("retry");
$("error-close").onclick = () => send("dismiss");
$("plan-dismiss").onclick = () => {
  browser.storage.local.set({ planNoticeSeen: true });
  $("plan-dialog").close();
};
$("composer").onsubmit = event => { event.preventDefault(); const text = $("question").value.trim(); if (!text || !state || state.busy) return; $("question").value = ""; $("question").style.height = "auto"; send("send", { text }); };
$("question").onkeydown = event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); } };
$("question").oninput = () => { $("question").style.height = "auto"; $("question").style.height = Math.min($("question").scrollHeight, 130) + "px"; };
const port = browser.runtime.connect({ name: `sidebar:${windowId}` }); port.onMessage.addListener(update);
await send("state");
await send("status");
