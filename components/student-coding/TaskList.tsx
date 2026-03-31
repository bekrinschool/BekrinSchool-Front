"use client";

import { TaskCard } from "./TaskCard";
import type { CodingExercise } from "@/lib/student";

interface TaskListProps {
  tasks: CodingExercise[];
  selectedTaskId: string | null;
  onSelectTask: (task: CodingExercise) => void;
  isLoading: boolean;
  error: Error | null;
}

export function TaskList({ tasks, selectedTaskId, onSelectTask, isLoading, error }: TaskListProps) {
  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-red-600">Xəta: {error.message}</p>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card animate-pulse h-40 bg-slate-100" />
        ))}
      </div>
    );
  }
  if (!tasks || tasks.length === 0) {
    return (
      <div className="card p-12 text-center text-slate-500">
        Tapşırıq tapılmadı
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tasks.map((task) => (
        <TaskCard
          key={String(task.id)}
          task={task}
          isSelected={String(task.id) === String(selectedTaskId)}
          onClick={() => onSelectTask(task)}
        />
      ))}
    </div>
  );
}
