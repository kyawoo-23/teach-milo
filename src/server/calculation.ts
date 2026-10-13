import "server-only";
import { Worker } from "node:worker_threads";
import { validateCalculation } from "@/lib/custom-code";
import { compileBoard } from "@/lib/board-catalog";
import {
  boardDisplay,
  validateBoardValues,
  validateWorkspaceSubmission,
} from "@/lib/boards";
import type {
  Board,
  BoardSnapshot,
  BoardSubmission,
  NumericTransfer,
} from "@/lib/contracts";
import type { TeachingLanguage } from "@/lib/i18n/locales";
import { AppError } from "@/lib/errors";
import { withinTolerance } from "@/lib/assessment";

// The code is validated to a tiny arithmetic language before it gets here; the
// fresh vm context, frozen inputs and terminable worker are defence in depth.
const source = `
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const { code, inputs, outputIds } = workerData;
try {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const result = vm.runInContext(
    '"use strict"; Object.freeze(Math);\\n' + code +
      "\\n;calculate(Object.freeze(JSON.parse(" +
      JSON.stringify(JSON.stringify(inputs)) + ")));",
    context,
    { timeout: 100 },
  );
  const metrics = {};
  for (const id of outputIds) {
    const value = result && result.metrics ? result.metrics[id] : undefined;
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("calculate() returned a non-finite value for " + id);
    metrics[id] = value;
  }
  parentPort.postMessage({ metrics });
} catch (error) {
  parentPort.postMessage({ error: String((error && error.message) || error) });
}
`;

export async function runCalculation(
  code: string,
  inputs: Record<string, number>,
  outputIds: string[],
): Promise<Record<string, number>> {
  validateCalculation(code, Object.keys(inputs), outputIds);
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      workerData: { code, inputs, outputIds },
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
    });
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("calculate() timed out"))),
      1_000,
    );
    worker.once("message", (message: { metrics?: Record<string, number>; error?: string }) =>
      finish(() =>
        message.metrics
          ? resolve(message.metrics)
          : reject(new Error(message.error ?? "calculate() failed")),
      ),
    );
    worker.once("error", (error) => finish(() => reject(error)));
  });
}

// The client's computed values are never trusted: the server re-runs calculate().
export async function verifyBoardSubmission(
  board: Board,
  submission: BoardSubmission,
  language?: TeachingLanguage,
): Promise<BoardSnapshot> {
  if (submission.version === 2) return validateWorkspaceSubmission(submission);
  const compiled = compileBoard(board);
  const values = validateBoardValues(board, compiled, submission);
  let metrics: Record<string, number> = {};
  if (board.derived.length)
    try {
      metrics = await runCalculation(
        board.code,
        values.state,
        board.derived.map((d) => d.id),
      );
    } catch {
      throw new AppError(
        "INVALID_BOARD",
        "The board calculation couldn't run. Reset the board and try again.",
      );
    }
  return {
    version: 3,
    ...values,
    kind: "board",
    verified: true,
    metrics,
    display: boardDisplay(board, compiled, values, metrics, language),
  };
}

const NONE: NumericTransfer = { fields: [], inputs: [], code: "" };
// A model-written key is kept only when its own calculation reproduces every
// expected value, so assessment never grades against an unverified number.
export async function verifyNumericTransfer(
  numeric: NumericTransfer,
): Promise<{ numeric: NumericTransfer; outcome: "none" | "verified" | "dropped" }> {
  if (!numeric.fields.length) return { numeric: NONE, outcome: "none" };
  const ids = numeric.fields.map((f) => f.id);
  const inputs = Object.fromEntries(numeric.inputs.map((i) => [i.id, i.value]));
  if (
    new Set(ids).size !== ids.length ||
    Object.keys(inputs).length !== numeric.inputs.length ||
    numeric.fields.some(
      (f) =>
        !f.label.trim() ||
        !Number.isFinite(f.expected) ||
        !Number.isFinite(f.tolerance) ||
        f.tolerance < 0,
    ) ||
    numeric.inputs.some((i) => !Number.isFinite(i.value))
  )
    return { numeric: NONE, outcome: "dropped" };
  try {
    const computed = await runCalculation(numeric.code, inputs, ids);
    const fields = numeric.fields.map((f) => ({ ...f, expected: computed[f.id] }));
    return numeric.fields.every((f) =>
      withinTolerance(computed[f.id], f.expected, f.tolerance),
    )
      ? { numeric: { ...numeric, fields }, outcome: "verified" }
      : { numeric: NONE, outcome: "dropped" };
  } catch {
    return { numeric: NONE, outcome: "dropped" };
  }
}