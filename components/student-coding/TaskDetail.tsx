"use client";

import { useState, useEffect } from "react";
import { Code, X } from "lucide-react";
import { Loading } from "@/components/Loading";
import { CodeEditor } from "./CodeEditor";
import { RunPanel } from "./RunPanel";
import { SubmitPanel } from "./SubmitPanel";
import { SubmissionHistory } from "./SubmissionHistory";
import {
  useTaskDetail,
  useSubmissions,
  useRunCode,
  useSubmitCode,
  useSubmissionDetail,
} from "@/hooks/useStudentCoding";

interface TaskDetailProps {
  taskId: string | null;
  code: string;
  onCodeChange: (code: string) => void;
  onClose: () => void;
}

const difficultyLabels: Record<string, string> = {
  easy: "Asan",
  medium: "Orta",
  hard: "Çətin",
};

export function TaskDetail({ taskId, code, onCodeChange, onClose }: TaskDetailProps) {
  const [submissionPage, setSubmissionPage] = useState(1);
  const [viewingSubmissionId, setViewingSubmissionId] = useState<number | null>(null);
  const [lastSubmitResult, setLastSubmitResult] = useState<{
    resultStatus: string;
    passedCount: number;
    totalCases: number;
    score?: number;
  } | null>(null);

  const { data: taskDetail, isLoading: detailLoading } = useTaskDetail(taskId);
  const { data: submissionsData, isLoading: submissionsLoading } = useSubmissions(
    taskId,
    submissionPage
  );
  const runMutation = useRunCode();
  const submitMutation = useSubmitCode();
  const { data: submissionDetail, isLoading: detailSubLoading } = useSubmissionDetail(
    taskId,
    viewingSubmissionId
  );

  useEffect(() => {
    if (taskDetail && taskId && String(taskDetail.id) === String(taskId) && code === "") {
      onCodeChange(taskDetail.starterCode || "");
    }
  }, [taskDetail, taskId, code, onCodeChange]);

  useEffect(() => {
    if (submitMutation.data) {
      setLastSubmitResult({
        resultStatus: submitMutation.data.resultStatus,
        passedCount: submitMutation.data.passedCount,
        totalCases: submitMutation.data.totalCases,
        score: submitMutation.data.score ?? undefined,
      });
    }
  }, [submitMutation.data]);

  if (!taskId) return null;
  if (detailLoading) return <Loading />;
  if (!taskDetail) return null;

  const submissions = submissionsData?.results ?? [];
  const totalCount = submissionsData?.count ?? 0;
  const hasNext = submissionsData?.next != null;
  const hasPrev = submissionsData?.previous != null;

  const handleRun = () => {
    runMutation.mutate({ taskId: Number(taskId), code });
  };

  const handleSubmit = () => {
    submitMutation.mutate({ taskId, code });
  };

  return (
    <div className="card space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Code className="w-5 h-5" />
          {taskDetail.title}
        </h2>
        <button type="button" onClick={onClose} className="btn-outline text-sm flex items-center gap-1">
          <X className="w-4 h-4" />
          Bağla
        </button>
      </div>

      <div className="prose prose-sm max-w-none">
        <p className="text-slate-600 whitespace-pre-wrap">{taskDetail.description}</p>
        {taskDetail.topicName && (
          <p className="text-xs text-slate-500">Mövzu: {taskDetail.topicName}</p>
        )}
        <p className="text-xs text-slate-500">
          Çətinlik: {difficultyLabels[taskDetail.difficulty] ?? taskDetail.difficulty} · Test
          sayı: {taskDetail.testCaseCount}
        </p>
      </div>

      <CodeEditor
        value={code}
        onChange={onCodeChange}
        placeholder={taskDetail.starterCode || "Kodunuzu yazın..."}
        minHeight="280px"
      />

      <div className="flex flex-wrap gap-4 items-start">
        <RunPanel
          onRun={handleRun}
          isRunning={runMutation.isPending}
          result={runMutation.data ?? null}
        />
        <SubmitPanel
          onSubmit={handleSubmit}
          isSubmitting={submitMutation.isPending}
          canSubmit={!!code.trim()}
          lastResult={lastSubmitResult}
        />
      </div>

      <SubmissionHistory
        submissions={submissions}
        isLoading={submissionsLoading}
        page={submissionPage}
        totalCount={totalCount}
        hasNext={hasNext}
        hasPrev={hasPrev}
        onPageChange={setSubmissionPage}
        onViewCode={setViewingSubmissionId}
        codeModalOpen={viewingSubmissionId != null}
        codeModalContent={submissionDetail?.submittedCode ?? null}
        codeModalLoading={detailSubLoading}
        onCloseCodeModal={() => setViewingSubmissionId(null)}
      />
    </div>
  );
}
