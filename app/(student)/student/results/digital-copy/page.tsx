"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { formatMcSelectionForDisplay } from "@/lib/mc-option-display";
import { Loading } from "@/components/Loading";
import { UniversalLatex } from "@/components/common/MathContent";
import { Check, X, ArrowLeft } from "lucide-react";

export default function StudentResultDigitalCopyPage() {
  const params = useSearchParams();
  const examId = Number(params.get("examId"));
  const attemptId = Number(params.get("attemptId"));

  const { data: detail, isLoading } = useQuery({
    queryKey: ["student", "exam-result", examId, attemptId, "digital-copy"],
    queryFn: () => studentApi.getExamResult(examId, attemptId),
    enabled: Number.isFinite(examId) && examId > 0 && Number.isFinite(attemptId) && attemptId > 0,
  });

  const questions = useMemo(() => detail?.questions ?? [], [detail?.questions]);

  if (isLoading) return <Loading />;
  if (!detail) return <div className="page-container text-slate-600">Nəticə tapılmadı.</div>;

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="mx-auto max-w-5xl px-4 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{detail.title}</h1>
            <p className="text-sm text-slate-600">
              Yekun bal: <span className="font-semibold text-slate-900">{Math.max(0, Number(detail.score ?? 0)).toFixed(1)}</span> / {detail.maxScore ?? "—"}
            </p>
          </div>
          <button type="button" className="btn-outline text-sm flex items-center gap-1" onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4" />
            Geri
          </button>
        </div>

        {!questions.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm">
            Bu nəticə üçün sual məzmunu göstərilmir.
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q: any, i: number) => {
              const hasOptions = Array.isArray(q.options) && q.options.length > 0;
              const blueprintOpts = Array.isArray(q.options) ? q.options : undefined;
              const pts = typeof q.points === "number" ? q.points : 0;
              const isCorrect = pts > 0;
              const blockClass = isCorrect ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50";
              return (
                <section key={q.questionNumber ?? i} className={`rounded-xl border p-4 ${blockClass}`}>
                  <div className="mb-2 text-xs font-medium text-slate-600">
                    Sual {(q as { presentationOrder?: number }).presentationOrder ?? q.questionNumber ?? i + 1}
                  </div>
                  <div className="text-sm text-slate-900 font-medium mb-2 whitespace-pre-wrap">
                    <UniversalLatex content={q.questionText ?? ""} />
                  </div>
                  {q.questionImageUrl ? (
                    <img src={q.questionImageUrl} alt="" className="max-w-full max-h-52 rounded border mb-3 object-contain" />
                  ) : null}

                  {hasOptions ? (
                    (() => {
                      const grid = q.options.some((o: { imageUrl?: string }) => !!o?.imageUrl);
                      return (
                    <div className={grid ? "grid grid-cols-1 sm:grid-cols-2 gap-2" : "space-y-1.5"}>
                      {q.options.map((opt: any, oi: number) => {
                        const rowClass = opt.isYours && opt.isCorrect
                          ? "border-emerald-500 bg-emerald-100"
                          : opt.isYours && !opt.isCorrect
                            ? "border-rose-500 bg-rose-100"
                            : opt.isCorrect
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-slate-200 bg-white";
                        const yours = opt.isYours ? "ring-4 ring-blue-500 ring-offset-1 border-blue-600" : "";
                        return (
                          <div key={opt.key ?? oi} className={`rounded-md border-2 px-3 py-2 text-sm ${rowClass} ${yours}`}>
                            {opt.imageUrl ? (
                              <img src={opt.imageUrl} alt="" className="w-full max-h-44 object-contain rounded border border-slate-100 mb-2 bg-white" />
                            ) : null}
                            <div className="flex items-center justify-between gap-2">
                              <span>
                                <span className="font-medium mr-1">{opt.key}.</span>
                                <UniversalLatex content={opt.text || "—"} />
                              </span>
                              <span className="text-xs inline-flex items-center gap-1 shrink-0">
                                {opt.isYours && opt.isCorrect && (<><Check className="w-3.5 h-3.5 text-emerald-700" />Düz</>)}
                                {opt.isYours && !opt.isCorrect && (<><X className="w-3.5 h-3.5 text-rose-700" />Seçiminiz</>)}
                                {!opt.isYours && opt.isCorrect && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">Düzgün</span>}
                              </span>
                            </div>
                            {opt.label ? (
                              <div className="mt-1 text-xs text-slate-700">
                                <UniversalLatex content={opt.label} />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                      );
                    })()
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div className="rounded-md border border-slate-200 bg-white p-2">
                        <p className="text-xs text-slate-500 mb-1">Sizin cavab</p>
                        <UniversalLatex
                          content={formatMcSelectionForDisplay(q.yourAnswer, blueprintOpts)}
                          className="whitespace-pre-wrap"
                        />
                      </div>
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                        <p className="text-xs text-emerald-700 mb-1">Düzgün cavab</p>
                        <UniversalLatex
                          content={formatMcSelectionForDisplay(q.correctAnswer, blueprintOpts)}
                          className="whitespace-pre-wrap"
                        />
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

