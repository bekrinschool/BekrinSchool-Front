"use client";

import { useState, useMemo } from "react";
import { useCodingTasks, type CodingStatusFilter, type CodingSort } from "@/hooks/useStudentCoding";
import { FiltersRow } from "@/components/student-coding/FiltersRow";
import { TaskList } from "@/components/student-coding/TaskList";
import { TaskDetail } from "@/components/student-coding/TaskDetail";
import type { CodingExercise } from "@/lib/student";

export default function StudentCodingPage() {
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<CodingStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CodingSort>("newest");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const filters = useMemo(
    () => ({ topic: topicFilter, status: statusFilter, search, sort }),
    [topicFilter, statusFilter, search, sort]
  );
  const { data: tasks, isLoading, error } = useCodingTasks(filters);

  const topicOptions = useMemo(() => {
    const list = tasks ?? [];
    const byId = new Map<string, string>();
    list.forEach((t) => {
      if (t.topicId != null && t.topicName != null)
        byId.set(String(t.topicId), t.topicName);
    });
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks]);

  const openTask = (task: CodingExercise) => {
    setSelectedTaskId(String(task.id));
    setCode("");
  };

  const closeTask = () => {
    setSelectedTaskId(null);
    setCode("");
  };

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Kodlaşdırma Məşqlərim</h1>
        <p className="text-sm text-slate-600 mt-2">
          Python tapşırıqlarını həll edin, icra edin və göndərin
        </p>
      </div>

      <div className="mb-4">
        <FiltersRow
          topicFilter={topicFilter}
          onTopicChange={setTopicFilter}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={setSort}
          topicOptions={topicOptions}
        />
      </div>

      <TaskList
        tasks={tasks ?? []}
        selectedTaskId={selectedTaskId}
        onSelectTask={openTask}
        isLoading={isLoading}
        error={error ?? null}
      />

      {selectedTaskId && (
        <div className="mt-8">
          <TaskDetail
            taskId={selectedTaskId}
            code={code}
            onCodeChange={setCode}
            onClose={closeTask}
          />
        </div>
      )}
    </div>
  );
}
