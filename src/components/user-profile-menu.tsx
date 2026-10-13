"use client";

import { useI18n } from "@/components/locale-context";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { UserPublic } from "@/lib/contracts";
import { useConfirmation } from "./confirmation";
import { useAuth } from "./auth-context";
import { AccountSettings } from "./account-settings";

export function UserProfileMenu({
  user,
  variant = "header",
}: {
  user: UserPublic;
  variant?: "header" | "session";
}) {
  const { t } = useI18n();

  const confirm = useConfirmation();
  const { logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const compact = variant === "session";

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      // Keep the menu trigger mounted while a native modal owns focus.
      if (document.querySelector("dialog[open]")) return;
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setProfileOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        setProfileOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  const triggerClass = compact
    ? "user-profile-badge-small user-profile-trigger"
    : "user-info-badge user-profile-trigger";
  const nameClass = compact ? "user-name-small" : "user-display-name";
  const avatarSize = compact ? 22 : 26;
  const avatarImageClass = compact
    ? "user-avatar-image-small"
    : "user-avatar-image";
  const avatarFallbackClass = compact
    ? "user-avatar-fallback-small"
    : "user-avatar-fallback";

  return (
    <div className="user-profile-menu" ref={profileRef}>
      <button
        type="button"
        className={triggerClass}
        title={user.email}
        aria-expanded={profileOpen}
        aria-haspopup="menu"
        aria-label={t("Open account menu")}
        onClick={() => setProfileOpen((open) => !open)}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className={avatarImageClass}
            width={avatarSize}
            height={avatarSize}
          />
        ) : (
          <span className={avatarFallbackClass} aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className={nameClass}>{user.name}</span>
        <ChevronDown
          size={compact ? 12 : 14}
          className={`user-profile-chevron${profileOpen ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {profileOpen && (
        <div className="user-profile-dropdown" role="menu">
          <div className="user-profile-dropdown-meta">
            <span className="user-profile-dropdown-name">{user.name}</span>
            <span className="user-profile-dropdown-email">{user.email}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="user-profile-dropdown-item"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={16} aria-hidden="true" />
            <span>{t("Account settings")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="user-profile-dropdown-item"
            onClick={async () => {
              if (
                await confirm({
                  title: "Sign out?",
                  description:
                    "Your saved sessions will remain available when you sign in again.",
                  confirmLabel: "Sign out",
                  cancelLabel: "Stay signed in",
                })
              ) {
                setProfileOpen(false);
                void logout();
              }
            }}
            title={t("Log out")}
            aria-label={t("Log out")}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{t("Sign out")}</span>
          </button>
        </div>
      )}
      {settingsOpen && (
        <AccountSettings user={user} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
