"use client";

import { Send } from "lucide-react";

interface SubmitPanelProps {
  onSubmit: () => void;
  isSubmitting: boolean;
  canSubmit: boolean;
  lastResult?: {
    resultStatus: string;
    passedCount: number;
    totalCases: number;
    score?: number;
  } | null;
}

export function SubmitPanel({
  onSubmit,
  isSubmitting,
  canSubmit,
  lastResult,
}: SubmitPanelProps) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || isSubmitting}
        className="btn-primary flex items-center gap-2"
      >
        <Send className="w-4 h-4" />
        {isSubmitting ? "Göndərilir..." : "Göndər"}
      </button>
      {lastResult && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            lastResult.resultStatus === "passed"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-amber-50 border-amber-200 text-amber-800"
          }`}
        >
          <span className="font-medium">
            {lastResult.resultStatus === "passed" ? "Keçdi" : lastResult.resultStatus}
          </span>{" "}
          ({lastResult.passedCount}/{lastResult.totalCases})
          {lastResult.score != null && ` — ${lastResult.score} xal`}
        </div>
      )}
    </div>
  );
}
