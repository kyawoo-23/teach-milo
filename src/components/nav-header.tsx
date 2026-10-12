"use client";

import { History, LogIn } from "lucide-react";
import { Brand } from "./brand";
import { useAuth } from "./auth-context";
import { UserProfileMenu } from "./user-profile-menu";

export function NavHeader({
  extraActions,
}: {
  extraActions?: React.ReactNode;
}) {
  const { user, loading, openAuthModal, openSessionModal } = useAuth();

  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />

        <nav className="header-actions" aria-label="Main">
          {extraActions}
          {user && (
            <button
              type="button"
              className="header-nav-button"
              onClick={openSessionModal}
              title="View saved learning sessions"
              aria-label="My Sessions"
            >
              <History size={16} />
              <span className="button-text">My Sessions</span>
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
                  <span>Sign In</span>
                </button>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
