"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  BoardStateSubmissionSchema,
  BoardSubmissionSchema,
  type Board,
  type BoardSubmission,
  type Phase,
} from "@/lib/contracts";
import {
  DraftToolStateSchema,
  emptyTool,
  type ToolState,
} from "@/lib/board-tools";
import { compileBoard } from "@/lib/board-catalog";
import {
  initialBoardValues,
  suggestedTool,
  exampleBoard,
  validateBoardValues,
  type BoardValues,
} from "@/lib/boards";
import type { TeachingLanguage } from "@/lib/i18n/locales";
import { BOARD_DRAFT_PREFIX } from "@/lib/board-drafts";
import type { SketchHistory } from "./sketch-board";

export type Workspace = {
  active: "suggested" | ToolState["kind"];
  board: BoardValues;
  tools: Record<string, ToolState>;
  invited: boolean;
  sketchHistory?: SketchHistory;
};
const WorkspaceSchema = z.object({
  active: z.enum(["suggested", "sketch", "concept_map", "matching", "table"]),
  board: BoardStateSubmissionSchema.omit({ version: true }),
  tools: z.record(
    z.string().regex(/^(suggested|sketch|concept_map|matching|table)$/),
    DraftToolStateSchema,
  ),
  invited: z.boolean(),
});
const SavedSchema = z.object({
  version: z.literal(2),
  expiresAt: z.string(),
  workspace: WorkspaceSchema,
  attachment: BoardSubmissionSchema.optional(),
  explanation: z.string().max(2000),
});
// Interactive boards render in the suggested slot; otherwise the slot holds the
// seeded learner tool, or the example table when the board seeds nothing.
export function initialWorkspace(
  board: Board,
  language?: TeachingLanguage,
): Workspace {
  const compiled = compileBoard(board);
  const seed = suggestedTool(board);
  return {
    active: "suggested",
    board: initialBoardValues(board, compiled),
    invited: false,
    tools: {
      sketch: emptyTool("sketch"),
      concept_map: emptyTool("concept_map"),
      matching: emptyTool("matching"),
      table: suggestedTool(exampleBoard("", language))!,
      ...(compiled.interactive
        ? seed
          ? { [seed.kind]: seed }
          : {}
        : {
            suggested:
              seed ?? suggestedTool(exampleBoard(board.title, language))!,
          }),
    },
  };
}
function restoredValues(
  board: Board,
  saved: BoardValues,
  initial: BoardValues,
) {
  try {
    return validateBoardValues(board, compileBoard(board), {
      version: 3,
      ...saved,
    });
  } catch {
    return initial;
  }
}
export function useBoardWorkspace({
  board,
  ownerId,
  sessionId,
  expiresAt,
  phase,
  language,
  attachment,
  explanation,
  restore,
}: {
  board?: Board;
  ownerId?: string;
  sessionId: string;
  expiresAt?: string;
  phase?: Phase;
  language?: TeachingLanguage;
  attachment?: BoardSubmission;
  explanation: string;
  restore: (
    attachment: BoardSubmission | undefined,
    explanation: string,
  ) => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const loadedKey = useRef<string | undefined>(undefined);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const key = ownerId
    ? `${BOARD_DRAFT_PREFIX}${ownerId}:${sessionId}`
    : undefined;
  const terminal =
    phase === "report" ||
    phase === "transfer" ||
    (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now());
  useEffect(() => {
    if (!key || terminal) {
      if (key && terminal) {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
      if (loadedKey.current) {
        try {
          localStorage.removeItem(loadedKey.current);
        } catch {}
      }
      loadedKey.current = undefined;
      setWorkspace(null);
      return;
    }
    if (!board || loadedKey.current === key) return;
    let initial = initialWorkspace(board, language);
    try {
      // Remove expired entries without extending their retention.
      for (const k of Object.keys(localStorage))
        if (k.startsWith(BOARD_DRAFT_PREFIX)) {
          try {
            if (
              Date.parse(JSON.parse(localStorage.getItem(k)!).expiresAt) <=
              Date.now()
            )
              localStorage.removeItem(k);
          } catch {
            localStorage.removeItem(k);
          }
        }
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = SavedSchema.safeParse(JSON.parse(raw));
        if (saved.success && Date.parse(saved.data.expiresAt) > Date.now()) {
          initial = {
            ...initial,
            ...saved.data.workspace,
            board: restoredValues(
              board,
              saved.data.workspace.board,
              initial.board,
            ),
            tools: { ...initial.tools, ...saved.data.workspace.tools },
          };
          restoreRef.current(saved.data.attachment, saved.data.explanation);
        } else localStorage.removeItem(key);
      }
      localStorage.setItem(`${key}:probe`, "1");
      localStorage.removeItem(`${key}:probe`);
    } catch {
      setStorageUnavailable(true);
    }
    loadedKey.current = key;
    setWorkspace(initial);
  }, [key, board, terminal, language]);
  useEffect(() => {
    if (
      !key ||
      loadedKey.current !== key ||
      !workspace ||
      !expiresAt ||
      terminal
    )
      return;
    const save = () => {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 2,
            expiresAt,
            workspace,
            attachment,
            explanation,
          }),
        );
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
      }
    };
    const timer = setTimeout(save, 150);
    window.addEventListener("teach-milo-board-migrating", save);
    window.addEventListener("pagehide", save);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("teach-milo-board-migrating", save);
      window.removeEventListener("pagehide", save);
    };
  }, [key, workspace, expiresAt, terminal, attachment, explanation]);
  useEffect(() => {
    const clear = (event: Event) => {
      const detail = (
        event as CustomEvent<{ ownerId?: string; sessionId?: string }>
      ).detail;
      if (
        key &&
        loadedKey.current === key &&
        (!detail.ownerId || detail.ownerId === ownerId) &&
        (!detail.sessionId || detail.sessionId === sessionId)
      ) {
        loadedKey.current = undefined;
        setWorkspace(null);
      }
    };
    window.addEventListener("teach-milo-board-cleared", clear);
    return () => window.removeEventListener("teach-milo-board-cleared", clear);
  }, [key, ownerId, sessionId]);
  const update = useCallback((value: Workspace) => setWorkspace(value), []);
  return { workspace, update, storageUnavailable };
}
