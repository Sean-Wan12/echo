const $ = id => document.getElementById(id);
const id = location.hash.slice(1);
let handoff;
let chatTabId;

function promptText() {
  const question = $("question").value.trim();
  if (!question) throw new Error("Write your question first.");
  const context = $("context").value.trim();
  const source = [handoff.title, handoff.url].filter(Boolean).join(" — ");
  return [question, context && `Page context (${source}):\n${context}`].filter(Boolean).join("\n\n");
}

async function openChatGPT() {
  if (chatTabId) {
    try {
      await browser.tabs.update(chatTabId, { active: true });
      return;
    } catch { /* The user closed the previous ChatGPT tab. */ }
  }
  chatTabId = (await browser.tabs.create({ url: "https://chatgpt.com/" })).id;
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    $("status").textContent = error.message || "The handoff could not complete. Try again.";
  }
}

async function copyPrompt() {
  await navigator.clipboard.writeText(promptText());
  $("status").textContent = "Question copied. Paste it into ChatGPT; add the screenshot if needed, then send.";
  await openChatGPT();
}

async function copyImage() {
  if (!handoff.image) throw new Error("No screenshot was captured for this tab.");
  const bytes = await (await fetch(handoff.image)).arrayBuffer();
  if (browser.clipboard?.setImageData) {
    await browser.clipboard.setImageData(bytes, "png");
  } else {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  }
  $("status").textContent = "Screenshot copied. Paste it into the ChatGPT message before sending.";
  await openChatGPT();
}

async function init() {
  handoff = await browser.runtime.sendMessage({ type: "get-handoff", id });
  if (!handoff) {
    $("status").textContent = "This handoff expired. Return to your study tab and click Echo Handoff again.";
    $("copy-prompt").disabled = true;
    $("copy-image").disabled = true;
    return;
  }
  $("source").textContent = [handoff.title, handoff.url].filter(Boolean).join(" — ");
  $("context").value = handoff.text;
  $("context-note").textContent = handoff.selected ? "Using your selected text." : handoff.truncated ? "The page was long, so only its first 16,000 characters were captured. Edit this text if your question concerns a later section." : "Review or shorten this text before copying.";
  $("copy-image").disabled = !handoff.image;
  if (handoff.image) {
    $("preview").src = handoff.image;
    $("image-section").hidden = false;
  }
  for (const note of handoff.notes) {
    const item = document.createElement("p");
    item.textContent = note;
    $("notes").append(item);
  }
  $("question").focus();
}

$("copy-prompt").addEventListener("click", () => run(copyPrompt));
$("copy-image").addEventListener("click", () => run(copyImage));
init().catch(() => { $("status").textContent = "The handoff could not load. Try opening it again from your study tab."; });
