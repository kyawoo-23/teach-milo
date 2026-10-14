"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { BoardReorderControls } from "./board-reorder-controls";
import { useI18n } from "./locale-context";
import { type MatchingState, type TableState } from "@/lib/board-tools";
export { ConceptMap } from "./concept-map-editor";

export function MatchingBoard({
  state,
  onChange,
  disabled,
}: {
  state: MatchingState;
  onChange: (s: MatchingState) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(state.pairs.length === 0);
  // The card being edited in place, as "<pairId>-term" or "<pairId>-description".
  const [active, setActive] = useState("");
  const refocus = useRef("");
  useEffect(() => {
    if (active) document.getElementById(`${id}-${active}`)?.focus();
    else if (refocus.current) {
      document.getElementById(`${id}-${refocus.current}-button`)?.focus();
      refocus.current = "";
    }
  }, [active, id]);
  const shuffledDescriptions = [...state.pairs].sort(
    (a, b) => hash(a.id) - hash(b.id),
  );
  if (
    shuffledDescriptions.length > 1 &&
    shuffledDescriptions.every((p, n) => p.id === state.pairs[n].id)
  )
    shuffledDescriptions.push(shuffledDescriptions.shift()!);
  const descriptionItems = editing ? state.pairs : shuffledDescriptions;
  const numbers = new Map(state.pairs.map((p, n) => [p.id, n + 1]));
  const filled = (value: string) => value.trim().length > 0;
  const match = (term: string, description: string) => {
    const termPair = state.pairs.find((p) => p.id === term);
    const descriptionPair = state.pairs.find((p) => p.id === description);
    if (
      !termPair ||
      !descriptionPair ||
      !filled(termPair.term) ||
      !filled(descriptionPair.description)
    )
      return;
    onChange({
      ...state,
      matches: {
        ...Object.fromEntries(
          Object.entries(state.matches).filter(
            ([k, v]) => k !== term && v !== description,
          ),
        ),
        [term]: description,
      },
    });
    setSelected("");
  };
  const editable = (
    p: MatchingState["pairs"][number],
    side: "term" | "description",
  ) => {
    const key = `${p.id}-${side}`;
    const label = t(
      side === "term" ? "Term {number}" : "Description {number}",
      {
        number: numbers.get(p.id)!,
      },
    );
    if (active === key)
      return (
        <div
          className="matching-field"
          onKeyDown={(e) => {
            // Enter or Escape finishes editing; Shift+Enter adds a line break.
            if (e.nativeEvent.isComposing) return;
            if (
              e.key === "Escape" ||
              (e.key === "Enter" &&
                !e.shiftKey &&
                e.target instanceof HTMLTextAreaElement)
            ) {
              e.preventDefault();
              e.stopPropagation();
              refocus.current = key;
              setActive("");
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
              setActive((current) => (current === key ? "" : current));
          }}
        >
          <textarea
            id={`${id}-${key}`}
            aria-label={label}
            rows={side === "term" ? 2 : 3}
            maxLength={300}
            disabled={disabled}
            value={p[side]}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onChange({
                ...state,
                pairs: state.pairs.map((a) =>
                  a.id === p.id ? { ...a, [side]: value } : a,
                ),
              });
            }}
          />
        </div>
      );
    return (
      <button
        type="button"
        id={`${id}-${key}-button`}
        className={`matching-editable${p[side] ? "" : " matching-placeholder"}`}
        disabled={disabled}
        onClick={() => setActive(key)}
      >
        {p[side] ? (
          <>
            <span className="visually-hidden">{label}: </span>
            {side === "term" ? <strong>{p.term}</strong> : p.description}
          </>
        ) : (
          label
        )}
      </button>
    );
  };
  return (
    <div className="matching-editor">
      <div className="matching-toolbar">
        <p className="tool-hint">
          {editing
            ? t("Select a term or description to edit it.")
            : t("Click a term, then click its description to connect them.")}
        </p>
        <div
          className="sketch-toolbar"
          role="group"
          aria-label={t("Matching pairs")}
        >
          <div className="sketch-tool-group">
            <button
              type="button"
              title={t("Add pair")}
              aria-label={t("Add pair")}
              disabled={disabled || state.pairs.length >= 10}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                const pairId = crypto.randomUUID();
                onChange({
                  ...state,
                  pairs: [
                    ...state.pairs,
                    { id: pairId, term: "", description: "" },
                  ],
                });
                setEditing(true);
                setSelected("");
                setActive(`${pairId}-term`);
              }}
            >
              <Plus size={18} aria-hidden="true" />
              <span className="visually-hidden">{t("Add pair")}</span>
            </button>
            <button
              type="button"
              title={editing ? t("Done") : t("Edit")}
              aria-label={editing ? t("Done") : t("Edit")}
              aria-pressed={editing}
              disabled={disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                setEditing(!editing);
                setActive("");
                setSelected("");
              }}
            >
              {editing ? (
                <Check size={18} aria-hidden="true" />
              ) : (
                <Pencil size={18} aria-hidden="true" />
              )}
              <span className="visually-hidden">
                {editing ? t("Done") : t("Edit")}
              </span>
            </button>
          </div>
        </div>
      </div>
      <p className="tool-progress" role="status">
        {t("{count} of {total} connected", {
          count: Object.keys(state.matches).length,
          total: state.pairs.length,
        })}
      </p>
      {!editing && state.pairs.length > 0 && (
        <p className="matching-next-step" id={`${id}-next-step`} role="status">
          {selected
            ? t("Choose a description for {term}.", {
                term:
                  state.pairs.find((pair) => pair.id === selected)?.term ||
                  t("Term"),
              })
            : Object.keys(state.matches).length === state.pairs.length
              ? t("All pairs connected. Explain why they belong together.")
              : t(
                  "Choose a term to start. Select a connected term to change its match.",
                )}
        </p>
      )}
      <div
        className={`matching-columns${editing ? " matching-columns-editing" : ""}`}
      >
        <div>
          {state.pairs.length > 0 && (
            <p className="matching-column-label">
              {editing ? t("Terms") : t("1. Choose a term")}
            </p>
          )}
          {state.pairs.map((p) =>
            editing ? (
              <div className="matching-term-row" key={p.id}>
                {editable(p, "term")}
                <button
                  type="button"
                  className="icon-button matching-delete"
                  disabled={disabled}
                  aria-label={t("Delete pair {number}", {
                    number: numbers.get(p.id)!,
                  })}
                  onClick={() =>
                    onChange({
                      ...state,
                      pairs: state.pairs.filter((a) => a.id !== p.id),
                      matches: Object.fromEntries(
                        Object.entries(state.matches).filter(
                          ([k, v]) => k !== p.id && v !== p.id,
                        ),
                      ),
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <div className="matching-term-row" key={p.id}>
                <button
                  type="button"
                  disabled={disabled || !filled(p.term)}
                  className="matching-choice"
                  data-connected={Boolean(state.matches[p.id])}
                  aria-label={p.term || t("Term")}
                  aria-describedby={`${id}-next-step${state.matches[p.id] ? ` ${id}-${p.id}-connection` : ""}`}
                  aria-pressed={selected === p.id}
                  onClick={() => {
                    if (!filled(p.term)) return;
                    setSelected(selected === p.id ? "" : p.id);
                  }}
                >
                  <span className="matching-pair-number" aria-hidden="true">
                    {numbers.get(p.id)}
                  </span>
                  <span className="matching-choice-content">
                    <strong>{p.term || t("Term")}</strong>
                    {selected === p.id && (
                      <small className="matching-selected-label">
                        {t("Selected — choose a description")}
                      </small>
                    )}
                    {state.matches[p.id] && (
                      <small id={`${id}-${p.id}-connection`}>
                        {t("Connected to: {description}", {
                          description:
                            state.pairs.find(
                              (a) => a.id === state.matches[p.id],
                            )?.description || t("Description"),
                        })}
                      </small>
                    )}
                  </span>
                </button>
              </div>
            ),
          )}
        </div>
        <div>
          {state.pairs.length > 0 && (
            <p className="matching-column-label">
              {editing ? t("Descriptions") : t("2. Choose its description")}
            </p>
          )}
          {descriptionItems.map((p) =>
            editing ? (
              <div key={p.id}>{editable(p, "description")}</div>
            ) : (
              <button
                type="button"
                key={p.id}
                className="matching-choice"
                data-match-description={p.id}
                data-connected={Object.values(state.matches).includes(p.id)}
                data-ready={Boolean(selected)}
                disabled={disabled || !selected || !filled(p.description)}
                aria-label={p.description || t("Description")}
                aria-describedby={`${id}-next-step${Object.values(state.matches).includes(p.id) ? ` ${id}-${p.id}-matched-term` : ""}`}
                onClick={() => {
                  if (selected && filled(p.description)) match(selected, p.id);
                }}
              >
                <span className="matching-pair-number" aria-hidden="true">
                  {numbers.get(
                    Object.keys(state.matches).find(
                      (term) => state.matches[term] === p.id,
                    ) ?? "",
                  ) ?? "—"}
                </span>
                <span className="matching-choice-content">
                  {p.description || t("Description")}
                  {Object.values(state.matches).includes(p.id) && (
                    <small id={`${id}-${p.id}-matched-term`}>
                      {t("Connected to: {term}", {
                        term:
                          state.pairs.find(
                            (pair) => state.matches[pair.id] === p.id,
                          )?.term || t("Term"),
                      })}
                    </small>
                  )}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
      {!state.pairs.length && (
        <p className="tool-empty">
          {t("Add terms and descriptions to create a matching activity.")}
        </p>
      )}
      {!editing && (
        <div className="tool-actions">
          <button
            type="button"
            disabled={disabled || !Object.keys(state.matches).length}
            onClick={() => {
              onChange({ ...state, matches: {} });
              setSelected("");
            }}
          >
            {t("Reset connections")}
          </button>
        </div>
      )}
    </div>
  );
}
function hash(value: string) {
  let result = 2166136261;
  for (const character of value)
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function ComparisonTable({
  state,
  onChange,
  disabled,
}: {
  state: TableState;
  onChange: (s: TableState) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const tableId = useId();
  const [editingColumns, setEditingColumns] = useState(false);
  const [collapsedRows, setCollapsedRows] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingFocus = useRef("");
  useEffect(() => {
    if (!pendingFocus.current) return;
    const field = document.getElementById(pendingFocus.current);
    field?.focus();
    if (field instanceof HTMLInputElement) field.select();
    pendingFocus.current = "";
  }, [state.rows.length, state.columns.length]);
  return (
    <div className="comparison-table-editor">
      <p className="tool-hint">
        {t(
          "Use one row for each idea or example. Fill in the columns to explain and compare them.",
        )}
      </p>
      <section className="board-column-editor">
        <button
          type="button"
          className="board-disclosure-toggle"
          aria-expanded={editingColumns}
          onClick={() => setEditingColumns((open) => !open)}
        >
          <ChevronDown size={16} aria-hidden="true" />
          {t("Rename or remove columns")}
        </button>
        <div
          className="board-disclosure-panel"
          data-collapsed={editingColumns ? "false" : "true"}
          aria-hidden={!editingColumns}
        >
          <div className="board-column-fields">
          {state.columns.map((column, index) => (
            <div className="tool-field" key={index}>
              <label htmlFor={`${tableId}-column-${index}`}>
                {t("Column {number}", { number: index + 1 })}
              </label>
              <div className="board-column-input">
                <input
                  id={`${tableId}-column-${index}`}
                  type="text"
                  value={column}
                  maxLength={60}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    onChange({
                      ...state,
                      columns: state.columns.map((column, i) =>
                        i === index ? value : column,
                      ),
                    });
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled || state.columns.length <= 2}
                  aria-label={t("Delete column {number}", {
                    number: index + 1,
                  })}
                  onClick={() =>
                    onChange({
                      ...state,
                      columns: state.columns.filter((_, i) => i !== index),
                      rows: state.rows.map((row) => ({
                        ...row,
                        cells: row.cells.filter((_, i) => i !== index),
                      })),
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          </div>
        </div>
      </section>
      <div className="board-table-scroll">
        <table className="board-table" role="table">
          <caption className="visually-hidden">{t("Comparison table")}</caption>
          <thead role="rowgroup">
            <tr role="row">
              {state.columns.map((c, n) => (
                <th key={n} scope="col" role="columnheader">
                  {c || t("Column {number}", { number: n + 1 })}
                </th>
              ))}
              <th
                scope="col"
                role="columnheader"
                className="board-row-actions-heading"
              >
                {t("Row actions")}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" data-reorder-list>
            {state.rows.map((r, n) => (
              <tr
                key={r.id}
                role="row"
                data-reorder-item={r.id}
                data-reorder-index={n}
                data-collapsed={collapsedRows.has(r.id) ? "true" : "false"}
              >
                {r.cells.map((c, i) => (
                  <td key={i} role="cell">
                    <span className="board-cell-label" aria-hidden="true">
                      {state.columns[i] ||
                        t("Column {number}", { number: i + 1 })}
                    </span>
                    <div
                      id={`${tableId}-${r.id}-cell-${i}`}
                      className="board-cell-editor"
                      data-collapsed={collapsedRows.has(r.id) ? "true" : "false"}
                      aria-hidden={collapsedRows.has(r.id)}
                    >
                      <textarea
                        id={`${tableId}-${r.id}-${i}`}
                        rows={2}
                        aria-label={t("Row {row}, {column}", {
                          row: n + 1,
                          column:
                            state.columns[i] ||
                            t("Column {number}", { number: i + 1 }),
                        })}
                        maxLength={300}
                        disabled={disabled}
                        value={c}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          onChange({
                            ...state,
                            rows: state.rows.map((a) =>
                              a.id === r.id
                                ? {
                                    ...a,
                                    cells: a.cells.map((v, j) =>
                                      j === i ? value : v,
                                    ),
                                  }
                                : a,
                            ),
                          });
                        }}
                      />
                    </div>
                    {collapsedRows.has(r.id) && (
                      <span className="board-cell-preview" title={c}>
                        {c || "—"}
                      </span>
                    )}
                  </td>
                ))}
                <td role="cell" className="board-row-actions">
                  <button
                    type="button"
                    className="board-row-toggle"
                    aria-expanded={!collapsedRows.has(r.id)}
                    aria-controls={r.cells
                      .map((_, i) => `${tableId}-${r.id}-cell-${i}`)
                      .join(" ")}
                    onClick={() =>
                      setCollapsedRows((current) => {
                        const next = new Set(current);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        return next;
                      })
                    }
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                    {t("Row {number}", { number: n + 1 })}
                  </button>
                  <div className="board-row-controls">
                    {state.rows.length > 1 && (
                      <BoardReorderControls
                        itemId={r.id}
                        label={t("Row {number}", { number: n + 1 })}
                        index={n}
                        count={state.rows.length}
                        disabled={disabled}
                        onMove={(target) => {
                          const rows = [...state.rows];
                          const [row] = rows.splice(n, 1);
                          rows.splice(target, 0, row);
                          onChange({ ...state, rows });
                        }}
                      />
                    )}
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={t("Delete row {number}", { number: n + 1 })}
                      onClick={() =>
                        onChange({
                          ...state,
                          rows: state.rows.filter((a) => a.id !== r.id),
                        })
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {collapsedRows.has(r.id) &&
                    r.cells.some((cell) => cell.trim()) && (
                      <span className="board-row-collapsed-summary">
                        {r.cells.find((cell) => cell.trim())}
                      </span>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tool-actions">
        <button
          type="button"
          disabled={disabled || state.rows.length >= 10}
          onClick={() => {
            const rowId = crypto.randomUUID();
            pendingFocus.current = `${tableId}-${rowId}-0`;
            onChange({
              ...state,
              rows: [
                ...state.rows,
                { id: rowId, cells: state.columns.map(() => "") },
              ],
            });
          }}
        >
          <Plus size={16} aria-hidden="true" />
          <span className="tool-action-label">{t("Add row")}</span>
        </button>
        <button
          type="button"
          disabled={disabled || state.columns.length >= 5}
          onClick={() => {
            pendingFocus.current = `${tableId}-column-${state.columns.length}`;
            setEditingColumns(true);
            onChange({
              ...state,
              columns: [...state.columns, t("New column")],
              rows: state.rows.map((r) => ({ ...r, cells: [...r.cells, ""] })),
            });
          }}
        >
          <Plus size={16} aria-hidden="true" />
          <span className="tool-action-label">{t("Add column")}</span>
        </button>
      </div>
      <p className="tool-hint">{t("Up to 10 rows and 5 columns.")}</p>
    </div>
  );
}
