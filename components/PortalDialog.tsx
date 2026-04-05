"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type PortalDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** If false, backdrop click does not close (e.g. blocking alerts) */
  closeOnBackdrop?: boolean;
  /** If false, hide X and Escape (anticheat / suspended). */
  showCloseButton?: boolean;
};

/**
 * Modal in a portal without touching document.body overflow/position (avoids scrollbar/layout shift).
 */
export function PortalDialog({
  open,
  onClose,
  title,
  children,
  size = "md",
  closeOnBackdrop = true,
  showCloseButton = true,
}: PortalDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !showCloseButton) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, showCloseButton]);

  if (!mounted || !open) return null;

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative my-auto flex max-h-[min(90dvh,900px)] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl ${sizeClasses[size]}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {showCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Bağla"
            >
              <X className="h-5 w-5" />
            </button>
          ) : (
            <span className="w-9" aria-hidden />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
