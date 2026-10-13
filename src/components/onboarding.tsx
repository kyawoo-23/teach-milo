"use client";

import { useI18n } from "@/components/locale-context";
import { Controller } from "react-hook-form";
import {
  materialFormSchema,
  LessonReviewFormSchema,
  LearningFileSchema,
} from "@/lib/form-schemas";
import { FieldError, useSchemaForm } from "./schema-form";
import { LanguageSelector } from "./language-selector";
import {
  isTeachingLanguage,
  teachingLanguageNames,
  lessonLanguage,
  formatNumber,
  type TeachingLanguage,
} from "@/lib/i18n/locales";
import { useConfirmation } from "./confirmation";
import { useEffect, useId, useRef, useState } from "react";
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
import { LevelIcon, type LessonLevel } from "./level-icon";

const lessonLevels = ["introductory", "intermediate", "advanced"] as const;

function isLessonLevel(value: string): value is LessonLevel {
  return (lessonLevels as readonly string[]).includes(value);
}
import { CustomSelect } from "./custom-select";
import {
  LessonPublic,
  SessionMode,
  SessionPublic,
  Source,
} from "@/lib/contracts";
import { useAuth } from "./auth-context";
import { MarkdownEditor } from "./markdown-editor";
import { clearDraft, saveDraft, takeDraft } from "./material-draft";
import { Milo } from "./milo";
import { NavHeader } from "./nav-header";
import {
  api,
  ApiError,
  ErrorNotice,
  Modal,
  Spinner,
  useOperationId,
} from "./ui";

type MaterialResult = { id: string; name: string; sources: Source[] };
const START_SESSION_BUSY = "Milo is getting ready to learn…";
export function Onboarding() {
  const { t, text: localizeText, locale } = useI18n();

  const confirm = useConfirmation();
  const router = useRouter();
  const getOperation = useOperationId();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [step, setStep] = useState<"material" | "review" | "lesson">(
    "material",
  );
  const materialForm = useSchemaForm(materialFormSchema(mode === "upload"), {
    file: null as File | null,
    notes: "",
    topic: "",
    level: "introductory" as const,
    teachingLanguage: locale,
  });
  const [file, setFile] = materialForm.state("file");
  const [notes, setNotes] = materialForm.state("notes");
  const [topic, setTopic] = materialForm.state("topic");
  const [level, setLevel] = materialForm.state("level");
  const levelId = useId();
  const levelLabel = t("How advanced should this lesson be?");
  const levelName = (lessonLevel: LessonLevel) =>
    lessonLevel === "introductory"
      ? t("Introductory")
      : lessonLevel === "intermediate"
        ? t("Intermediate")
        : t("Advanced");
  const [teachingLanguage, setTeachingLanguage] =
    materialForm.state("teachingLanguage");
  const languageChosen = useRef(false);
  useEffect(() => {
    if (!languageChosen.current)
      materialForm.setValue("teachingLanguage", locale);
  }, [locale, materialForm.setValue]);
  const [material, setMaterial] = useState<MaterialResult | null>(null);
  const reviewForm = useSchemaForm(LessonReviewFormSchema, { sources: [] });
  const [sources, setSources] = reviewForm.state("sources");
  const [lesson, setLesson] = useState<LessonPublic | null>(null);
  const [sessionMode, setSessionMode] = useState<SessionMode>("correct");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | Error>("");
  const [help, setHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const { user, loading, authModalOpen, openAuthModal } = useAuth();
  const mounted = useRef(true);
  const currentOwner = useRef(user?.id);
  currentOwner.current = user?.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    busyRef.current = false;
    setBusy("");
  }, [user?.id]);

  // Set when the learner submitted material while signed out; the submission resumes after sign-in.
  const [resume, setResume] = useState(false);
  useEffect(() => {
    takeDraft().then((saved) => {
      if (!saved || !mounted.current) return;
      setMode(saved.draft.mode);
      setNotes(saved.draft.notes);
      setTopic(saved.draft.topic);
      if (
        ["introductory", "intermediate", "advanced"].includes(saved.draft.level)
      )
        setLevel(saved.draft.level as typeof level);
      if (isTeachingLanguage(saved.draft.teachingLanguage)) {
        languageChosen.current = true;
        setTeachingLanguage(saved.draft.teachingLanguage);
      }
      setFile(saved.file);
      if (saved.draft.mode === "upload" && !saved.file)
        setError("Choose your file again to continue.");
      else setResume(true);
    });
  }, []);
  useEffect(() => {
    if (!resume || loading) return;
    if (user) {
      setResume(false);
      void clearDraft();
      void readMaterial();
    } else if (!authModalOpen) {
      setResume(false);
      void clearDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, user, loading, authModalOpen]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ missing: string[] }>("/api/status", undefined, "GET", {
      signal: controller.signal,
      priority: "low",
    })
      .then((r) => setMissing(r.missing))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (step !== "material")
      document.querySelector<HTMLElement>(".flow-heading")?.focus();
  }, [step]);
  async function run(
    label: string,
    action: (isCurrent: () => boolean) => Promise<void>,
    options?: { holdBusy?: boolean },
  ) {
    if (busyRef.current) return;
    const owner = currentOwner.current;
    const isCurrent = () => mounted.current && owner === currentOwner.current;
    busyRef.current = true;
    setBusy(label);
    setError("");
    let hold = false;
    try {
      await action(isCurrent);
      if (options?.holdBusy && isCurrent()) hold = true;
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof ApiError && e.code === "AUTH_REQUIRED")
        openAuthModal("login");
      setError(e instanceof Error ? e : "Please try again.");
    } finally {
      if (isCurrent() && !hold) {
        setBusy("");
        busyRef.current = false;
      }
    }
  }
  async function chooseFile(chosen?: File) {
    if (!chosen) return;
    const checked = LearningFileSchema.safeParse(chosen);
    if (!checked.success) {
      materialForm.setError("file", {
        type: "validate",
        message: checked.error.issues[0].message,
      });
      return;
    }
    materialForm.clearErrors("file");
    if (
      file &&
      !(await confirm({
        title: "Replace selected file?",
        description:
          "The current file will be removed from your lesson preparation.",
        confirmLabel: "Replace file",
        destructive: true,
      }))
    ) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(chosen);
    setError("");
  }
  async function submitMaterial() {
    if (busyRef.current || loading) return;
    if (!user) {
      setError("");
      await saveDraft({ mode, notes, topic, level, teachingLanguage }, file);
      setResume(true);
      openAuthModal("login");
      return;
    }
    await readMaterial();
  }
  async function readMaterial() {
    if (!(await materialForm.trigger())) return;
    await run(
      mode === "upload" && file?.name.toLowerCase().endsWith(".pdf")
        ? "Reading your pages, including scanned content…"
        : "Reading your learning material…",
      async (isCurrent) => {
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
        if (!isCurrent()) return;
        setMaterial(result);
        setSources(result.sources);
        setStep("review");
      },
    );
  }
  async function prepare() {
    if (!(await materialForm.trigger(["topic", "level", "teachingLanguage"])))
      return;
    await run(
      "Finding a focused lesson in your material…",
      async (isCurrent) => {
        const payload = {
          materialId: material!.id,
          topic,
          level,
          sources,
          teachingLanguage,
        };
        const result = await api<LessonPublic>("/api/lessons", {
          ...payload,
          operationId: getOperation(JSON.stringify(payload)),
        });
        if (!isCurrent()) return;
        setLesson(result);
        setStep("lesson");
      },
    );
  }
  async function start() {
    await run(
      START_SESSION_BUSY,
      async (isCurrent) => {
        const result = await api<SessionPublic>("/api/sessions", {
          lessonId: lesson!.id,
          mode: sessionMode,
          operationId: getOperation(`start:${lesson!.id}:${sessionMode}`),
        });
        if (isCurrent()) router.push(`/session/${result.id}`);
      },
      { holdBusy: true },
    );
  }
  return (
    <div className="home-shell">
      <NavHeader
        extraActions={
          <button className="quiet-button" onClick={() => setHelp(true)}>
            {t("How it works")} <MessageCircle size={16} />
          </button>
        }
      />
      <main
        id="main"
        tabIndex={-1}
        className={`home-main ${step !== "material" ? "flow-main" : ""}`}
      >
        {step === "material" ? (
          <>
            <section className="home-intro">
              <div className="intro-tag">
                <span className="status-dot" />{" "}
                {t("A little curiosity goes a long way")}
              </div>
              <h1>
                {t("You know it.")}
                <br />
                {t("Can you teach it?")}
              </h1>
              <p className="hero-description">
                {t(
                  "Meet Milo, your curious AI student. Bring what you’re learning, explain it in your own words, and discover what really clicks.",
                )}
              </p>
              <div className="milo-introduction">
                <div className="milo-orbit">
                  <span className="orbit-star star-one">✦</span>
                  <Milo
                    size={112}
                    state={busy ? "thinking" : "greeting"}
                    interactive
                  />
                  <span className="orbit-star star-two">✧</span>
                </div>
                <div className="intro-speech">
                  <span className="small-label">
                    {t("Milo’s ready to learn")}
                  </span>
                  <p>
                    {t("“You do the teaching.")}
                    <br />
                    {t("I’ll bring the questions.”")}
                  </p>
                  <span className="speech-dot" />
                </div>
              </div>
              <div className="learning-path">
                <div>
                  <MessageCircle size={17} />
                  <span>{t("Explain it")}</span>
                </div>
                <i />
                <div>
                  <Lightbulb size={18} />
                  <span>{t("Make it click")}</span>
                </div>
                <i />
                <div>
                  <CheckCircle2 size={17} />
                  <span>{t("Try it yourself")}</span>
                </div>
              </div>
            </section>
            <section className="material-card" aria-labelledby="material-title">
              <div className="card-title">
                <span className="round-icon">
                  <FileText size={22} />
                </span>
                <div>
                  <h2 id="material-title">{t("What are we learning?")}</h2>
                  <p>{t("Start with something you want to understand.")}</p>
                </div>
              </div>
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busyRef.current || loading) return;
                  if (!user) void submitMaterial();
                  else void materialForm.handleSubmit(submitMaterial)(event);
                }}
              >
                <div
                  className="segmented"
                  role="group"
                  aria-label={t("Material input method")}
                >
                  <button
                    type="button"
                    aria-pressed={mode === "upload"}
                    onClick={() => setMode("upload")}
                  >
                    <UploadCloud size={17} aria-hidden="true" />
                    <span className="segmented-label">
                      {t("Upload a document")}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "paste"}
                    onClick={() => setMode("paste")}
                  >
                    <FileText size={17} aria-hidden="true" />
                    <span className="segmented-label">{t("Paste notes")}</span>
                  </button>
                </div>
                <div className="material-source">
                  <div
                    className={`material-source-panel ${mode === "upload" ? "is-active" : ""}`}
                    aria-hidden={mode !== "upload"}
                    inert={mode !== "upload" ? true : undefined}
                  >
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
                        name="file"
                        ref={(node) => {
                          inputRef.current = node;
                          materialForm.register("file").ref(node);
                        }}
                        {...materialForm.a11y("file", "material-file")}
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
                            {(file.size / 1024).toFixed(0)}{" "}
                            {t("KB · Ready to read")}
                          </span>
                          <button
                            type="button"
                            className="text-button"
                            onClick={async () => {
                              if (
                                !(await confirm({
                                  title: "Remove selected file?",
                                  description:
                                    "You’ll need to choose a file again before preparing your lesson.",
                                  confirmLabel: "Remove file",
                                  destructive: true,
                                }))
                              )
                                return;
                              setFile(null);
                              if (inputRef.current) inputRef.current.value = "";
                            }}
                          >
                            {t("Choose another file")}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="upload-symbol">
                            <UploadCloud size={28} />
                          </span>
                          <label htmlFor="material-file" className="file-label">
                            {t("Choose a file")}{" "}
                            <span>{t("or drop it here")}</span>
                          </label>
                          <span>{t("PDF, DOCX, or TXT · Up to 10 MB")}</span>
                          <span className="ocr-note">
                            {t("Scanned PDFs welcome. We’ll read those too.")}
                          </span>
                        </>
                      )}
                    </div>
                    <FieldError
                      id="material-file"
                      message={materialForm.formState.errors.file?.message}
                    />
                  </div>
                  <div
                    className={`material-source-panel ${mode === "paste" ? "is-active" : ""}`}
                    aria-hidden={mode !== "paste"}
                    inert={mode !== "paste" ? true : undefined}
                  >
                    <div className="paste-field">
                      <label htmlFor="notes" className="visually-hidden">
                        {t("Your learning notes")}
                      </label>
                      <textarea
                        id="notes"
                        {...materialForm.register("notes")}
                        {...materialForm.a11y("notes", "notes")}
                        autoComplete="off"
                        minLength={30}
                        maxLength={50000}
                        required
                        rows={7}
                        placeholder={t(
                          "Paste a passage, your class notes, or an explanation you want to understand better…",
                        )}
                      />
                      <span className="character-count">
                        {formatNumber(locale, notes.length)} / 50,000
                      </span>
                    </div>
                    <FieldError
                      id="notes"
                      message={materialForm.formState.errors.notes?.message}
                    />
                  </div>
                </div>
                <label className="field-label" htmlFor="topic">
                  {t("What would you like to focus on?")}
                </label>
                <input
                  id="topic"
                  {...materialForm.register("topic")}
                  {...materialForm.a11y("topic", "topic")}
                  autoComplete="off"
                  className="text-input"
                  placeholder={t("e.g. How photosynthesis stores energy")}
                  minLength={1}
                  maxLength={200}
                  required
                />
                <FieldError
                  id="topic"
                  message={materialForm.formState.errors.topic?.message}
                />
                <Controller
                  control={materialForm.control}
                  name="teachingLanguage"
                  render={({ field }) => (
                    <LanguageSelector
                      teaching
                      value={field.value}
                      onChange={(value) => {
                        languageChosen.current = true;
                        field.onChange(value);
                      }}
                      onBlur={field.onBlur}
                      disabled={!!busy}
                    />
                  )}
                />
                <fieldset className="level-field">
                  <legend>{levelLabel}</legend>
                  <div className="level-options">
                    {lessonLevels.map((l) => (
                      <label key={l}>
                        <input
                          type="radio"
                          {...materialForm.register("level")}
                          value={l}
                          checked={level === l}
                        />
                        <span>
                          <LevelIcon level={l} muted={level !== l} />
                          {levelName(l)}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="level-select">
                  <label className="field-label" htmlFor={levelId}>
                    {levelLabel}
                  </label>
                  <CustomSelect
                    id={levelId}
                    label={levelLabel}
                    value={level}
                    disabled={!!busy}
                    icon={<LevelIcon level={level} />}
                    options={lessonLevels.map((l) => ({
                      value: l,
                      label: levelName(l),
                      icon: <LevelIcon level={l} />,
                    }))}
                    onChange={(value) => {
                      if (isLessonLevel(value)) setLevel(value);
                    }}
                  />
                </div>
                {error && <ErrorNotice message={error} />}
                <button
                  className="primary-button full-width"
                  type="submit"
                  disabled={!!busy}
                >
                  {busy ? (
                    <Spinner label={t("Reading your material")} />
                  ) : (
                    <>
                      {t("Prepare my lesson")} <ArrowRight size={18} />
                    </>
                  )}
                </button>
                {busy && (
                  <p className="processing-note" role="status">
                    {localizeText(busy)}{" "}
                    {t("Larger PDFs may take a few minutes.")}
                  </p>
                )}
                <p className="privacy-note">
                  <LockKeyhole size={13} />{" "}
                  {t(
                    "Private to your account. Material is processed with Gemini.",
                  )}
                </p>
              </form>
            </section>
          </>
        ) : (
          <section className="review-card">
            <button
              className="quiet-button back-button"
              disabled={!!busy}
              onClick={async () => {
                if (
                  step === "review" &&
                  !(await confirm({
                    title: "Change material?",
                    description:
                      "Reading new material will replace your reviewed text and lesson preparation.",
                    confirmLabel: "Change material",
                    destructive: true,
                  }))
                )
                  return;
                setError("");
                setStep(step === "lesson" ? "review" : "material");
              }}
            >
              <ChevronLeft size={17} />{" "}
              {step === "lesson" ? t("Review material") : t("Change material")}
            </button>
            <div
              className="flow-progress"
              aria-label={t("Preparation progress")}
            >
              <span className="complete">
                <Check size={14} /> {t("Your material")}
              </span>
              <i />
              <span className={step === "review" ? "current" : "complete"}>
                {t("Review extraction")}
              </span>
              <i />
              <span className={step === "lesson" ? "current" : ""}>
                {t("Your lesson")}
              </span>
            </div>
            {step === "review" ? (
              <form noValidate onSubmit={reviewForm.handleSubmit(prepare)}>
                <h1 className="flow-heading" tabIndex={-1}>
                  {t("Does this look right?")}
                </h1>
                <p className="section-description">
                  {t("Review what we read from")}{" "}
                  <strong>{localizeText(material?.name ?? "")}</strong>
                  {t(
                    ". Correct unclear words or formulas before Milo learns from it.",
                  )}
                </p>
                <div className="source-list">
                  {sources.map((source, i) => (
                    <div className="source-section" key={source.id}>
                      <label className="field-label" htmlFor={`source-${i}`}>
                        <FileText size={15} />
                        {/^p\d+$/.test(source.id)
                          ? t("Page {page}", {
                              page: Number(source.id.slice(1)),
                            })
                          : /^Section \d+$/.test(source.label)
                            ? t("Section {section}", {
                                section: Number(source.id.slice(1)),
                              })
                            : localizeText(source.label)}
                      </label>
                      {source.warnings.map((w, n) => (
                        <p className="source-warning" key={n}>
                          {localizeText(w)}
                        </p>
                      ))}
                      <Controller
                        control={reviewForm.control}
                        name={`sources.${i}.text`}
                        render={({ field, fieldState }) => (
                          <>
                            <MarkdownEditor
                              id={`source-${i}`}
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              inputRef={field.ref}
                              name={field.name}
                              invalid={!!fieldState.error}
                              describedBy={
                                fieldState.error
                                  ? `source-${i}-error`
                                  : undefined
                              }
                              rows={Math.min(
                                12,
                                Math.max(4, source.text.split("\n").length),
                              )}
                            />
                            <FieldError
                              id={`source-${i}`}
                              message={fieldState.error?.message}
                            />
                          </>
                        )}
                      />
                    </div>
                  ))}
                </div>
                <div className="review-summary">
                  <span>
                    <Paperclip size={15} /> {sources.length} {t("source")}{" "}
                    {t(sources.length === 1 ? "section" : "sections")}
                  </span>
                  <span>
                    {sources
                      .reduce((n, s) => n + s.text.length, 0)
                      .toLocaleString(locale)}{" "}
                    {t("characters")}
                  </span>
                </div>
                {error && <ErrorNotice message={error} />}
                <FieldError
                  id="review-sources"
                  message={reviewForm.formState.errors.sources?.message}
                />
                <Controller
                  control={materialForm.control}
                  name="teachingLanguage"
                  render={({ field }) => (
                    <LanguageSelector
                      teaching
                      value={field.value}
                      onChange={(value) => {
                        languageChosen.current = true;
                        field.onChange(value);
                      }}
                      onBlur={field.onBlur}
                      disabled={!!busy}
                    />
                  )}
                />
                <button
                  className="primary-button"
                  disabled={!!busy}
                  type="submit"
                >
                  {busy ? (
                    <Spinner label={t("Preparing your lesson")} />
                  ) : (
                    <>
                      {t("Looks right. Find my lesson")}{" "}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              lesson && (
                <>
                  <div className="lesson-milo">
                    <Milo
                      size={80}
                      state={busy ? "thinking" : "idle"}
                      interactive
                    />
                    <span>{t("I’d love to learn about this.")}</span>
                  </div>
                  <h1
                    className="flow-heading"
                    tabIndex={-1}
                    lang={lessonLanguage(lesson.teachingLanguage)}
                  >
                    {lesson.title}
                  </h1>
                  <p
                    className="section-description"
                    lang={lessonLanguage(lesson.teachingLanguage)}
                  >
                    {lesson.scope}
                  </p>
                  <p className="muted">
                    {t("Teaching language: {language}", {
                      language:
                        teachingLanguageNames[lesson.teachingLanguage ?? "en"],
                    })}
                  </p>
                  <span className="level-chip">
                    <LevelIcon level={lesson.level} />
                    {localizeText(lesson.level)} {t("depth")}
                  </span>
                  <h2 className="objectives-heading">
                    {t("What you’ll help Milo understand")}
                  </h2>
                  <ul
                    className="lesson-objectives"
                    lang={lessonLanguage(lesson.teachingLanguage)}
                  >
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
                      <strong>{t("A few things to clarify")}</strong>
                      <p>
                        {t(
                          "These source uncertainties may leave some report criteria unscored. You can revise the material or explore the concept with Milo.",
                        )}
                      </p>
                      {lesson.concerns.map((c, i) => (
                        <p
                          key={i}
                          lang={lessonLanguage(lesson.teachingLanguage)}
                        >
                          {c}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="lesson-promise">
                    <MessageCircle size={20} />
                    <p>
                      {t(
                        "Teach at your own pace. When the ideas connect, Milo will offer a fresh challenge. You can end whenever you like.",
                      )}
                    </p>
                  </div>
                  <fieldset className="mode-field">
                    <legend>{t("How do you want to start?")}</legend>
                    {(
                      [
                        [
                          "correct",
                          "Correct Milo’s mix-up first",
                          "Milo starts with a common misunderstanding about this topic. Spot it and set Milo straight, then keep teaching.",
                        ],
                        [
                          "teach",
                          "Just start teaching",
                          "Teach Milo from scratch. Milo won’t bring up a misconception.",
                        ],
                      ] as const
                    ).map(([value, title, detail]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="session-mode"
                          value={value}
                          checked={sessionMode === value}
                          disabled={!!busy}
                          onChange={() => setSessionMode(value)}
                        />
                        <span className="mode-icon" aria-hidden="true">
                          {value === "correct" ? (
                            <Lightbulb size={18} />
                          ) : (
                            <MessageCircle size={18} />
                          )}
                        </span>
                        <span>
                          <strong>{t(title)}</strong>
                          <small>{t(detail)}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {error && <ErrorNotice message={error} />}
                  <button
                    type="button"
                    className="primary-button full-width"
                    disabled={!!busy}
                    aria-busy={busy === START_SESSION_BUSY}
                    onClick={start}
                  >
                    {busy === START_SESSION_BUSY ? (
                      <Spinner label={t(START_SESSION_BUSY)} />
                    ) : (
                      <>
                        {t("Let’s teach Milo")} <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  {busy === START_SESSION_BUSY && (
                    <p className="processing-note" role="status">
                      {localizeText(START_SESSION_BUSY)}
                    </p>
                  )}
                </>
              )
            )}
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>{t("Understanding grows when you explain.")}</span>
        <span>{t("Formative feedback · Sign in to save your sessions")}</span>
      </footer>
      {missing.length > 0 && (
        <div className="setup-note">
          <span>{t("Local setup needed")}</span> {t("Add")}{" "}
          {missing.join(t(" and "))} {t("in")} <code>.env.local</code>{" "}
          {t("to start a real session.")}
        </div>
      )}
      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title={t("Learn by teaching")}
      >
        <div className="help-steps">
          <p>
            <strong>{t("Bring your material.")}</strong>{" "}
            {t(
              "Upload a document or paste notes, then check the extracted content.",
            )}
          </p>
          <p>
            <strong>{t("Teach Milo.")}</strong>{" "}
            {t(
              "Explain the idea in your own words. His questions and a visual board help you make your reasoning concrete.",
            )}
          </p>
          <p>
            <strong>{t("Try it independently.")}</strong>{" "}
            {t(
              "Take a new application question with practice aids hidden, then see feedback linked to your own explanations.",
            )}
          </p>
          <p className="muted">
            {t(
              "Sessions and extracted content expire after seven days. Uploaded originals are discarded after extraction. Feedback is formative and can be imperfect.",
            )}
          </p>
        </div>
      </Modal>
    </div>
  );
}
