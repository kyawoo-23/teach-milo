"use client";

import { useI18n } from "@/components/locale-context";
import { useConfirmation } from "./confirmation";
import Link from "next/link";
import { notFound, usePathname, useRouter } from "next/navigation";
import { ExplanationFormSchema, transferFormSchema } from "@/lib/form-schemas";
import { FieldError, useSchemaForm } from "./schema-form";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Circle,
  Flag,
  History,
  Layers3,
  Lightbulb,
  LogIn,
  MessageCircle,
  Paperclip,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  BoardSubmission,
  Message,
  SessionPublic,
  SessionUpdate,
} from "@/lib/contracts";
import { useAuth } from "./auth-context";
import { lessonLanguage } from "@/lib/i18n/locales";
import { LanguageSelector } from "./language-selector";
import { ThemeSelector } from "./theme-selector";
import { Brand } from "./brand";
import { UserProfileMenu } from "./user-profile-menu";
import { Milo } from "./milo";
import { TeachingBoard } from "./teaching-board";
import { useBoardWorkspace } from "./use-board-workspace";
import { BoardPreview } from "./board-preview";
import { clearBoardDrafts } from "@/lib/board-drafts";
import { CompletedSessionView } from "./completed-session-view";
import { ConversationMessage } from "./conversation-message";
import {
  api,
  ApiError,
  draftStorage,
  ErrorNotice,
  Modal,
  Spinner,
  useOperationId,
} from "./ui";

export function SessionExperience({ id }: { id: string }) {
  const { t } = useI18n();

  const confirm = useConfirmation();
  const router = useRouter();
  const pathname = usePathname();
  const {
    user,
    loading: authLoading,
    openAuthModal,
    openSessionModal,
  } = useAuth();
  const userId = user?.id;
  const getOperation = useOperationId(id);
  const busyRef = useRef(false);
  const [session, setSession] = useState<SessionPublic | null>(null);
  const [error, setError] = useState<string | Error>("");
  const [busy, setBusy] = useState(false);
  const explanationForm = useSchemaForm(
    ExplanationFormSchema,
    { text: "" },
    { mode: "onSubmit" },
  );
  const [text, setText] = explanationForm.state("text");
  const [listening, setListening] = useState(false);
  const [replyKey, setReplyKey] = useState<string | undefined>();
  const lastStudent = useRef<{ sessionKey: string; messageId?: string } | null>(
    null,
  );
  const [outgoing, setOutgoing] = useState<Message | null>(null);
  const pendingSend = useRef<{ text: string; board?: BoardSubmission } | null>(
    null,
  );
  const [board, setBoard] = useState<BoardSubmission | undefined>();
  const [boardOpen, setBoardOpen] = useState(false);
  const boardWorkspace = useBoardWorkspace({
    board: session?.board,
    ownerId: userId,
    sessionId: id,
    expiresAt: session?.expiresAt,
    phase: session?.phase,
    language: session?.lesson.teachingLanguage,
    attachment: board ?? pendingSend.current?.board,
    explanation: pendingSend.current?.text ?? text,
    restore: (attachment, explanation) => {
      if (
        session?.messages.some(
          (m) => m.id === draftStorage.getItem(`pending-turn:${id}`),
        )
      ) {
        setBoard(undefined);
        setText("");
      } else {
        setBoard(attachment);
        setText(explanation);
      }
    },
  });
  const [classroomDetailsOpen, setClassroomDetailsOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 960px), (max-height: 860px)");
    setClassroomDetailsOpen(!mq.matches);
  }, []);
  const [endOpen, setEndOpen] = useState(false);
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);
  const [older, setOlder] = useState<Message[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const numericFields = session?.numericFields ?? [];
  const transferForm = useSchemaForm(
    transferFormSchema(numericFields.map((f) => f.id)),
    { numbers: {}, answer: "" },
  );
  const [numbers, setNumbers] = transferForm.state("numbers");
  const [answer, setAnswer] = transferForm.state("answer");
  const messagesRef = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sessionRef = useRef(session);
  const generation = useRef(0);
  const request = useRef<{
    controller: AbortController;
    promise: Promise<boolean>;
  } | null>(null);
  const earlierRequest = useRef<AbortController | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const acceptSession = useCallback((incoming: SessionPublic) => {
    const previous = sessionRef.current;
    if (previous?.id === incoming.id && previous.revision > incoming.revision)
      return;
    if (
      previous?.id === incoming.id &&
      ["baseline", "teaching", "ready_for_check"].includes(incoming.phase)
    ) {
      const first = incoming.messages[0]?.sequence ?? Infinity;
      setOlder((old) =>
        Array.from(
          new Map(
            [
              ...old,
              ...previous.messages.filter((m) => m.sequence < first),
            ].map((m) => [m.id, m]),
          ).values(),
        ).sort((a, b) => a.sequence - b.sequence),
      );
      incoming = { ...incoming, nextCursor: previous.nextCursor };
    }
    sessionRef.current = incoming;
    setSession(incoming);
  }, []);
  const load = useCallback(
    (incremental = false): Promise<boolean> => {
      if (!userId) return Promise.resolve(false);
      if (request.current) return request.current.promise;
      const currentGeneration = generation.current;
      const controller = new AbortController();
      const revision = incremental ? sessionRef.current?.revision : undefined;
      const promise = (async () => {
        try {
          const result = await api<SessionUpdate>(
            `/api/sessions/${id}${revision === undefined ? "" : `?sinceRevision=${revision}`}`,
            undefined,
            "GET",
            {
              signal: controller.signal,
              priority: incremental ? "low" : "auto",
            },
          );
          if (
            generation.current !== currentGeneration ||
            controller.signal.aborted
          )
            return false;
          if ("unchanged" in result) {
            const previous = sessionRef.current;
            if (
              previous?.id === id &&
              previous.revision === result.revision &&
              previous.pending !== result.pending
            )
              acceptSession({ ...previous, pending: result.pending });
          } else {
            acceptSession(result);
            if (
              result.messages.some(
                (m) => m.id === draftStorage.getItem(`pending-turn:${id}`),
              )
            ) {
              setText("");
              draftStorage.removeItem(`draft:${id}`);
              draftStorage.removeItem(`pending-turn:${id}`);
            }
          }
          setError("");
          return true;
        } catch (e) {
          if (
            generation.current !== currentGeneration ||
            controller.signal.aborted
          )
            return false;
          if (
            e instanceof ApiError &&
            ["NOT_FOUND", "EXPIRED"].includes(e.code)
          ) {
            clearBoardDrafts(userId, id);
            notFound();
          }
          if (e instanceof ApiError && e.code === "AUTH_REQUIRED") {
            sessionRef.current = null;
            setSession(null);
            openAuthModal("login");
          }
          setError(e instanceof Error ? e : "Couldn't open this session.");
          return false;
        } finally {
          if (request.current?.controller === controller)
            request.current = null;
        }
      })();
      request.current = { controller, promise };
      return promise;
    },
    [id, userId, openAuthModal, acceptSession],
  );
  const sessionLoaded = session !== null;
  const sessionPending = !!session?.pending;
  const latestStudentId = session?.messages.findLast(
    (message) => message.role === "student",
  )?.id;
  useEffect(() => {
    if (!sessionLoaded) return;
    const sessionKey = `${id}:${userId ?? ""}`;
    const previous = lastStudent.current;
    if (!previous || previous.sessionKey !== sessionKey || !latestStudentId) {
      lastStudent.current = { sessionKey, messageId: latestStudentId };
      setReplyKey(undefined);
      return;
    }
    if (previous.messageId === latestStudentId) return;
    if (busy || sessionPending) return;
    lastStudent.current = { sessionKey, messageId: latestStudentId };
    setReplyKey(latestStudentId);
  }, [id, userId, latestStudentId, sessionLoaded, busy, sessionPending]);
  useEffect(() => {
    if (!replyKey) return;
    const timer = setTimeout(() => setReplyKey(undefined), 1200);
    return () => clearTimeout(timer);
  }, [replyKey]);
  useEffect(() => {
    generation.current++;
    request.current?.controller.abort();
    request.current = null;
    earlierRequest.current?.abort();
    earlierRequest.current = null;
    sessionRef.current = null;
    setSession(null);
    setOlder([]);
    setOutgoing(null);
    setListening(false);
    setBoard(undefined);
    setBoardOpen(false);
    setClassroomDetailsOpen(false);
    setLoadingEarlier(false);
    pendingSend.current = null;
    busyRef.current = false;
    setBusy(false);
    setError("");
    if (!authLoading) {
      if (userId) void load();
      else {
        setError("Sign in to open your learning session.");
        openAuthModal("login");
      }
    }
    return () => {
      generation.current++;
      request.current?.controller.abort();
      request.current = null;
      earlierRequest.current?.abort();
      earlierRequest.current = null;
    };
  }, [load, userId, authLoading, openAuthModal]);
  useEffect(() => {
    if (!session) return;
    const path = `/session/${id}${session.phase === "transfer" ? "/transfer" : session.phase === "report" ? "/report" : ""}`;
    if (pathname !== path) router.replace(path);
    if (session.phase === "transfer" || session.phase === "report") {
      setBoard(undefined);
      setBoardOpen(false);
      setText("");
      draftStorage.removeItem(`draft:${id}`);
    }
    document.title = `${session.lesson.title} | TeachBack AI`;
  }, [session, id, pathname, router]);
  useEffect(() => {
    setText(draftStorage.getItem(`draft:${id}`) || "");
    try {
      const draft = JSON.parse(
        draftStorage.getItem(`transfer-draft:${id}`) || "null",
      );
      if (draft) {
        setAnswer(typeof draft.answer === "string" ? draft.answer : "");
        if (draft.numbers && typeof draft.numbers === "object")
          setNumbers(
            Object.fromEntries(
              Object.entries(draft.numbers).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              ),
            ),
          );
      }
    } catch {
      /* Ignore a damaged local draft. */
    }
    setDraftsLoaded(true);
  }, [id]);
  useEffect(() => {
    if (draftsLoaded && (answer || Object.values(numbers ?? {}).some(Boolean)))
      draftStorage.setItem(
        `transfer-draft:${id}`,
        JSON.stringify({ answer, numbers }),
      );
  }, [id, answer, numbers, draftsLoaded]);
  useEffect(() => {
    if (session?.phase === "report")
      draftStorage.removeItem(`transfer-draft:${id}`);
  }, [id, session?.phase]);
  useEffect(() => {
    if (!session || session.phase === "ready_for_check") return;
    draftStorage.removeItem(`understood-dismissed:${id}`);
    setCelebrationDismissed(false);
  }, [id, session]);
  useEffect(() => {
    if (!draftsLoaded) return;
    if (text) draftStorage.setItem(`draft:${id}`, text);
    else draftStorage.removeItem(`draft:${id}`);
  }, [id, text, draftsLoaded]);
  const messageCount = session?.messages?.length ?? 0;
  const outgoingId = outgoing?.id ?? null;
  useEffect(() => {
    const thread = messagesRef.current;
    thread?.scrollTo({
      top: thread.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [messageCount, outgoingId, busy]);
  useEffect(() => {
    if (!session?.pending || busy || !userId) return;
    let stopped = false;
    let polling = false;
    let delay = 4000;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || polling || document.hidden || busyRef.current) return;
      polling = true;
      const ok = await load(true);
      polling = false;
      if (stopped) return;
      delay = ok ? 4000 : Math.min(delay * 2, 30000);
      if (sessionRef.current?.pending && !document.hidden)
        timer = setTimeout(poll, delay);
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    if (!document.hidden) timer = setTimeout(poll, delay);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session?.pending, busy, userId, load]);
  async function mutate(endpoint: string, payload: object) {
    if (busyRef.current || !session) return false;
    const currentGeneration = ++generation.current;
    request.current?.controller.abort();
    request.current = null;
    earlierRequest.current?.abort();
    earlierRequest.current = null;
    setLoadingEarlier(false);
    busyRef.current = true;
    setListening(false);
    setBusy(true);
    setError("");
    try {
      const body = { ...payload, revision: session.revision };
      const operationId = getOperation(endpoint + JSON.stringify(body));
      if (endpoint === "turns")
        draftStorage.setItem(`pending-turn:${id}`, operationId);
      const result = await api<SessionPublic>(
        `/api/sessions/${id}/${endpoint}`,
        { ...body, operationId },
      );
      if (generation.current !== currentGeneration) return null;
      if (endpoint === "turns") draftStorage.removeItem(`pending-turn:${id}`);
      acceptSession(result);
      return true;
    } catch (e) {
      if (generation.current !== currentGeneration) return null;
      if (e instanceof ApiError && e.code === "STALE_SESSION") await load();
      setError(e instanceof Error ? e : "Please try again.");
      return false;
    } finally {
      if (generation.current === currentGeneration) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function deliver(payload: { text: string; board?: BoardSubmission }) {
    const ok = await mutate("turns", {
      text: payload.text,
      ...(payload.board ? { board: payload.board } : {}),
    });
    if (ok === null) return false;
    if (ok) {
      setOutgoing(null);
      pendingSend.current = null;
      setText((current) => (current === payload.text ? "" : current));
      setBoard((current) => (current === payload.board ? undefined : current));
      composer.current?.focus();
    } else {
      setText(payload.text);
      setBoard(payload.board);
    }
    return ok;
  }
  async function send({ text }: typeof explanationForm.values) {
    if (busyRef.current) return;
    const body = text.trim();
    if (!body || !session) return;
    const payload = { text: body, ...(board ? { board } : {}) };
    pendingSend.current = payload;
    setOutgoing({
      id: `local-${session.revision}-${body.length}`,
      role: "learner",
      text: body,
      createdAt: new Date().toISOString(),
      sequence: Number.MAX_SAFE_INTEGER,
      kind: "teaching",
      ...(payload.board
        ? {
            board: {
              ...structuredClone(payload.board),
              kind:
                payload.board.version === 2
                  ? payload.board.state.kind
                  : "board",
              verified: false,
            },
          }
        : {}),
    });
    setText("");
    setBoard(undefined);
    await deliver(payload);
  }
  async function action(
    action: "hint" | "continue" | "start_transfer" | "end",
  ) {
    if (
      (action === "start_transfer" || action === "end") &&
      (text.trim() || board) &&
      !(await confirm({
        title: "Discard unsent explanation?",
        description:
          "Your unsent text and board attachment will be discarded when you continue.",
        confirmLabel: "Discard and continue",
        destructive: true,
      }))
    )
      return false;
    setEndOpen(false);
    return mutate("actions", { action });
  }
  async function attach(snapshot: BoardSubmission) {
    if (
      board &&
      !(await confirm({
        title: "Replace board snapshot?",
        description:
          "The attached snapshot will be replaced with the current board settings.",
        confirmLabel: "Replace snapshot",
        destructive: true,
      }))
    )
      return false;
    setBoard(structuredClone(snapshot));
    setBoardOpen(false);
    composer.current?.focus();
  }
  function dismissCelebration() {
    draftStorage.setItem(`understood-dismissed:${id}`, "1");
    setCelebrationDismissed(true);
  }
  const isTeaching =
    session &&
    ["baseline", "teaching", "ready_for_check"].includes(session.phase);
  const showCelebration =
    session?.phase === "ready_for_check" &&
    !celebrationDismissed &&
    draftStorage.getItem(`understood-dismissed:${id}`) !== "1";
  const unavailable = busy || !!session?.pending;
  const messages = [
    ...older,
    ...(session?.messages || []),
    ...(outgoing &&
    !(session?.messages || []).some(
      (m) =>
        m.role === "learner" &&
        m.text === outgoing.text &&
        m.createdAt >= outgoing.createdAt,
    )
      ? [outgoing]
      : []),
  ].filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i);
  return (
    <div className="session-shell">
      <header className="session-header">
        <div className="session-header-inner">
          <Brand />
          <div className="session-topic">
            {session?.lesson.title || t("Your classroom")}
            <span>
              {session?.phase === "transfer"
                ? t("Independent check")
                : session?.phase === "report"
                  ? t("Learning report")
                  : t("Learning by teaching")}
            </span>
          </div>
          <nav className="session-header-actions" aria-label={t("Session")}>
            <LanguageSelector />
            <ThemeSelector />
            {isTeaching && (
              <button
                className="quiet-button"
                aria-label={t("End session")}
                disabled={unavailable}
                onClick={() => setEndOpen(true)}
              >
                <Flag size={15} />{" "}
                <span className="session-end-label">{t("End session")}</span>
              </button>
            )}
            {user && (
              <button
                type="button"
                className="quiet-button session-history-button"
                onClick={openSessionModal}
                title={t("My Sessions")}
                aria-label={t("My Sessions")}
              >
                <History size={15} />
                <span className="button-text">{t("My Sessions")}</span>
              </button>
            )}
            {user ? (
              <UserProfileMenu user={user} variant="session" />
            ) : (
              <button
                type="button"
                className="quiet-button signin-button-small"
                onClick={() => openAuthModal("login")}
              >
                <LogIn size={14} />
                <span>{t("Sign In")}</span>
              </button>
            )}
          </nav>
        </div>
      </header>
      {!session ? (
        <main tabIndex={-1} id="main" className="loading-page">
          {error ? (
            <>
              <ErrorNotice message={error} onRetry={() => void load()} />
              <Link className="secondary-button" href="/">
                {t("Start a new lesson")}
              </Link>
            </>
          ) : (
            <>
              <Milo size={96} thinking />
              <Spinner label={t("Opening your classroom")} />
            </>
          )}
        </main>
      ) : session.phase === "report" && session.report ? (
        <CompletedSessionView
          key={`${session.id}:${userId}`}
          session={session}
          user={user}
        />
      ) : session.phase === "transfer" ? (
        <main tabIndex={-1} id="main" className="transfer-main">
          <section className="transfer-card">
            <span className="transfer-icon">
              <ShieldCheck size={30} />
            </span>
            <span className="small-label">
              {t("A fresh example, in your own words")}
            </span>
            <h1>
              {t("One last challenge.")}
              <br />
              {t("On your own.")}
            </h1>
            <p className="section-description">
              {t(
                "Put the idea to work in a new situation. Take your time—your reasoning matters more than a perfect answer.",
              )}
            </p>
            <div
              className="transfer-question"
              lang={lessonLanguage(session.lesson.teachingLanguage)}
            >
              {session.transferQuestion}
            </div>
            <form
              noValidate
              onSubmit={transferForm.handleSubmit(
                async ({ answer, numbers }) => {
                  await mutate("transfer", {
                    answer,
                    skip: false,
                    ...(numericFields.length
                      ? {
                          answers: Object.fromEntries(
                            numericFields.map((f) => [
                              f.id,
                              Number(numbers[f.id]),
                            ]),
                          ),
                        }
                      : {}),
                  });
                },
              )}
            >
              {numericFields.length > 0 && (
                <div className="number-fields">
                  {numericFields.map((field) => (
                    <label
                      key={field.id}
                      lang={lessonLanguage(session.lesson.teachingLanguage)}
                    >
                      {field.label}
                      {field.unit ? ` (${field.unit})` : ""}
                      <input
                        className="text-input"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        required
                        disabled={unavailable}
                        id={`transfer-${field.id}`}
                        {...transferForm.register(`numbers.${field.id}`)}
                        {...transferForm.a11y(
                          `numbers.${field.id}`,
                          `transfer-${field.id}`,
                        )}
                      />
                      <FieldError
                        id={`transfer-${field.id}`}
                        message={
                          transferForm.formState.errors.numbers?.[field.id]
                            ?.message
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              <label className="field-label" htmlFor="transfer-answer">
                {t("Explain your thinking")}
              </label>
              <textarea
                id="transfer-answer"
                rows={7}
                maxLength={4000}
                {...transferForm.register("answer")}
                {...transferForm.a11y("answer", "transfer-answer")}
                required
                placeholder={t("Here’s what I think happens, and why…")}
                disabled={unavailable}
              />
              <FieldError
                id="transfer-answer"
                message={transferForm.formState.errors.answer?.message}
              />
              {error && <ErrorNotice message={error} />}
              <button
                className="primary-button full-width"
                disabled={unavailable}
                type="submit"
              >
                {unavailable ? (
                  <Spinner label={t("Reflecting on your explanations")} />
                ) : (
                  <>
                    {t("See my learning report")} <ArrowRight size={18} />
                  </>
                )}
              </button>
              <button
                className="quiet-button skip-transfer"
                type="button"
                disabled={unavailable}
                onClick={() =>
                  void mutate("transfer", { answer: "", skip: true })
                }
              >
                {t("Skip this check")}
              </button>
              <p className="transfer-note">
                {t(
                  "Your teaching board and conversation are tucked away for this independent check.",
                )}
              </p>
            </form>
          </section>
        </main>
      ) : (
        <main tabIndex={-1} id="main" className="classroom">
          <section
            className="conversation-panel"
            aria-label={t("Conversation with Milo")}
            data-details-open={classroomDetailsOpen}
          >
            <div className="conversation-heading">
              <div
                className="classroom-mascot"
                aria-hidden={!classroomDetailsOpen}
                inert={!classroomDetailsOpen}
              >
                <Milo
                  size={48}
                  state={
                    unavailable
                      ? "thinking"
                      : listening
                        ? "listening"
                        : replyKey
                          ? "reply"
                          : "idle"
                  }
                  reactionKey={replyKey}
                  interactive
                />
              </div>
              <div className="classroom-heading-main">
                <div className="classroom-heading-top">
                  <h1>
                    <span className="classroom-desktop-title">
                      {t("Milo’s classroom")}
                    </span>
                    <button
                      type="button"
                      className="classroom-details-toggle"
                      aria-expanded={classroomDetailsOpen}
                      aria-controls="classroom-introduction classroom-objectives"
                      onClick={() => setClassroomDetailsOpen((open) => !open)}
                    >
                      <span>
                        {t("Milo’s classroom")}
                        <small aria-hidden="true">
                          {
                            session.progress.filter(
                              (p) => p.status === "supported",
                            ).length
                          }
                          /{session.progress.length} {t("objectives")}
                        </small>
                      </span>
                      <ChevronDown size={18} aria-hidden="true" />
                    </button>
                  </h1>
                  <button
                    className="icon-button mobile-board-button labeled-board-button"
                    aria-label={t("Open teaching board")}
                    onClick={() => {
                      setBoardOpen(true);
                      void api(`/api/sessions/${id}/events`, {
                        name: "board_opened",
                      }).catch(() => {});
                    }}
                  >
                    <Layers3 size={21} />
                    <span>{t("Teaching board")}</span>
                  </button>
                </div>
                <p
                  id="classroom-introduction"
                  aria-hidden={!classroomDetailsOpen}
                >
                  <span className="status-dot" />{" "}
                  {t("Curious student. You’re the teacher.")}
                </p>
              </div>
            </div>
            <div
              className="progress-strip"
              id="classroom-objectives"
              role="region"
              tabIndex={classroomDetailsOpen ? 0 : -1}
              aria-hidden={!classroomDetailsOpen}
              aria-label={t("Learning objective progress")}
            >
              {session.progress.map((p, i) => (
                <div
                  key={p.id}
                  className={`objective-progress ${p.status}`}
                  title={p.label}
                >
                  <span>
                    {p.status === "supported" ? <Check size={12} /> : i + 1}
                  </span>
                  <p>{p.label}</p>
                </div>
              ))}
            </div>
            <div
              ref={messagesRef}
              className="messages"
              aria-label={t("Teaching messages")}
              role="region"
              tabIndex={0}
            >
              <div className="conversation-start">
                <span>
                  {t("Every good explanation starts with a little curiosity.")}
                </span>
              </div>
              {session.nextCursor !== undefined && (
                <button
                  className="quiet-button load-earlier"
                  disabled={loadingEarlier}
                  onClick={async () => {
                    if (earlierRequest.current) return;
                    const currentGeneration = generation.current;
                    const controller = new AbortController();
                    earlierRequest.current = controller;
                    setLoadingEarlier(true);
                    try {
                      const result = await api<{
                        messages: Message[];
                        nextCursor?: number;
                      }>(
                        `/api/sessions/${id}/messages?before=${older[0]?.sequence ?? session.nextCursor}`,
                        undefined,
                        "GET",
                        { signal: controller.signal },
                      );
                      if (
                        controller.signal.aborted ||
                        generation.current !== currentGeneration
                      )
                        return;
                      setOlder((prev) => [...result.messages, ...prev]);
                      const previous = sessionRef.current;
                      if (previous) {
                        const next = {
                          ...previous,
                          nextCursor: result.nextCursor,
                        };
                        sessionRef.current = next;
                        setSession(next);
                      }
                    } catch (e) {
                      if (
                        !controller.signal.aborted &&
                        generation.current === currentGeneration
                      )
                        setError(e instanceof Error ? e : "Please try again.");
                    } finally {
                      if (earlierRequest.current === controller)
                        earlierRequest.current = null;
                      if (generation.current === currentGeneration)
                        setLoadingEarlier(false);
                    }
                  }}
                >
                  {loadingEarlier ? (
                    <Spinner label={t("Loading earlier messages…")} />
                  ) : (
                    t("Load earlier messages")
                  )}
                </button>
              )}
              {messages.map((message, index) => (
                <ConversationMessage
                  teachingLanguage={session.lesson.teachingLanguage}
                  key={message.id}
                  message={message}
                  previousMessage={messages[index - 1]}
                  user={user}
                />
              ))}
              {unavailable && (
                <div className="message student thinking-message">
                  <Milo size={34} thinking />
                  <div>
                    <span className="message-name">Milo</span>
                    <div
                      className="thinking-dots"
                      aria-label={t("Milo is thinking")}
                    >
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              )}
              {session.phase === "ready_for_check" && (
                <div className="ready-card">
                  <div>
                    <CheckCircleIcon />
                    <strong>{t("The key ideas are connecting.")}</strong>
                  </div>
                  <p>
                    {t(
                      "Try a new example independently, or keep exploring together.",
                    )}
                  </p>
                  <div>
                    <button
                      className="primary-button compact"
                      disabled={unavailable}
                      onClick={() => action("start_transfer")}
                    >
                      {t("Take the independent check")} <ArrowRight size={15} />
                    </button>
                    <button
                      className="quiet-button"
                      disabled={unavailable}
                      onClick={() => action("continue")}
                    >
                      {t("Keep teaching")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="sr-status" role="status" aria-live="polite">
              {unavailable
                ? t("Milo is thinking.")
                : session.messages.at(-1)?.role === "student"
                  ? session.messages.at(-1)?.text
                  : ""}
            </div>
            <div className="composer-area">
              {session.messages.some(
                (m) => m.role === "student" && m.move === "request_demo",
              ) &&
                boardWorkspace.workspace &&
                !boardWorkspace.workspace.invited && (
                  <div className="board-invitation">
                    <span>
                      {t(
                        "Make your explanation visible with an activity or sketch.",
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        boardWorkspace.update({
                          ...boardWorkspace.workspace!,
                          invited: true,
                        });
                        setBoardOpen(true);
                      }}
                    >
                      {t("Open teaching board")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("Dismiss board suggestion")}
                      onClick={() =>
                        boardWorkspace.update({
                          ...boardWorkspace.workspace!,
                          invited: true,
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                )}
              {error && (
                <ErrorNotice
                  message={error}
                  onRetry={
                    pendingSend.current
                      ? () => void deliver(pendingSend.current!)
                      : undefined
                  }
                />
              )}
              <form
                noValidate
                className="composer"
                onSubmit={explanationForm.handleSubmit(send)}
              >
                {board && (
                  <div className="board-attachment">
                    <div className="attachment-chip">
                      <Layers3 size={14} /> {t("Board snapshot attached")}
                      <button
                        type="button"
                        aria-label={t("Remove board snapshot")}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Remove board snapshot?",
                              description:
                                "This snapshot will be removed from your unsent explanation.",
                              confirmLabel: "Remove snapshot",
                              destructive: true,
                            })
                          )
                            setBoard(undefined);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <BoardPreview snapshot={board} definition={session.board} />
                  </div>
                )}
                <label className="visually-hidden" htmlFor="explanation">
                  {t("Your explanation to Milo")}
                </label>
                <textarea
                  {...explanationForm.register("text")}
                  {...explanationForm.a11y("text", "explanation")}
                  ref={(node) => {
                    composer.current = node;
                    explanationForm.register("text").ref(node);
                  }}
                  id="explanation"
                  rows={2}
                  maxLength={2000}
                  disabled={unavailable}
                  onChange={(e) => {
                    setText(e.target.value);
                    setListening(e.target.value.trim().length > 0);
                  }}
                  onFocus={(e) =>
                    setListening(e.currentTarget.value.trim().length > 0)
                  }
                  onBlur={(event) => {
                    setListening(false);
                    void explanationForm.register("text").onBlur(event);
                  }}
                  placeholder={t("Explain it to Milo in your own words…")}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      (e.metaKey || e.ctrlKey) &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <FieldError
                  id="explanation"
                  message={explanationForm.formState.errors.text?.message}
                />
                <div className="composer-actions">
                  <button
                    type="button"
                    className="hint-button"
                    disabled={unavailable || session.hintUsed}
                    onClick={() => action("hint")}
                  >
                    <Lightbulb size={16} />
                    {session.hintUsed ? t("Hint used") : t("I’m stuck")}
                  </button>
                  <span className="send-shortcut">
                    {t("⌘ / Ctrl + Enter to send")}
                  </span>
                  <button
                    className="send-button"
                    type="submit"
                    disabled={unavailable || !text.trim()}
                    aria-label={t("Send explanation")}
                  >
                    <ArrowUp size={19} />
                  </button>
                </div>
              </form>
              <p className="composer-footnote">
                {t(
                  "Your words matter. Examples and “because” are always welcome.",
                )}
              </p>
            </div>
          </section>
          <aside className="board-sidebar">
            {session.board && boardWorkspace.workspace && (
              <TeachingBoard
                teachingLanguage={session.lesson.teachingLanguage}
                board={session.board}
                onAttach={attach}
                disabled={unavailable}
                workspace={boardWorkspace.workspace}
                onChange={boardWorkspace.update}
                sessionId={id}
                storageUnavailable={boardWorkspace.storageUnavailable}
                onExpand={() => setBoardOpen(true)}
              />
            )}
            <div className="teacher-note">
              <Lightbulb size={18} />
              <p>
                <strong>{t("A good teacher makes connections.")}</strong>{" "}
                {t(
                  "Try explaining what changes, why it changes, and what stays the same.",
                )}
              </p>
            </div>
          </aside>
          <Modal
            open={boardOpen}
            onClose={() => setBoardOpen(false)}
            title={t("Your teaching board")}
            className="board-expanded-modal"
          >
            {boardOpen && session.board && boardWorkspace.workspace && (
              <TeachingBoard
                teachingLanguage={session.lesson.teachingLanguage}
                board={session.board}
                onAttach={attach}
                disabled={unavailable}
                workspace={boardWorkspace.workspace}
                onChange={boardWorkspace.update}
                sessionId={id}
                storageUnavailable={boardWorkspace.storageUnavailable}
              />
            )}
          </Modal>
          <UnderstoodCelebration
            open={showCelebration}
            busy={unavailable}
            error={error}
            onDismiss={dismissCelebration}
            onStartTransfer={() => void action("start_transfer")}
            onCloseSession={() => {
              dismissCelebration();
              setEndOpen(true);
            }}
          />
          <Modal
            open={endOpen}
            onClose={() => setEndOpen(false)}
            title={t("Ready to wrap up?")}
          >
            <p>
              {t(
                "You can try the independent check now, or finish with feedback on the explanations you’ve given. Skipped criteria will remain unscored.",
              )}
            </p>
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => action("start_transfer")}
              >
                {t("Try the independent check")}
              </button>
              <button
                className="secondary-button"
                onClick={() => action("end")}
              >
                {t("End and see my feedback")}
              </button>
              <button
                className="quiet-button"
                onClick={() => setEndOpen(false)}
              >
                {t("Keep teaching")}
              </button>
            </div>
          </Modal>
        </main>
      )}
    </div>
  );
}
const CONFETTI_COLORS = ["#655dcc", "#426da9", "#f4d35e", "#f7f4ff", "#8b87e8"];
function UnderstoodCelebration({
  open,
  busy,
  error,
  onDismiss,
  onStartTransfer,
  onCloseSession,
}: {
  open: boolean;
  busy: boolean;
  error: string | Error;
  onDismiss: () => void;
  onStartTransfer: () => void;
  onCloseSession: () => void;
}) {
  const { t } = useI18n();

  const ref = useRef<HTMLDialogElement>(null);
  const programmaticClose = useRef(false);
  const [pending, setPending] = useState<"transfer" | "end" | null>(null);
  const pieces = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const n = (i * 47 + 13) % 97;
        return {
          id: i,
          left: `${(n * 11) % 100}%`,
          delay: `${(i % 14) * 0.08}s`,
          duration: `${2.6 + (i % 6) * 0.28}s`,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          width: 10 + (i % 4) * 4,
          height: i % 3 === 0 ? 10 + (i % 4) * 4 : 8 + (i % 3) * 3,
          radius: i % 3 === 0 ? "50%" : "2px",
          drift: `${((i % 7) - 3) * 18}px`,
          spin: `${160 + (i % 5) * 70}deg`,
        };
      }),
    [],
  );
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) {
      programmaticClose.current = true;
      dialog.close();
      programmaticClose.current = false;
    }
  }, [open]);
  useEffect(() => {
    if (!busy) setPending(null);
  }, [busy]);
  function requestDismiss() {
    if (!programmaticClose.current) onDismiss();
  }
  return (
    <dialog
      ref={ref}
      className="understood-overlay"
      aria-labelledby="understood-title"
      onCancel={(event) => {
        event.preventDefault();
        requestDismiss();
      }}
      onClose={requestDismiss}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="confetti" aria-hidden="true">
        {pieces.map((piece) => (
          <i
            key={piece.id}
            style={{
              left: piece.left,
              animationDelay: piece.delay,
              animationDuration: piece.duration,
              background: piece.color,
              width: piece.width,
              height: piece.height,
              borderRadius: piece.radius,
              ["--drift" as string]: piece.drift,
              ["--spin" as string]: piece.spin,
            }}
          />
        ))}
      </div>
      <div
        className="understood-panel"
        onClick={(event) => event.stopPropagation()}
      >
        {open && <Milo size={88} state="celebration" />}
        <h2 id="understood-title">{t("Milo understood.")}</h2>
        <p>
          {t(
            "Your explanation landed. Take the independent check, close this session for feedback, or stay and keep talking with Milo.",
          )}
        </p>
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <button
            type="button"
            className="primary-button full-width"
            disabled={busy}
            onClick={() => {
              setPending("transfer");
              onStartTransfer();
            }}
          >
            {pending === "transfer" ? (
              <Spinner label={t("Starting the independent check")} />
            ) : (
              <>
                {t("Take the independent check")} <ArrowRight size={15} />
              </>
            )}
          </button>
          <button
            type="button"
            className="secondary-button full-width"
            disabled={busy}
            onClick={() => {
              setPending("end");
              onCloseSession();
            }}
          >
            {pending === "end" ? (
              <Spinner label={t("Closing session")} />
            ) : (
              t("Close session")
            )}
          </button>
          <button
            type="button"
            className="quiet-button full-width"
            disabled={busy}
            onClick={onDismiss}
          >
            {t("Keep chatting")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
function CheckCircleIcon() {
  return (
    <span className="ready-check">
      <Check size={14} />
    </span>
  );
}
