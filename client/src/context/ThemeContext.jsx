import React, { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  // Check localStorage, then system preference, default to 'night'
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("reconai-theme");
    if (saved === "day" || saved === "night") return saved;
    if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "day";
    }
    return "night";
  });

  useEffect(() => {
    localStorage.setItem("reconai-theme", theme);
    const root = document.documentElement;
    const body = document.body;

    if (theme === "day") {
      root.classList.remove("dark", "theme-night");
      root.classList.add("light", "theme-day");
      body.classList.remove("bg-[#080808]", "text-[#FAFAF9]");
      body.classList.add("bg-[#FAFAF7]", "text-[#181818]");
    } else {
      root.classList.remove("light", "theme-day");
      root.classList.add("dark", "theme-night");
      body.classList.remove("bg-[#FAFAF7]", "text-[#181818]");
      body.classList.add("bg-[#080808]", "text-[#FAFAF9]");
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "night" ? "day" : "night"));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isNight: theme === "night", isDay: theme === "day" }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
