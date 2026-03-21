"use client";
import { useEffect } from "react";
import { useWaiterStore } from "@/store/waiterStore";

export default function ThemeApplicator() {
  const theme = useWaiterStore((s) => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("theme-grey", "theme-light", "theme-beach");
    if (theme !== "dark") el.classList.add(`theme-${theme}`);
  }, [theme]);
  return null;
}
