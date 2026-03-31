"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Check, Circle, Eye, X } from "lucide-react";

function StatusIcon({ status }: { status?: string }) {
  if (status === "correct") {
    return <Check className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden />;
  }
  if (status === "partial") {
    return <Circle className="w-5 h-5 text-amber-500 shrink-0 fill-amber-100" aria-hidden />;
  }
  if (status === "pending") {
    return <Circle className="w-5 h-5 text-slate-400 shrink-0" aria-hidden />;
  }
  if (status === "blank") {
    return <Circle className="w-5 h-5 text-slate-300 shrink-0" aria-hidden />;
  }
  return <X className="w-5 h-5 text-rose-600 shrink-0" aria-hidden />;
}

export default function StudentResultsPage() {
  const [typeFilter, setTypeFilter] = useState<"all" | "quiz" | "exam">("all");
  const [archiveOnly, setArchiveOnly] = useState(false);
  const [scoreModal, setScoreModal] = useState<{ examId: number; attemptId: number } | null>(null);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["student", "exam-results", typeFilter, archiveOnly],
    queryFn: () =>
      studentApi.getMyExamResults({
        ...(typeFilter !== "all" ? { type: typeFilter } : {}),
        published_only: archiveOnly,
      }),
  });

  const { data: scoreSummary, isLoading: scoreLoading } = useQuery({
    queryKey: ["student", "exam-result-summary", scoreModal?.examId, scoreModal?.attemptId],
    queryFn: () =>
      studentApi.getExamResult(scoreModal!.examId, scoreModal!.attemptId, { mode: "score_summary" }),
    enabled: scoreModal != null,
  });

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Nəticələr</h1>
        <p className="text-sm text-slate-600 mt-2">
          Verilmiş imtahan və quizlərin nəticələri
        </p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-slate-900">İmtahan nəticələrim</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setArchiveOnly(false)}
              className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                !archiveOnly ? "bg-primary text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
              }`}
            >
              Hamısı
            </button>
            <button
              type="button"
              onClick={() => setArchiveOnly(true)}
              className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                archiveOnly ? "bg-primary text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
              }`}
            >
              Köhnə imtahanlar
            </button>
            <span className="text-slate-400 mx-1">|</span>
            {(["all", "quiz", "exam"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded text-sm font-medium transition-all duration-200 ease-in-out ${
                  typeFilter === t
                    ? "bg-primary text-white shadow-sm"
                    : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
                }`}
              >
                {t === "all" ? "Hamısı" : t === "quiz" ? "Quiz" : "İmtahan"}
              </button>
            ))}
          </div>
        </div>

        {results.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">İmtahan adı</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Bal</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Tarix</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.attemptId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">{r.title}</td>
                    <td className="py-3 px-4 text-sm">
                      {r.is_result_published && r.score != null ? (
                        <span className="font-semibold text-slate-900">{r.score}</span>
                      ) : (
                        <span className="text-amber-600">Yoxlanılır...</span>
                      )}
                      <span className="text-slate-500"> / {r.maxScore}</span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {r.finishedAt ? new Date(r.finishedAt).toLocaleDateString("az-AZ") : "—"}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {r.is_result_published ? (
                        <span className="text-green-600">Yayımlanıb</span>
                      ) : (
                        <span className="text-amber-600">Yoxlanılır</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {r.is_result_published && (
                        <button
                          type="button"
                          onClick={() => setScoreModal({ examId: r.examId, attemptId: r.attemptId })}
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <Eye className="w-4 h-4" /> Cavaba bax
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500">
            İmtahan nəticəsi tapılmadı
          </div>
        )}
      </div>

      <Modal
        isOpen={!!scoreModal}
        onClose={() => setScoreModal(null)}
        title={scoreSummary?.title ?? "Bal üzrə xülasə"}
        size="lg"
      >
        {scoreLoading && <p className="text-slate-500 py-6">Yüklənir...</p>}
        {!scoreLoading && scoreSummary && scoreSummary.questions && scoreSummary.questions.length > 0 && (
          <div className="space-y-4">
            <p className="text-base font-semibold text-slate-900">
              Yekun bal: {Math.max(0, Number(scoreSummary.score ?? 0)).toFixed(1)} / {scoreSummary.maxScore ?? "—"}
            </p>
            <div className="max-h-[70vh] overflow-y-auto space-y-3 pr-1">
              {scoreSummary.questions.map((q, i) => (
                <div
                  key={`${q.questionNumber ?? i}-${i}`}
                  className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm"
                >
                  <div className="flex items-start gap-3">
                    <StatusIcon status={q.status} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        Sual {(q as { presentationOrder?: number }).presentationOrder ?? q.questionNumber ?? i + 1}
                      </p>
                      <p className="text-slate-700 mt-1 whitespace-pre-wrap break-words">
                        <span className="text-slate-500">Sizin cavab: </span>
                        {q.yourAnswer || "—"}
                      </p>
                      <p className="text-slate-800 font-medium mt-2">
                        Bal: {q.scoreLabel ?? "—"}
                      </p>
                      {q.situationSubScores && q.situationSubScores.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-slate-700 border-t border-slate-200 pt-2">
                          {q.situationSubScores.map((s) => (
                            <li key={s.label}>
                              <span className="font-medium text-slate-800">{s.label}:</span> {s.scoreLabel}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!scoreLoading && scoreSummary && (!scoreSummary.questions || scoreSummary.questions.length === 0) && (
          <p className="text-slate-600 py-4">Bu cəhd üçün sual xülasəsi mövcud deyil.</p>
        )}
      </Modal>
    </div>
  );
}
