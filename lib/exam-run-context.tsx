"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type ExamRunContextValue = {
  isExamRunning: boolean;
  setExamRunning: (running: boolean) => void;
};

const ExamRunContext = createContext<ExamRunContextValue | null>(null);

export function ExamRunProvider({ children }: { children: ReactNode }) {
  const [isExamRunning, setExamRunning] = useState(false);
  const value: ExamRunContextValue = {
    isExamRunning,
    setExamRunning: useCallback((running: boolean) => setExamRunning(running), []),
  };
  return <ExamRunContext.Provider value={value}>{children}</ExamRunContext.Provider>;
}

export function useExamRun(): ExamRunContextValue {
  const ctx = useContext(ExamRunContext);
  if (!ctx) {
    return {
      isExamRunning: false,
      setExamRunning: () => {},
    };
  }
  return ctx;
}
