"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CopyFeedback {
  key: string;
  ok: boolean;
}

export interface CopyControl {
  feedback: CopyFeedback | null;
  copy: (key: string, text: string) => void;
}

const FEEDBACK_MS = 1600;

export function useCopy(): CopyControl {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback((key: string, text: string) => {
    const settle = (ok: boolean): void => {
      setFeedback({ key, ok });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFeedback(null), FEEDBACK_MS);
    };
    // navigator.clipboard is absent on plain-http LAN previews; report it instead of throwing.
    if (!navigator.clipboard) {
      settle(false);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => settle(true),
      () => settle(false)
    );
  }, []);

  return { feedback, copy };
}

export function copyLabel(feedback: CopyFeedback | null, key: string, idle = "Copy"): string {
  if (feedback?.key !== key) return idle;
  return feedback.ok ? "Copied" : "Blocked";
}

export function copyState(feedback: CopyFeedback | null, key: string): "idle" | "copied" | "blocked" {
  if (feedback?.key !== key) return "idle";
  return feedback.ok ? "copied" : "blocked";
}
