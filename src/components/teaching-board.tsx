"use client";

import {
  lessonLanguage,
  formatNumber,
  type TeachingLanguage,
} from "@/lib/i18n/locales";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BoardNumberField } from "./schema-form";
import { CustomSelect } from "./custom-select";
import { useI18n } from "@/components/locale-context";
import { useConfirmation } from "./confirmation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Grip,
  Layers3,
  RotateCcw,
} from "lucide-react";
import {
  Board,
  BoardOutput,
  BoardOutputSchema,
  BoardSubmission,
  BoardInputs,
  LegacyBoardSubmissionSchema,
} from "@/lib/contracts";
import {
  calculateTemplate,
  initialBoardInputs,
  validateBoardInputs,
} from "@/lib/boards";
import type { Workspace } from "./use-board-workspace";
import {
  ConceptMap,
  MatchingBoard,
  ComparisonTable,
} from "./board-tool-editors";
import { SketchBoard } from "./sketch-board";
import { sketchPng } from "@/lib/sketch";
import type { ToolState } from "@/lib/board-tools";
import { api, ErrorNotice } from "./ui";
import { convolution } from "@/lib/cnn";
import { validateCalculation } from "@/lib/custom-code";
import { calculationSandbox } from "@/lib/sandbox";

export function TeachingBoard({
  board,
  teachingLanguage,
  onAttach,
  disabled = false,
  workspace,
  onChange,
  onExpand,
  sessionId,
  storageUnavailable,
}: {
  board: Board;
  teachingLanguage?: TeachingLanguage;
  onAttach: (
    snapshot: BoardSubmission,
  ) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  workspace: Workspace;
  onChange: (value: Workspace) => void;
  onExpand?: () => void;
  sessionId: string;
  storageUnavailable: boolean;
}) {
  const { t } = useI18n();
  const toolId = useId();
  const [error, setError] = useState<string | Error>("");
  const [attaching, setAttaching] = useState(false);
  const confirm = useConfirmation();
  const state = workspace.tools[workspace.active];
  const updateTool = (value: ToolState) =>
    onChange({
      ...workspace,
      tools: { ...workspace.tools, [workspace.active]: value },
    });
  const attach = async (snapshot: BoardSubmission) => {
    setError("");
    try {
      return await onAttach(structuredClone(snapshot));
    } catch (e) {
      setError(e as Error);
      return false;
    }
  };
  return (
    <div className="board-workspace">
      <div className="workspace-heading">
        <strong>{t("Teaching board")}</strong>
        {onExpand && (
          <button type="button" onClick={onExpand}>
            {t("Expand board")}
          </button>
        )}
      </div>
      <div className="tool-field">
        <label htmlFor={toolId}>{t("Board tool")}</label>
        <CustomSelect
          id={toolId}
          label={t("Board tool")}
          disabled={disabled || attaching}
          value={workspace.active}
          options={[
            { value: "suggested", label: t("Suggested activity") },
            { value: "sketch", label: t("Sketch and diagram") },
            { value: "concept_map", label: t("Concept map") },
            { value: "matching", label: t("Matching pairs") },
            { value: "table", label: t("Comparison table") },
          ]}
          onChange={(value) => {
            const active = value as Workspace["active"];
            setError("");
            onChange({ ...workspace, active });
            void api(`/api/sessions/${sessionId}/events`, {
              name: `board_tool_${active}`,
            }).catch(() => {});
          }}
        />
      </div>
      {storageUnavailable && (
        <p className="board-saving-notice" role="status">
          {t(
            "Browser saving is unavailable. Keep this page open to preserve your board.",
          )}
        </p>
      )}
      {error && <ErrorNotice message={error} />}
      {state ? (
        <div className="workspace-editor">
          {workspace.active === "suggested" && (
            <div
              className="suggested-heading"
              lang={lessonLanguage(teachingLanguage)}
            >
              <h3>{board.title}</h3>
              <p>{board.instruction}</p>
            </div>
          )}
          {state.kind === "sketch" && (
            <SketchBoard
              state={state}
              disabled={disabled || attaching}
              history={workspace.sketchHistory ?? { past: [], future: [] }}
              onChange={(s, h) =>
                onChange({
                  ...workspace,
                  sketchHistory: h,
                  tools: { ...workspace.tools, [workspace.active]: s },
                })
              }
            />
          )}
          {state.kind === "concept_map" && (
            <ConceptMap
              state={state}
              onChange={updateTool}
              disabled={disabled || attaching}
            />
          )}
          {state.kind === "matching" && (
            <MatchingBoard
              state={state}
              onChange={updateTool}
              disabled={disabled || attaching}
            />
          )}
          {state.kind === "table" && (
            <ComparisonTable
              state={state}
              onChange={updateTool}
              disabled={disabled || attaching}
            />
          )}
          <div className="workspace-share">
            <button
              className="secondary-button full-width"
              type="button"
              disabled={disabled || attaching}
              onClick={async () => {
                setAttaching(true);
                setError("");
                try {
                  const snapshot: BoardSubmission = {
                    version: 2,
                    inputs: {},
                    state: structuredClone(state),
                    ...(state.kind === "sketch"
                      ? { png: sketchPng(state) }
                      : {}),
                  };
                  validateBoardInputs(board, snapshot);
                  await attach(snapshot);
                } catch (e) {
                  setError(e as Error);
                } finally {
                  setAttaching(false);
                }
              }}
            >
              {t("Attach to explanation")}
            </button>
            <p className="board-footnote">
              {t("Add your own explanation when you send.")}
            </p>
          </div>
        </div>
      ) : (
        <LegacyTeachingBoard
          board={board}
          teachingLanguage={teachingLanguage}
          onAttach={attach}
          disabled={disabled}
          inputs={workspace.inputs}
          onInputsChange={(inputs) => onChange({ ...workspace, inputs })}
        />
      )}
      {state && workspace.active !== "sketch" && (
        <button
          className="workspace-reset"
          type="button"
          disabled={disabled}
          onClick={async () => {
            if (
              await confirm({
                title: "Reset this board?",
                description:
                  "Your current board settings will be lost and the initial settings restored.",
                confirmLabel: "Reset board",
                destructive: true,
              })
            ) {
              const { initialWorkspace } =
                await import("./use-board-workspace");
              const initial = initialWorkspace(board, teachingLanguage);
              onChange({
                ...workspace,
                tools: {
                  ...workspace.tools,
                  [workspace.active]: initial.tools[workspace.active],
                },
              });
            }
          }}
        >
          {t("Reset board")}
        </button>
      )}
    </div>
  );
}
function LegacyTeachingBoard({
  board,
  teachingLanguage,
  onAttach,
  disabled = false,
  inputs,
  onInputsChange,
}: {
  board: Board;
  teachingLanguage?: TeachingLanguage;
  onAttach: (
    snapshot: BoardSubmission,
  ) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  inputs: BoardInputs;
  onInputsChange: (inputs: BoardInputs) => void;
}) {
  const { t, locale } = useI18n();

  const confirm = useConfirmation();
  const boardId = useId();
  const fields = useForm<BoardInputs>({
    resolver: zodResolver(LegacyBoardSubmissionSchema.shape.inputs),
    values: inputs,
  });
  const setInputs = (
    value: BoardInputs | ((old: BoardInputs) => BoardInputs),
  ) => onInputsChange(typeof value === "function" ? value(inputs) : value);
  const [customOutput, setCustomOutput] = useState<BoardOutput | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attached, setAttached] = useState(false);
  const [repairNonce, setRepairNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const retryCount = useRef(0);
  const inputRef = useRef(inputs);
  inputRef.current = inputs;
  const validCode = useMemo(() => {
    if (board.kind !== "custom") return true;
    try {
      validateCalculation(
        board.code,
        board.controls.map((c) => c.id),
        board.metrics.map((m) => m.id),
      );
      return true;
    } catch {
      return false;
    }
  }, [board]);
  useEffect(() => {
    if (board.kind !== "custom" || !loaded || !validCode) return;
    let alive = true;
    const channel = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    setCustomOutput(null);
    const fail = () => {
      if (!alive) return;
      if (retryCount.current++ === 0) {
        setRepairNonce((n) => n + 1);
      } else setFailed(true);
    };
    const timer = setTimeout(fail, 2000);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel ||
        event.data?.requestId !== requestId
      )
        return;
      clearTimeout(timer);
      const parsed = BoardOutputSchema.safeParse(event.data.result);
      if (
        !parsed.success ||
        Object.keys(parsed.data.metrics).length !== board.metrics.length ||
        board.metrics.some((m) => !(m.id in parsed.data.metrics))
      ) {
        fail();
        return;
      }
      setCustomOutput(parsed.data);
      setFailed(false);
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage(
      { type: "calculate", channel, requestId, code: board.code, inputs },
      "*",
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [board, inputs, loaded, validCode, repairNonce]);
  const update = (key: string, value: BoardInputs[string]) => {
    fields.setValue(key, value, { shouldDirty: true });
    setInputs((old) => ({ ...old, [key]: value }));
    setAttached(false);
  };
  const cnn =
    board.kind === "cnn" ? convolution(Number(inputs.inputSize)) : null;
  const output =
    board.kind === "causal" ? calculateTemplate(board, inputs) : customOutput;
  const unavailable = board.kind === "text" || failed || !validCode;
  const changed =
    attached ||
    JSON.stringify(inputs) !== JSON.stringify(initialBoardInputs(board));
  function reorder(index: number, offset: number) {
    const order = [...(inputs.order as string[])];
    [order[index], order[index + offset]] = [
      order[index + offset],
      order[index],
    ];
    update("order", order);
  }
  return (
    <div className="teaching-board">
      <div className="board-heading">
        <span className="board-icon">
          <Layers3 size={18} />
        </span>
        <h2>{t("Teaching board")}</h2>
        {/* Text boards have no controls, so there is nothing to reset. */}
        {board.kind !== "text" && (
          <button
            className="icon-button"
            title={
              changed || failed ? t("Reset board") : t("Nothing to reset yet")
            }
            aria-label={t("Reset board")}
            onClick={async () => {
              if (
                !(await confirm({
                  title: "Reset this board?",
                  description:
                    "Your current board settings will be lost and the initial settings restored.",
                  confirmLabel: "Reset board",
                  destructive: true,
                }))
              )
                return;
              setInputs(initialBoardInputs(board));
              setAttached(false);
              if (failed) {
                retryCount.current = 0;
                setFailed(false);
                setRepairNonce((n) => n + 1);
              }
            }}
            disabled={disabled || (!changed && !failed)}
          >
            <RotateCcw size={16} />
          </button>
        )}
      </div>
      <div className="board-content">
        <span className="small-label">
          {t("A space to make your thinking visible")}
        </span>
        <h3 lang={lessonLanguage(teachingLanguage)}>{board.title}</h3>
        <p
          className="board-instruction"
          lang={
            unavailable && board.kind !== "text"
              ? locale
              : lessonLanguage(teachingLanguage)
          }
        >
          {unavailable && board.kind !== "text"
            ? t(
                "This visualization isn't available. You can still teach Milo with a written example in the conversation.",
              )
            : board.instruction}
        </p>
        {board.kind === "custom" && validCode && (
          <iframe
            ref={frame}
            title={t("Isolated board calculation engine")}
            sandbox="allow-scripts"
            srcDoc={calculationSandbox}
            className="calculation-sandbox"
            onLoad={() => setLoaded(true)}
          />
        )}
        {cnn && (
          <>
            <div
              className="cnn-scene"
              aria-label={t(
                "The same kernel is reused across different image positions",
              )}
            >
              <div
                className="cnn-grid"
                style={
                  {
                    "--grid-count": inputs.inputSize === 64 ? 12 : 8,
                  } as React.CSSProperties
                }
              >
                <div className="kernel-window" />
                <span className="grid-corner" />
              </div>
              <span className="filter-link">
                <ArrowUpRight size={22} />
              </span>
              <div className="kernel-key">
                <div className="tiny-kernel">
                  {Array.from({ length: 9 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
                <span>
                  {t("Same weights,")}
                  <br />
                  {t("every position")}
                </span>
              </div>
            </div>
            <fieldset className="board-sizes">
              <legend>{t("Input image size")}</legend>
              <div className="segmented">
                {[32, 64].map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={inputs.inputSize === size}
                    disabled={disabled}
                    onClick={() => update("inputSize", size)}
                  >
                    {size} × {size}
                  </button>
                ))}
              </div>
            </fieldset>
            <dl className="board-metrics">
              <div>
                <dt>{t("Output shape")}</dt>
                <dd>
                  {cnn.outputSize} × {cnn.outputSize} × 8
                </dd>
              </div>
              <div className="metric-feature">
                <dt>
                  {t("Learned parameters")}{" "}
                  <span>{t("216 weights + 8 biases")}</span>
                </dt>
                <dd>
                  {cnn.parameters}
                  <span>{t("stays the same")}</span>
                </dd>
              </div>
              <div>
                <dt>{t("Multiplications")}</dt>
                <dd>{formatNumber(locale, cnn.multiplications)}</dd>
              </div>
            </dl>
          </>
        )}
        {!unavailable && ["causal", "custom"].includes(board.kind) && (
          <>
            <div className="board-controls">
              {board.controls.map((c) => (
                <div key={c.id}>
                  <div className="control-label">
                    <label htmlFor={`${boardId}-control-${c.id}`}>
                      {c.label}
                    </label>
                    <output>
                      {inputs[c.id]} {c.unit}
                    </output>
                  </div>
                  <BoardNumberField
                    id={`${boardId}-control-${c.id}`}
                    type="range"
                    disabled={disabled}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={Number(inputs[c.id])}
                    onChange={(value) => update(c.id, value)}
                  />
                  <BoardNumberField
                    className="board-number"
                    type="number"
                    aria-label={`${c.label} (${t("Numeric value")})`}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={Number(inputs[c.id])}
                    disabled={disabled}
                    onChange={(value) => update(c.id, value)}
                  />
                  <div className="range-ends">
                    <span>{c.min}</span>
                    <span>{c.max}</span>
                  </div>
                </div>
              ))}
            </div>
            <dl className="board-metrics">
              {board.metrics.map((m) => (
                <div key={m.id}>
                  <dt>{m.label}</dt>
                  <dd>
                    {output
                      ? formatNumber(locale, Number(output.metrics[m.id]), {
                          maximumFractionDigits: 3,
                        })
                      : "…"}{" "}
                    <small>{m.unit}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {!unavailable && board.kind === "sequence" && (
          <ol className="sequence-items">
            {(inputs.order as string[]).map((id, index, all) => (
              <li
                key={id}
                draggable={!disabled}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
                onDragOver={(e) => {
                  if (!disabled) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (disabled) return;
                  const order = [...(inputs.order as string[])];
                  const from = order.indexOf(
                    e.dataTransfer.getData("text/plain"),
                  );
                  if (from < 0) return;
                  order.splice(from, 1);
                  order.splice(index, 0, e.dataTransfer.getData("text/plain"));
                  update("order", order);
                }}
              >
                <Grip size={16} />
                <span>
                  <strong>{board.items.find((i) => i.id === id)?.label}</strong>
                  <small>{board.items.find((i) => i.id === id)?.detail}</small>
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label={t("Move {item} up", {
                      item: board.items.find((i) => i.id === id)?.label ?? "",
                    })}
                    disabled={disabled || index === 0}
                    onClick={() => reorder(index, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t("Move {item} down", {
                      item: board.items.find((i) => i.id === id)?.label ?? "",
                    })}
                    disabled={disabled || index === all.length - 1}
                    onClick={() => reorder(index, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {!unavailable && board.kind === "classification" && (
          <div className="classification-items">
            <div className="classification-groups">
              {board.groups.map((group) => (
                <span key={group}>
                  {group} (
                  {Object.values(inputs).filter((v) => v === group).length})
                </span>
              ))}
            </div>
            {board.items.map((item) => (
              <div key={item.id}>
                <label htmlFor={`${boardId}-class-${item.id}`}>
                  {item.label}
                </label>
                <p>{item.detail}</p>
                <Controller
                  control={fields.control}
                  name={item.id}
                  defaultValue=""
                  render={({ field }) => (
                    <CustomSelect
                      id={`${boardId}-class-${item.id}`}
                      label={item.label}
                      disabled={disabled}
                      value={String(field.value || "")}
                      inputRef={field.ref}
                      onBlur={field.onBlur}
                      name={field.name}
                      placeholder={t("Choose a group")}
                      options={board.groups.map((group) => ({
                        value: group,
                        label: group,
                        lang: lessonLanguage(teachingLanguage),
                      }))}
                      onChange={(value) => update(item.id, value)}
                    />
                  )}
                />
              </div>
            ))}
          </div>
        )}
        {!unavailable && board.kind === "comparison" && (
          <div className="comparison-items">
            {board.items.map((item) => (
              <button
                className={inputs.selected === item.id ? "selected" : ""}
                key={item.id}
                aria-pressed={inputs.selected === item.id}
                disabled={disabled}
                onClick={() => update("selected", item.id)}
              >
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </button>
            ))}
          </div>
        )}
        {board.assumptions && (
          <p className="board-assumptions">{board.assumptions}</p>
        )}
        {!unavailable && (
          <>
            <button
              className="secondary-button full-width"
              disabled={disabled || (board.kind === "custom" && !customOutput)}
              onClick={async () => {
                if (!(await fields.trigger())) return;
                const accepted = await onAttach({ version: 1, inputs });
                if (accepted !== false) setAttached(true);
              }}
            >
              {attached ? (
                <>
                  <Check size={17} /> {t("Attached to your explanation")}
                </>
              ) : (
                <>
                  {t("Attach to explanation")} <ArrowUpRight size={17} />
                </>
              )}
            </button>
            <p className="board-footnote">
              {t("Add your own explanation when you send.")}{" "}
              {board.kind !== "cnn" &&
                t("This illustration is not an assessment answer key.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
