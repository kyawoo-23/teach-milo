"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  GraduationCap,
  Sparkles,
  Trash2,
} from "lucide-react";
import { SessionSummary } from "@/lib/contracts";
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
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadSessions() {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ sessions: SessionSummary[] }>(
        "/api/sessions",
        undefined,
        "GET",
      );
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sessionModalOpen) {
      loadSessions();
    }
  }, [sessionModalOpen]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this session?"))
      return;
    setDeletingId(id);
    try {
      await api(`/api/sessions/${id}`, {}, "DELETE");
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete session.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function handleResume(id: string) {
    closeSessionModal();
    router.push(`/session/${id}`);
  }

  return (
    <Modal
      open={sessionModalOpen}
      onClose={closeSessionModal}
      title={user ? "My Learning Sessions" : "Current Sessions"}
    >
      <div className="session-history-content">
        {!user && (
          <div className="guest-history-banner">
            <div>
              <strong>You are in guest mode.</strong>
              <p>
                Sign in to save and sync your learning sessions across all your
                devices.
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
        )}

        {error && <ErrorNotice message={error} onRetry={loadSessions} />}

        {loading ? (
          <div className="history-loading">
            <Spinner label="Loading your sessions…" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="history-empty">
            <div className="history-empty-icon">
              <BookOpen size={36} />
            </div>
            <h3>No sessions found</h3>
            <p>
              Bring a document or paste your notes to start teaching Milo and
              test your understanding.
            </p>
            <button
              type="button"
              className="action-button primary-action"
              onClick={() => {
                closeSessionModal();
                router.push("/");
              }}
            >
              Start a New Lesson
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

              return (
                <div
                  key={item.id}
                  className="session-card"
                  onClick={() => handleResume(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleResume(item.id);
                    }
                  }}
                >
                  <div className="session-card-header">
                    <div className="session-card-title-wrap">
                      <span className={`phase-badge ${phaseInfo.badgeClass}`}>
                        {phaseInfo.label}
                      </span>
                      <span className="level-badge">{item.level}</span>
                    </div>
                    <button
                      type="button"
                      className="icon-button delete-session-button"
                      aria-label="Delete session"
                      onClick={(e) => handleDelete(item.id, e)}
                      disabled={deletingId === item.id}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <h3 className="session-card-title">{item.title}</h3>
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
                      Resume <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
