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
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [sessionModalOpen, setSessionModalOpen] = useState(false);

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
    void refreshUser();
    return () => {
      authGeneration.current++;
      authRead.current?.abort();
    };
  }, [refreshUser]);

  const beginAuthChange = () => {
    authRead.current?.abort();
    setLoading(false);
    return ++authGeneration.current;
  };
  const openAuthModal = useCallback((mode: "login" | "signup" = "login") => {
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
  };

  const logout = async () => {
    const generation = beginAuthChange();
    await api("/api/auth/logout", {});
    clearBoardDrafts(user?.id);
    if (generation !== authGeneration.current) return;
    setLoading(false);
    setSessionModalOpen(false);
    setUser(null);
  };

  const updateProfile = async (name: string) => {
    const generation = beginAuthChange();
    const res = await api<{ user: UserPublic }>(
      "/api/auth/profile",
      { name },
      "PATCH",
    );
    if (generation === authGeneration.current) setUser(res.user);
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
        signup,
        logout,
      }}
    >
      {children}
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
