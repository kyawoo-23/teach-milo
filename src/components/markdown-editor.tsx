"use client";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
// Adds \ce{…} / \pu{…} chemistry to the KaTeX instance rehype-katex uses (same pinned version).
import "katex/contrib/mhchem";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Sigma,
  Table,
} from "lucide-react";

type Format =
  | "bold"
  | "italic"
  | "heading"
  | "bullet"
  | "number"
  | "code"
  | "table"
  | "math";

const TOOLS: { kind: Format; label: string; icon: typeof Bold }[] = [
  { kind: "bold", label: "Bold", icon: Bold },
  { kind: "italic", label: "Italic", icon: Italic },
  { kind: "heading", label: "Heading", icon: Heading2 },
  { kind: "bullet", label: "Bulleted list", icon: List },
  { kind: "number", label: "Numbered list", icon: ListOrdered },
  { kind: "code", label: "Inline code", icon: Code },
  { kind: "table", label: "Table", icon: Table },
  { kind: "math", label: "Formula", icon: Sigma },
];

const WRAP: Partial<Record<Format, [string, string, string]>> = {
  bold: ["**", "**", "bold text"],
  italic: ["_", "_", "italic text"],
  code: ["`", "`", "code"],
  math: ["$", "$", "x^2"],
};
const PREFIX: Partial<Record<Format, (n: number) => string>> = {
  heading: () => "## ",
  bullet: () => "- ",
  number: (n) => `${n + 1}. `,
};
const TABLE = "\n| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |\n";

// Returns the new text and the selection to restore after applying a format.
function applyFormat(
  value: string,
  start: number,
  end: number,
  kind: Format,
): { text: string; start: number; end: number } {
  const wrap = WRAP[kind];
  if (wrap) {
    const [open, close, placeholder] = wrap;
    const inner = value.slice(start, end) || placeholder;
    return {
      text: value.slice(0, start) + open + inner + close + value.slice(end),
      start: start + open.length,
      end: start + open.length + inner.length,
    };
  }
  const prefix = PREFIX[kind];
  if (prefix) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lines = value.slice(lineStart, end).split("\n");
    const block = lines.map((line, n) => prefix(n) + line).join("\n");
    return {
      text: value.slice(0, lineStart) + block + value.slice(end),
      start: lineStart,
      end: lineStart + block.length,
    };
  }
  return {
    text: value.slice(0, end) + TABLE + value.slice(end),
    start: end + 1,
    end: end + TABLE.length,
  };
}

// Code spans/blocks and existing $$…$$ math are left untouched.
const PROTECTED = /(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$)/.source;
// Pandoc's rule for single-dollar math: no space just inside either $, and the
// closing $ is not followed by a digit — so "$5 and $10" stays plain text.
const INLINE_DOLLAR = /(?<!\\)\$(?=[^\s$])((?:\\.|[^$\\\n])*?[^\s\\])\$(?!\d)/
  .source;

// Rewrites the preview text into the only forms remark-math is configured to read
// ($$…$$ inline or as a block); the stored text is never changed.
const normaliseMath = (text: string) =>
  text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$$${body.trim()}$$`)
    .replace(
      new RegExp(`${PROTECTED}|${INLINE_DOLLAR}`, "g"),
      (match, kept, body) => kept ?? `$$${body}$$`,
    );

export function MarkdownEditor({
  id,
  value,
  onChange,
  rows,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement>(null);

  function format(kind: Format) {
    const area = ref.current;
    if (!area) return;
    const next = applyFormat(
      value,
      area.selectionStart,
      area.selectionEnd,
      kind,
    );
    onChange(next.text);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(next.start, next.end);
    });
  }

  return (
    <div className="md-editor">
      <div className="md-bar">
        <div className="md-tabs" role="tablist" aria-label="Editor mode">
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${id}-${t}-tab`}
              aria-selected={tab === t}
              aria-controls={`${id}-${t}-panel`}
              tabIndex={tab === t ? 0 : -1}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "write"
                    : event.key === "End"
                      ? "preview"
                      : t === "write"
                        ? "preview"
                        : "write";
                setTab(next);
                document.getElementById(`${id}-${next}-tab`)?.focus();
              }}
              onClick={() => setTab(t)}
            >
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
        {tab === "write" && (
          <div
            className="md-toolbar"
            role="group"
            aria-label="Markdown formatting"
          >
            {TOOLS.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                className="icon-button"
                aria-label={label}
                title={label}
                onClick={() => format(kind)}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === "write" ? (
        <div
          id={`${id}-write-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-write-tab`}
        >
          <textarea
            ref={ref}
            id={id}
            value={value}
            rows={rows}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      ) : (
        <div
          id={`${id}-preview-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-preview-tab`}
          className="md-preview"
          tabIndex={0}
          style={{ minHeight: `${rows * 1.65 + 2}em` }}
        >
          {value.trim() ? (
            <ReactMarkdown
              remarkPlugins={[
                remarkGfm,
                [remarkMath, { singleDollarTextMath: false }],
              ]}
              rehypePlugins={[rehypeKatex]}
            >
              {normaliseMath(value)}
            </ReactMarkdown>
          ) : (
            <p className="muted">Nothing to preview.</p>
          )}
        </div>
      )}
    </div>
  );
}
