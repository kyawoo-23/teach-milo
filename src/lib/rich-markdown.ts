function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function inlineHtml(text: string) {
  return text
    .split(/(`[^`\n]+`)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part)
        .replaceAll(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replaceAll(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");
    })
    .join("");
}

// The paste field stores Markdown and shows the formatted result.
export function htmlFromMarkdown(markdown: string) {
  if (!markdown) return "";
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };
  for (const line of markdown.split("\n")) {
    const bullet = /^- (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);
    const heading = /^## (.*)$/.exec(line);
    if (bullet) {
      if (list !== "ul") {
        closeList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inlineHtml(bullet[1])}</li>`);
      continue;
    }
    if (numbered) {
      if (list !== "ol") {
        closeList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inlineHtml(numbered[1])}</li>`);
      continue;
    }
    closeList();
    if (heading) {
      html.push(`<h2>${inlineHtml(heading[1])}</h2>`);
      continue;
    }
    html.push(line ? `<div>${inlineHtml(line)}</div>` : "<div><br></div>");
  }
  closeList();
  return html.join("");
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.tagName === "BR") return "\n";
  const inner = [...node.childNodes].map(inlineMarkdown).join("");
  if (node.tagName === "STRONG" || node.tagName === "B") return `**${inner}**`;
  if (node.tagName === "EM" || node.tagName === "I") return `_${inner}_`;
  if (node.tagName === "CODE") return `\`${inner}\``;
  return inner;
}

function blockMarkdown(element: HTMLElement) {
  if (
    element.childNodes.length === 1 &&
    element.firstChild instanceof HTMLElement &&
    element.firstChild.tagName === "BR"
  )
    return "";
  return [...element.childNodes].map(inlineMarkdown).join("");
}

export function markdownFromElement(root: HTMLElement) {
  const lines: string[] = [];
  let pending = "";
  const flush = () => {
    lines.push(pending);
    pending = "";
  };
  for (const node of root.childNodes) {
    if (!(node instanceof HTMLElement)) {
      pending += node.textContent ?? "";
      continue;
    }
    if (
      node.tagName === "STRONG" ||
      node.tagName === "B" ||
      node.tagName === "EM" ||
      node.tagName === "I" ||
      node.tagName === "CODE"
    ) {
      pending += inlineMarkdown(node);
      continue;
    }
    if (node.tagName === "BR") {
      flush();
      continue;
    }
    if (pending) flush();
    if (node.tagName === "UL" || node.tagName === "OL") {
      let index = 1;
      for (const item of node.querySelectorAll(":scope > li")) {
        if (!(item instanceof HTMLElement)) continue;
        const text = blockMarkdown(item);
        lines.push(node.tagName === "OL" ? `${index}. ${text}` : `- ${text}`);
        index += 1;
      }
      continue;
    }
    if (node.tagName === "H2") {
      lines.push(`## ${blockMarkdown(node)}`);
      continue;
    }
    lines.push(blockMarkdown(node));
  }
  if (pending) flush();
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}
