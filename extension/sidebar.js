import { renderText } from "./render.js";
const $ = id => document.getElementById(id);
const { id: windowId } = await browser.windows.getCurrent();
let state;
const messageViews = new Map();
const preferences = await browser.storage.local.get(["theme", "planNoticeSeen"]);
let planNoticeShown = Boolean(preferences.planNoticeSeen);
const tabAccess = { origins: ["<all_urls>"] };
let automaticTabAccess = false;

async function updateTabAccess() {
  automaticTabAccess = await browser.permissions.contains(tabAccess);
  $("tab-access").textContent = automaticTabAccess ? "Turn off automatic access" : "Enable tab access";
  $("context-access").textContent = automaticTabAccess ? "Retry tab view" : "Enable tab access and retry";
  $("tab-access-status").textContent = automaticTabAccess ? "On for the active tab when you send." : "Open Echo from a tab to grant access just to that tab.";
  $("tab-access-label").textContent = automaticTabAccess ? "Automatic tab access on" : "Visible tab on send";
}

function setTheme(theme) {
  const appearance = theme === "light" || theme === "dark" ? theme : "system";
  document.documentElement.dataset.theme = appearance;
  $("theme").value = appearance;
  const dark = appearance === "dark" || appearance === "system" && matchMedia("(prefers-color-scheme: dark)").matches;
  browser.runtime.sendMessage({ type: "sidebar-theme", windowId, dark }).catch(console.warn);
}

setTheme(preferences.theme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTheme($("theme").value));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.theme) setTheme(changes.theme.newValue);
});

const send = async (type, extra = {}) => {
  try {
    const next = await browser.runtime.sendMessage({ type, windowId, ...extra });
    if (next) update(next);
    return next;
  }
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
    label.title = "Enable tab access in Echo settings, reopen Echo from this tab, or use Snapshot.";
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
  const needsReload = !state.contextRequired;
  $("welcome").hidden = state.messages.length > 0;
  const signingIn = state.authPending === true;
  $("signin-progress").hidden = !signingIn;
  $("signin-open").hidden = !signingIn || !state.authURL;
  $("connect-card").hidden = state.account.connected || signingIn;
  $("composer").hidden = !state.account.connected || signingIn;
  $("status").hidden = !state.busy;
  $("status-text").textContent = state.activity || "One moment…";
  $("error").hidden = !needsReload && !state.error;
  $("error-text").textContent = needsReload ? "Reload Echo from Zen’s debugging page to finish the update." : state.error;
  $("error-close").hidden = needsReload;
  $("context-error").hidden = needsReload || !state.contextError;
  $("context-error-text").textContent = state.contextError || "";
  $("app-version").textContent = state.version ? `Echo ${state.version}` : "Reload required";
  $("retry").hidden = needsReload || !state.messages.some(m => m.role === "user") || state.messages.at(-1)?.status === "complete" && state.messages.at(-1)?.role === "assistant";
  for (const id of ["signin", "capture", "send", "new-chat", "reconnect", "signout", "model", "permissions", "retry", "question", "context-access", "send-text-only"]) $(id).disabled = state.busy;
  for (const id of ["capture", "send", "question"]) $(id).disabled ||= needsReload;
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
$("signin-cancel").onclick = () => send("cancel-signin");
$("signin-open").onclick = () => send("open-signin");
let restartingSignIn = false;
$("signin-restart").onclick = async () => {
  if (restartingSignIn) return;
  restartingSignIn = true;
  try {
    const cancelled = await send("cancel-signin");
    if (cancelled && !cancelled.busy) void send("signin");
  } finally { restartingSignIn = false; }
};
$("capture").onclick = () => send("capture");
$("new-chat").onclick = () => send("new");
$("settings-toggle").onclick = () => { $("settings").hidden = !$("settings").hidden; };
$("settings-close").onclick = () => { $("settings").hidden = true; };
$("tab-access").onclick = async () => {
  try {
    if (automaticTabAccess) await browser.permissions.remove(tabAccess);
    else await browser.permissions.request(tabAccess);
    await updateTabAccess();
  } catch {
    $("tab-access-status").textContent = "Zen couldn’t change tab access. Reload Echo and try again.";
  }
};
browser.permissions.onAdded.addListener(updateTabAccess);
browser.permissions.onRemoved.addListener(updateTabAccess);
void updateTabAccess();
$("context-access").onclick = async () => {
  try {
    const granted = automaticTabAccess || await browser.permissions.request(tabAccess);
    await updateTabAccess();
    if (granted) await submitQuestion();
  } catch {
    $("context-error-text").textContent = "Zen couldn’t enable tab access. Reopen Echo from this tab or use Snapshot.";
  }
};
$("send-text-only").onclick = () => submitQuestion(true);
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
async function submitQuestion(allowTextOnly = false) {
  const question = $("question");
  const text = question.value.trim();
  if (!text || !state?.contextRequired || state.busy) return;
  question.value = "";
  question.style.height = "auto";
  const next = await send("send", { text, allowTextOnly });
  if (!next?.accepted && !question.value) {
    question.value = text;
    resizeQuestion();
  }
}
$("composer").onsubmit = event => { event.preventDefault(); void submitQuestion(); };
$("question").onkeydown = event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); } };
function resizeQuestion() {
  $("question").style.height = "auto";
  $("question").style.height = Math.min($("question").scrollHeight, 130) + "px";
}
$("question").oninput = resizeQuestion;
const port = browser.runtime.connect({ name: `sidebar:${windowId}` }); port.onMessage.addListener(update);
setTheme($("theme").value);
await send("state");
await send("status");
