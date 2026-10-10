"use client";

import {
  BookOpen,
  History,
  LogIn,
  LogOut,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { Brand } from "./brand";
import { useAuth } from "./auth-context";

export function NavHeader({
  extraActions,
}: {
  extraActions?: React.ReactNode;
}) {
  const { user, loading, openAuthModal, openSessionModal, logout } = useAuth();

  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />

        <div className="header-actions">
          {extraActions}
          <button
            type="button"
            className="header-nav-button"
            onClick={openSessionModal}
            title="View saved learning sessions"
          >
            <History size={16} />
            <span className="button-text">My Sessions</span>
          </button>

          {!loading && (
            <>
              {user ? (
                <div className="user-profile-menu">
                  <div className="user-info-badge" title={user.email}>
                    {user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={user.avatarUrl}
                        alt={user.name}
                        className="user-avatar-image"
                      />
                    ) : (
                      <span className="user-avatar-fallback">
                        {user.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="user-display-name">{user.name}</span>
                  </div>

                  <button
                    type="button"
                    className="header-logout-button"
                    onClick={logout}
                    title="Log out"
                    aria-label="Log out"
                  >
                    <LogOut size={16} />
                    <span className="logout-text">Sign Out</span>
                  </button>
                </div>
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
        </div>
      </div>
    </header>
  );
}
