const delimiters = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false }
];
const blockSources = new WeakMap();

function hideUnfinishedMath(text) {
  // Skip escaped characters and prefer $$ over the inline $ delimiter.
  const tokens = /\$\$?|\\[[(]|\\./gs;
  let match;
  while ((match = tokens.exec(text))) {
    const delimiter = delimiters.find(item => item.left === match[0]);
    if (!delimiter) continue;
    let braces = 0;
    let end = match.index + delimiter.left.length;
    for (; end < text.length; end++) {
      if (braces === 0 && text.startsWith(delimiter.right, end)) break;
      if (text[end] === "\\") end++;
      else if (text[end] === "{") braces++;
      else if (text[end] === "}" && braces > 0) braces--;
    }
    if (end >= text.length) {
      // A price such as $20 can be ordinary prose.
      if (delimiter.left === "$" && /^\$\d[\d,.]*(?:\s+[a-z]|\s*$)/i.test(text.slice(match.index))) continue;
      return text.slice(0, match.index);
    }
    tokens.lastIndex = end + delimiter.right.length;
  }
  return text;
}

// Build DOM nodes from the reply, then typeset only blocks whose source changed.
export function renderText(element, text, { streaming = false } = {}) {
  const blocks = document.createDocumentFragment();
  const lines = text.replace(/\r/g, "").split("\n");
  let paragraph = [], list = null, code = null, displayMath = null;
  const visible = value => streaming ? hideUnfinishedMath(value) : value;
  const appendInline = (node, value) => {
    for (const part of value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (part.startsWith("**") && part.endsWith("**")) { const strong = document.createElement("strong"); strong.textContent = visible(part.slice(2, -2)); node.append(strong); }
      else if (part.startsWith("`") && part.endsWith("`")) { const c = document.createElement("code"); c.textContent = part.slice(1, -1); node.append(c); }
      else node.append(document.createTextNode(visible(part)));
    }
  };
  const flush = () => { if (paragraph.length) { const p = document.createElement("p"); appendInline(p, paragraph.join("\n")); blocks.append(p); paragraph = []; } list = null; };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flush(); if (code) { blocks.append(code); code = null; } else code = document.createElement("pre"); continue;
    }
    if (code) { code.textContent += line + "\n"; continue; }
    if (displayMath !== null) {
      displayMath.lines.push(line);
      if (line.includes(displayMath.end)) {
        paragraph.push(...displayMath.lines);
        displayMath = null;
        flush();
      }
      continue;
    }
    const opening = line.trimStart().match(/^(\\\[|\$\$)/)?.[0];
    if (opening) {
      const end = opening === "$$" ? "$$" : "\\]";
      if (!line.trimStart().slice(opening.length).includes(end)) {
        flush();
        displayMath = { lines: [line], end };
        continue;
      }
    }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) { flush(); const h = document.createElement(line.startsWith("###") ? "h4" : "h3"); appendInline(h, heading[1]); blocks.append(h); continue; }
    const item = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.*)/);
    if (item) {
      if (paragraph.length) flush();
      const tag = item[1] ? "ul" : "ol";
      if (!list || list.localName !== tag) { list = document.createElement(tag); blocks.append(list); }
      const li = document.createElement("li"); appendInline(li, item[2]); list.append(li); continue;
    }
    if (list) list = null;
    paragraph.push(line);
  }
  if (displayMath && !streaming) paragraph.push(...displayMath.lines);
  flush(); if (code) blocks.append(code);

  const next = [...blocks.children];
  for (const [index, block] of next.entries()) {
    const current = element.children[index];
    const source = block.outerHTML;
    if (current && blockSources.get(current) === source) continue;
    if (block.localName !== "pre") globalThis.renderMathInElement?.(block, {
      delimiters, throwOnError: false, trust: false, strict: "ignore", maxExpand: 1000
    });
    blockSources.set(block, source);
    if (current) current.replaceWith(block);
    else element.append(block);
  }
  while (element.children.length > next.length) element.lastElementChild.remove();
}
