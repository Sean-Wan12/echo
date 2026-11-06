(() => {
  const text = document.body?.innerText.trim() || "";
  const equations = Array.from(document.querySelectorAll('math annotation[encoding="application/x-tex"]'),
    node => node.textContent.trim()).filter(Boolean);
  return { title: document.title, text: equations.length ? `${text}\n\nEquation source (in page order):\n${equations.join("\n")}` : text };
})();
