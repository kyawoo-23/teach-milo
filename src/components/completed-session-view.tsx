"use client";

import { useI18n } from "@/components/locale-context";
import { useEffect, useId, useRef, useState } from "react";
import type { Message, SessionPublic, UserPublic } from "@/lib/contracts";
import { ConversationMessage } from "./conversation-message";
import { Milo } from "./milo";
import { ReportView } from "./report-view";
import { api, ErrorNotice, Spinner } from "./ui";

export function CompletedSessionView({
  session,
  user,
}: {
  session: SessionPublic;
  user: UserPublic | null;
}) {
  const { t } = useI18n();

  const prefix = useId();
  const [view, setView] = useState<"report" | "chat">("report");
  const [older, setOlder] = useState<Message[]>([]);
  const [cursor, setCursor] = useState(session.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | Error>("");
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  const messages = Array.from(
    new Map([...older, ...session.messages].map((m) => [m.id, m])).values(),
  ).sort((a, b) => a.sequence - b.sequence);

  async function loadEarlier() {
    if (pending.current || cursor === undefined) return;
    pending.current = true;
    const active = new AbortController();
    controller.current = active;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ messages: Message[]; nextCursor?: number }>(
        `/api/sessions/${session.id}/messages?before=${cursor}`,
        undefined,
        "GET",
        { signal: active.signal },
      );
      if (!alive.current || active.signal.aborted) return;
      setOlder((previous) => [...result.messages, ...previous]);
      setCursor(result.nextCursor);
    } catch (e) {
      if (alive.current && !active.signal.aborted)
        setError(e instanceof Error ? e : "Couldn't load earlier messages.");
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }

  return (
    <main
      id="main"
      tabIndex={-1}
      className="completed-session"
      data-view={view}
    >
      <div className="completed-header">
        <div className="report-milo">
          <Milo size={64} state="reply" reactionKey={session.id} interactive />
          <span>{t("Thanks for teaching me.")}</span>
        </div>
        <div
          className="completed-tabs"
          role="tablist"
          aria-label={t("Completed session")}
        >
          {(["report", "chat"] as const).map((tab, index) => (
            <button
              key={tab}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${prefix}-${tab}-tab`}
              aria-controls={`${prefix}-${tab}-panel`}
              aria-selected={view === tab}
              tabIndex={view === tab ? 0 : -1}
              onClick={() => setView(tab)}
              onKeyDown={(event) => {
                if (event.altKey || event.ctrlKey || event.metaKey) return;
                const target =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 1
                      : event.key === "ArrowRight" || event.key === "ArrowLeft"
                        ? 1 - index
                        : undefined;
                if (target === undefined) return;
                event.preventDefault();
                setView(target === 0 ? "report" : "chat");
                tabs.current[target]?.focus();
              }}
            >
              {tab === "report" ? t("Report") : t("Chat")}
            </button>
          ))}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-report-panel`}
        aria-labelledby={`${prefix}-report-tab`}
        tabIndex={0}
        hidden={view !== "report"}
      >
        <ReportView session={session} active={view === "report"} />
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-chat-panel`}
        aria-labelledby={`${prefix}-chat-tab`}
        tabIndex={0}
        hidden={view !== "chat"}
      >
        <section
          className="completed-chat"
          aria-label={t("Saved conversation")}
        >
          <div
            className="completed-messages"
            role="region"
            aria-label={t("Saved messages")}
            tabIndex={0}
            aria-busy={loading}
          >
            <div className="completed-chat-heading">
              <h1>{t("Your conversation with Milo")}</h1>
              <p>
                {t(
                  "Session ended · You can read your saved conversation here.",
                )}
              </p>
            </div>
            {error && (
              <ErrorNotice
                message={error}
                onRetry={loading ? undefined : loadEarlier}
              />
            )}
            {cursor !== undefined && (
              <button
                className="quiet-button load-earlier"
                type="button"
                disabled={loading}
                onClick={loadEarlier}
              >
                {loading ? (
                  <Spinner label={t("Loading earlier messages…")} />
                ) : (
                  t("Load earlier messages")
                )}
              </button>
            )}
            {messages.length ? (
              <>
                {messages.map((message) => (
                  <ConversationMessage
                    teachingLanguage={session.lesson.teachingLanguage}
                    key={message.id}
                    message={message}
                    user={user}
                  />
                ))}
                <div className="conversation-end">
                  <span>
                    {t("You've reached the end of this conversation.")}
                  </span>
                </div>
              </>
            ) : (
              <p className="muted">{t("No saved messages in this session.")}</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
