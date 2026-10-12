"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "./auth-context";
import { Modal, Spinner } from "./ui";

export function AuthModal() {
  return (
    <Suspense fallback={null}>
      <AuthModalContent />
    </Suspense>
  );
}

function AuthModalContent() {
  const {
    authModalOpen,
    closeAuthModal,
    authMode,
    setAuthMode,
    login,
    signup,
  } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const urlAuthError = searchParams.get("authError");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (authMode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (authMode === "login") {
        await login(email, password);
      } else {
        await signup(email, password, name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleGoogleLogin() {
    const returnTo = encodeURIComponent(pathname || "/");
    window.location.href = `/api/auth/google?returnTo=${returnTo}`;
  }

  return (
    <Modal
      open={authModalOpen || !!urlAuthError}
      onClose={() => {
        setShowPassword(false);
        setShowConfirmPassword(false);
        setConfirmPassword("");
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
          ? "Sign In to TeachBack"
          : "Create TeachBack Account"
      }
    >
      <div className="auth-modal-content">
        <div className="auth-tabs" role="group" aria-label="Account access">
          <button
            type="button"
            aria-pressed={authMode === "login"}
            className={`auth-tab ${authMode === "login" ? "auth-tab-active" : ""}`}
            onClick={() => {
              setAuthMode("login");
              setError("");
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            aria-pressed={authMode === "signup"}
            className={`auth-tab ${authMode === "signup" ? "auth-tab-active" : ""}`}
            onClick={() => {
              setAuthMode("signup");
              setError("");
            }}
          >
            Create Account
          </button>
        </div>

        {(error || urlAuthError) && (
          <div
            className="error-notice"
            role="alert"
            style={{ marginBottom: "1rem" }}
          >
            <AlertCircle size={18} />
            <span>{error || urlAuthError}</span>
          </div>
        )}

        <button
          type="button"
          className="google-button"
          onClick={handleGoogleLogin}
          disabled={busy}
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
          <span>Continue with Google</span>
        </button>

        <div className="auth-divider">
          <span>or with email</span>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {authMode === "signup" && (
            <div className="form-group">
              <label htmlFor="auth-name">Your Name</label>
              <div className="input-with-icon">
                <UserIcon size={16} className="input-icon" />
                <input
                  id="auth-name"
                  name="name"
                  autoComplete="name"
                  type="text"
                  required
                  placeholder="e.g. Marie Curie"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-email">Email Address</label>
            <div className="input-with-icon">
              <Mail size={16} className="input-icon" />
              <input
                id="auth-email"
                name="email"
                spellCheck={false}
                type="email"
                required
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <div className="input-with-icon">
              <Lock size={16} className="input-icon" />
              <input
                id="auth-password"
                name="password"
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
                  authMode === "signup" ? "At least 8 characters" : "••••••••"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-controls="auth-password"
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={busy}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {authMode === "signup" && (
            <div className="form-group">
              <label htmlFor="auth-confirm-password">Confirm Password</label>
              <div className="input-with-icon">
                <Lock size={16} className="input-icon" />
                <input
                  id="auth-confirm-password"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  className="password-input"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  required
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
                  aria-controls="auth-confirm-password"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  disabled={busy}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="primary-button full-width"
            style={{ marginTop: "1rem" }}
            disabled={busy}
          >
            {busy ? (
              <Spinner
                label={
                  authMode === "login" ? "Signing In…" : "Creating Account…"
                }
              />
            ) : authMode === "login" ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        <p className="auth-switch-prompt">
          {authMode === "login" ? (
            <>
              Don&apos;t have an account yet?{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setAuthMode("signup");
                  setError("");
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </Modal>
  );
}
