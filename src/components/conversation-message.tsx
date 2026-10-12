"use client";
import { memo, useEffect, useState } from "react";
import { Check, Copy, Layers3 } from "lucide-react";
import type { Message, UserPublic } from "@/lib/contracts";
import { Milo } from "./milo";

export const ConversationMessage = memo(function ConversationMessage({
  message,
  user,
}: {
  message: Message;
  user: UserPublic | null;
}) {
  return (
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
          {message.role === "student" ? "Milo" : "You"}
          {message.kind === "transfer" && (
            <small> Independent-check answer</small>
          )}
          {message.kind === "hint" && <small> A little nudge</small>}
        </span>
        <div className="message-bubble">
          <div className="message-text">{message.text}</div>
        </div>
        {message.role === "student" && <CopyButton text={message.text} />}
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
  );
});

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
      aria-label={copied ? "Copied" : "Copy Milo’s message"}
      title={copied ? "Copied" : "Copy"}
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
      <span className="visually-hidden">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
