"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { teacherApi, ExamAttemptDetail } from "@/lib/teacher";
import { UniversalLatex } from "@/components/common/MathContent";
import { Loading } from "@/components/Loading";
import { Check, X } from "lucide-react";

type BlueprintItemLike = {
  questionNumber?: number;
  questionId?: number;
  options?: Array<{ id: string; text: string }>;
  correctOptionId?: string;
};

function selectedOptionToken(ans: ExamAttemptDetail["answers"][number]): string | null {
  if (ans.selectedOptionId != null) return String(ans.selectedOptionId);
  if (ans.selectedOptionKey) return String(ans.selectedOptionKey).trim().toUpperCase();
  return null;
}

export default function DigitalCopyPage() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = Number(params.attemptId);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["teacher", "attempt-detail", attemptId, "digital-copy"],
    queryFn: () => teacherApi.getAttemptDetail(attemptId),
    enabled: Number.isFinite(attemptId) && attemptId > 0,
  });

  const orderedAnswers = useMemo(() => {
    const answers = [...(detail?.answers ?? [])];
    const blueprint = (detail?.attemptBlueprint ?? []) as BlueprintItemLike[];
    if (!answers.length || !blueprint.length) return answers;
    const rank = new Map<string, number>();
    blueprint.forEach((b, i) => {
      if (b.questionNumber != null) rank.set(`n:${b.questionNumber}`, i);
      if (b.questionId != null) rank.set(`id:${b.questionId}`, i);
    });
    return answers.sort((a, b) => {
      const ra =
        (a.questionNumber != null ? rank.get(`n:${a.questionNumber}`) : undefined) ??
        (a.questionId != null ? rank.get(`id:${a.questionId}`) : undefined) ??
        Number.MAX_SAFE_INTEGER;
      const rb =
        (b.questionNumber != null ? rank.get(`n:${b.questionNumber}`) : undefined) ??
        (b.questionId != null ? rank.get(`id:${b.questionId}`) : undefined) ??
        Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (a.questionNumber ?? 0) - (b.questionNumber ?? 0);
    });
  }, [detail?.answers, detail?.attemptBlueprint]);

  if (isLoading) return <Loading />;
  if (!detail) return <div className="p-6 text-slate-600">Məlumat tapılmadı.</div>;

  if (detail.sourceType === "PDF") {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-slate-900">İmtahan vərəqinin rəqəmsal nüsxəsi</h1>
          <p className="mt-2 text-sm text-slate-600">
            PDF mənbəli imtahanlar üçün bu görünüş deaktivdir. Mövcud "İmtahan Vərəqinə Bax" düyməsindən istifadə edin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="mx-auto max-w-5xl space-y-4 px-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h1 className="text-lg font-semibold text-slate-900">{detail.examTitle}</h1>
          <p className="text-sm text-slate-600">{detail.studentName}</p>
          <p className="text-sm text-slate-700 mt-1">
            Yekun bal: <span className="font-semibold">{Number(detail.totalScore ?? 0).toFixed(2)}</span> / {detail.maxScore}
          </p>
        </div>

        {orderedAnswers.map((ans, idx) => {
          const isSituation = (ans.questionType || "").toLowerCase() === "situation";
          const blueprint = (detail.attemptBlueprint ?? []) as BlueprintItemLike[];
          const bp =
            blueprint.find(
              (b) =>
                (b.questionNumber != null && b.questionNumber === ans.questionNumber) ||
                (b.questionId != null && b.questionId === ans.questionId)
            ) ?? null;
          const selectedToken = selectedOptionToken(ans);
          const correctToken = bp?.correctOptionId ?? null;
          const isBlank = !selectedToken && !(ans.textAnswer || "").trim();
          const isCorrect = !isSituation && !isBlank && (ans.autoScore ?? 0) > 0;

          const blockClass = isSituation
            ? "border-amber-200 bg-amber-50/40"
            : isBlank
              ? "border-orange-200 bg-orange-50/50"
              : isCorrect
                ? "border-emerald-300 bg-emerald-50"
                : "border-rose-300 bg-rose-50";

          return (
            <section key={`dc-${ans.id}-${idx}`} className={`rounded-xl border p-4 ${blockClass}`}>
              <div className="mb-2 text-xs font-medium text-slate-600">Sual {ans.questionNumber ?? idx + 1}</div>
              <div className="text-sm font-medium text-slate-900 mb-2">
                <UniversalLatex content={ans.questionText} className="whitespace-pre-wrap" />
              </div>

              {!isSituation && bp?.options?.length ? (
                <div className="space-y-1.5">
                  {bp.options.map((opt) => {
                    const isSelected = !!selectedToken && selectedToken === opt.id;
                    const isAnswer = !!correctToken && correctToken === opt.id;
                    const rowClass = isSelected && isAnswer
                      ? "border-emerald-500 bg-emerald-100"
                      : isSelected && !isAnswer
                        ? "border-rose-500 bg-rose-100"
                        : isAnswer
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-200 bg-white";
                    return (
                      <div key={opt.id} className={`rounded-md border px-3 py-2 ${rowClass}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-800"><UniversalLatex content={opt.text} /></span>
                          <span className="text-xs inline-flex items-center gap-1">
                            {isSelected && isAnswer && (<><Check className="w-3.5 h-3.5 text-emerald-700" />Düz</>)}
                            {isSelected && !isAnswer && (<><X className="w-3.5 h-3.5 text-rose-700" />Seçimi</>)}
                            {!isSelected && isAnswer && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">Düzgün</span>}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  <span className="font-medium">Şagirdin cavabı: </span>
                  <UniversalLatex content={(ans.textAnswer ?? "").trim() || "—"} className="whitespace-pre-wrap mt-1" />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

