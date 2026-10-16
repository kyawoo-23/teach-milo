"use client";
import { FormulaText } from "./formula-text";

import { lessonLanguage, type TeachingLanguage } from "@/lib/i18n/locales";
import { CustomSelect } from "./custom-select";
import { useI18n } from "@/components/locale-context";
import { useConfirmation } from "./confirmation";
import { useId, useState } from "react";
import {
  ArrowLeftRight,
  Maximize2,
  Network,
  PenLine,
  Sparkles,
  Table,
} from "lucide-react";
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
import { BoardAttachButton } from "./board-attach-button";
import attachStyles from "./board-attach-button.module.css";
import styles from "./board-editor.module.css";

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
  const [attachedState, setAttachedState] = useState<ToolState>();
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
  const resetBoard = async () => {
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
    const { initialWorkspace } = await import("./use-board-workspace");
    const initial = initialWorkspace(board, teachingLanguage);
    onChange({
      ...workspace,
      tools: {
        ...workspace.tools,
        [workspace.active]: initial.tools[workspace.active],
      },
    });
  };
  return (
    <div className={`board-workspace ${styles.workspace}`}>
      {onExpand && (
        <div className="workspace-heading">
          <strong>{t("Teaching board")}</strong>
          <button type="button" onClick={onExpand}>
            <Maximize2 size={16} aria-hidden="true" />
            {t("Expand")}
          </button>
        </div>
      )}
      <div className="tool-field">
        <label htmlFor={toolId}>{t("Board tool")}</label>
        <CustomSelect
          id={toolId}
          label={t("Board tool")}
          disabled={disabled || attaching}
          value={workspace.active}
          options={[
            {
              value: "suggested",
              label: t("Suggested activity"),
              icon: <Sparkles size={16} />,
            },
            {
              value: "sketch",
              label: t("Sketch and diagram"),
              icon: <PenLine size={16} />,
            },
            {
              value: "concept_map",
              label: t("Concept map"),
              icon: <Network size={16} />,
            },
            {
              value: "matching",
              label: t("Matching pairs"),
              icon: <ArrowLeftRight size={16} />,
            },
            {
              value: "table",
              label: t("Comparison table"),
              icon: <Table size={16} />,
            },
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
              <h3>
                <FormulaText>{board.title}</FormulaText>
              </h3>
              <p>
                <FormulaText>{board.instruction}</FormulaText>
              </p>
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
            <div className="workspace-actions">
              <button
                type="button"
                className={`secondary-button full-width ${attachStyles.button} ${attachStyles.reset} workspace-reset`}
                disabled={disabled}
                onClick={() => void resetBoard()}
              >
                {t("Reset board")}
              </button>
              <BoardAttachButton
                attaching={attaching}
                attached={attachedState === state}
                disabled={disabled}
                onClick={async () => {
                  setAttaching(true);
                  setError("");
                  try {
                    const snapshot = {
                      version: 2 as const,
                      inputs: {},
                      state: structuredClone(state),
                      ...(state.kind === "sketch"
                        ? { png: await sketchPng(state) }
                        : {}),
                    };
                    validateWorkspaceSubmission(snapshot);
                    if ((await attach(snapshot)) !== false)
                      setAttachedState(state);
                  } catch (e) {
                    setError(e as Error);
                  } finally {
                    setAttaching(false);
                  }
                }}
              />
            </div>
            <p className="board-footnote">
              {t("Add your own explanation when you send.")}
            </p>
          </div>
        </div>
      ) : (
        <div className="workspace-editor">
          <BoardRenderer
            board={board}
            teachingLanguage={teachingLanguage}
            onAttach={attach}
            disabled={disabled || attaching}
            values={workspace.board}
            onValuesChange={(values) =>
              onChange({ ...workspace, board: values })
            }
          />
        </div>
      )}
    </div>
  );
}
