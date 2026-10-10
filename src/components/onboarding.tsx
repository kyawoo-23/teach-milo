"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Lightbulb,
  LockKeyhole,
  MessageCircle,
  Paperclip,
  UploadCloud,
  X,
} from "lucide-react";
import { LessonPublic, SessionPublic, Source } from "@/lib/contracts";
import { Brand } from "./brand";
import { Milo } from "./milo";
import { api, ErrorNotice, Modal, Spinner, useOperationId } from "./ui";

type MaterialResult = { id: string; name: string; sources: Source[] };
export function Onboarding() {
  const router = useRouter();
  const getOperation = useOperationId();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [step, setStep] = useState<"material" | "review" | "lesson">(
    "material",
  );
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("introductory");
  const [material, setMaterial] = useState<MaterialResult | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [lesson, setLesson] = useState<LessonPublic | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    api<{ missing: string[] }>("/api/status")
      .then((r) => setMissing(r.missing))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (step !== "material")
      document.querySelector<HTMLElement>(".flow-heading")?.focus();
  }, [step]);
  async function run(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy("");
      busyRef.current = false;
    }
  }
  function chooseFile(chosen?: File) {
    if (!chosen) return;
    if (!/\.(pdf|docx|txt)$/i.test(chosen.name)) {
      setError("Choose a PDF, DOCX, or TXT file.");
      return;
    }
    if (chosen.size > 10 * 1024 * 1024) {
      setError("Choose a file smaller than 10 MB.");
      return;
    }
    setFile(chosen);
    setError("");
  }
  async function readMaterial(event: React.FormEvent) {
    event.preventDefault();
    await run(
      mode === "upload" && file?.name.toLowerCase().endsWith(".pdf")
        ? "Reading your pages, including scanned content…"
        : "Reading your learning material…",
      async () => {
        let result: MaterialResult;
        if (mode === "upload") {
          if (!file) throw new Error("Choose a learning document first.");
          const form = new FormData();
          form.append(
            "operationId",
            getOperation(
              `upload:${file.name}:${file.size}:${file.lastModified}`,
            ),
          );
          form.append("file", file);
          result = await api("/api/materials", form);
        } else
          result = await api("/api/materials", {
            text: notes,
            name: "Pasted notes",
            operationId: getOperation(`paste:${notes}`),
          });
        setMaterial(result);
        setSources(result.sources);
        setStep("review");
      },
    );
  }
  async function prepare() {
    await run("Finding a focused lesson in your material…", async () => {
      const payload = { materialId: material!.id, topic, level, sources };
      const result = await api<LessonPublic>("/api/lessons", {
        ...payload,
        operationId: getOperation(JSON.stringify(payload)),
      });
      setLesson(result);
      setStep("lesson");
    });
  }
  async function start() {
    await run("Milo is getting ready to learn…", async () => {
      const result = await api<SessionPublic>("/api/sessions", {
        lessonId: lesson!.id,
        operationId: getOperation(`start:${lesson!.id}`),
      });
      router.push(`/session/${result.id}`);
    });
  }
  return (
    <div className="home-shell">
      <header className="site-header">
        <Brand />
        <button className="quiet-button" onClick={() => setHelp(true)}>
          How it works <MessageCircle size={16} />
        </button>
      </header>
      <main
        id="main"
        className={`home-main ${step !== "material" ? "flow-main" : ""}`}
      >
        {step === "material" ? (
          <>
            <section className="home-intro">
              <div className="intro-tag">
                <span className="status-dot" /> A little curiosity goes a long
                way
              </div>
              <h1>
                You know it.
                <br />
                Can you teach it?
              </h1>
              <p className="hero-description">
                Meet Milo, your curious AI student. Bring what you’re learning,
                explain it in your own words, and discover what really clicks.
              </p>
              <div className="milo-introduction">
                <div className="milo-orbit">
                  <span className="orbit-star star-one">✦</span>
                  <Milo size={112} />
                  <span className="orbit-star star-two">✧</span>
                </div>
                <div className="intro-speech">
                  <span className="small-label">Milo’s ready to learn</span>
                  <p>
                    “You do the teaching.
                    <br />
                    I’ll bring the questions.”
                  </p>
                  <span className="speech-dot" />
                </div>
              </div>
              <div className="learning-path">
                <div>
                  <MessageCircle size={17} />
                  <span>Explain it</span>
                </div>
                <i />
                <div>
                  <Lightbulb size={18} />
                  <span>Make it click</span>
                </div>
                <i />
                <div>
                  <CheckCircle2 size={17} />
                  <span>Try it yourself</span>
                </div>
              </div>
            </section>
            <section className="material-card" aria-labelledby="material-title">
              <div className="card-title">
                <span className="round-icon">
                  <FileText size={22} />
                </span>
                <div>
                  <h2 id="material-title">What are we learning?</h2>
                  <p>Start with something you want to understand.</p>
                </div>
              </div>
              <form onSubmit={readMaterial}>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Material input method"
                >
                  <button
                    type="button"
                    aria-pressed={mode === "upload"}
                    onClick={() => setMode("upload")}
                  >
                    <UploadCloud size={17} /> Upload a document
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "paste"}
                    onClick={() => setMode("paste")}
                  >
                    <FileText size={17} /> Paste notes
                  </button>
                </div>
                {mode === "upload" ? (
                  <div
                    className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      chooseFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <input
                      ref={inputRef}
                      id="material-file"
                      type="file"
                      className="visually-hidden"
                      accept=".pdf,.docx,.txt"
                      onChange={(e) => chooseFile(e.target.files?.[0])}
                    />
                    {file ? (
                      <>
                        <span className="file-symbol">
                          <FileText size={26} />
                        </span>
                        <strong>{file.name}</strong>
                        <span>
                          {(file.size / 1024).toFixed(0)} KB · Ready to read
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setFile(null);
                            if (inputRef.current) inputRef.current.value = "";
                          }}
                        >
                          Choose another file
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="upload-symbol">
                          <UploadCloud size={28} />
                        </span>
                        <label htmlFor="material-file" className="file-label">
                          Choose a file <span>or drop it here</span>
                        </label>
                        <span>PDF, DOCX, or TXT · Up to 10 MB</span>
                        <span className="ocr-note">
                          Scanned PDFs welcome. We’ll read those too.
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="paste-field">
                    <label htmlFor="notes" className="visually-hidden">
                      Your learning notes
                    </label>
                    <textarea
                      id="notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      minLength={30}
                      maxLength={50000}
                      required
                      rows={7}
                      placeholder="Paste a passage, your class notes, or an explanation you want to understand better…"
                    />
                    <span className="character-count">
                      {notes.length.toLocaleString()} / 50,000
                    </span>
                  </div>
                )}
                <label className="field-label" htmlFor="topic">
                  What would you like to focus on?
                </label>
                <input
                  id="topic"
                  className="text-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. How photosynthesis stores energy"
                  minLength={3}
                  maxLength={200}
                  required
                />
                <fieldset className="level-field">
                  <legend>Choose your depth</legend>
                  <div className="level-options">
                    {["introductory", "intermediate", "advanced"].map((l) => (
                      <label key={l}>
                        <input
                          type="radio"
                          name="level"
                          value={l}
                          checked={level === l}
                          onChange={() => setLevel(l)}
                        />
                        <span>
                          {l === "introductory"
                            ? "Introductory"
                            : l === "intermediate"
                              ? "Intermediate"
                              : "Advanced"}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {error && <ErrorNotice message={error} />}
                <button
                  className="primary-button full-width"
                  type="submit"
                  disabled={!!busy}
                >
                  {busy ? (
                    <Spinner label="Reading your material" />
                  ) : (
                    <>
                      Prepare my lesson <ArrowRight size={18} />
                    </>
                  )}
                </button>
                {busy && (
                  <p className="processing-note" role="status">
                    {busy} Larger PDFs may take a few minutes.
                  </p>
                )}
                <p className="privacy-note">
                  <LockKeyhole size={13} /> Private guest session. Material is
                  processed with Gemini.
                </p>
              </form>
            </section>
          </>
        ) : (
          <section className="review-card">
            <button
              className="quiet-button back-button"
              disabled={!!busy}
              onClick={() => {
                setError("");
                setStep(step === "lesson" ? "review" : "material");
              }}
            >
              <ChevronLeft size={17} />{" "}
              {step === "lesson" ? "Review material" : "Change material"}
            </button>
            <div className="flow-progress" aria-label="Preparation progress">
              <span className="complete">
                <Check size={14} /> Your material
              </span>
              <i />
              <span className={step === "review" ? "current" : "complete"}>
                Review extraction
              </span>
              <i />
              <span className={step === "lesson" ? "current" : ""}>
                Your lesson
              </span>
            </div>
            {step === "review" ? (
              <>
                <h1 className="flow-heading" tabIndex={-1}>
                  Does this look right?
                </h1>
                <p className="section-description">
                  Review what we read from <strong>{material?.name}</strong>.
                  Correct unclear words or formulas before Milo learns from it.
                </p>
                <div className="source-list">
                  {sources.map((source, i) => (
                    <div className="source-section" key={source.id}>
                      <label className="field-label" htmlFor={`source-${i}`}>
                        <FileText size={15} />
                        {source.label}
                      </label>
                      {source.warnings.map((w, n) => (
                        <p className="source-warning" key={n}>
                          {w}
                        </p>
                      ))}
                      <textarea
                        id={`source-${i}`}
                        value={source.text}
                        rows={Math.min(
                          12,
                          Math.max(4, source.text.split("\n").length),
                        )}
                        onChange={(e) =>
                          setSources((prev) =>
                            prev.map((s, n) =>
                              n === i ? { ...s, text: e.target.value } : s,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="review-summary">
                  <span>
                    <Paperclip size={15} /> {sources.length} source{" "}
                    {sources.length === 1 ? "section" : "sections"}
                  </span>
                  <span>
                    {sources
                      .reduce((n, s) => n + s.text.length, 0)
                      .toLocaleString()}{" "}
                    characters
                  </span>
                </div>
                {error && <ErrorNotice message={error} />}
                <button
                  className="primary-button"
                  disabled={!!busy}
                  onClick={prepare}
                >
                  {busy ? (
                    <Spinner label="Preparing your lesson" />
                  ) : (
                    <>
                      Looks right. Find my lesson <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </>
            ) : (
              lesson && (
                <>
                  <div className="lesson-milo">
                    <Milo size={80} />
                    <span>I’d love to learn about this.</span>
                  </div>
                  <h1 className="flow-heading" tabIndex={-1}>
                    {lesson.title}
                  </h1>
                  <p className="section-description">{lesson.scope}</p>
                  <span className="level-chip">{lesson.level} depth</span>
                  <h2 className="objectives-heading">
                    What you’ll help Milo understand
                  </h2>
                  <ul className="lesson-objectives">
                    {lesson.objectives.map((o) => (
                      <li key={o.id}>
                        <span>
                          <Check size={15} />
                        </span>
                        {o.label}
                      </li>
                    ))}
                  </ul>
                  {lesson.concerns.length > 0 && (
                    <div className="source-concerns">
                      <strong>A few things to clarify</strong>
                      <p>
                        These source uncertainties may leave some report
                        criteria unscored. You can revise the material or
                        explore the concept with Milo.
                      </p>
                      {lesson.concerns.map((c, i) => (
                        <p key={i}>{c}</p>
                      ))}
                    </div>
                  )}
                  <div className="lesson-promise">
                    <MessageCircle size={20} />
                    <p>
                      Teach at your own pace. When the ideas connect, Milo will
                      offer a fresh challenge. You can end whenever you like.
                    </p>
                  </div>
                  {error && <ErrorNotice message={error} />}
                  <button
                    className="primary-button full-width"
                    disabled={!!busy}
                    onClick={start}
                  >
                    {busy ? (
                      <Spinner label="Opening your classroom" />
                    ) : (
                      <>
                        Let’s teach Milo <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </>
              )
            )}
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>Understanding grows when you explain.</span>
        <span>Formative feedback · No account needed</span>
      </footer>
      {missing.length > 0 && (
        <div className="setup-note">
          <span>Local setup needed</span> Add {missing.join(" and ")} in{" "}
          <code>.env.local</code> to start a real session.
        </div>
      )}
      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title="Learn by teaching"
      >
        <div className="help-steps">
          <p>
            <strong>Bring your material.</strong> Upload a document or paste
            notes, then check the extracted content.
          </p>
          <p>
            <strong>Teach Milo.</strong> Explain the idea in your own words. His
            questions and a visual board help you make your reasoning concrete.
          </p>
          <p>
            <strong>Try it independently.</strong> Take a new application
            question with practice aids hidden, then see feedback linked to your
            own explanations.
          </p>
          <p className="muted">
            Sessions and extracted content expire after seven days. Uploaded
            originals are discarded after extraction. Feedback is formative and
            can be imperfect.
          </p>
        </div>
      </Modal>
    </div>
  );
}
