"use client";
import { FormulaText } from "./formula-text";

import { formatDate, type Locale } from "@/lib/i18n/locales";
import { useI18n } from "@/components/locale-context";
import { useConfirmation } from "./confirmation";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileCheck2,
  Flag,
  HelpCircle,
  Hourglass,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { SessionHistoryPage, SessionSummary } from "@/lib/contracts";
import { LevelIcon } from "./level-icon";
import { useAuth } from "./auth-context";
import { api, ErrorNotice, Modal, Spinner } from "./ui";
import { clearBoardDrafts } from "@/lib/board-drafts";

const PHASE_LABELS: Record<
  string,
  { label: string; badgeClass: string; icon: LucideIcon }
> = {
  preparing: {
    label: "Preparing",
    badgeClass: "phase-badge-neutral",
    icon: Sparkles,
  },
  baseline: {
    label: "Baseline Check",
    badgeClass: "phase-badge-info",
    icon: ClipboardCheck,
  },
  teaching: {
    label: "Teaching Milo",
    badgeClass: "phase-badge-active",
    icon: MessageCircle,
  },
  ready_for_check: {
    label: "Ready for Check",
    badgeClass: "phase-badge-success",
    icon: ShieldCheck,
  },
  transfer: {
    label: "Independent Check",
    badgeClass: "phase-badge-warning",
    icon: Flag,
  },
  report: {
    label: "Report Ready",
    badgeClass: "phase-badge-complete",
    icon: FileCheck2,
  },
};
const DAY_MS = 86_400_000;
// Sessions under this much remaining time get the warning style.
const EXPIRY_SOON_MS = 2 * DAY_MS;
// Longer lists are split into one section per last-updated calendar day.
const GROUP_THRESHOLD = 5; // TODO: restore to 10 after testing.

const startOfDay = (time: number) => {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

function dayLabel(time: number, now: number, locale: Locale) {
  // Round, not floor: a DST shift makes a calendar day 23 or 25 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
  if (days <= 1) {
    const label = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
    }).format(-Math.max(days, 0), "day");
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  }
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return formatDate(locale, new Date(time).toISOString(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Groups keep the API's newest-first order; a day appears once even if pages overlap.
function groupByDay(sessions: SessionSummary[], now: number, locale: Locale) {
  const groups = new Map<
    string,
    { key: string; label: string; items: SessionSummary[] }
  >();
  for (const item of sessions) {
    const time = Date.parse(item.updatedAt || item.createdAt);
    const key = String(startOfDay(time));
    const group = groups.get(key);
    if (group) group.items.push(item);
    else
      groups.set(key, {
        key,
        label: dayLabel(time, now, locale),
        items: [item],
      });
  }
  return [...groups.values()];
}

export function SessionHistoryModal() {
  const { t, text: localizeText, locale } = useI18n();

  const confirm = useConfirmation();
  const { sessionModalOpen, closeSessionModal, guest, ownerId, openAuthModal } =
    useAuth();
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [error, setError] = useState<string | Error>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  // Captured when a page loads so render stays pure; expiry hints are relative to it.
  const [loadedAt, setLoadedAt] = useState(0);
  const requests = useRef<{
    generation: number;
    pending: boolean;
    controller?: AbortController;
  }>({ generation: 0, pending: false });
  const deletedIds = useRef(new Set<string>());
  const retryCursor = useRef<string | undefined>(undefined);

  const loadSessions = useCallback(async (cursor?: string) => {
    if (requests.current.pending) return;
    const generation = requests.current.generation;
    requests.current.pending = true;
    const controller = new AbortController();
    requests.current.controller = controller;
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
        { signal: controller.signal },
      );
      if (requests.current.generation !== generation) return;
      setLoadedAt(Date.now());
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
      setError(err instanceof Error ? err : "Failed to load sessions.");
    } finally {
      if (requests.current.generation === generation) {
        requests.current.pending = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const userId = ownerId;
  useEffect(() => {
    requests.current.controller?.abort();
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
    setOpenIds(new Set());
    retryCursor.current = undefined;
    deletedIds.current.clear();
    if (sessionModalOpen && userId) void loadSessions();
    return () => {
      requests.current.controller?.abort();
      requests.current = {
        generation: requests.current.generation + 1,
        pending: false,
      };
    };
  }, [sessionModalOpen, userId, loadSessions]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const generation = requests.current.generation;
    if (
      !(await confirm({
        title: "Delete this session?",
        description:
          "Its conversation, board submissions, and report will be permanently removed.",
        confirmLabel: "Delete session",
        cancelLabel: "Keep session",
        destructive: true,
      })) ||
      requests.current.generation !== generation
    )
      return;
    setDeletingId(id);
    try {
      await api(`/api/sessions/${id}`, {}, "DELETE");
      clearBoardDrafts(undefined, id);
      if (requests.current.generation !== generation) return;
      deletedIds.current.add(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      if (requests.current.generation !== generation) return;
      setError(err instanceof Error ? err : "Failed to delete session.");
    } finally {
      if (requests.current.generation === generation) setDeletingId(null);
    }
  }

  function renderCard(item: SessionSummary, Heading: "h3" | "h4") {
    const title =
      item.title === "Untitled Lesson" ? t("Untitled Lesson") : item.title;
    const phaseInfo = PHASE_LABELS[item.phase] || {
      label: item.phase,
      badgeClass: "phase-badge-neutral",
      icon: HelpCircle,
    };
    const PhaseIcon = phaseInfo.icon;
    const supportedCount = item.progress.filter(
      (p) => p.status === "supported",
    ).length;
    const dateStr = formatDate(locale, item.updatedAt || item.createdAt, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const remaining = Date.parse(item.expiresAt) - loadedAt;
    const expiryDate = formatDate(locale, item.expiresAt, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const completed = item.phase === "report";
    const href = `/session/${item.id}${completed ? "/report" : ""}`;
    const open = openIds.has(item.id);
    const detailsId = `session-details-${item.id}`;
    return (
      <article key={item.id} className="session-card">
        <div className="session-card-row">
          <div className="session-card-identity">
            <Heading className="session-card-title">
              <Link
                className="session-card-link"
                href={href}
                onClick={closeSessionModal}
              >
                <FormulaText>{title}</FormulaText>
              </Link>
            </Heading>
            <div className="session-card-summary">
              <span className={`phase-badge ${phaseInfo.badgeClass}`}>
                <PhaseIcon size={12} aria-hidden />
                {localizeText(phaseInfo.label)}
              </span>
              <time
                className="session-date"
                dateTime={item.updatedAt || item.createdAt}
              >
                {dateStr}
              </time>
            </div>
          </div>
          <Link
            className="resume-indicator"
            href={href}
            onClick={closeSessionModal}
          >
            {completed ? t("View report") : t("Resume")}{" "}
            <ArrowRight size={14} />
          </Link>
          <button
            type="button"
            className="icon-button session-details-toggle"
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            aria-label={t("Session details: {title}", { title })}
            onClick={() =>
              setOpenIds((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })
            }
          >
            <ChevronDown size={16} />
          </button>
        </div>
        {open && (
          <div id={detailsId} className="session-card-more">
            <span className="level-badge">
              <LevelIcon level={item.level} size={14} />
              {localizeText(item.level)}
            </span>
            {item.scope && (
              <p className="session-card-scope">
                <FormulaText>{item.scope}</FormulaText>
              </p>
            )}
            <div className="session-card-more-footer">
              <div className="session-meta">
                {item.progress.length > 0 && (
                  <span className="session-progress-pill">
                    <CheckCircle2 size={13} />
                    {supportedCount}/{item.progress.length} {t("objectives")}
                  </span>
                )}
                <span
                  className={`session-expiry${remaining < EXPIRY_SOON_MS ? " session-expiry-soon" : ""}`}
                  title={t("Expires {date}", { date: expiryDate })}
                >
                  <Hourglass size={13} />
                  {remaining <= DAY_MS
                    ? t("Expires within a day")
                    : t("Expires in {count} days", {
                        count: Math.ceil(remaining / DAY_MS),
                      })}
                </span>
              </div>
              <button
                type="button"
                className="icon-button delete-session-button"
                aria-label={t("Delete session: {title}", { title })}
                onClick={(e) => handleDelete(item.id, e)}
                disabled={deletingId === item.id}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}
      </article>
    );
  }

  return (
    <Modal
      open={sessionModalOpen && !!ownerId}
      onClose={closeSessionModal}
      title={t("My Learning Sessions")}
      className="session-history-modal"
    >
      <div className="session-history-content">
        {guest && (
          <p className="muted">
            {t(
              "Guest sessions are available only in this browser and expire after seven days. Sign in to access them across devices.",
            )}
          </p>
        )}
        {!ownerId ? (
          <div className="signin-history-banner">
            <div>
              <strong>{t("Sign in to see your sessions.")}</strong>
              <p>
                {t(
                  "Your learning sessions are saved to your account and sync across all your devices.",
                )}
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
              {t("Sign In / Sign Up")}
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
                <Spinner label={t("Loading your sessions…")} />
              </div>
            ) : sessions.length === 0 && !nextCursor && !error ? (
              <div className="history-empty">
                <div className="history-empty-icon">
                  <BookOpen size={36} />
                </div>
                <h3>{t("No sessions found")}</h3>
                <p>
                  {t(
                    "Bring a document or paste your notes to start teaching Milo and test your understanding.",
                  )}
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    closeSessionModal();
                    router.push("/");
                  }}
                >
                  {t("Start a New Lesson")} <ArrowRight size={17} />
                </button>
              </div>
            ) : (
              <div className="sessions-groups">
                {sessions.length > GROUP_THRESHOLD ? (
                  groupByDay(sessions, loadedAt, locale).map((group) => (
                    <section
                      key={group.key}
                      className="sessions-group"
                      aria-labelledby={`sessions-group-${group.key}`}
                    >
                      <h3
                        id={`sessions-group-${group.key}`}
                        className="sessions-group-heading"
                      >
                        {group.label}
                        <span className="sessions-group-count">
                          {group.items.length}
                        </span>
                      </h3>
                      <div className="sessions-list">
                        {group.items.map((item) => renderCard(item, "h4"))}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className="sessions-list">
                    {sessions.map((item) => renderCard(item, "h3"))}
                  </div>
                )}
              </div>
            )}
            {!loading && (sessions.length > 0 || nextCursor) && (
              <div className="history-pagination">
                <p role="status">
                  {sessions.length} {t("sessions shown")}
                </p>
                {nextCursor && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={loadingMore}
                    onClick={() => loadSessions(nextCursor)}
                  >
                    {loadingMore ? (
                      <Spinner label={t("Loading more sessions…")} />
                    ) : (
                      t("Load more")
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
