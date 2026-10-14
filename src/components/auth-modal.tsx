"use client";

import { useI18n } from "@/components/locale-context";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  KeyRound,
  Mail,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "./auth-context";
import { Modal, Spinner } from "./ui";
import { authFormSchema } from "@/lib/form-schemas";
import { FieldError, useSchemaForm } from "./schema-form";
import {
  conditionalPasskeysSupported,
  isPasskeyCancellation,
  passkeysSupported,
} from "@/lib/passkeys";

export function AuthModal() {
  return (
    <Suspense fallback={null}>
      <AuthModalContent />
    </Suspense>
  );
}

function AuthModalContent() {
  const { t, errorText } = useI18n();

  const {
    authModalOpen,
    closeAuthModal,
    authMode,
    setAuthMode,
    login,
    loginPasskey,
    signup,
  } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const form = useSchemaForm(authFormSchema(authMode === "signup"), {
    email: "",
    password: "",
    name: "",
    confirmPassword: "",
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;
  useEffect(() => {
    form.clearErrors();
  }, [authMode, form.clearErrors]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [autofillAttempt, setAutofillAttempt] = useState(0);
  const autofill = useRef<AbortController | null>(null);
  const passkeyPrompt = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | Error>("");

  const urlAuthError = searchParams.get("authError");
  const modalOpen = authModalOpen || !!urlAuthError;
  const working = busy || passkeyBusy;

  useEffect(() => {
    setPasskeySupported(passkeysSupported());
  }, []);
  useEffect(() => {
    if (!modalOpen || authMode !== "login" || working) return;
    const controller = new AbortController();
    autofill.current = controller;
    // Renew before the server challenge expires, even if autofill stays pending.
    const timer = setTimeout(
      () => setAutofillAttempt((value) => value + 1),
      4 * 60_000,
    );
    void (async () => {
      if (!(await conditionalPasskeysSupported()) || controller.signal.aborted)
        return;
      await loginPasskey(controller.signal, true);
    })().catch((err) => {
      if (!controller.signal.aborted && !isPasskeyCancellation(err))
        setError(err instanceof Error ? err : "Authentication failed.");
    });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [modalOpen, authMode, working, autofillAttempt, loginPasskey]);
  useEffect(
    () => () => {
      passkeyPrompt.current?.abort();
    },
    [modalOpen, authMode],
  );

  async function passkeyLogin() {
    if (working || passkeyPrompt.current) return;
    autofill.current?.abort();
    const controller = new AbortController();
    passkeyPrompt.current = controller;
    setPasskeyBusy(true);
    setError("");
    try {
      await loginPasskey(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          isPasskeyCancellation(err)
            ? "Passkey sign-in was cancelled. Try again or use another sign-in method."
            : err instanceof Error
              ? err
              : "Authentication failed.",
        );
    } finally {
      passkeyPrompt.current = null;
      setPasskeyBusy(false);
    }
  }

  async function submit({ email, password, name }: typeof form.values) {
    if (working) return;
    autofill.current?.abort();
    setBusy(true);
    setError("");
    try {
      if (authMode === "login") {
        await login(email, password);
      } else {
        await signup(email, password, name);
      }
      form.setValue("password", "");
      form.setValue("confirmPassword", "");
    } catch (err) {
      setError(err instanceof Error ? err : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleGoogleLogin() {
    autofill.current?.abort();
    const returnTo = encodeURIComponent(pathname || "/");
    window.location.href = `/api/auth/google?returnTo=${returnTo}`;
  }

  return (
    <Modal
      open={modalOpen}
      onClose={() => {
        autofill.current?.abort();
        passkeyPrompt.current?.abort();
        setShowPassword(false);
        setShowConfirmPassword(false);
        form.setValue("confirmPassword", "");
        form.setValue("password", "");
        form.clearErrors();
        setError("");
        closeAuthModal();
        if (urlAuthError) {
          const url = new URL(window.location.href);
          url.searchParams.delete("authError");
          window.history.replaceState(
            {},
            "",
            url.pathname + (url.search ? url.search : ""),
          );
        }
      }}
      title={
        authMode === "login"
          ? t("Sign In to TeachBack")
          : t("Create TeachBack Account")
      }
    >
      <div className="auth-modal-content">
        <div
          className="auth-tabs"
          role="group"
          aria-label={t("Account access")}
        >
          <button
            type="button"
            aria-pressed={authMode === "login"}
            disabled={working}
            className={`auth-tab ${authMode === "login" ? "auth-tab-active" : ""}`}
            onClick={() => {
              setAuthMode("login");
              setError("");
            }}
          >
            {t("Sign In")}
          </button>
          <button
            type="button"
            aria-pressed={authMode === "signup"}
            disabled={working}
            className={`auth-tab ${authMode === "signup" ? "auth-tab-active" : ""}`}
            onClick={() => {
              setAuthMode("signup");
              setError("");
            }}
          >
            {t("Create Account")}
          </button>
        </div>

        {(error || urlAuthError) && (
          <div
            className="error-notice"
            role="alert"
            style={{ marginBottom: "1rem" }}
          >
            <AlertCircle size={18} />
            <span>{errorText(error || urlAuthError || "")}</span>
          </div>
        )}

        <button
          type="button"
          className="google-button"
          onClick={handleGoogleLogin}
          disabled={working}
        >
          <svg
            className="google-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>{t("Continue with Google")}</span>
        </button>

        {authMode === "login" && passkeySupported && (
          <button
            type="button"
            className="secondary-button full-width"
            onClick={() => void passkeyLogin()}
            disabled={working}
          >
            {passkeyBusy ? (
              <Spinner label={t("Signing In…")} />
            ) : (
              <>
                <KeyRound size={18} aria-hidden="true" />
                {t("Sign in with a passkey")}
              </>
            )}
          </button>
        )}

        <div className="auth-divider">
          <span>{t("or with email")}</span>
        </div>

        <form noValidate onSubmit={handleSubmit(submit)} className="auth-form">
          {authMode === "signup" && (
            <div className="form-group">
              <label htmlFor="auth-name">{t("Your Name")}</label>
              <div className="input-with-icon">
                <UserIcon size={16} className="input-icon" />
                <input
                  id="auth-name"
                  {...register("name")}
                  {...form.a11y("name", "auth-name")}
                  autoComplete="name"
                  type="text"
                  required
                  placeholder={t("e.g. Marie Curie")}
                  disabled={working}
                />
              </div>
              <FieldError id="auth-name" message={errors.name?.message} />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-email">{t("Email Address")}</label>
            <div className="input-with-icon">
              <Mail size={16} className="input-icon" />
              <input
                id="auth-email"
                {...register("email")}
                {...form.a11y("email", "auth-email")}
                spellCheck={false}
                type="email"
                required
                autoComplete={
                  authMode === "login" ? "username webauthn" : "username"
                }
                placeholder="name@example.com"
                disabled={working}
              />
            </div>
            <FieldError id="auth-email" message={errors.email?.message} />
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">{t("Password")}</label>
            <div className="input-with-icon">
              <Lock size={16} className="input-icon" />
              <input
                id="auth-password"
                {...register("password")}
                {...form.a11y("password", "auth-password")}
                type={showPassword ? "text" : "password"}
                className="password-input"
                spellCheck={false}
                autoCapitalize="none"
                required
                autoComplete={
                  authMode === "login" ? "current-password" : "new-password"
                }
                minLength={authMode === "signup" ? 8 : undefined}
                placeholder={
                  authMode === "signup"
                    ? t("At least 8 characters")
                    : "••••••••"
                }
                disabled={working}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={
                  showPassword ? t("Hide password") : t("Show password")
                }
                aria-controls="auth-password"
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={working}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
            <FieldError id="auth-password" message={errors.password?.message} />
          </div>

          {authMode === "signup" && (
            <div className="form-group">
              <label htmlFor="auth-confirm-password">
                {t("Confirm Password")}
              </label>
              <div className="input-with-icon">
                <Lock size={16} className="input-icon" />
                <input
                  id="auth-confirm-password"
                  {...register("confirmPassword")}
                  {...form.a11y("confirmPassword", "auth-confirm-password")}
                  type={showConfirmPassword ? "text" : "password"}
                  className="password-input"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  required
                  placeholder={t("Re-enter your password")}
                  disabled={working}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={
                    showConfirmPassword
                      ? t("Hide confirm password")
                      : t("Show confirm password")
                  }
                  aria-controls="auth-confirm-password"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  disabled={working}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
              <FieldError
                id="auth-confirm-password"
                message={errors.confirmPassword?.message}
              />
            </div>
          )}

          <button
            type="submit"
            className="primary-button full-width"
            style={{ marginTop: "1rem" }}
            disabled={working}
          >
            {busy ? (
              <Spinner
                label={
                  authMode === "login"
                    ? t("Signing In…")
                    : t("Creating Account…")
                }
              />
            ) : authMode === "login" ? (
              t("Sign In")
            ) : (
              t("Create Account")
            )}
          </button>
        </form>

        <p className="auth-switch-prompt">
          {authMode === "login" ? (
            <>
              {t("Don't have an account yet?")}{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setAuthMode("signup");
                  setError("");
                }}
              >
                {t("Sign up")}
              </button>
            </>
          ) : (
            <>
              {t("Already have an account?")}{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
              >
                {t("Sign in")}
              </button>
            </>
          )}
        </p>
      </div>
    </Modal>
  );
}
