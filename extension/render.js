// Build DOM nodes rather than trusting model-produced HTML. Math runs afterwards.
export function renderText(element, text, { math = true } = {}) {
  element.replaceChildren();
  const lines = text.replace(/\r/g, "").split("\n");
  let paragraph = [], list = null, code = null, displayMath = null;
  const appendInline = (node, value) => {
    for (const part of value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (part.startsWith("**") && part.endsWith("**")) { const strong = document.createElement("strong"); strong.textContent = part.slice(2, -2); node.append(strong); }
      else if (part.startsWith("`") && part.endsWith("`")) { const c = document.createElement("code"); c.textContent = part.slice(1, -1); node.append(c); }
      else node.append(document.createTextNode(part));
    }
  };
  const flush = () => { if (paragraph.length) { const p = document.createElement("p"); appendInline(p, paragraph.join("\n")); element.append(p); paragraph = []; } list = null; };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flush(); if (code) { element.append(code); code = null; } else code = document.createElement("pre"); continue;
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
    if (heading) { flush(); const h = document.createElement(line.startsWith("###") ? "h4" : "h3"); appendInline(h, heading[1]); element.append(h); continue; }
    const item = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.*)/);
    if (item) {
      if (paragraph.length) flush();
      const tag = item[1] ? "ul" : "ol";
      if (!list || list.localName !== tag) { list = document.createElement(tag); element.append(list); }
      const li = document.createElement("li"); appendInline(li, item[2]); list.append(li); continue;
    }
    if (list) list = null;
    paragraph.push(line);
  }
  if (displayMath) paragraph.push(...displayMath.lines);
  flush(); if (code) element.append(code);
  if (math && globalThis.renderMathInElement) globalThis.renderMathInElement(element, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "$", right: "$", display: false }
    ],
    throwOnError: false, trust: false, strict: "ignore", maxExpand: 1000
  });
}
