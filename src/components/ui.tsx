"use client";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { AlertCircle, LoaderCircle, X } from "lucide-react";

export const draftStorage = {
  getItem(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* Continue when local storage is unavailable. */
    }
  },
  removeItem(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Continue when local storage is unavailable. */
    }
  },
};
export { api, ApiError } from "@/lib/api-client";
export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={19} />
      <div>
        {message}
        {onRetry && (
          <button className="text-button" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="loading-inline">
      <LoaderCircle className="spin" size={18} />
      {label}
    </span>
  );
}
export function Modal({
  open,
  onClose,
  title,
  children,
  role = "dialog",
  descriptionId,
  className = "",
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  role?: "dialog" | "alertdialog";
  descriptionId?: string;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) {
      dialog?.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog?.open) dialog.close();
  }, [open, initialFocusRef]);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      role={role}
      onPointerDown={(event) => {
        // A backdrop targets the dialog too; padding inside it should not dismiss.
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
      onCancel={onClose}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      aria-label={title}
      aria-describedby={descriptionId}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function useOperationId(scope = "preparation") {
  const operation = useRef<{ key: string; id: string } | null>(null);
  return (key: string) => {
    if (!operation.current) {
      try {
        operation.current = JSON.parse(
          sessionStorage.getItem(`operation:${scope}`) || "null",
        );
      } catch {
        /* A missing draft must not prevent a request. */
      }
    }
    if (operation.current?.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    try {
      sessionStorage.setItem(
        `operation:${scope}`,
        JSON.stringify(operation.current),
      );
    } catch {
      /* Storage may be disabled. */
    }
    return operation.current.id;
  };
}
