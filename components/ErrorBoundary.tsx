"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="card max-w-md text-center">
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              Xəta baş verdi
            </h2>
            <p className="text-slate-600 mb-6">
              Tətbiq gözlənilməz xəta ilə qarşılaşdı. Səhifəni yeniləyin və yenidən cəhd edin.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Səhifəni yenilə
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
