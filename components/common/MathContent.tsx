"use client";

import Latex from "react-latex-next";
import { Component, type ReactNode } from "react";

type UniversalLatexProps = {
  content?: string | null;
  className?: string;
};

function sanitizeLatexInput(value: string): string {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

class LatexErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // graceful fallback for malformed latex
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function UniversalLatex({ content, className }: UniversalLatexProps) {
  const raw = typeof content === "string" ? content : "";
  const text = sanitizeLatexInput(raw);
  if (!text.trim()) return null;
  return (
    <div className={className} style={{ whiteSpace: "pre-wrap" }}>
      <LatexErrorBoundary fallback={<span>{text}</span>}>
        <Latex>{text}</Latex>
      </LatexErrorBoundary>
    </div>
  );
}

export const MathContent = UniversalLatex;

