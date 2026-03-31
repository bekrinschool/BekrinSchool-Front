"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { parentApi, Child } from "@/lib/parent";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Eye } from "lucide-react";

import type { ScribbleDrawingData } from "@/components/exam/ImageScribbleViewer";
import { ImageScribbleViewer } from "@/components/exam/ImageScribbleViewer";

function ParentResultsContent() {
  const searchParams = useSearchParams();
  const studentIdParam = searchParams.get("studentId");
  const [typeFilter, setTypeFilter] = useState<"all" | "quiz" | "exam">("all");
  const [selectedResult, setSelectedResult] = useState<{ examId: number; attemptId: number } | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(studentIdParam || null);

  const { data: children, isLoading: childrenLoading } = useQuery({
    queryKey: ["parent", "children"],
    queryFn: () => parentApi.getChildren(),
  });

  useEffect(() => {
    const fromUrl = searchParams.get("studentId");
    if (fromUrl && children?.some((c: Child) => String(c.id) === fromUrl)) {
      setSelectedChildId(fromUrl);
    }
  }, [searchParams, children]);

  const effectiveStudentId = selectedChildId || (children && children.length > 0 ? String(children[0].id) : null);

  const { data: results = [], isLoading: resultsLoading } = useQuery({
    queryKey: ["parent", "exam-results", effectiveStudentId],
    queryFn: () => parentApi.getChildExamResults(effectiveStudentId!),
    enabled: !!effectiveStudentId,
  });

  const filteredResults =
    typeFilter === "all"
      ? results
      : results.filter((r) => {
          const type = r.examType ?? "exam";
          if (typeFilter === "quiz") return type === "quiz";
          if (typeFilter === "exam") return type === "exam";
          return true;
        });

  const { data: resultDetail } = useQuery({
    queryKey: ["parent", "exam-attempt", selectedResult?.examId, selectedResult?.attemptId, effectiveStudentId],
    queryFn: () =>
      parentApi.getChildExamAttemptDetail(
        selectedResult!.examId,
        selectedResult!.attemptId,
        effectiveStudentId!
      ),
    enabled: !!selectedResult && !!effectiveStudentId,
  });

  const isLoading = childrenLoading || (!!effectiveStudentId && resultsLoading);

  if (isLoading && !children?.length) return <Loading />;

  if (!effectiveStudentId && children?.length === 0) {
    return (
      <div className="page-container">
        <div className="card text-center py-12">
          <p className="text-slate-500">Şagird tapılmadı</p>
          <p className="text-sm text-slate-400 mt-1">Panel səhifəsindən uşağınızı seçin</p>
        </div>
      </div>
    );
  }

  const selectedChild = children?.find((c) => String(c.id) === effectiveStudentId);

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">İmtahanlar</h1>
        <p className="text-sm text-slate-600 mt-2">
          Uşağınızın imtahan və quiz nəticələri
        </p>
      </div>

      {children && children.length > 1 && (
        <div className="card mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">Şagird</label>
          <select
            className="input w-full max-w-xs"
            value={effectiveStudentId ?? ""}
            onChange={(e) => setSelectedChildId(e.target.value || null)}
          >
            {children.map((c: Child) => (
              <option key={c.id} value={String(c.id)}>
                {c.fullName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {selectedChild ? `${selectedChild.fullName} – İmtahan nəticələri` : "İmtahan nəticələri"}
          </h2>
          <div className="flex gap-2">
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

        {filteredResults.length > 0 ? (
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
                {filteredResults.map((r) => (
                  <tr key={r.attemptId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">{r.title}</td>
                    <td className="py-3 px-4 text-sm">
                      {r.is_result_published && r.score != null ? (
                        <span className="font-semibold text-slate-900">{r.score}</span>
                      ) : (
                        <span className="text-amber-600">—</span>
                      )}
                      <span className="text-slate-500"> / {r.maxScore ?? "—"}</span>
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
                          onClick={() => setSelectedResult({ examId: r.examId, attemptId: r.attemptId })}
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <Eye className="w-4 h-4" /> Nəticəyə bax
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
        isOpen={!!selectedResult}
        onClose={() => setSelectedResult(null)}
        title={resultDetail?.title ?? "Nəticə"}
        size="lg"
      >
        {resultDetail && (
          <div className="space-y-4">
            <p className="text-lg font-semibold text-green-700">
              {resultDetail.score != null
                ? `Yekun bal: ${Math.max(0, Number(resultDetail.score))} / ${resultDetail.maxScore ?? "—"}`
                : "Yoxlanılır / Nəticə yayımda deyil"}
            </p>
            {resultDetail.questions && resultDetail.questions.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Sual üzrə bölgü</h4>
                <div className="max-h-72 overflow-y-auto space-y-2">
                  {resultDetail.questions.map(
                    (
                      q: {
                        questionNumber?: number;
                        questionText?: string;
                        yourAnswer?: string;
                        correctAnswer?: string;
                        points?: number;
                      },
                      i: number
                    ) => (
                      <div key={q.questionNumber ?? i} className="border border-slate-200 rounded p-2 text-sm">
                        <p className="font-medium text-slate-800 mb-1">Sual {q.questionNumber ?? i + 1}</p>
                        <p className="text-xs text-slate-600 mb-1 truncate">{q.questionText}</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-slate-500">Şagirdin cavabı: </span>
                            <span className="text-slate-800">{q.yourAnswer ?? "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Düzgün cavab: </span>
                            <span className="text-emerald-700">{q.correctAnswer ?? "—"}</span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">Bal: {typeof q.points === "number" ? q.points.toFixed(1) : "—"}</p>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
            {(resultDetail as { pages?: string[] }).pages?.length && (resultDetail as { pdfScribbles?: unknown[] }).pdfScribbles && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Şagirdin PDF qaralamaları</h4>
                <ImageScribbleViewer
                  pages={(resultDetail as { pages: string[] }).pages}
                  pdfScribbles={(resultDetail as { pdfScribbles: { pageIndex: number; drawingData: ScribbleDrawingData }[] }).pdfScribbles}
                  maxHeight={400}
                />
              </div>
            )}
            {resultDetail.canvases && resultDetail.canvases.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Situasiya qaralamaları</h4>
                <p className="text-xs text-slate-500 mb-2">Şagirdin qaralama sahəsi. Aşağı sürüşdürərək bütün məzmunu görə bilərsiniz.</p>
                <div className="space-y-3">
                  {resultDetail.canvases.map(
                    (c: { canvasId?: number; questionId?: number; imageUrl?: string | null; situationIndex?: number }, ci: number) =>
                      c.imageUrl && (
                        <div key={c.canvasId ?? ci}>
                          {c.situationIndex != null && <span className="text-xs text-slate-600 font-medium block mb-1">Situasiya {c.situationIndex}</span>}
                          <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden rounded border border-slate-200 bg-white">
                            <img
                              src={c.imageUrl}
                              alt={c.questionId ? `Sual ${c.questionId} qaralama` : `Qaralama ${ci + 1}`}
                              className="w-full h-auto block rounded"
                            />
                          </div>
                        </div>
                      )
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function ParentResultsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ParentResultsContent />
    </Suspense>
  );
}
