"use client";

import { useId, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { UpdateProfileSchema, type UserPublic } from "@/lib/contracts";
import { PasswordFormSchema } from "@/lib/form-schemas";
import { useI18n } from "./locale-context";
import { useAuth } from "./auth-context";
import { FieldError, useSchemaForm } from "./schema-form";
import { api, Modal, Spinner } from "./ui";

export function AccountSettings({
  user,
  onClose,
}: {
  user: UserPublic;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const { updateProfile } = useAuth();
  const tabId = useId();
  const [activeTab, setActiveTab] = useState<"profile" | "password">("profile");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const profile = useSchemaForm(UpdateProfileSchema, { name: user.name });
  const password = useSchemaForm(PasswordFormSchema, {
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState<"profile" | "password" | null>(null);
  const saving = useRef(false);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const [passwordError, setPasswordError] = useState<Error | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  async function saveProfile(input: typeof profile.values) {
    if (saving.current) return;
    saving.current = true;
    setBusy("profile");
    setProfileError(null);
    setProfileSaved(false);
    try {
      await updateProfile(input.name);
      profile.reset(input);
      setProfileSaved(true);
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error
          : new Error("Something went wrong. Please retry."),
      );
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }

  async function savePassword(input: typeof password.values) {
    if (saving.current) return;
    saving.current = true;
    setBusy("password");
    setPasswordError(null);
    setPasswordSaved(false);
    try {
      await api("/api/auth/password", {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      });
      password.reset();
      setShowPasswords(false);
      setPasswordSaved(true);
    } catch (error) {
      setPasswordError(
        error instanceof Error
          ? error
          : new Error("Something went wrong. Please retry."),
      );
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }

  const passwordFields = [
    {
      name: "currentPassword",
      id: "current-password",
      label: "Current password",
      autoComplete: "current-password",
    },
    {
      name: "newPassword",
      id: "new-password",
      label: "New password",
      autoComplete: "new-password",
    },
    {
      name: "confirmPassword",
      id: "confirm-password",
      label: "Confirm Password",
      autoComplete: "new-password",
    },
  ] as const;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Account settings")}
      className="account-settings-modal"
    >
      <div className="account-settings-content">
        <div
          className="auth-tabs"
          role="tablist"
          aria-label={t("Account settings")}
        >
          {(["profile", "password"] as const).map((tab, index) => (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${tabId}-${tab}-tab`}
              aria-controls={`${tabId}-${tab}-panel`}
              aria-selected={activeTab === tab}
              tabIndex={activeTab === tab ? 0 : -1}
              className={`auth-tab${activeTab === tab ? " auth-tab-active" : ""}`}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 1
                      : 1 - index;
                setActiveTab(next === 0 ? "profile" : "password");
                tabRefs.current[next]?.focus();
              }}
            >
              {t(tab === "profile" ? "Profile" : "Change password")}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${tabId}-profile-panel`}
          aria-labelledby={`${tabId}-profile-tab`}
          hidden={activeTab !== "profile"}
          tabIndex={0}
        >
          <form
            className="auth-form"
            noValidate
            onSubmit={profile.handleSubmit(saveProfile)}
          >
            <fieldset disabled={!!busy}>
              <legend>{t("Profile")}</legend>
              <div className="form-group">
                <label htmlFor="profile-name">{t("Display name")}</label>
                <div className="input-with-icon">
                  <input
                    id="profile-name"
                    {...profile.register("name")}
                    {...profile.a11y("name", "profile-name")}
                    autoComplete="name"
                    required
                    maxLength={80}
                  />
                </div>
                <FieldError
                  id="profile-name"
                  message={profile.formState.errors.name?.message}
                />
              </div>
              <div className="form-group">
                <label htmlFor="profile-email">{t("Email Address")}</label>
                <div className="input-with-icon">
                  <input
                    id="profile-email"
                    type="email"
                    value={user.email}
                    readOnly
                    autoComplete="username"
                    aria-describedby="profile-email-help"
                  />
                </div>
                <p id="profile-email-help" className="account-settings-help">
                  {t("Your email address cannot be changed.")}
                </p>
              </div>
              {profileError && (
                <p className="error-notice" role="alert">
                  {errorText(profileError)}
                </p>
              )}
              <p role="status" className="account-settings-status">
                {profileSaved &&
                  !profile.formState.isDirty &&
                  t("Profile updated.")}
              </p>
              <button type="submit" className="primary-button full-width">
                {busy === "profile" ? (
                  <Spinner label={t("Saving…")} />
                ) : (
                  t("Save profile")
                )}
              </button>
            </fieldset>
          </form>
        </div>

        <div
          role="tabpanel"
          id={`${tabId}-password-panel`}
          aria-labelledby={`${tabId}-password-tab`}
          hidden={activeTab !== "password"}
          tabIndex={0}
        >
          {user.hasPassword ? (
            <form
              className="auth-form"
              noValidate
              onSubmit={password.handleSubmit(savePassword)}
            >
              <fieldset disabled={!!busy}>
                <legend>{t("Change password")}</legend>
                <p className="account-settings-help">
                  {t(
                    "Use at least 8 characters. Other browsers will be signed out.",
                  )}
                </p>
                <input
                  type="hidden"
                  name="username"
                  value={user.email}
                  autoComplete="username"
                />
                {passwordFields.map((field) => (
                  <div className="form-group" key={field.name}>
                    <label htmlFor={field.id}>{t(field.label)}</label>
                    <div className="input-with-icon">
                      <input
                        id={field.id}
                        {...password.register(field.name)}
                        {...password.a11y(field.name, field.id)}
                        type={showPasswords ? "text" : "password"}
                        autoComplete={field.autoComplete}
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        minLength={field.name === "newPassword" ? 8 : undefined}
                        maxLength={1024}
                      />
                    </div>
                    <FieldError
                      id={field.id}
                      message={password.formState.errors[field.name]?.message}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary-button"
                  aria-pressed={showPasswords}
                  onClick={() => setShowPasswords((value) => !value)}
                >
                  {showPasswords ? (
                    <EyeOff size={16} aria-hidden="true" />
                  ) : (
                    <Eye size={16} aria-hidden="true" />
                  )}
                  {showPasswords ? t("Hide password") : t("Show password")}
                </button>
                {passwordError && (
                  <p className="error-notice" role="alert">
                    {errorText(passwordError)}
                  </p>
                )}
                <p role="status" className="account-settings-status">
                  {passwordSaved &&
                    !password.formState.isDirty &&
                    t("Password updated.")}
                </p>
                <button type="submit" className="primary-button full-width">
                  {busy === "password" ? (
                    <Spinner label={t("Saving…")} />
                  ) : (
                    t("Update password")
                  )}
                </button>
              </fieldset>
            </form>
          ) : (
            <section aria-label={t("Change password")}>
              <h3>{t("Change password")}</h3>
              <p className="account-settings-help">
                {t(
                  "Your password is managed by Google. Change it in your Google account.",
                )}
              </p>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
