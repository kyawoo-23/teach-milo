export type FormulaSegment =
  | { kind: "text" | "code"; source: string }
  | { kind: "math"; source: string; body: string; display: boolean };

function escaped(text: string, index: number) {
  let slashes = 0;
  while (index > 0 && text[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

// One scanner is shared by display normalization and board interpolation. Code
// is consumed before math, and the source is never changed in storage.
export function formulaSegments(text: string): FormulaSegment[] {
  const segments: FormulaSegment[] = [];
  let plain = 0;
  let i = 0;
  const push = (end: number, segment: FormulaSegment) => {
    if (i > plain)
      segments.push({ kind: "text", source: text.slice(plain, i) });
    segments.push(segment);
    plain = end;
    i = end;
  };
  while (i < text.length) {
    // An indented code block starts at a blank-line boundary, never in the
    // middle of prose. Preserve its lines before normalizing math delimiters.
    if (
      (i === 0 || text[i - 1] === "\n") &&
      (i === 0 || /\n[ \t]*\n$/.test(text.slice(0, i))) &&
      /^(?: {4}|\t)/.test(text.slice(i))
    ) {
      let end = i;
      while (end < text.length) {
        const next = text.indexOf("\n", end);
        const lineEnd = next < 0 ? text.length : next + 1;
        const line = text.slice(end, lineEnd);
        if (!/^(?: {4}|\t)/.test(line) && line.trim()) break;
        end = lineEnd;
      }
      push(end, { kind: "code", source: text.slice(i, end) });
      continue;
    }
    if (escaped(text, i)) {
      i++;
      continue;
    }
    const code = /^(?:`+|~{3,})/.exec(text.slice(i));
    if (code) {
      const marker = code[0];
      const fenced =
        marker.length >= 3 &&
        /^ {0,3}$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i));
      let end = text.indexOf(marker, i + marker.length);
      while (end >= 0 && text[end + marker.length] === marker[0])
        end = text.indexOf(marker, end + marker.length + 1);
      if (end >= 0) {
        end += marker.length;
        push(end, { kind: "code", source: text.slice(i, end) });
        continue;
      }
      if (fenced) {
        push(text.length, { kind: "code", source: text.slice(i) });
        continue;
      }
    }
    const open = text.startsWith("\\[", i)
      ? "\\["
      : text.startsWith("\\(", i)
        ? "\\("
        : text.startsWith("$$", i)
          ? "$$"
          : text[i] === "$"
            ? "$"
            : "";
    if (open) {
      const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
      let end = text.indexOf(close, i + open.length);
      while (end >= 0 && escaped(text, end))
        end = text.indexOf(close, end + close.length);
      if (end >= 0) {
        const body = text.slice(i + open.length, end);
        // Currency such as "$5 and $10" and spaced dollars stay literal.
        if (
          body.trim() &&
          (open !== "$" ||
            (!/^\s|\s$/.test(body) &&
              !body.includes("\n") &&
              !/\d/.test(text[end + 1] ?? "") &&
              text[end + 1] !== "$"))
        ) {
          const display = open === "\\[" || open === "$$";
          end += close.length;
          push(end, {
            kind: "math",
            source: text.slice(i, end),
            body: body.trim(),
            display,
          });
          continue;
        }
      }
      i += open.length;
      continue;
    }
    i++;
  }
  if (plain < text.length)
    segments.push({ kind: "text", source: text.slice(plain) });
  return segments;
}

export function normaliseMath(text: string) {
  return formulaSegments(text)
    .map((segment) =>
      segment.kind === "math"
        ? segment.display
          ? `\n$$\n${segment.body}\n$$\n`
          : `$$${segment.body}$$`
        : segment.source,
    )
    .join("");
}

export function interpolateBoardText(
  text: string,
  values: Record<string, string>,
) {
  return formulaSegments(text)
    .map((segment) =>
      segment.kind === "text"
        ? segment.source.replace(
            /(?<![\\\w])\{([A-Za-z][\w-]*)\}/g,
            (match, id: string) =>
              Object.hasOwn(values, id) ? values[id] : match,
          )
        : segment.source,
    )
    .join("");
}
