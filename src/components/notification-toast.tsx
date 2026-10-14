"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { useI18n } from "./locale-context";

export function NotificationToast({
  message,
  error,
  onClose,
}: {
  message: string;
  error: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Older browsers use the same fixed-position layout without top-layer promotion.
    if (ref.current && "showPopover" in ref.current) ref.current.showPopover();
  }, []);

  return (
    <div ref={ref} popover="manual" className="notification-toast">
      {error ? (
        <CircleAlert size={20} aria-hidden="true" />
      ) : (
        <CheckCircle2 size={20} aria-hidden="true" />
      )}
      <p role={error ? "alert" : "status"} aria-atomic="true">
        {message}
      </p>
      <button
        type="button"
        className="icon-button"
        aria-label={t("Close notification")}
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
