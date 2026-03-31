"use client";

import { useRef, useEffect, useCallback } from "react";

const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 2000;

export interface AutoExpandTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
}

/**
 * Textarea that expands vertically as the user types, for long-form exam answers.
 * Prevents compression and keeps layout stable; no answer length restriction.
 */
export function AutoExpandTextarea({
  value,
  onChange,
  minHeight = MIN_HEIGHT_PX,
  maxHeight = MAX_HEIGHT_PX,
  className = "",
  ...rest
}: AutoExpandTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [minHeight, maxHeight]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e);
    requestAnimationFrame(adjustHeight);
  };

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={handleChange}
      className={className}
      style={{ minHeight, overflowY: "auto", resize: "none" }}
      {...rest}
    />
  );
}
