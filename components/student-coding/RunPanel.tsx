"use client";

import { Play } from "lucide-react";
import type { RunCodeResult } from "@/lib/student";

interface RunPanelProps {
  onRun: () => void;
  isRunning: boolean;
  result: RunCodeResult | null | undefined;
}

function runResultOutput(result: RunCodeResult): string {
  if (result.results && result.results.length > 0) {
    return result.results
      .map(
        (r, i) =>
          `Test ${i + 1}: ${r.passed ? "Keçdi" : "Səhv"}\nGiriş: ${(r.input || "").slice(0, 80)}${r.input && r.input.length > 80 ? "…" : ""}\nGözlənilən: ${(r.expected || "").slice(0, 80)}\nÇıxış: ${(r.actual ?? r.output ?? "(boş)").slice(0, 200)}`
      )
      .join("\n\n");
  }
  return result.output ?? "(boş)";
}

const isSuccess = (r: RunCodeResult) =>
  r.status === "OK" || r.status === "success" || (r.passedCount != null && r.totalCount != null && r.passedCount === r.totalCount);

export function RunPanel({ onRun, isRunning, result }: RunPanelProps) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onRun}
        disabled={isRunning}
        className="btn-outline flex items-center gap-2"
      >
        <Play className="w-4 h-4" />
        {isRunning ? "İcra olunur..." : "İcra et"}
      </button>
      {result && (
        <div
          className={`rounded-lg border p-3 text-sm font-mono whitespace-pre-wrap overflow-x-auto ${
            isSuccess(result)
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold">
              {isSuccess(result)
                ? `Nəticə: ${result.passedCount ?? "?"}/${result.totalCount ?? "?"} keçdi`
                : "Xəta"}
            </span>
            {result.execution_time_ms != null && (
              <span className="text-xs">{result.execution_time_ms} ms</span>
            )}
          </div>
          <pre className="m-0 text-xs">{runResultOutput(result)}</pre>
        </div>
      )}
    </div>
  );
}
