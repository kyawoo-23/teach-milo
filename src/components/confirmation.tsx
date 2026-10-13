"use client";

import { useI18n } from "@/components/locale-context";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Modal, ModalFooter } from "./ui";

type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};
type RequestConfirmation = (
  options: ConfirmationOptions,
  signal?: AbortSignal,
) => Promise<boolean>;
const ConfirmationContext = createContext<RequestConfirmation | null>(null);

export function ConfirmationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t, text: localizeText } = useI18n();

  const descriptionId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [request, setRequest] = useState<
    (ConfirmationOptions & { id: number }) | null
  >(null);
  const nextId = useRef(0);
  const pending = useRef<{
    id: number;
    resolve: (confirmed: boolean) => void;
    cleanup: () => void;
  } | null>(null);

  const finish = useCallback((id: number, confirmed: boolean) => {
    if (pending.current?.id !== id) return;
    const current = pending.current;
    pending.current = null;
    current.cleanup();
    setRequest(null);
    current.resolve(confirmed);
  }, []);

  const confirm = useCallback<RequestConfirmation>(
    (options, signal) => {
      if (pending.current || signal?.aborted) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const id = ++nextId.current;
        const abort = () => finish(id, false);
        pending.current = {
          id,
          resolve,
          cleanup: () => signal?.removeEventListener("abort", abort),
        };
        signal?.addEventListener("abort", abort, { once: true });
        setRequest({ ...options, id });
      });
    },
    [finish],
  );

  useEffect(
    () => () => {
      const current = pending.current;
      pending.current = null;
      current?.cleanup();
      current?.resolve(false);
    },
    [],
  );

  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          key={request.id}
          open
          title={request.title}
          role="alertdialog"
          descriptionId={descriptionId}
          className="confirmation-modal"
          initialFocusRef={cancelButton}
          onClose={() => finish(request.id, false)}
        >
          <p id={descriptionId}>{localizeText(request.description)}</p>
          <ModalFooter>
            <div className="modal-actions confirmation-actions">
              <button
                ref={cancelButton}
                type="button"
                className="secondary-button"
                onClick={() => finish(request.id, false)}
              >
                {request.cancelLabel ?? t("Cancel")}
              </button>
              <button
                type="button"
                className={
                  request.destructive ? "danger-button" : "primary-button"
                }
                onClick={() => finish(request.id, true)}
              >
                {localizeText(request.confirmLabel)}
              </button>
            </div>
          </ModalFooter>
        </Modal>
      )}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm)
    throw new Error("useConfirmation requires ConfirmationProvider");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current?.abort();
  }, []);
  return useCallback(
    (options: ConfirmationOptions) =>
      confirm(options, controller.current?.signal),
    [confirm],
  );
}
