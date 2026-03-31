"use client";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
}

export function CodeEditor({
  value,
  onChange,
  placeholder = "Kodunuzu yazın...",
  disabled = false,
  minHeight = "240px",
}: CodeEditorProps) {
  return (
    <textarea
      className="input font-mono text-sm w-full resize-y rounded-lg border border-slate-200 bg-slate-50/50 p-3 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      style={{ minHeight }}
      rows={12}
    />
  );
}
