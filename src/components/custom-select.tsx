"use client";
import { FormulaText } from "./formula-text";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type SelectOption = {
  value: string;
  label: string;
  lang?: string;
  searchText?: string;
  icon?: ReactNode;
};

export function CustomSelect({
  id,
  label,
  labelledBy,
  value,
  options,
  onChange,
  placeholder = "",
  disabled = false,
  compact = false,
  icon,
  name,
  onBlur,
  inputRef,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  labelledBy?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  icon?: ReactNode;
  name?: string;
  onBlur?: () => void;
  inputRef?: RefCallback<HTMLButtonElement>;
  invalid?: boolean;
  describedBy?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const search = useRef({ text: "", time: 0 });
  const selected = options.findIndex((option) => option.value === value);
  const leadingIcon = icon ?? options[selected]?.icon;
  const expanded = open && !disabled;
  const panelId = `${id}-options`;
  const nativePopover =
    expanded &&
    typeof HTMLElement !== "undefined" &&
    "popover" in HTMLElement.prototype;

  const positionPanel = () => {
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, compact ? 180 : 200),
      window.innerWidth - 24,
    );
    const height = Math.min(
      options.length * 44 + Math.max(0, options.length - 1) * 4 + 14,
      264,
    );
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const flip = below < height && above > below;
    const maxHeight = Math.max(44, Math.min(height, flip ? above : below));
    const left = Math.max(
      12,
      Math.min(
        compact ? rect.right - width : rect.left,
        window.innerWidth - width - 12,
      ),
    );
    setPosition({
      left,
      top: flip ? rect.top - maxHeight - 8 : rect.bottom + 8,
      width,
      maxHeight,
    });
  };
  const show = (index = Math.max(selected, 0)) => {
    if (disabled || !options.length) return;
    positionPanel();
    setActive(index);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    setOpen(false);
    search.current.text = "";
    if (option && option.value !== value) onChange(option.value);
    trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!expanded) return;
    const element = panel.current!;
    if (nativePopover) element.showPopover();
    return () => {
      if (nativePopover && element.matches(":popover-open"))
        element.hidePopover();
    };
  }, [expanded, nativePopover]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !panel.current?.contains(target)
      )
        setOpen(false);
    };
    // Dialogs own Escape after the listbox has been dismissed.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    const reposition = () => positionPanel();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [expanded, compact, options.length]);
  useEffect(() => {
    if (expanded)
      document
        .getElementById(`${panelId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, panelId]);

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey && event.key === "ArrowUp" && expanded) {
      event.preventDefault();
      choose(active);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    if (
      [
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
        "PageDown",
        "PageUp",
        "Enter",
        " ",
      ].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") {
        expanded ? choose(active) : show();
        return;
      }
      if (!expanded) {
        show(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : Math.max(selected, 0),
        );
        return;
      }
      setActive((index) =>
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : Math.max(
                0,
                Math.min(
                  options.length - 1,
                  index +
                    (event.key === "ArrowDown"
                      ? 1
                      : event.key === "ArrowUp"
                        ? -1
                        : event.key === "PageDown"
                          ? 10
                          : -10),
                ),
              ),
      );
    } else if (event.key === "Tab" && expanded) {
      setOpen(false);
      if (options[active]?.value !== value) onChange(options[active].value);
    } else if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const character = event.key.toLocaleLowerCase();
      const previous =
        now - search.current.time < 700 ? search.current.text : "";
      const query =
        previous && [...previous].every((c) => c === character)
          ? character
          : previous + character;
      search.current = { text: query, time: now };
      const from = expanded ? active : Math.max(selected, 0);
      const index = options.findIndex((_, offset) => {
        const option = options[(from + offset + 1) % options.length];
        return (
          option.label.toLocaleLowerCase().startsWith(query) ||
          option.searchText?.toLocaleLowerCase().startsWith(query)
        );
      });
      if (index !== -1) show((from + index + 1) % options.length);
    }
  }

  return (
    <div className={`custom-select${compact ? " custom-select--compact" : ""}`}>
      {name && (
        <input type="hidden" name={name} value={value} disabled={disabled} />
      )}
      <button
        ref={(node) => {
          trigger.current = node;
          inputRef?.(node);
        }}
        id={id}
        type="button"
        role="combobox"
        className="custom-select-trigger"
        disabled={disabled}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-controls={expanded ? panelId : undefined}
        aria-expanded={expanded}
        aria-activedescendant={expanded ? `${panelId}-${active}` : undefined}
        data-value={value}
        onKeyDown={handleKey}
        onClick={() => (expanded ? setOpen(false) : show())}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
      >
        {leadingIcon && (
          <span className="custom-select-icon" aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        <span
          className={`custom-select-value${selected < 0 ? " is-placeholder" : ""}`}
          lang={options[selected]?.lang}
        >
          <FormulaText>{options[selected]?.label ?? placeholder}</FormulaText>
        </span>
        <ChevronDown
          size={15}
          className="custom-select-chevron"
          aria-hidden="true"
        />
      </button>
      {expanded &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="listbox"
            aria-label={label}
            className="custom-select-options"
            style={position}
            popover={nativePopover ? "manual" : undefined}
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${panelId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`custom-select-option${active === index ? " is-active" : ""}`}
                lang={option.lang}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="custom-select-option-label">
                  {option.icon && (
                    <span className="custom-select-icon" aria-hidden="true">
                      {option.icon}
                    </span>
                  )}
                  <span>
                    <FormulaText>{option.label}</FormulaText>
                  </span>
                </span>
                <Check
                  size={16}
                  aria-hidden="true"
                  className="custom-select-check"
                />
              </div>
            ))}
          </div>,
          trigger.current?.closest("dialog") ?? document.body,
        )}
    </div>
  );
}
