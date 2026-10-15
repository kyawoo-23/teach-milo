"use client";

import { AnimatedTabs } from "./animated-tabs";

import { localize } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locales";
import { useI18n } from "@/components/locale-context";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefCallback,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { FormulaBlock } from "./formula-text";
import { htmlFromMarkdown, markdownFromElement } from "@/lib/rich-markdown";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Sigma,
  SquareSigma,
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
  | "math"
  | "displayMath";

const TOOLS: {
  kind: Format;
  label: string;
  icon: typeof Bold;
  shortcut?: string;
}[] = [
  { kind: "bold", label: "Bold", icon: Bold, shortcut: "B" },
  { kind: "italic", label: "Italic", icon: Italic, shortcut: "I" },
  { kind: "code", label: "Inline code", icon: Code, shortcut: "E" },
  { kind: "heading", label: "Heading", icon: Heading2 },
  { kind: "bullet", label: "Bulleted list", icon: List },
  { kind: "number", label: "Numbered list", icon: ListOrdered },
  { kind: "table", label: "Table", icon: Table },
  { kind: "math", label: "Formula", icon: Sigma, shortcut: "M" },
  {
    kind: "displayMath",
    label: "Display formula",
    icon: SquareSigma,
    shortcut: "Shift+M",
  },
];

const SELECTION_TOOLS = TOOLS.filter(
  (tool) =>
    tool.kind !== "table" &&
    tool.kind !== "math" &&
    tool.kind !== "displayMath",
);

function shortcutKind(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): Format | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (!event.shiftKey && key === "b") return "bold";
  if (!event.shiftKey && key === "i") return "italic";
  if (!event.shiftKey && key === "e") return "code";
  if (!event.shiftKey && key === "m") return "math";
  if (event.shiftKey && key === "m") return "displayMath";
  return null;
}

function selectContents(selection: Selection, node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

const EMPTY_RICH_HTML = "<br>";

function ensureEmptyRichCaret(root: HTMLElement) {
  if (root.childNodes.length > 0) return;
  root.innerHTML = EMPTY_RICH_HTML;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function wrapInline(
  root: HTMLElement,
  selection: Selection,
  tag: "strong" | "em" | "code",
  placeholder: string,
) {
  const range = selection.getRangeAt(0);
  const host =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  const existing = host?.closest(tag);
  if (
    existing &&
    root.contains(existing) &&
    existing.textContent === range.toString() &&
    range.toString().length > 0
  ) {
    const text = document.createTextNode(existing.textContent ?? "");
    existing.replaceWith(text);
    selectContents(selection, text);
    return;
  }
  const element = document.createElement(tag);
  if (range.collapsed) element.textContent = placeholder;
  else element.append(range.extractContents());
  range.insertNode(element);
  selectContents(selection, element);
}

function ensureBlock(root: HTMLElement) {
  if ([...root.childNodes].some((node) => node instanceof HTMLElement)) return;
  const block = document.createElement("div");
  block.append(...root.childNodes);
  if (!block.childNodes.length) block.append(document.createElement("br"));
  root.append(block);
}

function selectionBlocks(root: HTMLElement, selection: Selection) {
  ensureBlock(root);
  const range = selection.getRangeAt(0);
  const blocks = [...root.children].filter(
    (child) => child instanceof HTMLElement && range.intersectsNode(child),
  ) as HTMLElement[];
  const targets: HTMLElement[] = [];
  for (const block of blocks) {
    if (block.tagName === "UL" || block.tagName === "OL") {
      const items = [...block.children].filter(
        (item) => item instanceof HTMLElement && range.intersectsNode(item),
      ) as HTMLElement[];
      targets.push(...items);
    } else targets.push(block);
  }
  return targets.length ? targets : blocks;
}

function fillElement(source: HTMLElement, tag: string) {
  const next = document.createElement(tag);
  next.append(...source.childNodes);
  if (!next.childNodes.length) next.append(document.createElement("br"));
  return next;
}

function applyRichBlock(
  root: HTMLElement,
  selection: Selection,
  kind: "heading" | "bullet" | "number",
) {
  const targets = selectionBlocks(root, selection);
  if (!targets.length) return;
  if (kind === "heading") {
    const created = targets.map((block) => {
      const next = fillElement(block, block.tagName === "H2" ? "div" : "h2");
      if (block.parentElement && block.parentElement !== root) {
        const list = block.parentElement;
        list.before(next);
        block.remove();
        if (!list.children.length) list.remove();
      } else block.replaceWith(next);
      return next;
    });
    selectContents(selection, created[0]);
    return;
  }
  const wanted = kind === "bullet" ? "UL" : "OL";
  const already = targets.every(
    (block) =>
      block.tagName === "LI" && block.parentElement?.tagName === wanted,
  );
  if (already) {
    const list = targets[0].parentElement!;
    const created = targets.map((item) => {
      const div = fillElement(item, "div");
      list.before(div);
      item.remove();
      return div;
    });
    if (!list.children.length) list.remove();
    selectContents(selection, created[0]);
    return;
  }
  const list = document.createElement(kind === "bullet" ? "ul" : "ol");
  const first = targets[0];
  const host =
    first.parentElement &&
    first.parentElement !== root &&
    (first.parentElement.tagName === "UL" ||
      first.parentElement.tagName === "OL")
      ? first.parentElement
      : first;
  host.before(list);
  for (const block of targets) {
    const item = fillElement(block, "li");
    list.append(item);
    const parent = block.parentElement;
    block.remove();
    if (
      parent &&
      parent !== root &&
      (parent.tagName === "UL" || parent.tagName === "OL") &&
      !parent.children.length
    )
      parent.remove();
  }
  selectContents(selection, list);
}

const WRAP: Partial<Record<Format, [string, string, string]>> = {
  bold: ["**", "**", "bold text"],
  italic: ["_", "_", "italic text"],
  code: ["`", "`", "code"],
  math: ["$", "$", "x^2"],
  displayMath: ["\n$$\n", "\n$$\n", "x^2"],
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
  locale: Locale,
): { text: string; start: number; end: number } {
  const wrap = WRAP[kind];
  if (wrap) {
    const [open, close, placeholder] = wrap;
    const inner = value.slice(start, end) || localize(locale, placeholder);
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
  const table = localize(locale, TABLE);
  return {
    text: value.slice(0, end) + table + value.slice(end),
    start: end + 1,
    end: end + table.length,
  };
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  rows,
  onBlur,
  inputRef,
  name,
  invalid,
  describedBy,
  compact = false,
  bar = true,
  tabs = true,
  defaultTab = "write",
  writeLabel = "Write",
  selectionToolbar = false,
  maxLength = 50000,
  disabled,
  onFocus,
  submitOnEnter = false,
  ...textareaProps
}: Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "id" | "onBlur"
> & {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  onBlur?: TextareaHTMLAttributes<HTMLTextAreaElement>["onBlur"];
  inputRef?: RefCallback<HTMLTextAreaElement>;
  name?: string;
  invalid?: boolean;
  describedBy?: string;
  compact?: boolean;
  bar?: boolean;
  tabs?: boolean;
  defaultTab?: "write" | "preview";
  writeLabel?: "Write" | "Edit";
  selectionToolbar?: boolean;
  submitOnEnter?: boolean;
}) {
  const { t, text: localizeText, locale } = useI18n();

  const [tab, setTab] = useState<"write" | "preview">(defaultTab);
  const tabOrder =
    defaultTab === "preview"
      ? (["preview", "write"] as const)
      : (["write", "preview"] as const);
  const [bubble, setBubble] = useState<{
    top: number;
    left: number;
    below: boolean;
  } | null>(null);
  const [modLabel, setModLabel] = useState("Ctrl");
  const ref = useRef<HTMLTextAreaElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  const authored = useRef(false);

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setModLabel("⌘");
  }, []);

  useEffect(() => {
    const root = richRef.current;
    if (!root || !selectionToolbar) return;
    if (authored.current) {
      authored.current = false;
      return;
    }
    if (markdownFromElement(root) === value) {
      if (value.length === 0) ensureEmptyRichCaret(root);
      root.classList.toggle("is-empty", value.length === 0);
      return;
    }
    root.innerHTML = value.length ? htmlFromMarkdown(value) : EMPTY_RICH_HTML;
    root.classList.toggle("is-empty", value.length === 0);
  }, [selectionToolbar, value]);

  useEffect(() => {
    const root = richRef.current;
    if (!root || !selectionToolbar || disabled) return;
    let dragging = false;
    const hide = () => setBubble((current) => (current ? null : current));
    const sync = () => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      if (
        dragging ||
        !selection ||
        selection.isCollapsed ||
        !anchor ||
        !root.contains(anchor)
      ) {
        hide();
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hide();
        return;
      }
      const below = rect.top < 56;
      const width = 220;
      const left = Math.min(
        window.innerWidth - 8 - width / 2,
        Math.max(8 + width / 2, rect.left),
      );
      const top = Math.round(below ? rect.bottom + 8 : rect.top - 8);
      const next = { top, left: Math.round(left), below };
      setBubble((current) =>
        current &&
        current.top === next.top &&
        current.left === next.left &&
        current.below === next.below
          ? current
          : next,
      );
    };
    const onPointerDown = () => {
      dragging = true;
    };
    const onPointerUp = () => {
      dragging = false;
      sync();
    };
    root.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("selectionchange", sync);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("selectionchange", sync);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [disabled, selectionToolbar]);

  useEffect(() => {
    if (invalid || textareaProps["aria-invalid"]) setTab("write");
  }, [invalid, textareaProps["aria-invalid"]]);

  function emitRich() {
    const root = richRef.current;
    if (!root) return;
    const next = markdownFromElement(root);
    root.classList.toggle("is-empty", next.length === 0);
    if (next.length === 0) ensureEmptyRichCaret(root);
    if (next.length > maxLength) {
      root.innerHTML = value.length ? htmlFromMarkdown(value) : EMPTY_RICH_HTML;
      root.classList.toggle("is-empty", value.length === 0);
      return;
    }
    if (next === value) return;
    authored.current = true;
    onChange(next);
  }

  function formatRich(kind: Format) {
    const root = richRef.current;
    const selection = window.getSelection();
    if (!root || disabled || !selection?.rangeCount) return;
    if (kind === "math" || kind === "displayMath" || kind === "table") return;
    if (!root.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    if (kind === "bold" || kind === "italic" || kind === "code") {
      const tag =
        kind === "bold" ? "strong" : kind === "italic" ? "em" : "code";
      const placeholder = localize(
        locale,
        kind === "bold"
          ? "bold text"
          : kind === "italic"
            ? "italic text"
            : "code",
      );
      wrapInline(root, selection, tag, placeholder);
    } else {
      applyRichBlock(root, selection, kind);
    }
    emitRich();
  }

  function format(kind: Format) {
    if (selectionToolbar) {
      formatRich(kind);
      return;
    }
    const area = ref.current;
    if (!area || disabled) return;
    const next = applyFormat(
      value,
      area.selectionStart,
      area.selectionEnd,
      kind,
      locale,
    );
    if (next.text.length > maxLength) return;
    onChange(next.text);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(next.start, next.end);
    });
  }

  return (
    <div className={`md-editor${compact ? " md-editor--compact" : ""}`}>
      {bar && (
        <div className="md-bar">
          {tabs && (
            <AnimatedTabs
              activeKey={tab}
              className="md-tabs"
              role="tablist"
              aria-label={t("Editor mode")}
            >
              {tabOrder.map((tabId) => (
                <button
                  key={tabId}
                  type="button"
                  role="tab"
                  id={`${id}-${tabId}-tab`}
                  aria-selected={tab === tabId}
                  aria-controls={`${id}-${tabId}-panel`}
                  tabIndex={tab === tabId ? 0 : -1}
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
                        ? tabOrder[0]
                        : event.key === "End"
                          ? tabOrder[1]
                          : tabId === "write"
                            ? "preview"
                            : "write";
                    setTab(next);
                    document.getElementById(`${id}-${next}-tab`)?.focus();
                  }}
                  onClick={() => setTab(tabId)}
                >
                  {tabId === "write" ? t(writeLabel) : t("Preview")}
                </button>
              ))}
            </AnimatedTabs>
          )}
          {(!tabs || tab === "write") && (
            <div
              className="md-toolbar"
              role="group"
              aria-label={t("Markdown formatting")}
            >
              {TOOLS.filter(
                (tool) =>
                  !compact ||
                  tool.kind === "math" ||
                  tool.kind === "displayMath",
              ).map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  className="icon-button"
                  aria-label={localizeText(label)}
                  title={localizeText(label)}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format(kind)}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        hidden={tabs && bar && tab !== "write"}
        id={tabs && bar ? `${id}-write-panel` : undefined}
        role={tabs && bar ? "tabpanel" : undefined}
        aria-labelledby={tabs && bar ? `${id}-write-tab` : undefined}
      >
        {selectionToolbar ? (
          <>
            <div
              id={id}
              ref={richRef}
              className={`md-rich${value ? "" : " is-empty"}`}
              role="textbox"
              aria-multiline="true"
              aria-invalid={invalid ?? textareaProps["aria-invalid"]}
              aria-labelledby={textareaProps["aria-labelledby"]}
              aria-describedby={
                describedBy ?? textareaProps["aria-describedby"]
              }
              contentEditable={!disabled}
              suppressContentEditableWarning
              data-placeholder={
                typeof textareaProps.placeholder === "string"
                  ? textareaProps.placeholder
                  : undefined
              }
              onInput={emitRich}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text/plain");
                event.preventDefault();
                const root = richRef.current;
                const selection = window.getSelection();
                if (!root || !text || !selection?.rangeCount) return;
                const range = selection.getRangeAt(0);
                if (!root.contains(range.commonAncestorContainer)) return;
                range.deleteContents();
                const lines = text.replaceAll("\r\n", "\n").split("\n");
                const fragment = document.createDocumentFragment();
                lines.forEach((line, index) => {
                  if (index > 0) fragment.append(document.createElement("br"));
                  fragment.append(document.createTextNode(line));
                });
                const last = fragment.lastChild;
                range.insertNode(fragment);
                if (last) {
                  range.setStartAfter(last);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
                emitRich();
              }}
              onKeyDown={(event) => {
                textareaProps.onKeyDown?.(
                  event as unknown as KeyboardEvent<HTMLTextAreaElement>,
                );
                if (
                  event.defaultPrevented ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                const kind = shortcutKind(event);
                if (!kind) return;
                event.preventDefault();
                format(kind);
              }}
              onFocus={(event) => {
                const root = richRef.current;
                if (root && value.length === 0) ensureEmptyRichCaret(root);
                onFocus?.(event as unknown as FocusEvent<HTMLTextAreaElement>);
              }}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (
                  !(next instanceof Element) ||
                  !next.closest(".md-selection-tools")
                )
                  setBubble(null);
                ref.current?.dispatchEvent(
                  new FocusEvent("focusout", { bubbles: true }),
                );
              }}
            />
            <textarea
              className="md-rich-source"
              tabIndex={-1}
              aria-hidden="true"
              name={name}
              ref={(node) => {
                ref.current = node;
                inputRef?.(node);
              }}
              value={value}
              required={textareaProps.required}
              minLength={textareaProps.minLength}
              maxLength={maxLength}
              rows={rows}
              onChange={() => {}}
              onBlur={onBlur}
              onFocus={() => richRef.current?.focus()}
            />
          </>
        ) : (
          <textarea
            {...textareaProps}
            disabled={disabled}
            onKeyDown={(event) => {
              textareaProps.onKeyDown?.(event);
              if (
                submitOnEnter &&
                !event.defaultPrevented &&
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229 &&
                event.currentTarget.form
              ) {
                event.preventDefault();
                event.currentTarget.form.requestSubmit();
              }
            }}
            onFocus={(event) => {
              setTab("write");
              onFocus?.(event);
            }}
            onBlur={onBlur}
            ref={(node) => {
              ref.current = node;
              inputRef?.(node);
            }}
            name={name}
            aria-invalid={invalid ?? textareaProps["aria-invalid"]}
            aria-describedby={describedBy ?? textareaProps["aria-describedby"]}
            maxLength={maxLength}
            id={id}
            value={value}
            rows={rows}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
      {tabs && bar && (
        <div
          hidden={tab !== "preview"}
          id={`${id}-preview-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-preview-tab`}
          className="md-preview"
          tabIndex={0}
          style={{ minHeight: `${rows * 1.65 + 2}em` }}
        >
          {tab === "preview" &&
            (value.trim() ? (
              <FormulaBlock>{value}</FormulaBlock>
            ) : (
              <p className="muted">{t("Nothing to preview.")}</p>
            ))}
        </div>
      )}
      {selectionToolbar &&
        bubble &&
        createPortal(
          <div
            className={`md-selection-tools${bubble.below ? " is-below" : ""}`}
            role="toolbar"
            aria-label={t("Markdown formatting")}
            style={{ top: bubble.top, left: bubble.left }}
          >
            {SELECTION_TOOLS.map(({ kind, label, icon: Icon, shortcut }) => (
              <button
                key={kind}
                type="button"
                className="icon-button"
                aria-label={localizeText(label)}
                title={
                  shortcut
                    ? `${localizeText(label)} (${modLabel}+${shortcut})`
                    : localizeText(label)
                }
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format(kind)}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
