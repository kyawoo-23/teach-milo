"use client";

import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, Pencil, Trash2, X } from "lucide-react";
import { api } from "@/lib/api-client";
import type { PasskeyList, PasskeySummary } from "@/lib/passkey-contracts";
import {
  createPasskey,
  isPasskeyCancellation,
  passkeysSupported,
  syncPasskeys,
} from "@/lib/passkeys";
import { useI18n } from "./locale-context";
import { Spinner } from "./ui";

export function PasskeySettings() {
  const { t, errorText, locale } = useI18n();
  const [data, setData] = useState<PasskeyList | null>(null);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    setSupported(passkeysSupported());
    const controller = new AbortController();
    void api<PasskeyList>("/api/auth/passkeys", undefined, "GET", {
      signal: controller.signal,
    })
      .then((result) => {
        setData(result);
        void syncPasskeys(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err);
      });
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, []);

  async function mutate(
    action: (signal: AbortSignal) => Promise<PasskeyList>,
    message: string,
  ) {
    if (operation.current) return false;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      const result = await action(controller.signal);
      if (controller.signal.aborted) return false;
      setData(result);
      setStatus(message);
      void syncPasskeys(result);
      return true;
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          isPasskeyCancellation(err)
            ? new Error("Passkey creation was cancelled. You can try again.")
            : err instanceof Error
              ? err
              : new Error("Something went wrong. Please retry."),
        );
      return false;
    } finally {
      operation.current = null;
      setBusy(false);
    }
  }

  return (
    <section className="passkey-settings" aria-label={t("Passkeys")}>
      <p className="account-settings-help">
        {t(
          "Use your fingerprint, face, or device PIN to sign in without a password. Create an account first, then add a passkey here.",
        )}
      </p>
      <p className="account-settings-help">
        {t("Managing passkeys requires a sign-in within the last 10 minutes.")}
      </p>
      {error && (
        <p className="error-notice" role="alert">
          {errorText(error)}
        </p>
      )}
      <p className="account-settings-status" role="status">
        {status}
      </p>
      {!data && !error && <Spinner label={t("Loading")} />}
      {data &&
        (data.passkeys.length ? (
          <ul className="passkey-list">
            {data.passkeys.map((key) => (
              <PasskeyRow
                key={key.id}
                passkey={key}
                busy={busy}
                locale={locale}
                rename={(value) =>
                  mutate(
                    (signal) =>
                      api<PasskeyList>(
                        `/api/auth/passkeys/${key.id}`,
                        { name: value },
                        "PATCH",
                        { signal },
                      ),
                    t("Passkey renamed."),
                  )
                }
                remove={() =>
                  void mutate(
                    (signal) =>
                      api<PasskeyList>(
                        `/api/auth/passkeys/${key.id}`,
                        {},
                        "DELETE",
                        { signal },
                      ),
                    t("Passkey removed."),
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <p className="account-settings-help">{t("No passkeys yet.")}</p>
        ))}
      {supported ? (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(async (signal) => {
              const result = await createPasskey(name.trim(), signal);
              setName("");
              return result;
            }, t("Passkey added."));
          }}
        >
          <div className="form-group">
            <label htmlFor="passkey-name">{t("Passkey name")}</label>
            <div className="input-with-icon">
              <input
                id="passkey-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
                disabled={busy || !data}
                autoComplete="off"
                placeholder={t("e.g. Personal laptop")}
              />
            </div>
          </div>
          <button
            className="primary-button full-width"
            type="submit"
            disabled={busy || !data || !name.trim()}
          >
            {busy ? (
              <Spinner label={t("Saving…")} />
            ) : (
              <>
                <KeyRound size={16} aria-hidden="true" />
                {t("Add passkey")}
              </>
            )}
          </button>
        </form>
      ) : (
        <p className="account-settings-help">
          {t(
            "Passkeys need a supported browser on HTTPS or localhost. You can still sign in with email or Google.",
          )}
        </p>
      )}
    </section>
  );
}

function PasskeyRow({
  passkey,
  busy,
  locale,
  rename,
  remove,
}: {
  passkey: PasskeySummary;
  busy: boolean;
  locale: string;
  rename: (name: string) => Promise<boolean>;
  remove: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(passkey.name);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      editButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);

  function finishEditing() {
    restoreFocus.current = true;
    setEditing(false);
  }

  return (
    <li className="passkey-row">
      <KeyRound className="passkey-symbol" size={18} aria-hidden="true" />
      <div className="passkey-details">
        {editing ? (
          <form
            className="passkey-rename"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !name.trim() || name.trim() === passkey.name) return;
              if (await rename(name.trim())) finishEditing();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                if (!busy) finishEditing();
              }
            }}
          >
            <input
              ref={input}
              aria-label={t("Rename passkey {name}", { name: passkey.name })}
              name="passkey-name"
              autoComplete="off"
              enterKeyHint="done"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              disabled={busy}
            />
            <button
              type="submit"
              className="icon-button"
              disabled={busy || !name.trim() || name.trim() === passkey.name}
              aria-label={t("Save passkey name")}
              title={t("Save passkey name")}
            >
              <Check size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={t("Cancel")}
              title={t("Cancel")}
              onClick={finishEditing}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <div className="passkey-heading">
            <span className="passkey-name" title={passkey.name}>
              {passkey.name}
            </span>
            <button
              ref={editButton}
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={t("Rename passkey {name}", { name: passkey.name })}
              title={t("Rename passkey {name}", { name: passkey.name })}
              onClick={() => {
                setName(passkey.name);
                setConfirmRemove(false);
                setEditing(true);
              }}
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <p className="account-settings-help">
          {t("Added {date}", {
            date: new Date(passkey.createdAt).toLocaleDateString(locale),
          })}
        </p>
        {passkey.lastUsedAt && (
          <p className="account-settings-help">
            {t("Last used {date}", {
              date: new Date(passkey.lastUsedAt).toLocaleDateString(locale),
            })}
          </p>
        )}
        {confirmRemove && (
          <div className="passkey-remove-confirm">
            <p className="account-settings-help">
              {t(
                "Remove this passkey? You can still sign in with email or Google.",
              )}
            </p>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={remove}
            >
              {t("Remove passkey")}
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => setConfirmRemove(false)}
            >
              {t("Cancel")}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="icon-button"
        disabled={busy || editing}
        aria-label={t("Remove passkey {name}", { name: passkey.name })}
        title={t("Remove passkey {name}", { name: passkey.name })}
        aria-expanded={confirmRemove}
        onClick={() => setConfirmRemove((value) => !value)}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </li>
  );
}
