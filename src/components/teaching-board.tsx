"use client";

import { lessonLanguage, type TeachingLanguage } from "@/lib/i18n/locales";
import { CustomSelect } from "./custom-select";
import { useI18n } from "@/components/locale-context";
import { useConfirmation } from "./confirmation";
import { useId, useState } from "react";
import { Board, BoardSubmission } from "@/lib/contracts";
import { validateWorkspaceSubmission } from "@/lib/boards";
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
import { BoardRenderer } from "./board-catalog/board-renderer";

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
                  const snapshot = {
                    version: 2 as const,
                    inputs: {},
                    state: structuredClone(state),
                    ...(state.kind === "sketch"
                      ? { png: sketchPng(state) }
                      : {}),
                  };
                  validateWorkspaceSubmission(snapshot);
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
        <BoardRenderer
          board={board}
          teachingLanguage={teachingLanguage}
          onAttach={attach}
          disabled={disabled}
          values={workspace.board}
          onValuesChange={(values) => onChange({ ...workspace, board: values })}
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
