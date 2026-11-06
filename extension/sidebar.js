import { renderText } from "./render.js";
const $ = id => document.getElementById(id);
const { id: windowId } = await browser.windows.getCurrent();
let state, previousSignature = "";
const send = async (type, extra = {}) => {
  try { const next = await browser.runtime.sendMessage({ type, windowId, ...extra }); if (next) update(next); }
  catch (e) { $("error").hidden = false; $("error-text").textContent = e.message; }
};
function renderMessages() {
  const signature = JSON.stringify(state.messages);
  if (signature === previousSignature) return;
  previousSignature = signature;
  const scroller = $("conversation");
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 110;
  $("messages").replaceChildren();
  for (const m of state.messages) {
    const article = document.createElement("article"); article.className = `message ${m.role}`;
    const label = document.createElement("div"); label.className = "message-label"; label.textContent = m.role === "user" ? (m.image ? "Your snapshot" : "You") : "Echo";
    const content = document.createElement("div"); content.className = "message-content";
    if (m.image) { const image = document.createElement("img"); image.className = "snapshot"; image.src = m.image; image.alt = "Your captured question"; image.tabIndex = 0; image.title = "Click to expand"; const toggle = () => image.classList.toggle("expanded"); image.onclick = toggle; image.onkeydown = e => { if (e.key === "Enter") toggle(); }; content.append(image); }
    if (m.text) { const body = document.createElement("div"); renderText(body, m.text, { math: m.status !== "streaming" }); content.append(body); }
    if (m.status === "error") { const interrupted = document.createElement("p"); interrupted.className = "interrupted"; interrupted.textContent = "This response was interrupted. Try again below."; content.append(interrupted); }
    article.append(label, content); $("messages").append(article);
  }
  if (nearBottom) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
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
  if (state.account.connected) browser.storage.local.get("planNoticeSeen").then(saved => { if (!saved.planNoticeSeen && !$("plan-dialog").open) $("plan-dialog").showModal(); });
}
for (const id of ["signin", "reconnect"]) $(id).onclick = () => send("signin");
$("capture").onclick = () => send("capture");
$("new-chat").onclick = () => send("new");
$("settings-toggle").onclick = () => { $("settings").hidden = !$("settings").hidden; };
$("settings-close").onclick = () => { $("settings").hidden = true; };
$("signout").onclick = () => send("signout");
$("model").onchange = () => send("model", { model: $("model").value });
$("permissions").onclick = () => send("permissions");
$("retry").onclick = () => send("retry");
$("error-close").onclick = () => send("dismiss");
$("plan-dismiss").onclick = () => { browser.storage.local.set({ planNoticeSeen: true }); $("plan-dialog").close(); };
$("composer").onsubmit = event => { event.preventDefault(); const text = $("question").value.trim(); if (!text || !state || state.busy) return; $("question").value = ""; $("question").style.height = "auto"; send("send", { text }); };
$("question").onkeydown = event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); } };
$("question").oninput = () => { $("question").style.height = "auto"; $("question").style.height = Math.min($("question").scrollHeight, 130) + "px"; };
const port = browser.runtime.connect({ name: `sidebar:${windowId}` }); port.onMessage.addListener(update);
await send("state");
await send("status");
