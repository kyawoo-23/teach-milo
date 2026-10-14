"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { UserPublic } from "@/lib/contracts";
import { api } from "./ui";
import { clearBoardDrafts } from "@/lib/board-drafts";
import { signInWithPasskey, syncPasskeys } from "@/lib/passkeys";
import type { PasskeyList } from "@/lib/passkey-contracts";
import { prepareLocalAuth } from "@/lib/local-auth";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "./locale-context";
import { NotificationToast } from "./notification-toast";

type AuthContextType = {
  user: UserPublic | null;
  loading: boolean;
  authModalOpen: boolean;
  authMode: "login" | "signup";
  sessionModalOpen: boolean;
  openAuthModal: (mode?: "login" | "signup") => void;
  closeAuthModal: () => void;
  setAuthMode: (mode: "login" | "signup") => void;
  openSessionModal: () => void;
  closeSessionModal: () => void;
  refreshUser: () => Promise<void>;
  updateProfile: (name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginPasskey: (signal: AbortSignal, conditional?: boolean) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, errorText } = useI18n();
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const loggingOut = useRef(false);
  const returningHome = useRef(false);
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [sessionModalOpen, setSessionModalOpen] = useState(false);

  useEffect(() => {
    if (!notice || notice.error || (returningHome.current && pathname !== "/"))
      return;
    returningHome.current = false;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice, pathname]);

  useEffect(() => {
    if (loading || !user) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("signed-in") !== "1") return;
    setNotice({ message: t("You’re signed in."), error: false });
    url.searchParams.delete("signed-in");
    window.history.replaceState(window.history.state, "", url);
  }, [loading, user, t]);

  const authGeneration = useRef(0);
  const authRead = useRef<AbortController | null>(null);
  const refreshUser = useCallback(async () => {
    const generation = ++authGeneration.current;
    authRead.current?.abort();
    const controller = new AbortController();
    authRead.current = controller;
    try {
      const res = await api<{ user: UserPublic | null }>(
        "/api/auth/me",
        undefined,
        "GET",
        { signal: controller.signal },
      );
      if (generation === authGeneration.current) setUser(res.user);
    } catch {
      if (!controller.signal.aborted && generation === authGeneration.current)
        setUser(null);
    } finally {
      if (generation === authGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const generation = authGeneration.current;
    void prepareLocalAuth().then((ready) => {
      if (active && ready && generation === authGeneration.current)
        void refreshUser();
    });
    return () => {
      active = false;
      authGeneration.current++;
      authRead.current?.abort();
    };
  }, [refreshUser]);

  const beginAuthChange = useCallback(() => {
    authRead.current?.abort();
    setLoading(false);
    return ++authGeneration.current;
  }, []);
  const openAuthModal = useCallback((mode: "login" | "signup" = "login") => {
    // A protected page may request sign-in before the logout navigation commits.
    if (returningHome.current) return;
    setAuthMode(mode);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
  }, []);

  const openSessionModal = useCallback(() => {
    setSessionModalOpen(true);
  }, []);

  const closeSessionModal = useCallback(() => {
    setSessionModalOpen(false);
  }, []);

  const login = async (email: string, password: string) => {
    const generation = beginAuthChange();
    const res = await api<{ user: UserPublic }>("/api/auth/login", {
      email,
      password,
    });
    if (generation !== authGeneration.current) return;
    setLoading(false);
    setUser(res.user);
    setAuthModalOpen(false);
    setNotice({ message: t("You’re signed in."), error: false });
  };

  const signup = async (email: string, password: string, name: string) => {
    const generation = beginAuthChange();
    const res = await api<{ user: UserPublic }>("/api/auth/signup", {
      email,
      password,
      name,
    });
    if (generation !== authGeneration.current) return;
    setLoading(false);
    setUser(res.user);
    setAuthModalOpen(false);
    setNotice({ message: t("You’re signed in."), error: false });
  };

  const loginPasskey = useCallback(
    async (signal: AbortSignal, conditional = false) => {
      const generation = beginAuthChange();
      const res = await signInWithPasskey(signal, conditional);
      signal.throwIfAborted();
      if (generation !== authGeneration.current) return;
      setLoading(false);
      setUser(res.user);
      setAuthModalOpen(false);
      setNotice({ message: t("You’re signed in."), error: false });
    },
    [beginAuthChange, t],
  );

  const logout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    const generation = beginAuthChange();
    try {
      await api("/api/auth/logout", {});
      clearBoardDrafts(user?.id);
      if (generation !== authGeneration.current) return;
      setLoading(false);
      setAuthModalOpen(false);
      setSessionModalOpen(false);
      returningHome.current = true;
      setUser(null);
      setNotice({ message: t("You’re signed out."), error: false });
      router.replace("/", { scroll: true });
    } catch (error) {
      if (generation === authGeneration.current)
        setNotice({
          message: errorText(
            error instanceof Error
              ? error
              : new Error("Something went wrong. Please retry."),
          ),
          error: true,
        });
    } finally {
      loggingOut.current = false;
    }
  };

  const updateProfile = async (name: string) => {
    const generation = beginAuthChange();
    const res = await api<{ user: UserPublic }>(
      "/api/auth/profile",
      { name },
      "PATCH",
    );
    if (generation === authGeneration.current) {
      setUser(res.user);
      // Refresh the account details held by password managers after a rename.
      void api<PasskeyList>("/api/auth/passkeys")
        .then(syncPasskeys)
        .catch(() => {});
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authModalOpen,
        authMode,
        sessionModalOpen,
        openAuthModal,
        closeAuthModal,
        setAuthMode,
        openSessionModal,
        closeSessionModal,
        refreshUser,
        updateProfile,
        login,
        loginPasskey,
        signup,
        logout,
      }}
    >
      {children}
      {notice && (
        <NotificationToast
          message={notice.message}
          error={notice.error}
          onClose={() => setNotice(null)}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
