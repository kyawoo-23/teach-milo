"use client";

import { useI18n } from "@/components/locale-context";
import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
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
  message: string | Error;
  onRetry?: () => void;
}) {
  const { t, errorText } = useI18n();

  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={19} />
      <div>
        {errorText(message)}
        {onRetry && (
          <button className="text-button" onClick={onRetry}>
            {t("Try again")}
          </button>
        )}
      </div>
    </div>
  );
}
export function Spinner({ label = "Loading" }: { label?: string }) {
  const { text: localizeText } = useI18n();
  return (
    <span className="loading-inline">
      <LoaderCircle className="spin" size={18} />
      {localizeText(label)}
    </span>
  );
}
export function ModalFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`modal-footer${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

function splitModalChildren(children: ReactNode) {
  const body: ReactNode[] = [];
  const footers: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (
      isValidElement(child) &&
      (child as ReactElement<{ children?: ReactNode }>).type === ModalFooter
    ) {
      footers.push(child);
    } else if (child !== null && child !== undefined) {
      body.push(child);
    }
  });
  return { body, footers };
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
  children: ReactNode;
  role?: "dialog" | "alertdialog";
  descriptionId?: string;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t, text: localizeText } = useI18n();

  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) dialog.close();
  }, [open, initialFocusRef, mounted]);
  const { body, footers } = splitModalChildren(children);
  const dialog = (
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
      onCancel={(event) => {
        // Escape dismisses the top dialog, including an editor inside a board.
        event.stopPropagation();
        onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
        if (!event.currentTarget.open) onClose();
      }}
      aria-label={localizeText(title)}
      aria-describedby={descriptionId}
    >
      <div className="modal-heading">
        <h2>{localizeText(title)}</h2>
        <button
          type="button"
          className="icon-button modal-close"
          aria-label={t("Close dialog")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {body.length > 0 && <div className="modal-body">{body}</div>}
      {footers}
    </dialog>
  );
  if (!mounted) return null;
  return createPortal(dialog, document.body);
}
export function useOperationId(scope = "preparation") {
  const operation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (scope !== "preparation") return;
    const reset = () => {
      operation.current = null;
    };
    window.addEventListener("teach-milo-preparation-reset", reset);
    return () =>
      window.removeEventListener("teach-milo-preparation-reset", reset);
  }, [scope]);
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
