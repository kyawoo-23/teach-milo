"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { BoardSubmission, Message, SessionPublic } from "@/lib/contracts";
import { useAuth } from "./auth-context";
import { Brand } from "./brand";
import { Milo } from "./milo";
import { TeachingBoard } from "./teaching-board";
import { ReportView } from "./report-view";
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
  const router = useRouter();
  const pathname = usePathname();
  const { user, openAuthModal, openSessionModal } = useAuth();
  const getOperation = useOperationId(id);
  const busyRef = useRef(false);
  const [session, setSession] = useState<SessionPublic | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [outgoing, setOutgoing] = useState<Message | null>(null);
  const pendingSend = useRef<{ text: string; board?: BoardSubmission } | null>(
    null,
  );
  const [board, setBoard] = useState<BoardSubmission | undefined>();
  const [boardOpen, setBoardOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);
  const [older, setOlder] = useState<Message[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [small, setSmall] = useState("");
  const [large, setLarge] = useState("");
  const [answer, setAnswer] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => {
    try {
      const s = await api<SessionPublic>(`/api/sessions/${id}`);
      setSession(s);
      setError("");
      if (
        s.messages.some(
          (m) => m.id === draftStorage.getItem(`pending-turn:${id}`),
        )
      ) {
        setText("");
        draftStorage.removeItem(`draft:${id}`);
        draftStorage.removeItem(`pending-turn:${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open this session.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
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
        setAnswer(draft.answer || "");
        setSmall(draft.small || "");
        setLarge(draft.large || "");
      }
    } catch {
      /* Ignore a damaged local draft. */
    }
    setDraftsLoaded(true);
  }, [id]);
  useEffect(() => {
    if (draftsLoaded && (answer || small || large))
      draftStorage.setItem(
        `transfer-draft:${id}`,
        JSON.stringify({ answer, small, large }),
      );
  }, [id, answer, small, large, draftsLoaded]);
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
    endRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "end",
    });
  }, [messageCount, outgoingId, busy]);
  useEffect(() => {
    if (!session?.pending) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [session?.pending, load]);
  async function mutate(endpoint: string, payload: object) {
    if (busyRef.current || !session) return false;
    busyRef.current = true;
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
      if (endpoint === "turns") draftStorage.removeItem(`pending-turn:${id}`);
      setSession(result);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_SESSION") await load();
      setError(e instanceof Error ? e.message : "Please try again.");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function deliver(payload: { text: string; board?: BoardSubmission }) {
    const ok = await mutate("turns", {
      text: payload.text,
      ...(payload.board ? { board: payload.board } : {}),
    });
    if (ok) {
      setOutgoing(null);
      pendingSend.current = null;
      composer.current?.focus();
    }
    return ok;
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
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
    });
    setText("");
    setBoard(undefined);
    await deliver(payload);
  }
  async function action(
    action: "hint" | "continue" | "start_transfer" | "end",
  ) {
    setEndOpen(false);
    return mutate("actions", { action });
  }
  function attach(snapshot: BoardSubmission) {
    setBoard(snapshot);
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
        <Brand />
        <div className="session-topic">
          {session?.lesson.title || "Your classroom"}
          <span>
            {session?.phase === "transfer"
              ? "Independent check"
              : session?.phase === "report"
                ? "Learning report"
                : "Learning by teaching"}
          </span>
        </div>
        <div className="session-header-actions">
          {isTeaching && (
            <button
              className="quiet-button"
              disabled={unavailable}
              onClick={() => setEndOpen(true)}
            >
              <Flag size={15} /> End session
            </button>
          )}
          <button
            type="button"
            className="quiet-button"
            onClick={openSessionModal}
            title="My Sessions"
          >
            <History size={15} />
            <span className="button-text">My Sessions</span>
          </button>
          {user ? (
            <div className="user-profile-badge-small" title={user.email}>
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="user-avatar-image-small"
                />
              ) : (
                <span className="user-avatar-fallback-small">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="user-name-small">{user.name}</span>
            </div>
          ) : (
            <button
              type="button"
              className="quiet-button signin-button-small"
              onClick={() => openAuthModal("login")}
            >
              <LogIn size={14} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>
      {!session ? (
        <main id="main" className="loading-page">
          {error ? (
            <>
              <ErrorNotice message={error} onRetry={load} />
              <Link className="secondary-button" href="/">
                Start a new lesson
              </Link>
            </>
          ) : (
            <>
              <Milo size={96} thinking />
              <Spinner label="Opening your classroom" />
            </>
          )}
        </main>
      ) : session.phase === "report" && session.report ? (
        <ReportView session={session} />
      ) : session.phase === "transfer" ? (
        <main id="main" className="transfer-main">
          <section className="transfer-card">
            <span className="transfer-icon">
              <ShieldCheck size={30} />
            </span>
            <span className="small-label">
              A fresh example, in your own words
            </span>
            <h1>
              One last challenge.
              <br />
              On your own.
            </h1>
            <p className="section-description">
              Put the idea to work in a new situation. Take your time—your
              reasoning matters more than a perfect answer.
            </p>
            <div className="transfer-question">{session.transferQuestion}</div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await mutate("transfer", {
                  answer,
                  skip: false,
                  ...(session.numericalCheck
                    ? {
                        parameters: {
                          small: Number(small),
                          large: Number(large),
                        },
                      }
                    : {}),
                });
              }}
            >
              {session.numericalCheck && (
                <div className="number-fields">
                  <label>
                    Parameters at 20 × 20
                    <input
                      className="text-input"
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={small}
                      onChange={(e) => setSmall(e.target.value)}
                    />
                  </label>
                  <label>
                    Parameters at 40 × 40
                    <input
                      className="text-input"
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={large}
                      onChange={(e) => setLarge(e.target.value)}
                    />
                  </label>
                </div>
              )}
              <label className="field-label" htmlFor="transfer-answer">
                Explain your thinking
              </label>
              <textarea
                id="transfer-answer"
                rows={7}
                maxLength={4000}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                required
                placeholder="Here’s what I think happens, and why…"
                disabled={unavailable}
              />
              {error && <ErrorNotice message={error} />}
              <button
                className="primary-button full-width"
                disabled={unavailable}
                type="submit"
              >
                {unavailable ? (
                  <Spinner label="Reflecting on your explanations" />
                ) : (
                  <>
                    See my learning report <ArrowRight size={18} />
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
                Skip this check
              </button>
              <p className="transfer-note">
                Your teaching board and conversation are tucked away for this
                independent check.
              </p>
            </form>
          </section>
        </main>
      ) : (
        <main id="main" className="classroom">
          <section
            className="conversation-panel"
            aria-label="Conversation with Milo"
          >
            <div className="conversation-heading">
              <Milo size={48} />
              <div>
                <h1>Milo’s classroom</h1>
                <p>
                  <span className="status-dot" /> Curious student. You’re the
                  teacher.
                </p>
              </div>
              <button
                className="icon-button mobile-board-button"
                aria-label="Open teaching board"
                onClick={() => {
                  setBoardOpen(true);
                  void api(`/api/sessions/${id}/events`, {
                    name: "board_opened",
                  }).catch(() => {});
                }}
              >
                <Layers3 size={21} />
              </button>
            </div>
            <div
              className="progress-strip"
              aria-label="Learning objective progress"
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
              className="messages"
              aria-label="Teaching messages"
              role="region"
              tabIndex={0}
            >
              <div className="conversation-start">
                <span>
                  Every good explanation starts with a little curiosity.
                </span>
              </div>
              {session.nextCursor !== undefined && (
                <button
                  className="quiet-button load-earlier"
                  onClick={async () => {
                    try {
                      const result = await api<{
                        messages: Message[];
                        nextCursor?: number;
                      }>(
                        `/api/sessions/${id}/messages?before=${older[0]?.sequence ?? session.nextCursor}`,
                      );
                      setOlder((prev) => [...result.messages, ...prev]);
                      if (result.nextCursor === undefined)
                        setSession((s) => s && { ...s, nextCursor: undefined });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Load earlier messages
                </button>
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  id={`message-${message.id}`}
                  className={`message ${message.role}`}
                >
                  <div className="message-avatar">
                    {message.role === "student" ? (
                      <Milo size={34} />
                    ) : (
                      <span>You</span>
                    )}
                  </div>
                  <div className="message-body">
                    <span className="message-name">
                      {message.role === "student" ? "Milo" : "You"}
                      {message.kind === "hint" && (
                        <small> A little nudge</small>
                      )}
                    </span>
                    <div className="message-bubble">{message.text}</div>
                    {message.board && (
                      <div className="shared-board">
                        <Layers3 size={15} />
                        <span>
                          Demonstration shared
                          {message.board.kind === "cnn"
                            ? ` · ${message.board.inputs.inputSize} × ${message.board.inputs.inputSize}`
                            : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {unavailable && (
                <div className="message student thinking-message">
                  <Milo size={34} thinking />
                  <div>
                    <span className="message-name">Milo</span>
                    <div
                      className="thinking-dots"
                      aria-label="Milo is thinking"
                    >
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
            <div className="sr-status" role="status" aria-live="polite">
              {unavailable
                ? "Milo is thinking."
                : session.messages.at(-1)?.role === "student"
                  ? session.messages.at(-1)?.text
                  : ""}
            </div>
            <div className="composer-area">
              {session.phase === "ready_for_check" && (
                <div className="ready-card">
                  <div>
                    <CheckCircleIcon />
                    <strong>The key ideas are connecting.</strong>
                  </div>
                  <p>
                    Try a new example independently, or keep exploring together.
                  </p>
                  <div>
                    <button
                      className="primary-button compact"
                      disabled={unavailable}
                      onClick={() => action("start_transfer")}
                    >
                      Take the independent check <ArrowRight size={15} />
                    </button>
                    <button
                      className="quiet-button"
                      disabled={unavailable}
                      onClick={() => action("continue")}
                    >
                      Keep teaching
                    </button>
                  </div>
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
              <form className="composer" onSubmit={send}>
                {board && (
                  <div className="attachment-chip">
                    <Layers3 size={14} /> Board snapshot attached
                    <button
                      type="button"
                      aria-label="Remove board snapshot"
                      onClick={() => setBoard(undefined)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <label className="visually-hidden" htmlFor="explanation">
                  Your explanation to Milo
                </label>
                <textarea
                  ref={composer}
                  id="explanation"
                  value={text}
                  rows={3}
                  maxLength={2000}
                  disabled={unavailable}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Explain it to Milo in your own words…"
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
                <div className="composer-actions">
                  <button
                    type="button"
                    className="hint-button"
                    disabled={unavailable || session.hintUsed}
                    onClick={() => action("hint")}
                  >
                    <Lightbulb size={16} />
                    {session.hintUsed ? "Hint used" : "I’m stuck"}
                  </button>
                  <span className="send-shortcut">
                    ⌘ / Ctrl + Enter to send
                  </span>
                  <button
                    className="send-button"
                    type="submit"
                    disabled={unavailable}
                    aria-label="Send explanation"
                  >
                    <ArrowUp size={19} />
                  </button>
                </div>
              </form>
              <p className="composer-footnote">
                Your words matter. Examples and “because” are always welcome.
              </p>
            </div>
          </section>
          <aside className="board-sidebar">
            {session.board && (
              <TeachingBoard
                board={session.board}
                onAttach={attach}
                disabled={unavailable}
              />
            )}
            <div className="teacher-note">
              <Lightbulb size={18} />
              <p>
                <strong>A good teacher makes connections.</strong> Try
                explaining what changes, why it changes, and what stays the
                same.
              </p>
            </div>
          </aside>
          <Modal
            open={boardOpen}
            onClose={() => setBoardOpen(false)}
            title="Your teaching board"
          >
            {boardOpen && session.board && (
              <TeachingBoard
                board={session.board}
                onAttach={attach}
                disabled={unavailable}
              />
            )}
          </Modal>
          <UnderstoodCelebration
            open={showCelebration}
            busy={unavailable}
            error={error}
            onDismiss={dismissCelebration}
            onCloseSession={() => void action("end")}
          />
          <Modal
            open={endOpen}
            onClose={() => setEndOpen(false)}
            title="Ready to wrap up?"
          >
            <p>
              You can try the independent check now, or finish with feedback on
              the explanations you’ve given. Skipped criteria will remain
              unscored.
            </p>
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => action("start_transfer")}
              >
                Try the independent check
              </button>
              <button
                className="secondary-button"
                onClick={() => action("end")}
              >
                End and see my feedback
              </button>
              <button
                className="quiet-button"
                onClick={() => setEndOpen(false)}
              >
                Keep teaching
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
  onCloseSession,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  onDismiss: () => void;
  onCloseSession: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const programmaticClose = useRef(false);
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
        <Milo size={88} />
        <h2 id="understood-title">Milo understood.</h2>
        <p>
          Your explanation landed. Close this session for feedback, or stay and
          keep talking with Milo.
        </p>
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <button
            type="button"
            className="primary-button full-width"
            disabled={busy}
            onClick={onCloseSession}
          >
            {busy ? <Spinner label="Closing session" /> : "Close session"}
          </button>
          <button
            type="button"
            className="quiet-button full-width"
            disabled={busy}
            onClick={onDismiss}
          >
            Keep chatting
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
