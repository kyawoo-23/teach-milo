"use client";

import { useI18n } from "@/components/locale-context";
import { History, UserRound } from "lucide-react";
import { HeaderPreferences } from "./header-preferences";
import { Brand } from "./brand";
import { useAuth } from "./auth-context";
import { UserProfileMenu } from "./user-profile-menu";

export function NavHeader({
  extraActions,
}: {
  extraActions?: React.ReactNode;
}) {
  const { t } = useI18n();

  const { user, guest, ownerId, loading, openAuthModal, openSessionModal } =
    useAuth();

  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />

        <nav className="header-actions" aria-label={t("Main")}>
          <HeaderPreferences showTheme={!user} />
          {extraActions}
          {ownerId && (
            <button
              type="button"
              className="header-nav-button"
              onClick={openSessionModal}
              title={t("View saved learning sessions")}
              aria-label={t("My Sessions")}
            >
              <History size={16} />
              <span className="button-text">{t("My Sessions")}</span>
            </button>
          )}

          {!loading && (
            <>
              {user ? (
                <UserProfileMenu user={user} />
              ) : (
                <button
                  type="button"
                  className="header-auth-button"
                  aria-label={guest ? t("Guest mode") : t("Sign In")}
                  aria-description={guest ? t("Guest") : undefined}
                  onClick={() => openAuthModal("login")}
                >
                  <UserRound size={17} aria-hidden="true" />
                  <span>{guest ? t("Guest mode") : t("Sign In")}</span>
                </button>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
