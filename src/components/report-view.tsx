"use client";

import { lessonLanguage } from "@/lib/i18n/locales";
import { useI18n } from "@/components/locale-context";
import { clearBoardDrafts } from "@/lib/board-drafts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  HelpCircle,
  Lightbulb,
  Quote,
  ShieldCheck,
  Trash2,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  Citation,
  Dimension,
  dimensions,
  Message,
  SessionPublic,
  SessionReport,
} from "@/lib/contracts";
import { api, ErrorNotice, Modal } from "./ui";

const skills: Record<Dimension, { label: string; hint: string }> = {
  accuracy: { label: "Getting the facts right", hint: "Concept accuracy" },
  mechanism: { label: "Explaining how it works", hint: "The mechanism" },
  evidence: { label: "Using examples", hint: "Examples & demonstrations" },
  misconception: {
    label: "Fixing a common mistake",
    hint: "Misconception handling",
  },
  transfer: { label: "Applying it on your own", hint: "Independent check" },
};

type Status = "strong" | "partial" | "notyet" | "missing" | "uncertain";
const statuses: Record<
  Status,
  { word: string; icon: typeof CheckCircle2; legend: string }
> = {
  strong: { word: "Strong", icon: CheckCircle2, legend: "2 of 2 points" },
  partial: { word: "Getting there", icon: TrendingUp, legend: "1 of 2 points" },
  notyet: { word: "Not yet", icon: XCircle, legend: "0 of 2 points" },
  missing: {
    word: "Not shown yet",
    icon: CircleDashed,
    legend: "Not enough evidence to score",
  },
  uncertain: {
    word: "Couldn’t judge",
    icon: HelpCircle,
    legend: "Unclear source, so not scored",
  },
};
const legendOrder: Status[] = [
  "strong",
  "partial",
  "notyet",
  "missing",
  "uncertain",
];

function statusOf(d: SessionReport["scores"][Dimension]): Status {
  if (d.score === 2) return "strong";
  if (d.score === 1) return "partial";
  if (d.score === 0) return "notyet";
  return d.status === "uncertain" ? "uncertain" : "missing";
}

const verdicts = {
  strong_evidence: {
    tone: "strong",
    title: "Great teaching — your explanations showed clear understanding.",
  },
  developing: {
    tone: "partial",
    title: "You’re on your way — a few ideas need more work.",
  },
  incomplete: {
    tone: "missing",
    title: "Good start — Milo needs more evidence to judge everything.",
  },
} as const;

// One donut slice per skill, coloured by its status.
function SkillRing({
  items,
  center,
  caption,
}: {
  items: { name: Dimension; status: Status }[];
  center: string;
  caption: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = 6;
  const slice = c / items.length;
  return (
    <figure className="rp-ring" aria-hidden="true">
      <svg viewBox="0 0 132 132">
        {items.map((item, i) => (
          <circle
            key={item.name}
            className={`rp-slice rp-fill-${item.status}`}
            cx="66"
            cy="66"
            r={r}
            strokeDasharray={`${slice - gap} ${c - slice + gap}`}
            strokeDashoffset={-i * slice}
            transform="rotate(-90 66 66)"
          />
        ))}
      </svg>
      <figcaption>
        <strong>{center}</strong>
        <span>{caption}</span>
      </figcaption>
    </figure>
  );
}

function PointMeter({
  status,
  score,
}: {
  status: Status;
  score: number | null;
}) {
  const { t } = useI18n();

  return (
    <span
      className={`rp-meter rp-meter-${status}`}
      role="img"
      aria-label={
        score === null ? t("Not scored") : t("{score} of 2 points", { score })
      }
    >
      <i className={score !== null && score >= 1 ? "on" : ""} />
      <i className={score === 2 ? "on" : ""} />
    </span>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const { text: localizeText } = useI18n();
  const { word, icon: Icon } = statuses[status];
  return (
    <span className={`rp-badge rp-tone-${status}`}>
      <Icon size={14} aria-hidden="true" /> {localizeText(word)}
    </span>
  );
}

export function ReportView({
  session,
  active = true,
}: {
  session: SessionPublic;
  active?: boolean;
}) {
  const { t, text: localizeText } = useI18n();

  const report = session.report!;
  const [evidence, setEvidence] = useState<Message | null>(null);
  const [error, setError] = useState<string | Error>("");
  const [remove, setRemove] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const evidenceRequest = useRef<AbortController | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState<string | null>(null);
  useEffect(() => {
    if (!active) {
      setEvidence(null);
      setLoadingEvidence(null);
    }
    return () => {
      evidenceRequest.current?.abort();
      evidenceRequest.current = null;
    };
  }, [active, session.id]);
  async function showEvidence(citation: Citation) {
    evidenceRequest.current?.abort();
    const controller = new AbortController();
    evidenceRequest.current = controller;
    setLoadingEvidence(citation.messageId);
    try {
      const result = await api<{ messages: Message[] }>(
        `/api/sessions/${session.id}/messages?messageId=${citation.messageId}`,
        undefined,
        "GET",
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setEvidence(result.messages[0]);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e : "Please try again.");
    } finally {
      if (evidenceRequest.current === controller) {
        evidenceRequest.current = null;
        setLoadingEvidence(null);
      }
    }
  }
  const citations = (items: Citation[]) =>
    items.map((c, i) => (
      <button
        className="evidence-quote"
        key={i}
        disabled={loadingEvidence === c.messageId}
        aria-busy={loadingEvidence === c.messageId}
        onClick={() => showEvidence(c)}
      >
        <Quote size={13} />
        <span>“{c.quote}”</span>
        <ArrowRight size={13} />
      </button>
    ));
  const yourWords = (items: Citation[]) =>
    items.length > 0 && (
      <details className="rp-words">
        <summary>
          {t("See your words (")}
          {items.length})
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        {citations(items)}
      </details>
    );

  const items = dimensions.map((name) => ({
    name,
    status: statusOf(report.scores[name]),
    dimension: report.scores[name],
  }));
  const count = (s: Status) => items.filter((i) => i.status === s).length;
  const scored = items.filter((i) => i.dimension.score !== null).length;
  const verdict = verdicts[report.overallLabel];
  const VerdictIcon = statuses[verdict.tone].icon;
  const center =
    report.total !== null
      ? `${report.total}/10`
      : report.availablePoints
        ? `${report.earnedPoints}/${report.availablePoints}`
        : "—";
  const summary =
    report.total !== null
      ? t("You scored {total} out of 10 across all five skills.", {
          total: report.total,
        })
      : scored === 0
        ? t("Milo didn’t see enough evidence to score any skill yet.")
        : t(
            scored === 1
              ? "You earned {earned} of {available} points on the {scored} skill Milo could check."
              : "You earned {earned} of {available} points on the {scored} skills Milo could check.",
            {
              earned: report.earnedPoints,
              available: report.availablePoints,
              scored,
            },
          ) +
          " " +
          t(
            5 - scored === 1
              ? "{count} skill still needs evidence."
              : "{count} skills still need evidence.",
            { count: 5 - scored },
          );
  const transferStatus: Status =
    report.transferCorrect === null
      ? "missing"
      : report.transferCorrect
        ? "strong"
        : "notyet";

  return (
    <div className="report-main">
      <header className="report-intro">
        <span className="small-label">{t("Your learning report")}</span>
        <h1>{t("How did your teaching go?")}</h1>
        <p>{session.lesson.title}</p>
      </header>

      <section className="rp-overview" aria-labelledby="rp-verdict">
        <SkillRing
          items={items}
          center={center}
          caption={report.total !== null ? t("overall") : t("points")}
        />
        <div className="rp-overview-text">
          <h2 id="rp-verdict" className={`rp-verdict rp-tone-${verdict.tone}`}>
            <VerdictIcon size={20} aria-hidden="true" />
            {localizeText(verdict.title)}
          </h2>
          <p>{summary}</p>
          <ul className="rp-counts" aria-label={t("Skills by result")}>
            {legendOrder
              .filter((s) => count(s) > 0)
              .map((s) => (
                <li key={s} className={`rp-tone-${s}`}>
                  <i className={`rp-dot rp-fill-${s}`} aria-hidden="true" />
                  <strong>{count(s)}</strong> {localizeText(statuses[s].word)}
                </li>
              ))}
          </ul>
        </div>
      </section>

      {report.criticalMisconception && (
        <div className="source-concerns">
          <strong>{t("One important idea still needs attention.")}</strong>
          <p>
            {t(
              "An unresolved misconception appeared in your reasoning. Review the next steps below before moving on.",
            )}
          </p>
        </div>
      )}
      {error && <ErrorNotice message={error} />}

      <section className="rp-panel" aria-labelledby="rp-skills-title">
        <div className="rp-panel-head">
          <h2 id="rp-skills-title">{t("Skill by skill")}</h2>
          <p className="muted">{t("Tap a skill to see why.")}</p>
        </div>
        <ul className="rp-skills">
          {items.map(({ name, status, dimension }) => {
            const Icon = statuses[status].icon;
            return (
              <li key={name}>
                <details>
                  <summary>
                    <span className={`rp-skill-icon rp-tone-${status}`}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="rp-skill-name">
                      <strong>{localizeText(skills[name].label)}</strong>
                      <small>{localizeText(skills[name].hint)}</small>
                    </span>
                    <PointMeter status={status} score={dimension.score} />
                    <StatusBadge status={status} />
                    <ChevronDown
                      className="rp-chevron"
                      size={16}
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="rp-skill-body">
                    <p lang={lessonLanguage(session.lesson.teachingLanguage)}>
                      {dimension.explanation}
                    </p>
                    {citations(dimension.citations)}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        <ul className="rp-legend" aria-label={t("Legend")}>
          {legendOrder.map((s) => (
            <li key={s}>
              <i className={`rp-dot rp-fill-${s}`} aria-hidden="true" />
              <strong>{localizeText(statuses[s].word)}</strong>{" "}
              {localizeText(statuses[s].legend)}
            </li>
          ))}
        </ul>
      </section>

      <div className="rp-columns">
        <section className="rp-panel rp-list rp-strengths">
          <h2>
            <CheckCircle2 size={20} aria-hidden="true" /> {t("What went well")}
          </h2>
          {report.strengths.length ? (
            <ul>
              {report.strengths.map((s, i) => (
                <li key={i}>
                  <p lang={lessonLanguage(session.lesson.teachingLanguage)}>
                    {s.text}
                  </p>
                  {yourWords(s.citations)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {t(
                "Nothing stood out clearly yet. Next time, try walking Milo through a worked example.",
              )}
            </p>
          )}
        </section>
        <section className="rp-panel rp-list rp-next">
          <h2>
            <Lightbulb size={20} aria-hidden="true" /> {t("Try this next")}
          </h2>
          <ol>
            {report.nextSteps.map((s, i) => (
              <li key={i}>
                <p lang={lessonLanguage(session.lesson.teachingLanguage)}>
                  {s.text}
                </p>
                {yourWords(s.citations)}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="rp-panel rp-check">
        <div className="rp-check-head">
          <span className={`rp-skill-icon rp-tone-${transferStatus}`}>
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <h2>{t("Independent check")}</h2>
          <StatusBadge status={transferStatus} />
        </div>
        <p lang={lessonLanguage(session.lesson.teachingLanguage)}>
          {report.scores.transfer.explanation}
        </p>
        <details className="rp-words">
          <summary>
            {t("See the expected reasoning")}
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <p
            className="expected-explanation"
            lang={lessonLanguage(session.lesson.teachingLanguage)}
          >
            {report.expectedTransferExplanation}
          </p>
        </details>
      </section>

      <div className="report-actions">
        <Link className="primary-button" href="/">
          {t("Teach something new")} <ArrowRight size={18} />
        </Link>
        <button className="quiet-button" onClick={() => setRemove(true)}>
          <Trash2 size={15} /> {t("Delete this session")}
        </button>
      </div>
      <p className="report-disclaimer">
        {t(
          "This is feedback on one session, not a final grade. Coming back to the idea later shows what really sticks.",
        )}
      </p>
      <Modal
        open={!!evidence}
        onClose={() => setEvidence(null)}
        title={t("Your original explanation")}
      >
        <p className="evidence-original">{evidence?.text}</p>
        {evidence?.board && (
          <p className="muted">
            {t("A teaching-board snapshot accompanied this explanation.")}
          </p>
        )}
      </Modal>
      <Modal
        open={remove}
        onClose={() => setRemove(false)}
        title={t("Delete this session?")}
      >
        <p>
          {t(
            "This removes its conversation, board submissions, and report. Your original document was already discarded after extraction.",
          )}
        </p>
        <div className="modal-actions">
          <button
            className="danger-button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await api(`/api/sessions/${session.id}`, {}, "DELETE");
                clearBoardDrafts(undefined, session.id);
                window.location.assign("/");
              } catch (e) {
                setError(e instanceof Error ? e : "Please try again.");
                setRemove(false);
                setDeleting(false);
              }
            }}
          >
            {t("Delete session")}
          </button>
          <button className="quiet-button" onClick={() => setRemove(false)}>
            {t("Keep session")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
