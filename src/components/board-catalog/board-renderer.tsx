"use client";
import { FormulaText } from "../formula-text";
import { useId, useMemo, useState } from "react";
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
import { BoardAttachButton } from "../board-attach-button";
import attachStyles from "../board-attach-button.module.css";
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
  const [attaching, setAttaching] = useState(false);
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
    disabled: disabled || attaching,
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
        <p className="small-label">
          {t("A space to make your thinking visible")}
        </p>
        <h3 lang={lessonLanguage(teachingLanguage)}>
          <FormulaText>{board.title}</FormulaText>
        </h3>
        <p
          className="board-instruction"
          lang={unavailable ? locale : lessonLanguage(teachingLanguage)}
        >
          <FormulaText>
            {unavailable
              ? t(
                  "This visualization isn't available. You can still teach Milo with a written example in the conversation.",
                )
              : board.instruction}
          </FormulaText>
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
          <div className="board-nodes" lang={lessonLanguage(teachingLanguage)}>
            {compiled.tree.map((node) => (
              <BoardNodeView key={node.id} node={node} ctx={ctx} />
            ))}
          </div>
        )}
        {board.assumptions && (
          <p className="board-assumptions">
            <FormulaText>{board.assumptions}</FormulaText>
          </p>
        )}
        {error && <ErrorNotice message={error} />}
      </div>
      {!unavailable && (
        <div className="workspace-share">
          <div className="workspace-actions">
            <button
              type="button"
              className={`secondary-button full-width ${attachStyles.button} ${attachStyles.reset} workspace-reset`}
              disabled={disabled || attaching || !changed}
              title={changed ? undefined : t("Nothing to reset yet")}
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
                setAttached(false);
                onValuesChange(initial);
              }}
            >
              {t("Reset board")}
            </button>
            <BoardAttachButton
              attaching={attaching}
              attached={attached}
              disabled={disabled}
              onClick={async () => {
                setAttaching(true);
                setError("");
                const snapshot: BoardSubmission = { version: 3, ...values };
                try {
                  validateBoardValues(board, compiled, snapshot);
                  const accepted = await onAttach(structuredClone(snapshot));
                  if (accepted !== false) setAttached(true);
                } catch (e) {
                  setError(e as Error);
                } finally {
                  setAttaching(false);
                }
              }}
            />
          </div>
          <p className="board-footnote">
            {t("Add your own explanation when you send.")}{" "}
            {t("This illustration is not an assessment answer key.")}
          </p>
        </div>
      )}
    </div>
  );
}
