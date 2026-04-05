"use client";

import { useCallback, useEffect, useRef } from "react";
import { Copy, RotateCcw } from "lucide-react";

const FONT_STACK =
  '"Fira Code", "Source Code Pro", ui-monospace, "Cascadia Code", "Segoe UI Mono", Menlo, Consolas, monospace';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
  /** Spaces inserted when Tab is pressed (default 2). */
  tabSize?: 2 | 4;
  /** Shown for “Reset to template”; if empty, reset is hidden unless showToolbar forces copy-only. */
  templateCode?: string;
  showToolbar?: boolean;
  /** When false, the copy button is hidden (e.g. bank JSON import). Default true. */
  showCopyButton?: boolean;
  /** Fires after user stops typing for this many ms (e.g. future auto-checks). Run/Submit stay manual. */
  debounceMs?: number;
  onDebouncedChange?: (value: string) => void;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  placeholder = "Kodunuzu yazın...",
  disabled = false,
  minHeight = "240px",
  tabSize = 2,
  templateCode = "",
  showToolbar = false,
  showCopyButton = true,
  debounceMs,
  onDebouncedChange,
  className = "",
}: CodeEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!debounceMs || !onDebouncedChange) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onDebouncedChange(value);
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, debounceMs, onDebouncedChange]);

  const indent = " ".repeat(tabSize);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Tab" || disabled) return;
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = value.slice(0, start) + indent + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + indent.length;
      });
    },
    [value, onChange, indent, disabled]
  );

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      taRef.current?.select();
      document.execCommand("copy");
    }
  }, [value]);

  const resetTemplate = useCallback(() => {
    onChange(templateCode);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [templateCode, onChange]);

  const showReset = Boolean(templateCode.length > 0);
  const toolbar = showToolbar || showReset;

  return (
    <div className={`space-y-2 ${className}`}>
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {showCopyButton && (
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy code
            </button>
          )}
          {showReset && (
            <button
              type="button"
              onClick={resetTemplate}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to template
            </button>
          )}
        </div>
      )}
      <textarea
        ref={taRef}
        className="input w-full resize-y rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
        style={{
          minHeight,
          fontFamily: FONT_STACK,
          tabSize,
        }}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={12}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />
    </div>
  );
}
