import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../api/axios";

const AuthContext = createContext(null);

export const DEMO_CREDENTIALS = [
  {
    role: "ADMIN",
    label: "Admin (Full Operations)",
    email: "admin@reconai.com",
    password: "AdminPassword123!",
    badgeColor: "emerald"
  },
  {
    role: "SHOP",
    label: "Merchant (Store Operator)",
    email: "shop@reconai.com",
    password: "ShopPassword123!",
    badgeColor: "indigo"
  },
  {
    role: "AUDITOR",
    label: "Auditor (Read-Only Compliance)",
    email: "auditor@reconai.com",
    password: "AuditorPassword123!",
    badgeColor: "amber"
  }
];

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("reconai_token"));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Authenticate with specific credentials
  const login = useCallback(async (identifier, password) => {
    try {
      const res = await api.post("/auth/login", { identifier, password });
      const newToken = res.data?.data?.token;
      const userData = res.data?.data?.user;
      if (newToken) {
        localStorage.setItem("reconai_token", newToken);
        setToken(newToken);
        setUser(userData);
        setIsLoginModalOpen(false);
        return { success: true, user: userData };
      }
      throw new Error("No token returned by server");
    } catch (err) {
      return { success: false, error: err.message || "Login failed" };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("reconai_token");
    setToken(null);
    setUser(null);
  }, []);

  // Check existing token or auto-login with default admin demo account on first load
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      const existingToken = localStorage.getItem("reconai_token");
      if (existingToken) {
        try {
          const res = await api.get("/auth/me");
          if (isMounted) {
            setUser(res.data?.data?.user);
            setLoading(false);
            return;
          }
        } catch {
          // Token invalid or expired, clear and attempt demo login
          localStorage.removeItem("reconai_token");
        }
      }

      // If no token in local dev environment, automatically sign in with default Admin demo account
      try {
        const res = await api.post("/auth/login", {
          identifier: "admin@reconai.com",
          password: "AdminPassword123!"
        });
        const autoToken = res.data?.data?.token;
        const userData = res.data?.data?.user;
        if (isMounted && autoToken) {
          localStorage.setItem("reconai_token", autoToken);
          setToken(autoToken);
          setUser(userData);
        }
      } catch {
        // Safe fallback - user can manually sign in
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initAuth();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        loading,
        isAuthenticated: !!token,
        login,
        logout,
        isLoginModalOpen,
        openLoginModal: () => setIsLoginModalOpen(true),
        closeLoginModal: () => setIsLoginModalOpen(false)
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
