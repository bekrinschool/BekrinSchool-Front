"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType, options?: { duration?: number }) => void;
  success: (message: string, options?: { duration?: number }) => void;
  error: (message: string, options?: { duration?: number }) => void;
  info: (message: string, options?: { duration?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = "info", options?: { duration?: number }) => {
    const id = Math.random().toString(36).slice(2);
    const duration = options?.duration ?? 4000;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const success = useCallback((message: string, options?: { duration?: number }) => show(message, "success", options), [show]);
  const error = useCallback((message: string, options?: { duration?: number }) => show(message, "error", options), [show]);
  const info = useCallback((message: string, options?: { duration?: number }) => show(message, "info", options), [show]);

  return (
    <ToastContext.Provider value={{ show, success, error, info }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 shadow-lg text-sm font-medium text-white ${
              t.type === "success"
                ? "bg-green-600"
                : t.type === "error"
                ? "bg-red-600"
                : "bg-slate-700"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
    };
  }
  return ctx;
}
