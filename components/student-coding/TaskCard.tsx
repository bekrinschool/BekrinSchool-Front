"use client";

import type { CodingExercise } from "@/lib/student";

interface TaskCardProps {
  task: CodingExercise;
  isSelected: boolean;
  onClick: () => void;
}

const difficultyLabels: Record<string, string> = {
  easy: "Asan",
  medium: "Orta",
  hard: "Çətin",
};

const difficultyClass: Record<string, string> = {
  easy: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  hard: "bg-red-100 text-red-700",
};

export function TaskCard({ task, isSelected, onClick }: TaskCardProps) {
  const statusBadge = task.solved
    ? "Həll edilib"
    : (task.attemptCount ?? 0) > 0
    ? "Cəhd edilib"
    : "Başlanmayıb";

  const statusClass = task.solved
    ? "bg-green-100 text-green-700"
    : (task.attemptCount ?? 0) > 0
    ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={`card cursor-pointer border-2 transition-colors text-left ${
        isSelected ? "border-primary-500 bg-primary-50/30" : "border-transparent hover:border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-lg font-semibold text-slate-900 flex-1 min-w-0">{task.title}</h3>
        <span className={`px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${statusClass}`}>
          {statusBadge}
        </span>
      </div>
      {task.topicName && (
        <p className="text-xs text-slate-500 mb-1">{task.topicName}</p>
      )}
      <p className="text-sm text-slate-600 mb-3 line-clamp-2">{task.description}</p>
      <div className="flex items-center justify-between text-sm flex-wrap gap-2">
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            difficultyClass[task.difficulty] ?? "bg-slate-100 text-slate-700"
          }`}
        >
          {difficultyLabels[task.difficulty] ?? task.difficulty}
        </span>
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          {(task.attemptCount ?? 0) > 0 && (
            <span>{task.attemptCount} cəhd</span>
          )}
          {task.lastSubmissionAt && (
            <span>{new Date(task.lastSubmissionAt).toLocaleDateString("az-AZ")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
