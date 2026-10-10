"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Lightbulb,
  Quote,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Citation, dimensions, Message, SessionPublic } from "@/lib/contracts";
import { api, ErrorNotice, Modal } from "./ui";
import { Milo } from "./milo";

const labels = {
  accuracy: "Concept accuracy",
  mechanism: "Explaining the mechanism",
  evidence: "Examples & demonstrations",
  misconception: "Misconception handling",
  transfer: "Independent transfer",
};
export function ReportView({ session }: { session: SessionPublic }) {
  const report = session.report!;
  const [evidence, setEvidence] = useState<Message | null>(null);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function showEvidence(citation: Citation) {
    try {
      const result = await api<{ messages: Message[] }>(
        `/api/sessions/${session.id}/messages?messageId=${citation.messageId}`,
      );
      setEvidence(result.messages[0]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const citations = (items: Citation[]) =>
    items.map((c, i) => (
      <button
        className="evidence-quote"
        key={i}
        onClick={() => showEvidence(c)}
      >
        <Quote size={13} />
        <span>“{c.quote}”</span>
        <ArrowRight size={13} />
      </button>
    ));
  return (
    <main id="main" className="report-main">
      <header className="report-intro">
        <div className="report-milo">
          <Milo size={86} />
          <span>Thanks for teaching me.</span>
        </div>
        <span className="small-label">Your learning reflection</span>
        <h1>
          Here’s what your
          <br />
          explanations showed.
        </h1>
        <p>{session.lesson.title}</p>
      </header>
      <div className="report-summary">
        <div>
          <span className="report-label">
            {report.overallLabel === "strong_evidence"
              ? "Strong evidence of understanding"
              : report.overallLabel === "developing"
                ? "Understanding is developing"
                : "More evidence to explore"}
          </span>
          <p>
            This is indicative feedback on this session, not a mastery
            certification.
          </p>
        </div>
        <div className="score-display">
          {report.total !== null ? (
            <>
              <strong>{report.total}</strong>
              <span>/ 10</span>
            </>
          ) : (
            <>
              <strong>{report.earnedPoints}</strong>
              <span>
                / {report.availablePoints || "—"}
                <small>assessed points</small>
              </span>
            </>
          )}
        </div>
      </div>
      {report.criticalMisconception && (
        <div className="source-concerns">
          <strong>One important idea still needs attention.</strong>
          <p>
            An unresolved misconception appeared in your reasoning. Review the
            relevant next step below before moving on.
          </p>
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      <div className="report-columns">
        <section className="rubric-panel">
          <h2>The evidence, idea by idea</h2>
          <p className="muted">Each dimension is assessed independently.</p>
          <div className="rubric-rows">
            {dimensions.map((name) => {
              const dimension = report.scores[name];
              return (
                <article className="rubric-row" key={name}>
                  <div className="rubric-title">
                    <h3>{labels[name]}</h3>
                    <span>
                      {dimension.score === null
                        ? "Unscored"
                        : `${dimension.score} / 2`}
                    </span>
                  </div>
                  <div className="rubric-bar" aria-hidden="true">
                    <i
                      style={{
                        width: `${dimension.score === null ? 0 : dimension.score * 50}%`,
                      }}
                    />
                  </div>
                  <p>{dimension.explanation}</p>
                  {dimension.score === null && (
                    <span className="evidence-status">
                      {dimension.status === "uncertain"
                        ? "Source or judgment uncertainty"
                        : "Insufficient evidence"}
                    </span>
                  )}
                  {citations(dimension.citations)}
                </article>
              );
            })}
          </div>
        </section>
        <aside className="reflection-panel">
          <section className="reflection-card">
            <span className="reflection-icon">
              <CheckCircle2 size={22} />
            </span>
            <h2>What came through clearly</h2>
            {report.strengths.length ? (
              report.strengths.map((s, i) => (
                <div className="feedback-item" key={i}>
                  <p>{s.text}</p>
                  {citations(s.citations)}
                </div>
              ))
            ) : (
              <p>
                There isn’t enough evidence yet to identify a specific strength.
                A worked example is a good place to begin next time.
              </p>
            )}
          </section>
          <section className="reflection-card next-steps">
            <span className="reflection-icon">
              <Lightbulb size={22} />
            </span>
            <h2>Your next steps</h2>
            {report.nextSteps.map((s, i) => (
              <div className="feedback-item" key={i}>
                <p>{s.text}</p>
                {citations(s.citations)}
              </div>
            ))}
          </section>
        </aside>
      </div>
      <section className="transfer-review">
        <div>
          <ShieldCheck size={23} />
          <h2>The independent check</h2>
          <span className="result-chip">
            {report.transferCorrect === null
              ? "Unscored"
              : report.transferCorrect
                ? "Supported"
                : "Keep exploring"}
          </span>
        </div>
        <p>{report.scores.transfer.explanation}</p>
        <details>
          <summary>See the expected reasoning</summary>
          <p className="expected-explanation">
            {report.expectedTransferExplanation}
          </p>
        </details>
      </section>
      <div className="report-actions">
        <Link className="primary-button" href="/">
          Teach something new <ArrowRight size={18} />
        </Link>
        <button className="quiet-button" onClick={() => setRemove(true)}>
          <Trash2 size={15} /> Delete this session
        </button>
      </div>
      <p className="report-disclaimer">
        One session shows today’s explanations. Returning to the idea later
        helps reveal what stays with you.
      </p>
      <Modal
        open={!!evidence}
        onClose={() => setEvidence(null)}
        title="Your original explanation"
      >
        <p className="evidence-original">{evidence?.text}</p>
        {evidence?.board && (
          <p className="muted">
            A teaching-board snapshot accompanied this explanation.
          </p>
        )}
      </Modal>
      <Modal
        open={remove}
        onClose={() => setRemove(false)}
        title="Delete this session?"
      >
        <p>
          This removes its conversation, board submissions, and report. Your
          original document was already discarded after extraction.
        </p>
        <div className="modal-actions">
          <button
            className="danger-button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await api(`/api/sessions/${session.id}`, {}, "DELETE");
                window.location.assign("/");
              } catch (e) {
                setError((e as Error).message);
                setRemove(false);
                setDeleting(false);
              }
            }}
          >
            Delete session
          </button>
          <button className="quiet-button" onClick={() => setRemove(false)}>
            Keep session
          </button>
        </div>
      </Modal>
    </main>
  );
}
