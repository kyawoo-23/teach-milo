"use client";

import { useI18n } from "@/components/locale-context";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { UserPublic } from "@/lib/contracts";
import { useConfirmation } from "./confirmation";
import { useAuth } from "./auth-context";
import { AccountSettings } from "./account-settings";
import { ThemeInlinePicker } from "./theme-selector";

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
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const profileRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
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

  useLayoutEffect(() => {
    if (!profileOpen) return;
    const menu = profileRef.current;
    const dropdown = dropdownRef.current;
    if (!menu || !dropdown) return;

    const place = () => {
      const anchor = menu.getBoundingClientRect();
      const width = dropdown.offsetWidth;
      const height = dropdown.offsetHeight;
      const margin = 16;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      let left = anchor.right - width;
      if (left < margin) left = margin;
      if (left + width > viewportWidth - margin) {
        left = Math.max(margin, viewportWidth - margin - width);
      }
      const below = anchor.bottom + 8;
      const above = anchor.top - height - 8;
      const top =
        below + height > viewportHeight - margin && above >= margin
          ? above - anchor.top
          : below - anchor.top;
      const next = {
        left: left - anchor.left,
        right: "auto",
        top,
      } satisfies CSSProperties;
      setDropdownStyle((current) =>
        current.left === next.left &&
        current.right === next.right &&
        current.top === next.top
          ? current
          : next,
      );
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
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
        <div
          className="user-profile-dropdown"
          role="menu"
          ref={dropdownRef}
          style={dropdownStyle}
        >
          <div className="user-profile-dropdown-meta">
            <span className="user-profile-dropdown-name">{user.name}</span>
            <span className="user-profile-dropdown-email">{user.email}</span>
          </div>
          <div className="user-profile-dropdown-section">
            <span className="user-profile-dropdown-section-label">
              {t("Theme")}
            </span>
            <ThemeInlinePicker />
          </div>
          <button
            ref={settingsTriggerRef}
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
        <AccountSettings
          user={user}
          onClose={() => {
            setSettingsOpen(false);
            requestAnimationFrame(() => settingsTriggerRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}
