"use client";
import { useEffect, useRef } from "react";
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
export class ApiError extends Error {
  constructor(
    message: string,
    public code = "ERROR",
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : method,
    cache: "no-store",
    headers:
      body instanceof FormData
        ? undefined
        : body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError("The connection was interrupted. Please retry.");
  }
  if (!response.ok)
    throw new ApiError(
      result.error?.message || "Something went wrong. Please retry.",
      result.error?.code,
    );
  return result;
}
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClose={onClose}
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
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
