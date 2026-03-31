"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AutoExpandTextarea } from "@/components/exam/AutoExpandTextarea";
import SituasiyaCanvas, { type SituasiyaCanvasRef } from "@/components/exam/SituasiyaCanvas";
import CanvasReview from "@/components/teacher/CanvasReview";
import { useToast } from "@/components/Toast";
import { UniversalLatex } from "@/components/common/MathContent";

type SituationChip = { label: string; value: number };

type StudentModeProps = {
  mode: "student";
  saveHookId?: string;
  onRegisterFinalSave?: (id: string, fn: (() => Promise<void>) | null) => void;
  answerText: string;
  onAnswerTextChange: (value: string) => void;
  initialCanvasJson?: object | null;
  initialCanvasSnapshot?: string | null;
  onCanvasSave: (data: { json: object; snapshotBase64: string; width: number; height: number }) => Promise<void>;
};

type GradingModeProps = {
  mode: "grading";
  studentAnswerId?: number;
  examRunId?: number | null;
  canvasJson?: object | null;
  canvasSnapshot?: string | null;
  currentScore?: number;
  maxScoreLabel?: string;
  chips?: SituationChip[];
  selectedChipValue?: number;
  onSelectChip?: (chipValue: number) => void;
  onScoreChange: (value: number | undefined) => void;
  onOpenPreview?: () => void;
  onSave?: () => void;
  saveStatus?: "idle" | "saving" | "saved" | "error";
};

type CommonProps = {
  questionNumber: number;
  questionText: string;
  questionImageUrl?: string | null;
};

type SituationSmartCardProps = CommonProps & (StudentModeProps | GradingModeProps);

export function SituationSmartCard(props: SituationSmartCardProps) {
  const { questionNumber, questionText, questionImageUrl } = props;
  const onCanvasSave = props.mode === "student" ? props.onCanvasSave : undefined;
  const saveHookId = props.mode === "student" ? props.saveHookId : undefined;
  const onRegisterFinalSave = props.mode === "student" ? props.onRegisterFinalSave : undefined;
  const situationCanvasRef = useRef<SituasiyaCanvasRef>(null);
  const [studentSaveStatus, setStudentSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const toast = useToast();

  const saveStudentCanvas = useCallback(
    async (showToast = false) => {
      if (props.mode !== "student" || !onCanvasSave) return;
      if (!situationCanvasRef.current) return;
      const data = situationCanvasRef.current.getCanvasData();
      if (!data.snapshotBase64 && Object.keys(data.json || {}).length === 0) return;
      try {
        setStudentSaveStatus("saving");
        await onCanvasSave(data);
        setStudentSaveStatus("saved");
        if (showToast) toast.success("Uğurla saxlanıldı");
        setTimeout(() => setStudentSaveStatus("idle"), 1800);
      } catch (e: any) {
        setStudentSaveStatus("error");
        if (showToast) toast.error(e?.message || "Saxlama alınmadı");
      }
    },
    [props.mode, onCanvasSave, toast]
  );

  useEffect(() => {
    if (props.mode !== "student") return;
    if (!saveHookId || !onRegisterFinalSave) return;
    onRegisterFinalSave(saveHookId, async () => {
      await saveStudentCanvas(false);
    });
    return () => onRegisterFinalSave(saveHookId, null);
  }, [props.mode, saveHookId, onRegisterFinalSave, saveStudentCanvas]);

  useEffect(() => {
    if (props.mode !== "student") return;
    // Autosave safety net for non-PDF situation drawings.
    const t = setInterval(() => {
      void saveStudentCanvas(false);
    }, 45000);
    return () => clearInterval(t);
  }, [props.mode, saveStudentCanvas]);

  return (
    <div
      className="card"
      data-student-answer-id={props.mode === "grading" ? props.studentAnswerId ?? "" : ""}
      data-exam-run-id={props.mode === "grading" ? props.examRunId ?? "" : ""}
    >
      <div className="font-medium text-slate-900 mb-3">
        <UniversalLatex content={`${questionNumber}. ${questionText || ""}`} className="whitespace-pre-wrap" />
      </div>
      {questionImageUrl && <img src={questionImageUrl} alt="" className="max-w-full max-h-40 rounded border mb-2 object-contain" />}

      {props.mode === "student" ? (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Cavab (mətn)</label>
            <AutoExpandTextarea
              className="input w-full min-h-[160px]"
              placeholder="Cavabı bura yazın…"
              value={props.answerText}
              onChange={(e) => props.onAnswerTextChange(e.target.value)}
              rows={6}
            />
          </div>
          <p className="text-sm text-slate-600 mb-2">Qaralama (vektor)</p>
          <SituasiyaCanvas
            initialJson={props.initialCanvasJson ?? null}
            initialImageUrl={props.initialCanvasSnapshot ?? null}
            onSaveStatus={() => {}}
            ref={situationCanvasRef}
          />
          <div className="mt-2">
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={async () => {
                await saveStudentCanvas(true);
              }}
              disabled={studentSaveStatus === "saving"}
            >
              {studentSaveStatus === "saving" ? "Saxlanılır..." : "Qaralamanı saxla"}
            </button>
            {studentSaveStatus === "saved" && <span className="ml-2 text-xs text-emerald-600">Uğurla saxlanıldı</span>}
            {studentSaveStatus === "error" && <span className="ml-2 text-xs text-rose-600">Saxlama xətası</span>}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-medium text-slate-600 mb-1">Situasiya qaralamaları:</p>
          {(props.canvasJson || props.canvasSnapshot) ? (
            <div className="max-h-64 overflow-y-auto rounded border border-slate-200 bg-slate-50">
              <CanvasReview
                canvasJson={(props.canvasJson ?? null) as Record<string, unknown> | null}
                canvasSnapshot={props.canvasSnapshot ?? null}
              />
            </div>
          ) : (
            <div className="max-h-32 py-4 rounded border border-slate-200 bg-slate-50 text-center text-sm text-slate-500">Qaralama yoxdur</div>
          )}
          {props.canvasSnapshot && props.onOpenPreview && (
            <button type="button" onClick={props.onOpenPreview} className="mt-1 text-xs text-primary hover:underline">
              Tam baxış
            </button>
          )}

          {props.chips && props.chips.length > 0 && (
            <div className="mt-2">
              <label className="text-xs text-slate-700 block mb-1">Situasiya balı (çiplər):</label>
              <div className="flex flex-wrap gap-2">
                {props.chips.map(({ label, value }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => props.onSelectChip?.(value)}
                    className={`px-3 py-1.5 text-sm font-medium rounded border transition-colors ${
                      typeof props.selectedChipValue === "number" && Math.abs(props.selectedChipValue - value) < 0.001
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-slate-700">Manual xal:</label>
            <input
              type="number"
              step="0.01"
              min={0}
              className="input text-sm w-24"
              value={props.currentScore ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  props.onScoreChange(undefined);
                  return;
                }
                const num = parseFloat(raw);
                props.onScoreChange(Number.isNaN(num) ? undefined : num);
              }}
            />
            {props.maxScoreLabel && <span className="text-xs text-slate-500">{props.maxScoreLabel}</span>}
          </div>
          {props.onSave && (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={props.onSave} className="btn-outline text-xs">
                Yadda saxla
              </button>
              {props.saveStatus === "saving" && <span className="text-xs text-slate-500">Saxlanılır...</span>}
              {props.saveStatus === "saved" && <span className="text-xs text-emerald-600">Yadda saxlanıldı</span>}
              {props.saveStatus === "error" && <span className="text-xs text-rose-600">Saxlama xətası</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

