"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Trash2,
} from "lucide-react";
import { SessionHistoryPage, SessionSummary } from "@/lib/contracts";
import { useAuth } from "./auth-context";
import { api, ErrorNotice, Modal, Spinner } from "./ui";

const PHASE_LABELS: Record<string, { label: string; badgeClass: string }> = {
  preparing: { label: "Preparing", badgeClass: "phase-badge-neutral" },
  baseline: { label: "Baseline Check", badgeClass: "phase-badge-info" },
  teaching: { label: "Teaching Milo", badgeClass: "phase-badge-active" },
  ready_for_check: {
    label: "Ready for Check",
    badgeClass: "phase-badge-success",
  },
  transfer: { label: "Independent Check", badgeClass: "phase-badge-warning" },
  report: { label: "Report Ready", badgeClass: "phase-badge-complete" },
};

export function SessionHistoryModal() {
  const { sessionModalOpen, closeSessionModal, user, openAuthModal } =
    useAuth();
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const requests = useRef({ generation: 0, pending: false });
  const deletedIds = useRef(new Set<string>());
  const retryCursor = useRef<string | undefined>(undefined);

  const loadSessions = useCallback(async (cursor?: string) => {
    if (requests.current.pending) return;
    const generation = requests.current.generation;
    requests.current.pending = true;
    retryCursor.current = cursor;
    setLoading(!cursor);
    setLoadingMore(!!cursor);
    setError("");
    try {
      const res = await api<SessionHistoryPage>(
        cursor
          ? `/api/sessions?cursor=${encodeURIComponent(cursor)}`
          : "/api/sessions",
        undefined,
        "GET",
      );
      if (requests.current.generation !== generation) return;
      setSessions((previous) =>
        cursor
          ? [
              ...new Map(
                [...previous, ...res.sessions]
                  .filter((session) => !deletedIds.current.has(session.id))
                  .map((session) => [session.id, session]),
              ).values(),
            ]
          : res.sessions,
      );
      setNextCursor(res.nextCursor);
    } catch (err) {
      if (requests.current.generation !== generation) return;
      setError(err instanceof Error ? err.message : "Failed to load sessions.");
    } finally {
      if (requests.current.generation === generation) {
        requests.current.pending = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const userId = user?.id;
  useEffect(() => {
    requests.current = {
      generation: requests.current.generation + 1,
      pending: false,
    };
    setSessions([]);
    setNextCursor(undefined);
    setError("");
    setLoading(false);
    setLoadingMore(false);
    setDeletingId(null);
    retryCursor.current = undefined;
    deletedIds.current.clear();
    if (sessionModalOpen && userId) void loadSessions();
    return () => {
      requests.current = {
        generation: requests.current.generation + 1,
        pending: false,
      };
    };
  }, [sessionModalOpen, userId, loadSessions]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this session?"))
      return;
    const generation = requests.current.generation;
    setDeletingId(id);
    try {
      await api(`/api/sessions/${id}`, {}, "DELETE");
      if (requests.current.generation !== generation) return;
      deletedIds.current.add(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      if (requests.current.generation !== generation) return;
      setError(
        err instanceof Error ? err.message : "Failed to delete session.",
      );
    } finally {
      if (requests.current.generation === generation) setDeletingId(null);
    }
  }

  return (
    <Modal
      open={sessionModalOpen}
      onClose={closeSessionModal}
      title="My Learning Sessions"
    >
      <div className="session-history-content">
        {!user ? (
          <div className="signin-history-banner">
            <div>
              <strong>Sign in to see your sessions.</strong>
              <p>
                Your learning sessions are saved to your account and sync across
                all your devices.
              </p>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                closeSessionModal();
                openAuthModal("signup");
              }}
            >
              Sign In / Sign Up
            </button>
          </div>
        ) : (
          <>
            {error && (
              <ErrorNotice
                message={error}
                onRetry={() => loadSessions(retryCursor.current)}
              />
            )}

            {loading ? (
              <div className="history-loading">
                <Spinner label="Loading your sessions…" />
              </div>
            ) : sessions.length === 0 && !nextCursor && !error ? (
              <div className="history-empty">
                <div className="history-empty-icon">
                  <BookOpen size={36} />
                </div>
                <h3>No sessions found</h3>
                <p>
                  Bring a document or paste your notes to start teaching Milo
                  and test your understanding.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    closeSessionModal();
                    router.push("/");
                  }}
                >
                  Start a New Lesson <ArrowRight size={17} />
                </button>
              </div>
            ) : (
              <div className="sessions-list">
                {sessions.map((item) => {
                  const phaseInfo = PHASE_LABELS[item.phase] || {
                    label: item.phase,
                    badgeClass: "phase-badge-neutral",
                  };
                  const supportedCount = item.progress.filter(
                    (p) => p.status === "supported",
                  ).length;
                  const dateStr = new Date(
                    item.updatedAt || item.createdAt,
                  ).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  const completed = item.phase === "report";
                  return (
                    <article key={item.id} className="session-card">
                      <div className="session-card-header">
                        <div className="session-card-title-wrap">
                          <span
                            className={`phase-badge ${phaseInfo.badgeClass}`}
                          >
                            {phaseInfo.label}
                          </span>
                          <span className="level-badge">{item.level}</span>
                        </div>
                        <button
                          type="button"
                          className="icon-button delete-session-button"
                          aria-label={`Delete session: ${item.title}`}
                          onClick={(e) => handleDelete(item.id, e)}
                          disabled={deletingId === item.id}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <h3 className="session-card-title">
                        <Link
                          className="session-card-link"
                          href={`/session/${item.id}${completed ? "/report" : ""}`}
                          onClick={closeSessionModal}
                        >
                          {item.title}
                        </Link>
                      </h3>
                      {item.scope && (
                        <p className="session-card-scope">{item.scope}</p>
                      )}

                      <div className="session-card-footer">
                        <div className="session-meta">
                          <span className="session-date">
                            <Clock size={13} />
                            {dateStr}
                          </span>
                          {item.progress.length > 0 && (
                            <span className="session-progress-pill">
                              <CheckCircle2 size={13} />
                              {supportedCount}/{item.progress.length} objectives
                            </span>
                          )}
                        </div>
                        <span className="resume-indicator">
                          {completed ? "View report" : "Resume"}{" "}
                          <ArrowRight size={14} />
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {!loading && (sessions.length > 0 || nextCursor) && (
              <div className="history-pagination">
                <p role="status">{sessions.length} sessions shown</p>
                {nextCursor && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={loadingMore}
                    onClick={() => loadSessions(nextCursor)}
                  >
                    {loadingMore ? (
                      <Spinner label="Loading more sessions…" />
                    ) : (
                      "Load more"
                    )}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
