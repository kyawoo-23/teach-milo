"use client";
import { Controller } from "react-hook-form";
import { CustomSelect } from "./custom-select";
import { useId, useRef, useState } from "react";
import { ConceptFormSchema, relationshipFormSchema } from "@/lib/form-schemas";
import { BoardTextField, FieldError, useSchemaForm } from "./schema-form";
import { useI18n } from "./locale-context";
import {
  type MapState,
  type MatchingState,
  type TableState,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "@/lib/board-tools";
export function ConceptMap({
  state,
  onChange,
  disabled,
}: {
  state: MapState;
  onChange: (s: MapState) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const conceptForm = useSchemaForm(ConceptFormSchema, { name: "" });
  const [name, setName] = conceptForm.state("name");
  const relationshipForm = useSchemaForm(
    relationshipFormSchema(state.nodes.map((node) => node.id)),
    { from: "", to: "", relation: "" },
  );
  const [from] = relationshipForm.state("from");
  const [to] = relationshipForm.state("to");
  const [relation, setRelation] = relationshipForm.state("relation");
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const move = (nodeId: string, x: number, y: number) =>
    onChange({
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              x: Math.max(60, Math.min(900, x)),
              y: Math.max(40, Math.min(600, y)),
            }
          : n,
      ),
    });
  return (
    <div className="concept-map-editor">
      <p className="tool-hint">
        {t(
          "Connect ideas and label how they relate. Explain the connections when you share.",
        )}
      </p>
      <div className="concept-map-scene">
        <svg
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          role="img"
          aria-label={t("Concept relationships")}
        >
          <title>{t("Concept relationships")}</title>
          <defs>
            <marker
              id={`${id}-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#7f78bf" />
            </marker>
          </defs>
          {state.links.map((l) => {
            const a = state.nodes.find((n) => n.id === l.from)!,
              b = state.nodes.find((n) => n.id === l.to)!;
            return (
              <g key={l.id}>
                <polyline
                  points={`${a.x},${a.y} ${(a.x + b.x) / 2},${(a.y + b.y) / 2} ${b.x},${b.y}`}
                  fill="none"
                  markerMid={`url(#${id}-arrow)`}
                />
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - 16}
                  textAnchor="middle"
                >
                  {l.label}
                </text>
              </g>
            );
          })}
        </svg>
        {state.nodes.map((n) => (
          <button
            type="button"
            className="concept-node"
            key={n.id}
            style={{
              left: `${(n.x / CANVAS_WIDTH) * 100}%`,
              top: `${(n.y / CANVAS_HEIGHT) * 100}%`,
            }}
            disabled={disabled}
            aria-label={t("Move concept {name}", { name: n.label })}
            onKeyDown={(e) => {
              const d: Record<string, [number, number]> = {
                ArrowLeft: [-15, 0],
                ArrowRight: [15, 0],
                ArrowUp: [0, -15],
                ArrowDown: [0, 15],
              };
              if (d[e.key]) {
                e.preventDefault();
                move(n.id, n.x + d[e.key][0], n.y + d[e.key][1]);
              }
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || disabled) return;
              drag.current = {
                id: n.id,
                x: e.clientX,
                y: e.clientY,
                originX: n.x,
                originY: n.y,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (
                !d ||
                d.id !== n.id ||
                !e.currentTarget.hasPointerCapture(e.pointerId)
              )
                return;
              const r = e.currentTarget.parentElement!.getBoundingClientRect();
              move(
                n.id,
                d.originX + ((e.clientX - d.x) / r.width) * CANVAS_WIDTH,
                d.originY + ((e.clientY - d.y) / r.height) * CANVAS_HEIGHT,
              );
            }}
            onPointerUp={(e) => {
              drag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
          >
            {n.label || t("Concept")}
          </button>
        ))}
        {!state.nodes.length && (
          <p className="tool-empty">
            {t("Add two concepts to start your map.")}
          </p>
        )}
      </div>
      <div className="tool-add-row">
        <label htmlFor={`${id}-concept`}>{t("New concept")}</label>
        <input
          id={`${id}-concept`}
          {...conceptForm.register("name")}
          {...conceptForm.a11y("name", `${id}-concept`)}
          maxLength={100}
          disabled={disabled}
        />
        <FieldError
          id={`${id}-concept`}
          message={conceptForm.formState.errors.name?.message}
        />
        <button
          type="button"
          disabled={disabled || !name.trim() || state.nodes.length >= 10}
          onClick={conceptForm.handleSubmit(({ name }) => {
            onChange({
              ...state,
              nodes: [
                ...state.nodes,
                {
                  id: crypto.randomUUID(),
                  label: name.trim(),
                  x: 160 + (state.nodes.length % 3) * 300,
                  y: 100 + Math.floor(state.nodes.length / 3) * 140,
                },
              ],
            });
            setName("");
          })}
        >
          {t("Add concept")}
        </button>
      </div>
      {state.nodes.map((n, index) => (
        <div className="tool-edit-row" key={n.id}>
          <label className="visually-hidden" htmlFor={`${id}-${n.id}`}>
            {t("Concept {number}", { number: index + 1 })}
          </label>
          <BoardTextField
            id={`${id}-${n.id}`}
            value={n.label}
            disabled={disabled}
            maxLength={100}
            onChange={(value) =>
              onChange({
                ...state,
                nodes: state.nodes.map((a) =>
                  a.id === n.id ? { ...a, label: value } : a,
                ),
              })
            }
          />
          <button
            type="button"
            disabled={disabled}
            aria-label={t("Delete concept {name}", { name: n.label })}
            onClick={() =>
              onChange({
                ...state,
                nodes: state.nodes.filter((a) => a.id !== n.id),
                links: state.links.filter(
                  (l) => l.from !== n.id && l.to !== n.id,
                ),
              })
            }
          >
            {t("Delete")}
          </button>
        </div>
      ))}
      {state.nodes.length >= 2 && (
        <fieldset className="relationship-editor">
          <legend>{t("Add relationship")}</legend>
          <div className="tool-field">
            <label htmlFor={`${id}-from`}>{t("From")}</label>
            <Controller
              control={relationshipForm.control}
              name="from"
              render={({ field, fieldState }) => (
                <CustomSelect
                  id={`${id}-from`}
                  label={t("From")}
                  name={field.name}
                  disabled={disabled}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  invalid={!!fieldState.error}
                  describedBy={
                    fieldState.error ? `${id}-from-error` : undefined
                  }
                  placeholder={t("Choose a concept")}
                  options={state.nodes.map((node) => ({
                    value: node.id,
                    label: node.label,
                  }))}
                />
              )}
            />
            <FieldError
              id={`${id}-from`}
              message={relationshipForm.formState.errors.from?.message}
            />
          </div>
          <div className="tool-field">
            <label htmlFor={`${id}-to`}>{t("To")}</label>
            <Controller
              control={relationshipForm.control}
              name="to"
              render={({ field, fieldState }) => (
                <CustomSelect
                  id={`${id}-to`}
                  label={t("To")}
                  name={field.name}
                  disabled={disabled}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  invalid={!!fieldState.error}
                  describedBy={fieldState.error ? `${id}-to-error` : undefined}
                  placeholder={t("Choose a concept")}
                  options={state.nodes.map((node) => ({
                    value: node.id,
                    label: node.label,
                  }))}
                />
              )}
            />
            <FieldError
              id={`${id}-to`}
              message={relationshipForm.formState.errors.to?.message}
            />
          </div>
          <label>
            {t("Relationship")}
            <input
              id={`${id}-relation`}
              {...relationshipForm.register("relation")}
              {...relationshipForm.a11y("relation", `${id}-relation`)}
              maxLength={300}
              disabled={disabled}
            />
          </label>
          <FieldError
            id={`${id}-relation`}
            message={relationshipForm.formState.errors.relation?.message}
          />
          <button
            type="button"
            disabled={
              disabled ||
              !relation.trim() ||
              from === to ||
              !state.nodes.some((n) => n.id === from) ||
              !state.nodes.some((n) => n.id === to) ||
              state.links.length >= 20
            }
            onClick={relationshipForm.handleSubmit(({ from, to, relation }) => {
              onChange({
                ...state,
                links: [
                  ...state.links,
                  { id: crypto.randomUUID(), from, to, label: relation.trim() },
                ],
              });
              setRelation("");
            })}
          >
            {t("Connect concepts")}
          </button>
        </fieldset>
      )}
      {state.links.map((l) => (
        <div className="tool-edit-row" key={l.id}>
          <span>
            {state.nodes.find((n) => n.id === l.from)?.label} →{" "}
            {state.nodes.find((n) => n.id === l.to)?.label}: {l.label}
          </span>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("Delete relationship {name}", { name: l.label })}
            onClick={() =>
              onChange({
                ...state,
                links: state.links.filter((a) => a.id !== l.id),
              })
            }
          >
            {t("Delete")}
          </button>
        </div>
      ))}
    </div>
  );
}
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
  const descriptions = [...state.pairs].sort((a, b) => hash(a.id) - hash(b.id));
  if (
    descriptions.length > 1 &&
    descriptions.every((p, n) => p.id === state.pairs[n].id)
  )
    descriptions.push(descriptions.shift()!);
  const match = (term: string, description: string) => {
    if (!state.pairs.some((p) => p.id === term)) return;
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
  return (
    <div>
      <p className="tool-hint">
        {t(
          "Choose a term, then its description. Explain why your choices belong together.",
        )}
      </p>
      <p className="tool-progress">
        {t("{count} of {total} connected", {
          count: Object.keys(state.matches).length,
          total: state.pairs.length,
        })}
      </p>
      <div className="matching-columns">
        <div>
          {state.pairs.map((p) => (
            <button
              type="button"
              key={p.id}
              draggable={!disabled}
              disabled={disabled}
              aria-pressed={selected === p.id}
              onClick={() => setSelected(p.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", p.id);
                setSelected(p.id);
              }}
            >
              <strong>{p.term || t("Term")}</strong>
              {state.matches[p.id] && (
                <small>
                  {
                    state.pairs.find((a) => a.id === state.matches[p.id])
                      ?.description
                  }
                </small>
              )}
            </button>
          ))}
        </div>
        <div>
          {descriptions.map((p) => (
            <button
              type="button"
              key={p.id}
              disabled={disabled}
              aria-pressed={Object.values(state.matches).includes(p.id)}
              onClick={() => selected && match(selected, p.id)}
              onDragOver={(e) => {
                if (!disabled) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!disabled)
                  match(e.dataTransfer.getData("text/plain"), p.id);
              }}
            >
              {p.description || t("Description")}
            </button>
          ))}
        </div>
      </div>
      {!state.pairs.length && (
        <p className="tool-empty">
          {t("Add terms and descriptions to create a matching activity.")}
        </p>
      )}
      <details
        open={editing}
        onToggle={(e) => setEditing(e.currentTarget.open)}
      >
        <summary>{t("Edit terms and descriptions")}</summary>
        {state.pairs.map((p, index) => (
          <div className="pair-editor" key={p.id}>
            <label htmlFor={`${id}-term-${p.id}`}>
              {t("Term {number}", { number: index + 1 })}
            </label>
            <BoardTextField
              id={`${id}-term-${p.id}`}
              maxLength={300}
              disabled={disabled}
              value={p.term}
              onChange={(value) =>
                onChange({
                  ...state,
                  pairs: state.pairs.map((a) =>
                    a.id === p.id ? { ...a, term: value } : a,
                  ),
                })
              }
            />
            <label htmlFor={`${id}-description-${p.id}`}>
              {t("Description {number}", { number: index + 1 })}
            </label>
            <BoardTextField
              id={`${id}-description-${p.id}`}
              maxLength={300}
              disabled={disabled}
              value={p.description}
              onChange={(value) =>
                onChange({
                  ...state,
                  pairs: state.pairs.map((a) =>
                    a.id === p.id ? { ...a, description: value } : a,
                  ),
                })
              }
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={t("Delete pair {number}", { number: index + 1 })}
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
              {t("Delete")}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled || state.pairs.length >= 10}
          onClick={() =>
            onChange({
              ...state,
              pairs: [
                ...state.pairs,
                { id: crypto.randomUUID(), term: "", description: "" },
              ],
            })
          }
        >
          {t("Add pair")}
        </button>
      </details>
      <button
        type="button"
        disabled={disabled || !Object.keys(state.matches).length}
        onClick={() => onChange({ ...state, matches: {} })}
      >
        {t("Reset connections")}
      </button>
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
  return (
    <div>
      <p className="tool-hint">
        {t(
          "Add examples or compare ideas. Fill the cells with your own reasoning.",
        )}
      </p>
      <div className="board-table-scroll">
        <table className="board-table">
          <caption className="visually-hidden">{t("Comparison table")}</caption>
          <thead>
            <tr>
              {state.columns.map((c, n) => (
                <th key={n} scope="col">
                  <BoardTextField
                    aria-label={t("Column {number}", { number: n + 1 })}
                    value={c}
                    maxLength={60}
                    disabled={disabled}
                    onChange={(value) =>
                      onChange({
                        ...state,
                        columns: state.columns.map((v, i) =>
                          i === n ? value : v,
                        ),
                      })
                    }
                  />
                  {state.columns.length > 2 && (
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={t("Delete column {number}", {
                        number: n + 1,
                      })}
                      onClick={() =>
                        onChange({
                          ...state,
                          columns: state.columns.filter((_, i) => i !== n),
                          rows: state.rows.map((r) => ({
                            ...r,
                            cells: r.cells.filter((_, i) => i !== n),
                          })),
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </th>
              ))}
              <th scope="col">
                <span className="visually-hidden">{t("Row actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r, n) => (
              <tr key={r.id}>
                {r.cells.map((c, i) => (
                  <td key={i}>
                    <BoardTextField
                      multiline
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
                      onChange={(value) =>
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
                        })
                      }
                    />
                  </td>
                ))}
                <td>
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
                    ×
                  </button>
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
          onClick={() =>
            onChange({
              ...state,
              rows: [
                ...state.rows,
                { id: crypto.randomUUID(), cells: state.columns.map(() => "") },
              ],
            })
          }
        >
          {t("Add row")}
        </button>
        <button
          type="button"
          disabled={disabled || state.columns.length >= 5}
          onClick={() =>
            onChange({
              ...state,
              columns: [...state.columns, t("New column")],
              rows: state.rows.map((r) => ({ ...r, cells: [...r.cells, ""] })),
            })
          }
        >
          {t("Add column")}
        </button>
      </div>
    </div>
  );
}
