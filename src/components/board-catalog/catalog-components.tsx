"use client";
import { FormulaText, FormulaBlock } from "../formula-text";
import { interpolateBoardText } from "@/lib/formulas";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { Board, BoardCompositeValue } from "@/lib/contracts";
import type { CompiledNode, PropValue } from "@/lib/board-catalog";
import { formatBoardValue, type BoardValues } from "@/lib/boards";
import { lessonLanguage, type TeachingLanguage } from "@/lib/i18n/locales";
import type { TranslationKey, TranslationParams } from "@/lib/i18n/messages";
import { BoardNumberField } from "../schema-form";
import { CustomSelect } from "../custom-select";
import { BoardReorderControls } from "../board-reorder-controls";
import type { Series } from "./use-board-calculation";

export type BoardContext = {
  board: Board;
  values: BoardValues;
  metrics: Record<string, number>;
  series: Series;
  disabled: boolean;
  language?: TeachingLanguage;
  idPrefix: string;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  setState: (id: string, value: number) => void;
  setComposite: (id: string, value: BoardCompositeValue) => void;
};

const GRID_MAX = 24;
const text = (value: PropValue | undefined) =>
  typeof value === "string" ? value : undefined;

function lookup(ctx: BoardContext, id: string) {
  const state = ctx.board.state.find((s) => s.id === id);
  const derived = ctx.board.derived.find((d) => d.id === id);
  return {
    label: state?.label ?? derived?.label ?? id,
    unit: state?.type === "number" ? state.unit : (derived?.unit ?? ""),
    number: state ? ctx.values.state[id] : ctx.metrics[id],
  };
}
const amount = (ctx: BoardContext, value: PropValue | undefined) =>
  typeof value === "number"
    ? value
    : typeof value === "string"
      ? lookup(ctx, value).number
      : undefined;
const display = (ctx: BoardContext, id: string, digits?: number) =>
  formatBoardValue(
    ctx.board,
    id,
    ctx.values,
    ctx.metrics,
    ctx.language,
    digits,
  );

export function BoardNodeView({
  node,
  ctx,
}: {
  node: CompiledNode;
  ctx: BoardContext;
}): ReactNode {
  const children = node.children.map((child) => (
    <BoardNodeView key={child.id} node={child} ctx={ctx} />
  ));
  const { props } = node;
  const fieldId = `${ctx.idPrefix}-${node.id}`;
  switch (node.component) {
    case "Stack":
      return <div className="board-stack">{children}</div>;
    case "Row":
      return <div className="board-row">{children}</div>;
    case "Card":
      return (
        <section className="board-card">
          {text(props.title) && (
            <h4>
              <FormulaText>{text(props.title)}</FormulaText>
            </h4>
          )}
          {children}
        </section>
      );
    case "Heading":
      return (
        <h4 className="board-subheading">
          <FormulaText>{text(props.text)}</FormulaText>
        </h4>
      );
    case "Text":
      return (
        <div className="board-text">
          <FormulaBlock>
            {interpolateBoardText(
              text(props.text)!,
              Object.fromEntries(
                [...ctx.board.state, ...ctx.board.derived].map(({ id }) => {
                  const { unit } = lookup(ctx, id);
                  return [id, `${display(ctx, id)}${unit ? ` ${unit}` : ""}`];
                }),
              ),
            )}
          </FormulaBlock>
        </div>
      );
    case "Callout":
      return (
        <div className={`board-callout ${text(props.tone) ?? "info"}`}>
          <FormulaBlock>{text(props.text)}</FormulaBlock>
        </div>
      );
    case "Slider":
    case "NumberInput": {
      const id = text(props.bind)!;
      const s = ctx.board.state.find((x) => x.id === id)!;
      const label = text(props.label) ?? s.label;
      return (
        <div className="board-control">
          <div className="control-label">
            <label htmlFor={fieldId}>
              <FormulaText>{label}</FormulaText>
            </label>
            {node.component === "Slider" && (
              <output htmlFor={fieldId}>
                {display(ctx, id)} <FormulaText>{s.unit}</FormulaText>
              </output>
            )}
          </div>
          <BoardNumberField
            id={fieldId}
            className={node.component === "NumberInput" ? "board-number" : ""}
            type={node.component === "Slider" ? "range" : "number"}
            disabled={ctx.disabled}
            min={s.min}
            max={s.max}
            step={s.step}
            value={ctx.values.state[id]}
            onChange={(value) => ctx.setState(id, value)}
          />
          {node.component === "Slider" ? (
            <div className="board-slider-value">
              <div className="range-ends">
                <span>{s.min}</span>
                <span>{s.max}</span>
              </div>
              <BoardNumberField
                id={`${fieldId}-value`}
                aria-label={ctx.t("Value for {label}", { label })}
                className="board-number"
                inputMode="decimal"
                disabled={ctx.disabled}
                min={s.min}
                max={s.max}
                step={s.step}
                value={ctx.values.state[id]}
                onChange={(value) => ctx.setState(id, value)}
              />
            </div>
          ) : (
            s.unit && (
              <small className="board-unit">
                <FormulaText>{s.unit}</FormulaText>
              </small>
            )
          )}
        </div>
      );
    }
    case "Toggle": {
      const id = text(props.bind)!;
      const on = ctx.values.state[id] === 1;
      return (
        <button
          type="button"
          role="switch"
          className="board-toggle"
          aria-checked={on}
          disabled={ctx.disabled}
          onClick={() => ctx.setState(id, on ? 0 : 1)}
        >
          <span>
            <FormulaText>
              {text(props.label) ?? lookup(ctx, id).label}
            </FormulaText>
          </span>
          <strong>{ctx.t(on ? "On" : "Off")}</strong>
        </button>
      );
    }
    case "Select": {
      const id = text(props.bind)!;
      const s = ctx.board.state.find((x) => x.id === id)!;
      const label = text(props.label) ?? s.label;
      return (
        <div className="board-control">
          <label className="control-label" htmlFor={fieldId}>
            <FormulaText>{label}</FormulaText>
          </label>
          <CustomSelect
            id={fieldId}
            label={label}
            disabled={ctx.disabled}
            value={String(ctx.values.state[id])}
            options={s.options.map((option, n) => ({
              value: String(n),
              label: option,
              lang: lessonLanguage(ctx.language),
            }))}
            onChange={(value) => ctx.setState(id, Number(value))}
          />
        </div>
      );
    }
    case "Metric": {
      const id = text(props.value)!;
      const { label, unit } = lookup(ctx, id);
      return (
        <dl className="board-metrics">
          <div>
            <dt>
              <FormulaText>{text(props.label) ?? label}</FormulaText>
            </dt>
            <dd>
              {display(
                ctx,
                id,
                typeof props.digits === "number" ? props.digits : undefined,
              )}{" "}
              <small>
                <FormulaText>{unit}</FormulaText>
              </small>
            </dd>
          </div>
        </dl>
      );
    }
    case "Bar": {
      const id = text(props.value)!;
      const { label, unit, number } = lookup(ctx, id);
      const max = amount(ctx, props.max);
      const ratio =
        number !== undefined && max
          ? Math.min(1, Math.max(0, number / max))
          : 0;
      const name = text(props.label) ?? label;
      return (
        <div className="board-bar">
          <div className="control-label">
            <span>
              <FormulaText>{name}</FormulaText>
            </span>
            <output>
              {display(ctx, id)} <FormulaText>{unit}</FormulaText>
            </output>
          </div>
          <div
            className="board-bar-track"
            role="meter"
            aria-label={name}
            aria-valuemin={0}
            aria-valuemax={max ?? 0}
            aria-valuenow={number ?? 0}
          >
            <span style={{ width: `${ratio * 100}%` }} />
          </div>
        </div>
      );
    }
    case "Grid": {
      const size = (value: PropValue | undefined, fallback: number) =>
        Math.max(
          0,
          Math.min(GRID_MAX, Math.round(amount(ctx, value) ?? fallback)),
        );
      const rows = Math.max(1, size(props.rows, 1));
      const cols = Math.max(1, size(props.cols, 1));
      const windowRows = size(props.windowRows, 0);
      const windowCols = size(props.windowCols, 0);
      const top = size(props.windowRow, 0);
      const left = size(props.windowCol, 0);
      const caption = text(props.label) ?? `${rows} × ${cols}`;
      return (
        <figure className="board-grid-figure">
          <div
            className="board-grid"
            role="img"
            aria-label={caption}
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              aspectRatio: `${cols} / ${rows}`,
            }}
          >
            {Array.from({ length: rows * cols }, (_, n) => {
              const r = Math.floor(n / cols),
                c = n % cols;
              const lit =
                r >= top &&
                r < top + windowRows &&
                c >= left &&
                c < left + windowCols;
              return <span key={n} className={lit ? "lit" : undefined} />;
            })}
          </div>
          <figcaption>
            <FormulaText>{caption}</FormulaText>
          </figcaption>
        </figure>
      );
    }
    case "LineChart": {
      const x = text(props.x)!;
      const y = text(props.y)!;
      const points = ctx.series[x] ?? [];
      const xs = lookup(ctx, x),
        ys = lookup(ctx, y);
      const caption =
        text(props.label) ??
        ctx.t("{y} as {x} changes", { x: xs.label, y: ys.label });
      const values = points.map((p) => p.metrics[y]);
      const low = Math.min(...values),
        high = Math.max(...values);
      const s = ctx.board.state.find((v) => v.id === x)!;
      const px = (value: number) =>
        8 + ((value - s.min) / (s.max - s.min)) * 284;
      const py = (value: number) =>
        high === low ? 70 : 132 - ((value - low) / (high - low)) * 124;
      return (
        <figure className="board-chart">
          <svg viewBox="0 0 300 140" role="img" aria-label={caption}>
            <line x1="8" y1="132" x2="292" y2="132" />
            {points.length > 1 && (
              <polyline
                points={points
                  .map((p) => `${px(p.x)},${py(p.metrics[y])}`)
                  .join(" ")}
              />
            )}
            {points.length > 1 && ctx.metrics[y] !== undefined && (
              <circle
                cx={px(ctx.values.state[x])}
                cy={py(ctx.metrics[y])}
                r="4"
              />
            )}
          </svg>
          <figcaption>
            <FormulaText>{caption}</FormulaText>
            {points.length > 1 && (
              <span>
                <FormulaText>{xs.label}</FormulaText>: {s.min}–{s.max}{" "}
                <FormulaText>{xs.unit}</FormulaText> ·{" "}
                <FormulaText>{ys.label}</FormulaText>: {display(ctx, y)}{" "}
                <FormulaText>{ys.unit}</FormulaText>
              </span>
            )}
          </figcaption>
        </figure>
      );
    }
    case "SortableList": {
      const order =
        (ctx.values.composites[node.id] as string[] | undefined) ??
        node.items.map((i) => i.id);
      const item = (id: string) => node.items.find((i) => i.id === id);
      const move = (index: number, target: number) => {
        const next = [...order];
        const [moved] = next.splice(index, 1);
        next.splice(target, 0, moved);
        ctx.setComposite(node.id, next);
      };
      return (
        <ol
          className="sequence-items"
          aria-label={text(props.label)}
          data-reorder-list
        >
          {order.map((id, index) => (
            <li key={id} data-reorder-item={id} data-reorder-index={index}>
              <span>
                <strong>
                  <FormulaText>{item(id)?.label}</FormulaText>
                </strong>
                <small>
                  <FormulaText>{item(id)?.detail}</FormulaText>
                </small>
              </span>
              <BoardReorderControls
                itemId={id}
                label={item(id)?.label ?? ""}
                index={index}
                count={order.length}
                disabled={ctx.disabled}
                onMove={(target) => move(index, target)}
              />
            </li>
          ))}
        </ol>
      );
    }
    case "Buckets": {
      const groups = props.groups as string[];
      const assigned =
        (ctx.values.composites[node.id] as
          Record<string, string> | undefined) ?? {};
      return (
        <div className="classification-items">
          {text(props.label) && (
            <p className="board-text">
              <FormulaText>{text(props.label)}</FormulaText>
            </p>
          )}
          <div className="classification-groups">
            {groups.map((group) => (
              <span key={group}>
                <FormulaText>{group}</FormulaText> (
                {Object.values(assigned).filter((g) => g === group).length})
              </span>
            ))}
          </div>
          {node.items.map((item) => (
            <div key={item.id}>
              <label htmlFor={`${fieldId}-${item.id}`}>
                <FormulaText>{item.label}</FormulaText>
              </label>
              {item.detail && (
                <p>
                  <FormulaText>{item.detail}</FormulaText>
                </p>
              )}
              <CustomSelect
                id={`${fieldId}-${item.id}`}
                label={item.label}
                disabled={ctx.disabled}
                value={assigned[item.id] ?? ""}
                placeholder={ctx.t("Choose a group")}
                options={groups.map((group) => ({
                  value: group,
                  label: group,
                  lang: lessonLanguage(ctx.language),
                }))}
                onChange={(group) =>
                  ctx.setComposite(node.id, { ...assigned, [item.id]: group })
                }
              />
            </div>
          ))}
        </div>
      );
    }
    case "CompareCards": {
      const selected = ctx.values.composites[node.id];
      return (
        <div className="comparison-items" aria-label={text(props.label)}>
          {text(props.label) && (
            <p className="board-text">
              <FormulaText>{text(props.label)}</FormulaText>
            </p>
          )}
          {node.items.map((item) => (
            <button
              type="button"
              className={selected === item.id ? "selected" : ""}
              key={item.id}
              aria-pressed={selected === item.id}
              disabled={ctx.disabled}
              onClick={() => ctx.setComposite(node.id, item.id)}
            >
              <strong>
                <FormulaText>{item.label}</FormulaText>
              </strong>
              {selected === item.id && <Check size={18} aria-hidden="true" />}
              {item.detail && (
                <p>
                  <FormulaText>{item.detail}</FormulaText>
                </p>
              )}
            </button>
          ))}
        </div>
      );
    }
  }
}
