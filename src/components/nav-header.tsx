"use client";

import { useI18n } from "@/components/locale-context";
import { History, LogIn } from "lucide-react";
import { LanguageSelector } from "./language-selector";
import { Brand } from "./brand";
import { useAuth } from "./auth-context";
import { UserProfileMenu } from "./user-profile-menu";

export function NavHeader({
  extraActions,
}: {
  extraActions?: React.ReactNode;
}) {
  const { t } = useI18n();

  const { user, loading, openAuthModal, openSessionModal } = useAuth();

  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />

        <nav className="header-actions" aria-label={t("Main")}>
          <LanguageSelector />
          {extraActions}
          {user && (
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
                  onClick={() => openAuthModal("login")}
                >
                  <LogIn size={15} />
                  <span>{t("Sign In")}</span>
                </button>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
