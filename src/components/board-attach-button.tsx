"use client";

import type { MouseEventHandler } from "react";
import { ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { useI18n } from "./locale-context";
import styles from "./board-attach-button.module.css";

export function BoardAttachButton({
  attaching,
  attached,
  disabled,
  onClick,
}: {
  attaching: boolean;
  attached: boolean;
  disabled: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  return (
    <button
      className={`primary-button full-width ${styles.button} ${styles.attach}`}
      type="button"
      disabled={disabled || attaching}
      aria-busy={attaching}
      onClick={onClick}
    >
      {t(
        attaching
          ? "Attaching board…"
          : attached
            ? "Attached to your explanation"
            : "Attach to explanation",
      )}
      {attaching ? (
        <LoaderCircle size={17} className="board-spinner" aria-hidden="true" />
      ) : attached ? (
        <Check size={17} aria-hidden="true" />
      ) : (
        <ArrowUpRight size={17} aria-hidden="true" />
      )}
    </button>
  );
}
