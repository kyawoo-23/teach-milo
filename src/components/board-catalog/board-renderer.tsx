"use client";
import { useId, useMemo, useState } from "react";
import { ArrowUpRight, Check, RotateCcw } from "lucide-react";
import type { Board, BoardSubmission } from "@/lib/contracts";
import { compileBoard } from "@/lib/board-catalog";
import {
  boardNodes,
  initialBoardValues,
  validateBoardValues,
  type BoardValues,
} from "@/lib/boards";
import { lessonLanguage, type TeachingLanguage } from "@/lib/i18n/locales";
import { calculationSandbox } from "@/lib/sandbox";
import { useI18n } from "../locale-context";
import { useConfirmation } from "../confirmation";
import { ErrorNotice } from "../ui";
import { BoardNodeView, type BoardContext } from "./catalog-components";
import { useBoardCalculation } from "./use-board-calculation";

export function BoardRenderer({
  board,
  teachingLanguage,
  values,
  onValuesChange,
  onAttach,
  disabled = false,
}: {
  board: Board;
  teachingLanguage?: TeachingLanguage;
  values: BoardValues;
  onValuesChange: (values: BoardValues) => void;
  onAttach: (
    snapshot: BoardSubmission,
  ) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const confirm = useConfirmation();
  const idPrefix = useId();
  const [attached, setAttached] = useState(false);
  const [error, setError] = useState<string | Error>("");
  const compiled = useMemo(() => compileBoard(board), [board]);
  const initial = useMemo(
    () => initialBoardValues(board, compiled),
    [board, compiled],
  );
  const sweeps = useMemo(
    () => [
      ...new Set(
        boardNodes(compiled.tree)
          .filter((n) => n.component === "LineChart")
          .map((n) => n.props.x as string),
      ),
    ],
    [compiled],
  );
  const calculation = useBoardCalculation(board, values.state, sweeps);
  const unavailable =
    calculation.enabled && calculation.failed && !calculation.metrics;
  const changed =
    attached || JSON.stringify(values) !== JSON.stringify(initial);
  const update = (next: BoardValues) => {
    setAttached(false);
    setError("");
    onValuesChange(next);
  };
  const ctx: BoardContext = {
    board,
    values,
    metrics: calculation.metrics ?? {},
    series: calculation.series,
    disabled,
    language: teachingLanguage,
    idPrefix,
    t,
    setState: (id, value) =>
      update({ ...values, state: { ...values.state, [id]: value } }),
    setComposite: (id, value) =>
      update({ ...values, composites: { ...values.composites, [id]: value } }),
  };
  return (
    <div className="teaching-board">
      <div className="board-content">
        <div className="board-reset-row">
          <span className="small-label">
            {t("A space to make your thinking visible")}
          </span>
          <button
            type="button"
            className="icon-button"
            title={changed ? t("Reset board") : t("Nothing to reset yet")}
            aria-label={t("Reset board")}
            disabled={disabled || !changed}
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
                setAttached(false);
                onValuesChange(initial);
              }
            }}
          >
            <RotateCcw size={16} />
          </button>
        </div>
        <h3 lang={lessonLanguage(teachingLanguage)}>{board.title}</h3>
        <p
          className="board-instruction"
          lang={unavailable ? locale : lessonLanguage(teachingLanguage)}
        >
          {unavailable
            ? t(
                "This visualization isn't available. You can still teach Milo with a written example in the conversation.",
              )
            : board.instruction}
        </p>
        {calculation.enabled && (
          <iframe
            ref={calculation.frame}
            title={t("Isolated board calculation engine")}
            sandbox="allow-scripts"
            srcDoc={calculationSandbox}
            className="calculation-sandbox"
            onLoad={calculation.onLoad}
          />
        )}
        {calculation.failed && !unavailable && (
          <p className="board-callout caution" role="status">
            {t("This board couldn't update. The last values are shown.")}
          </p>
        )}
        {!unavailable && (
          <div
            className="board-nodes"
            lang={lessonLanguage(teachingLanguage)}
          >
            {compiled.tree.map((node) => (
              <BoardNodeView key={node.id} node={node} ctx={ctx} />
            ))}
          </div>
        )}
        {board.assumptions && (
          <p className="board-assumptions">{board.assumptions}</p>
        )}
        {error && <ErrorNotice message={error} />}
        {!unavailable && (
          <>
            <button
              type="button"
              className="secondary-button full-width"
              disabled={disabled}
              onClick={async () => {
                const snapshot: BoardSubmission = { version: 3, ...values };
                try {
                  validateBoardValues(board, compiled, snapshot);
                } catch (e) {
                  setError(e as Error);
                  return;
                }
                const accepted = await onAttach(structuredClone(snapshot));
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
              {t("This illustration is not an assessment answer key.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
