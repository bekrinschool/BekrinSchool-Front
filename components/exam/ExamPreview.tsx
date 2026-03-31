"use client";

import { X } from "lucide-react";
import { UniversalLatex } from "@/components/common/MathContent";

export interface ExamPreviewBankOption {
  id: number;
  text: string;
  label?: string;
  order: number;
  image_url?: string | null;
}

/** One exam-linked question row (teacher API / ExamQuestionDetailSerializer shape). */
export interface ExamPreviewBankQuestion {
  id?: number;
  question?: number;
  question_text?: string;
  question_type?: string;
  question_image_url?: string | null;
  mc_option_display?: string | null;
  options?: ExamPreviewBankOption[];
}

export interface ExamPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  /** For PDF/JSON: URL to the exam PDF */
  pdfUrl?: string | null;
  /** BANK | PDF | JSON */
  sourceType?: string;
  /** For BANK: rich question rows in student-facing order */
  questions?: ExamPreviewBankQuestion[];
  title?: string;
}

/** Split situation stem vs sub-parts (teacher can separate with --- lines). */
function situationTextBlocks(text: string): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  const parts = t.split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [t];
}

function kindLabel(kind: string): string {
  const k = (kind || "").toLowerCase();
  if (k === "mc" || k === "multiple_choice") return "Qapalı";
  if (k === "open") return "Açıq";
  if (k === "situation") return "Situasiya";
  return kind;
}

/**
 * Compact windowed preview of the exam as the student will see it.
 * BANK: LaTeX + question image + text vs image MC options. PDF/JSON: iframe + optional list.
 */
export default function ExamPreview({
  isOpen,
  onClose,
  pdfUrl,
  sourceType,
  questions = [],
  title = "İmtahan Vərəqinə Bax",
}: ExamPreviewProps) {
  if (!isOpen) return null;

  const isPdfOrJson = sourceType === "PDF" || sourceType === "JSON";
  const hasPdf = isPdfOrJson && pdfUrl;
  const isBank = sourceType === "BANK";
  const hasBankQuestions = isBank && questions.length > 0;
  const hasLegacyList = !isBank && questions.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white shadow-xl rounded-lg w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 shrink-0">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {hasPdf && (
            <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50 w-full max-w-md">
              <div className="overflow-auto max-h-[60vh]">
                <iframe
                  title="İmtahan vərəqi önizləmə"
                  src={`${pdfUrl}${pdfUrl.includes("?") ? "&" : "?"}embedded=true`}
                  className="w-full min-h-[480px]"
                />
              </div>
            </div>
          )}

          {hasBankQuestions && (
            <div className={`text-sm ${hasPdf ? "mt-4" : ""}`}>
              {hasPdf && <h3 className="font-medium text-slate-700 mb-2">Sual siyahısı</h3>}
              <ol className="space-y-6 list-decimal list-inside text-slate-800 max-h-[70vh] overflow-y-auto pr-2">
                {questions.slice(0, 200).map((q, idx) => {
                  const displayNum = idx + 1;
                  const qtext = q.question_text ?? "";
                  const qtype = (q.question_type || "").toUpperCase();
                  const isMc = qtype === "MULTIPLE_CHOICE";
                  const isSituation = qtype === "SITUATION";
                  const mode = (q.mc_option_display || "TEXT").toUpperCase();
                  const opts = [...(q.options ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                  return (
                    <li key={q.id ?? q.question ?? idx} className="border-b border-slate-100 pb-5 last:border-0">
                      <div className="inline-flex flex-col gap-2 w-full max-w-full">
                        <span className="text-xs font-medium text-slate-500">
                          #{displayNum} · {kindLabel(isMc ? "mc" : isSituation ? "situation" : "open")}
                        </span>
                        {isSituation ? (
                          situationTextBlocks(qtext).map((block, bi) => (
                            <div
                              key={bi}
                              className={bi === 0 ? "text-[15px] leading-relaxed" : "text-sm text-slate-800 pl-2 border-l-2 border-slate-200"}
                            >
                              <UniversalLatex content={block} />
                            </div>
                          ))
                        ) : (
                          <div className="text-[15px] leading-relaxed">
                            <UniversalLatex content={qtext} />
                          </div>
                        )}
                        {q.question_image_url ? (
                          <div className="mt-1 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 max-w-lg">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={q.question_image_url}
                              alt=""
                              className="w-full h-auto max-h-64 object-contain"
                            />
                          </div>
                        ) : null}
                        {isMc && opts.length > 0 ? (
                          mode === "IMAGE" ? (
                            <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 mt-2">
                              {opts.map((opt) => (
                                <div
                                  key={opt.id}
                                  className="rounded-lg border border-slate-200 p-2 bg-white flex flex-col gap-1"
                                >
                                  {opt.image_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={opt.image_url}
                                      alt=""
                                      className="w-full h-28 object-contain rounded"
                                    />
                                  ) : (
                                    <span className="text-xs text-slate-400">Şəkil yoxdur</span>
                                  )}
                                  {(opt.label || opt.text) && (
                                    <div className="text-xs text-slate-700">
                                      <UniversalLatex content={(opt.label || opt.text)!} />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <ul className="mt-2 space-y-1.5 list-none pl-0">
                              {opts.map((opt, oi) => (
                                <li
                                  key={opt.id}
                                  className="flex gap-2 text-sm text-slate-800 border border-slate-100 rounded-md px-2 py-1.5 bg-slate-50/80"
                                >
                                  <span className="shrink-0 font-medium text-slate-500">{String.fromCharCode(65 + oi)}.</span>
                                  <div className="min-w-0 flex-1">
                                    <UniversalLatex content={opt.text || opt.label || ""} />
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {questions.length > 200 && (
                <p className="text-xs text-slate-500 mt-2">… və {questions.length - 200} sual daha</p>
              )}
            </div>
          )}

          {hasLegacyList && (
            <div className={`${hasPdf ? "mt-4" : ""} text-sm`}>
              {hasPdf && <h3 className="font-medium text-slate-700 mb-2">Sual siyahısı</h3>}
              <ul className="space-y-2 list-decimal list-inside text-slate-700 max-h-[50vh] overflow-y-auto pr-2">
                {questions.slice(0, 50).map((q, idx) => (
                  <li key={idx} className="py-1 border-b border-slate-100 last:border-0">
                    <UniversalLatex content={q.question_text ?? `Sual ${idx + 1}`} />
                  </li>
                ))}
              </ul>
              {questions.length > 50 && (
                <p className="text-xs text-slate-500 mt-2">… və {questions.length - 50} sual daha</p>
              )}
            </div>
          )}

          {!hasPdf && !hasBankQuestions && !hasLegacyList && (
            <p className="text-slate-500 py-8 text-center">
              Önizləmə üçün məlumat yoxdur (PDF və ya sual siyahısı əlavə edin).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
