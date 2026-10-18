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
import { AuthIdentity, GuestPublic, UserPublic } from "@/lib/contracts";
import { api } from "./ui";
import { clearBoardDrafts, moveBoardDrafts } from "@/lib/board-drafts";
import { signInWithPasskey, syncPasskeys } from "@/lib/passkeys";
import type { PasskeyList } from "@/lib/passkey-contracts";
import { prepareLocalAuth } from "@/lib/local-auth";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "./locale-context";
import { NotificationToast } from "./notification-toast";

type AuthContextType = {
  user: UserPublic | null;
  guest: GuestPublic | null;
  ownerId?: string;
  syncing: boolean;
  ensureLearningIdentity: () => Promise<string>;
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

function preparationOwner(ownerId?: string, transferredFrom?: string) {
  try {
    const previous = sessionStorage.getItem("teach-milo:preparation-owner");
    if (
      !ownerId ||
      (previous && previous !== ownerId && previous !== transferredFrom)
    ) {
      sessionStorage.removeItem("operation:preparation");
      window.dispatchEvent(new Event("teach-milo-preparation-reset"));
    }
    if (ownerId) sessionStorage.setItem("teach-milo:preparation-owner", ownerId);
    else sessionStorage.removeItem("teach-milo:preparation-owner");
  } catch {
    // In-memory operation IDs still work when browser storage is unavailable.
  }
}

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
  const [guest, setGuest] = useState<GuestPublic | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncRetry, setSyncRetry] = useState(0);
  const identityCreation = useRef<Promise<string> | null>(null);
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
  const currentGuest = useRef(guest);
  currentGuest.current = guest;
  const settleIdentity = useCallback(
    async (res: AuthIdentity, generation: number, signal?: AbortSignal) => {
      const fromOwnerId = res.claim?.fromOwnerId ?? currentGuest.current?.id;
      if (res.user && fromOwnerId) moveBoardDrafts(fromOwnerId, res.user.id);
      if (res.user && res.claim) {
        setSyncing(true);
        setLoading(true);
        // Drafts have moved before the final request clears the cookie, so a
        // lost response cannot lose the source owner for local drafts.
        let status = res.claim.status;
        do {
          if (generation !== authGeneration.current) return;
          const claim = await api<{ status: "pending" | "complete" }>(
            "/api/auth/guest/claim",
            {},
            "POST",
            { signal },
          );
          status = claim.status;
        } while (status !== "complete");
      }
      if (generation !== authGeneration.current) return;
      preparationOwner(res.user?.id ?? res.guest?.id, fromOwnerId);
      setUser(res.user);
      setGuest(res.user ? null : (res.guest ?? null));
      setSyncing(false);
      setSyncRetry(0);
      setLoading(false);
    },
    [],
  );

  const refreshUser = useCallback(async () => {
    const generation = ++authGeneration.current;
    authRead.current?.abort();
    const controller = new AbortController();
    authRead.current = controller;
    try {
      const res = await api<AuthIdentity>("/api/auth/me", undefined, "GET", {
        signal: controller.signal,
      });
      if (generation === authGeneration.current)
        await settleIdentity(res, generation, controller.signal);
    } catch {
      if (!controller.signal.aborted && generation === authGeneration.current) {
        setLoading(false);
        setSyncRetry((n) => n + 1);
      }
    }
  }, [settleIdentity]);

  useEffect(() => {
    if (!syncing || !syncRetry) return;
    const timer = setTimeout(() => void refreshUser(), 5000);
    return () => clearTimeout(timer);
  }, [syncing, syncRetry, refreshUser]);

  // Cookies can change in another tab or during a redirect. Never create a
  // guest here: identity creation belongs to an explicit learning action.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshUser();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshUser]);

  const ensureLearningIdentity = async (): Promise<string> => {
    if (syncing) throw new Error("Moving your guest work to your account…");
    if (user || guest) return (user ?? guest)!.id;
    if (identityCreation.current) return identityCreation.current;
    const generation = ++authGeneration.current;
    authRead.current?.abort();
    const create = async () => {
      await api<AuthIdentity>("/api/auth/guest", {});
      const res = await api<AuthIdentity>("/api/auth/me");
      const id = res.user?.id ?? res.guest?.id;
      if (!id)
        throw new Error(
          "Allow cookies in this browser to start a guest lesson.",
        );
      if (generation !== authGeneration.current)
        throw new Error(
          "Your browser access changed. Refresh to continue or start a new lesson.",
        );
      await settleIdentity(res, generation);
      return id;
    };
    // Web Locks coordinate first use across tabs when supported. Same-tab
    // callers always share this promise, including browsers without Web Locks.
    identityCreation.current = (
      navigator.locks
        ? navigator.locks.request("teach-milo-guest", create)
        : create()
    ).finally(() => {
      identityCreation.current = null;
    });
    return identityCreation.current;
  };

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
    const res = await api<AuthIdentity>("/api/auth/login", {
      email,
      password,
    });
    if (generation !== authGeneration.current) return;
    setAuthModalOpen(false);
    try {
      await settleIdentity(res, generation);
    } catch (error) {
      setSyncRetry((n) => n + 1);
      throw error;
    }
    setNotice({ message: t("You’re signed in."), error: false });
  };

  const signup = async (email: string, password: string, name: string) => {
    const generation = beginAuthChange();
    const res = await api<AuthIdentity>("/api/auth/signup", {
      email,
      password,
      name,
    });
    if (generation !== authGeneration.current) return;
    setAuthModalOpen(false);
    try {
      await settleIdentity(res, generation);
    } catch (error) {
      setSyncRetry((n) => n + 1);
      throw error;
    }
    setNotice({ message: t("You’re signed in."), error: false });
  };

  const loginPasskey = useCallback(
    async (signal: AbortSignal, conditional = false) => {
      const generation = beginAuthChange();
      const res = await signInWithPasskey(signal, conditional);
      signal.throwIfAborted();
      if (generation !== authGeneration.current) return;
      setAuthModalOpen(false);
      try {
        await settleIdentity(res, generation);
      } catch (error) {
        setSyncRetry((n) => n + 1);
        throw error;
      }
      setNotice({ message: t("You’re signed in."), error: false });
    },
    [beginAuthChange, settleIdentity, t],
  );

  const logout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    const generation = beginAuthChange();
    try {
      await api("/api/auth/logout", {});
      preparationOwner();
      clearBoardDrafts(user?.id ?? guest?.id);
      if (generation !== authGeneration.current) return;
      setLoading(false);
      setAuthModalOpen(false);
      setSessionModalOpen(false);
      returningHome.current = true;
      setUser(null);
      setGuest(null);
      setSyncing(false);
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
        guest,
        ownerId: syncing ? undefined : (user?.id ?? guest?.id),
        syncing,
        ensureLearningIdentity,
        loading: loading || syncing,
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
      {syncing && (
        <NotificationToast
          message={t("Moving your guest work to your account…")}
          error={false}
        />
      )}
      {!syncing && notice && (
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
