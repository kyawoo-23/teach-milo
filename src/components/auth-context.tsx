"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { UserPublic } from "@/lib/contracts";
import { api } from "./ui";

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

  const refreshUser = useCallback(async () => {
    try {
      const res = await api<{ user: UserPublic | null }>(
        "/api/auth/me",
        undefined,
        "GET",
      );
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

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
    const res = await api<{ user: UserPublic }>("/api/auth/login", {
      email,
      password,
    });
    setUser(res.user);
    setAuthModalOpen(false);
  };

  const signup = async (email: string, password: string, name: string) => {
    const res = await api<{ user: UserPublic }>("/api/auth/signup", {
      email,
      password,
      name,
    });
    setUser(res.user);
    setAuthModalOpen(false);
  };

  const logout = async () => {
    await api("/api/auth/logout", {});
    setUser(null);
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
