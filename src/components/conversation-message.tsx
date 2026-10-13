"use client";

import { lessonLanguage, type TeachingLanguage } from "@/lib/i18n/locales";
import { useI18n } from "@/components/locale-context";
import { memo, useEffect, useState } from "react";
import { Check, Copy, Layers3 } from "lucide-react";
import type { Message, UserPublic } from "@/lib/contracts";
import { Milo } from "./milo";
import { BoardPreview } from "./board-preview";

export const ConversationMessage = memo(function ConversationMessage({
  message,
  previousMessage,
  user,
  teachingLanguage,
}: {
  message: Message;
  previousMessage?: Message;
  teachingLanguage?: TeachingLanguage;
  user: UserPublic | null;
}) {
  const { t } = useI18n();
  const showTimestamp =
    !previousMessage ||
    Date.parse(message.createdAt) - Date.parse(previousMessage.createdAt) >=
      15 * 60 * 1000;

  return (
    <>
      {showTimestamp && <MessageTimestamp createdAt={message.createdAt} />}
      <article
        key={message.id}
        id={`message-${message.id}`}
        className={`message ${message.role}`}
      >
        <div className="message-avatar">
          {message.role === "student" ? (
            <Milo size={34} animated={false} />
          ) : (
            <LearnerMessageAvatar user={user} />
          )}
        </div>
        <div className="message-body">
          <span className="message-name">
            {message.role === "student" ? "Milo" : t("You")}
            {message.kind === "transfer" && (
              <small> {t("Independent-check answer")}</small>
            )}
            {message.kind === "hint" && <small> {t("A little nudge")}</small>}
          </span>
          <div className="message-bubble">
            <div
              className="message-text"
              lang={
                message.role === "student"
                  ? lessonLanguage(teachingLanguage)
                  : undefined
              }
            >
              {message.text}
            </div>
          </div>
          {message.role === "student" && (
            <div className="message-footer">
              <CopyButton text={message.text} />
            </div>
          )}
          {message.board && (
            <div className="shared-board-preview">
              <div className="shared-board">
                <Layers3 size={15} />
                <span>{t("Demonstration shared")}</span>
              </div>
              <BoardPreview snapshot={message.board} />
            </div>
          )}
        </div>
      </article>
    </>
  );
});

function MessageTimestamp({ createdAt }: { createdAt: string }) {
  const { locale } = useI18n();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const timestamp = Date.parse(createdAt);
  // Render after mounting so server and browser clocks/time zones cannot disagree.
  if (now === null || !Number.isFinite(timestamp)) return null;

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds < 60
      ? [seconds, "second"]
      : seconds < 3600
        ? [Math.floor(seconds / 60), "minute"]
        : seconds < 86_400
          ? [Math.floor(seconds / 3600), "hour"]
          : [Math.floor(seconds / 86_400), "day"];
  const fullDate = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);

  return (
    <time className="message-timestamp" dateTime={createdAt} title={fullDate}>
      {new Intl.RelativeTimeFormat(locale, {
        style: "narrow",
        numeric: "always",
      }).format(-value, unit)}
    </time>
  );
}

function LearnerMessageAvatar({ user }: { user: UserPublic | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = user?.avatarUrl;
  if (avatarUrl && !imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className="message-avatar-image"
        width={29}
        height={29}
        onError={() => setImageFailed(true)}
      />
    );
  }
  const fallbackLabel = user?.name ? user.name.charAt(0).toUpperCase() : "You";
  return (
    <span className="message-avatar-fallback" aria-hidden="true">
      {fallbackLabel}
    </span>
  );
}
function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="message-copy"
      aria-label={copied ? t("Copied") : t("Copy Milo’s message")}
      title={copied ? t("Copied") : t("Copy")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard API blocked (e.g. embedded frames): fall back to a hidden textarea.
          const area = document.createElement("textarea");
          area.value = text;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          if (document.execCommand("copy")) setCopied(true);
          area.remove();
        }
      }}
    >
      {copied ? (
        <Check size={12} strokeWidth={2} />
      ) : (
        <Copy size={12} strokeWidth={2} />
      )}
      <span className="visually-hidden">
        {copied ? t("Copied") : t("Copy")}
      </span>
    </button>
  );
}
