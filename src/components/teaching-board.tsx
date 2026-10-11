"use client";
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
} from "@/lib/contracts";
import { calculateTemplate, initialBoardInputs } from "@/lib/boards";
import { convolution } from "@/lib/cnn";
import { validateCalculation } from "@/lib/custom-code";
import { calculationSandbox } from "@/lib/sandbox";

export function TeachingBoard({
  board,
  onAttach,
  disabled = false,
}: {
  board: Board;
  onAttach: (snapshot: BoardSubmission) => void;
  disabled?: boolean;
}) {
  const boardId = useId();
  const [inputs, setInputs] = useState<BoardSubmission["inputs"]>(() =>
    initialBoardInputs(board),
  );
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
  const update = (key: string, value: BoardSubmission["inputs"][string]) => {
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
        <h2>Teaching board</h2>
        {/* Text boards have no controls, so there is nothing to reset. */}
        {board.kind !== "text" && (
          <button
            className="icon-button"
            title={changed || failed ? "Reset board" : "Nothing to reset yet"}
            aria-label="Reset board"
            onClick={() => {
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
          A space to make your thinking visible
        </span>
        <h3>{board.title}</h3>
        <p className="board-instruction">
          {unavailable && board.kind !== "text"
            ? "This visualization isn't available. You can still teach Milo with a written example in the conversation."
            : board.instruction}
        </p>
        {board.kind === "custom" && validCode && (
          <iframe
            ref={frame}
            title="Isolated board calculation engine"
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
              aria-label="The same kernel is reused across different image positions"
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
                  Same weights,
                  <br />
                  every position
                </span>
              </div>
            </div>
            <fieldset className="board-sizes">
              <legend>Input image size</legend>
              <div className="segmented">
                {[32, 64].map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={inputs.inputSize === size}
                    onClick={() => update("inputSize", size)}
                  >
                    {size} × {size}
                  </button>
                ))}
              </div>
            </fieldset>
            <dl className="board-metrics">
              <div>
                <dt>Output shape</dt>
                <dd>
                  {cnn.outputSize} × {cnn.outputSize} × 8
                </dd>
              </div>
              <div className="metric-feature">
                <dt>
                  Learned parameters <span>216 weights + 8 biases</span>
                </dt>
                <dd>
                  {cnn.parameters}
                  <span>stays the same</span>
                </dd>
              </div>
              <div>
                <dt>Multiplications</dt>
                <dd>{cnn.multiplications.toLocaleString()}</dd>
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
                  <input
                    id={`${boardId}-control-${c.id}`}
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={Number(inputs[c.id])}
                    onChange={(e) => update(c.id, Number(e.target.value))}
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
                      ? Number(output.metrics[m.id]).toLocaleString(undefined, {
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
              <li key={id}>
                <Grip size={16} />
                <span>
                  <strong>{board.items.find((i) => i.id === id)?.label}</strong>
                  <small>{board.items.find((i) => i.id === id)?.detail}</small>
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label={`Move ${board.items.find((i) => i.id === id)?.label} up`}
                    disabled={index === 0}
                    onClick={() => reorder(index, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${board.items.find((i) => i.id === id)?.label} down`}
                    disabled={index === all.length - 1}
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
            {board.items.map((item) => (
              <div key={item.id}>
                <label htmlFor={`${boardId}-class-${item.id}`}>
                  {item.label}
                </label>
                <p>{item.detail}</p>
                <select
                  id={`${boardId}-class-${item.id}`}
                  value={String(inputs[item.id] || "")}
                  onChange={(e) => update(item.id, e.target.value)}
                >
                  <option value="" disabled>
                    Choose a group
                  </option>
                  {board.groups.map((group) => (
                    <option key={group}>{group}</option>
                  ))}
                </select>
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
              onClick={() => {
                onAttach({ version: 1, inputs });
                setAttached(true);
              }}
            >
              {attached ? (
                <>
                  <Check size={17} /> Attached to your explanation
                </>
              ) : (
                <>
                  Use this to explain it <ArrowUpRight size={17} />
                </>
              )}
            </button>
            <p className="board-footnote">
              Add your own explanation when you send.{" "}
              {board.kind !== "cnn" &&
                "This illustration is not an assessment answer key."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
