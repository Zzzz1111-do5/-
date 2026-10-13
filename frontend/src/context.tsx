import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Meta } from "./types";

export type ColorScheme = "green-up" | "red-up";

interface AppState {
  meta: Meta | null;
  metaError: string | null;
  source: string;
  setSource: (s: string) => void;
  colorScheme: ColorScheme;
  setColorScheme: (c: ColorScheme) => void;
  colors: { up: string; down: string };
  reloadMeta: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式等情况下忽略
  }
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const GREEN = "#0ecb81";
const RED = "#f6465d";

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [source, setSourceState] = useState<string>(() => readString("cq.source") ?? "");
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(
    () => (readString("cq.colors") as ColorScheme) || "green-up",
  );

  const reloadMeta = useCallback(() => {
    setMetaError(null);
    api
      .meta()
      .then((m) => {
        setMeta(m);
        setSourceState((s) => (s && m.sources.some((x) => x.id === s) ? s : m.default_source));
      })
      .catch((e: Error) => setMetaError(e.message));
  }, []);

  useEffect(reloadMeta, [reloadMeta]);

  const setSource = useCallback((s: string) => {
    setSourceState(s);
    try {
      localStorage.setItem("cq.source", s);
    } catch {
      /* ignore */
    }
  }, []);

  const setColorScheme = useCallback((c: ColorScheme) => {
    setColorSchemeState(c);
    try {
      localStorage.setItem("cq.colors", c);
    } catch {
      /* ignore */
    }
  }, []);

  const colors = useMemo(
    () => (colorScheme === "green-up" ? { up: GREEN, down: RED } : { up: RED, down: GREEN }),
    [colorScheme],
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--up", colors.up);
    document.documentElement.style.setProperty("--down", colors.down);
  }, [colors]);

  const value = useMemo(
    () => ({ meta, metaError, source, setSource, colorScheme, setColorScheme, colors, reloadMeta }),
    [meta, metaError, source, setSource, colorScheme, setColorScheme, colors, reloadMeta],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}
