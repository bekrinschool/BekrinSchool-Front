"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Pen, Eraser, Trash2, ZoomIn, ZoomOut, Maximize2, PanelRightClose, PanelRightOpen, Send, Clock } from "lucide-react";
import SituasiyaCanvas, { SituasiyaCanvasRef } from "@/components/exam/SituasiyaCanvas";
import { Modal } from "@/components/Modal";
import { AutoExpandTextarea } from "@/components/exam/AutoExpandTextarea";
import { studentApi } from "@/lib/student";

const LABELS = ["A", "B", "C", "D", "E", "F"];
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.25;

export type ImageExamQuestion = {
  questionNumber?: number;
  questionId?: number;
  kind?: string;
  type?: string;
  text?: string;
  prompt?: string;
  options?: { id?: number | string; key?: string; text: string; order?: number }[];
  open_rule?: string;
  matching_left?: string[];
  matching_right?: string[];
};

export type ScribbleDrawingData = {
  strokes?: { tool: "pen" | "eraser"; width: number; points: { x: number; y: number }[] }[];
};

export interface ImageExamViewerProps {
  runId: number;
  attemptId: number;
  examId: number;
  title: string;
  questions: ImageExamQuestion[];
  answers: Record<string, { selectedOptionId?: number | string; selectedOptionKey?: string; textAnswer?: string }>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, { selectedOptionId?: number | string; selectedOptionKey?: string; textAnswer?: string }>>>;
  canvases?: { canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string; canvasJson?: object; canvasSnapshot?: string | null }[];
  onSaveCanvas?: (
    questionId?: number,
    situationIndex?: number
  ) => (
    data: string | { json: object; snapshotBase64: string; width: number; height: number },
    pageIndex?: number
  ) => Promise<void>;
  onSubmitClick: () => void;
  submitMutation: { isPending: boolean };
  countdownMs: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  initialPdfScribbles?: { pageIndex: number; drawingData: ScribbleDrawingData }[] | null;
  formatCountdown: (ms: number) => string;
  /** Scroll this index into view in the answer panel (blueprint order). */
  resumeQuestionIndex?: number;
}

function getAnswerKey(q: ImageExamQuestion): string {
  return q.questionId != null ? String(q.questionId) : `n-${q.questionNumber ?? 0}`;
}

export interface ImageExamViewerRef {
  flushScribbles: () => Promise<void>;
  saveAllSituasiyaCanvases: () => Promise<void>;
}

export const ImageExamViewer = forwardRef<ImageExamViewerRef, ImageExamViewerProps>(function ImageExamViewer(
  {
    runId,
    attemptId,
    title,
    questions,
    answers,
    setAnswers,
    canvases = [],
    onSaveCanvas,
    onSubmitClick,
    submitMutation,
    countdownMs,
    containerRef,
    initialPdfScribbles,
    formatCountdown,
    resumeQuestionIndex,
  },
  ref
) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [lineWidth] = useState(4);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [situationModal, setSituationModal] = useState<number | null>(null);
  const [situasiyaSaveStatus, setSituasiyaSaveStatus] = useState<"saving" | "saved" | "error" | null>(null);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }[]>([]);
  const [containerWidth, setContainerWidth] = useState(800);
  const [windowWidth, setWindowWidth] = useState(1280);
  const isDrawerMode = windowWidth < 1280;
  const isMobile = windowWidth < 768;
  useEffect(() => {
    const check = () => setWindowWidth(window.innerWidth);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const scribblesRef = useRef<Map<number, ScribbleDrawingData>>(new Map());
  const debounceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStrokeRef = useRef<{ tool: "pen" | "eraser"; width: number; points: { x: number; y: number }[] } | null>(null);
  const isDrawingRef = useRef(false);
  const situationCanvasRef = useRef<SituasiyaCanvasRef>(null);
  const answerPanelScrollRef = useRef<HTMLDivElement>(null);
  const answerDrawerScrollRef = useRef<HTMLDivElement>(null);

  /** Prevent browser from auto-scrolling the panel when user clicks a question (focus scroll). */
  const preventFocusScroll = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const label = t.closest?.("label") as HTMLLabelElement | null;
    const focusable: HTMLElement | null = label
      ? (label.control ?? (label.htmlFor ? document.getElementById(label.htmlFor) : null)) as HTMLElement | null
      : t.matches?.("input, button, textarea, [tabindex]:not([tabindex='-1'])")
        ? t
        : null;
    if (!focusable?.focus) return;
    if (e.cancelable) e.preventDefault();
    focusable.focus({ preventScroll: true });
    if (label && focusable instanceof HTMLInputElement && (focusable.type === "radio" || focusable.type === "checkbox")) {
      focusable.click();
    } else if (t instanceof HTMLInputElement && (t.type === "radio" || t.type === "checkbox")) {
      t.click();
    }
  }, []);

  const closedQuestions = questions.filter((q) => (q.type || q.kind || "").toString().toLowerCase() === "mc" || (q.type || q.kind || "").toString().toLowerCase() === "closed");
  const situationQuestions = questions.filter((q) => (q.type || q.kind || "").toString().toLowerCase() === "situation");

  const scheduleDebouncedSave = useCallback(() => {
    if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current);
    debounceSaveRef.current = setTimeout(() => {
      debounceSaveRef.current = null;
    }, 3000);
  }, []);

  const flushScribbles = useCallback(async () => {
    if (debounceSaveRef.current) {
      clearTimeout(debounceSaveRef.current);
      debounceSaveRef.current = null;
    }
    scribblesRef.current.clear();
    overlayCanvasesRef.current.forEach((canvas) => {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  }, []);

  const saveAllSituasiyaCanvases = useCallback(async () => {
    if (situationModal == null || !situationCanvasRef.current || !onSaveCanvas) return;
    const data = situationCanvasRef.current.getCanvasData();
    if (!data.snapshotBase64 && Object.keys(data.json).length === 0) return;
    const sitQ = situationQuestions[situationModal - 1];
    const questionId = sitQ?.questionId ?? undefined;
    await onSaveCanvas(questionId, situationModal)({
      json: data.json,
      snapshotBase64: data.snapshotBase64,
      width: data.width,
      height: data.height,
    });
  }, [situationModal, onSaveCanvas, situationQuestions]);

  useImperativeHandle(
    ref,
    () => ({ flushScribbles, saveAllSituasiyaCanvases }),
    [flushScribbles, saveAllSituasiyaCanvases]
  );

  /** Reset scroll targets when attempt loads or resumes (avoids header clipped / bottom gap with dynamic viewport). */
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    scrollContainerRef.current?.scrollTo({ top: 0, left: 0 });
    answerPanelScrollRef.current?.scrollTo({ top: 0, left: 0 });
    answerDrawerScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [attemptId]);

  useEffect(() => {
    if (resumeQuestionIndex == null || resumeQuestionIndex < 0) return;
    const id = `pdf-answer-q-${resumeQuestionIndex}`;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 400);
    return () => window.clearTimeout(t);
  }, [resumeQuestionIndex, questions.length]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    studentApi
      .getRunPages(runId)
      .then((res) => {
        if (!cancelled) {
          setPages(res.pages || []);
          setPageDimensions([]);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError("Səhifələr yüklənmədi");
          setPages([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    const el = pdfContainerRef.current;
    if (!el) return;
    const updateWidth = () => setContainerWidth(el.clientWidth || 800);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.length]);

  useEffect(() => {
    pageDimensions.forEach((d, i) => {
      const overlay = overlayCanvasesRef.current.get(i);
      if (overlay && d?.width && d?.height) {
        overlay.width = d.width;
        overlay.height = d.height;
      }
    });
  }, [pageDimensions]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (isDrawingRef.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  useEffect(() => {
    if (!initialPdfScribbles?.length) return;
    initialPdfScribbles.forEach(({ pageIndex, drawingData }) => {
      scribblesRef.current.set(pageIndex, drawingData || { strokes: [] });
    });
  }, [initialPdfScribbles]);

  useEffect(() => {
    if (!initialPdfScribbles?.length || pageDimensions.length === 0) return;
    for (let i = 0; i < pageDimensions.length; i++) {
      const data = scribblesRef.current.get(i);
      const overlay = overlayCanvasesRef.current.get(i);
      if (!overlay || !data?.strokes?.length) continue;
      const ctx = overlay.getContext("2d");
      if (!ctx) continue;
      if (overlay.width > 0 && overlay.height > 0) ctx.clearRect(0, 0, overlay.width, overlay.height);
      data.strokes.forEach((stroke) => {
        ctx.strokeStyle = stroke.tool === "eraser" ? "rgba(255,255,255,1)" : "#000";
        ctx.lineWidth = stroke.tool === "eraser" ? stroke.width * 2 : stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
        if (stroke.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        stroke.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      });
    }
  }, [initialPdfScribbles, pageDimensions.length]);

  const getCoords = useCallback((e: React.PointerEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, pageIndex: number) => {
      if (e.cancelable) e.preventDefault();
      const overlay = overlayCanvasesRef.current.get(pageIndex);
      if (!overlay) return;
      const { x, y } = getCoords(e, overlay);
      currentStrokeRef.current = { tool, width: lineWidth, points: [{ x, y }] };
      isDrawingRef.current = true;
    },
    [tool, lineWidth, getCoords]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent, pageIndex: number) => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      const overlay = overlayCanvasesRef.current.get(pageIndex);
      if (!overlay) return;
      const { x, y } = getCoords(e, overlay);
      currentStrokeRef.current.points.push({ x, y });
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = tool === "eraser" ? "rgba(255,255,255,1)" : "#000";
      ctx.lineWidth = tool === "eraser" ? lineWidth * 2 : lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      const pts = currentStrokeRef.current.points;
      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    },
    [tool, lineWidth, getCoords]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent, pageIndex: number) => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      const stroke = currentStrokeRef.current;
      currentStrokeRef.current = null;
      isDrawingRef.current = false;
      const data = scribblesRef.current.get(pageIndex) || { strokes: [] };
      const strokes = [...(data.strokes || []), stroke];
      scribblesRef.current.set(pageIndex, { ...data, strokes });
      scheduleDebouncedSave();
    },
    [scheduleDebouncedSave]
  );

  const handleClearPage = useCallback((pageIndex: number) => {
    const overlay = overlayCanvasesRef.current.get(pageIndex);
    if (overlay) {
      const ctx = overlay.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
    scribblesRef.current.set(pageIndex, { strokes: [] });
    scheduleDebouncedSave();
  }, [scheduleDebouncedSave]);

  useEffect(() => {
    const onUp = () => {
      if (currentStrokeRef.current) {
        const pageIndex = Array.from(overlayCanvasesRef.current.entries()).find(([, c]) => c === document.elementFromPoint(0, 0))?.[0];
        if (pageIndex != null) {
          const data = scribblesRef.current.get(pageIndex) || { strokes: [] };
          const strokes = [...(data.strokes || []), currentStrokeRef.current];
          scribblesRef.current.set(pageIndex, { ...data, strokes });
          scheduleDebouncedSave();
        }
        currentStrokeRef.current = null;
      }
      isDrawingRef.current = false;
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [scheduleDebouncedSave]);

  const situationIndexForQuestion = (q: ImageExamQuestion): number => {
    return situationQuestions.findIndex((s) => getAnswerKey(s) === getAnswerKey(q)) + 1;
  };

  const handleImageLoad = useCallback(
    (index: number, naturalWidth: number, naturalHeight: number) => {
      const w = containerWidth || 800;
      const h = (w / naturalWidth) * naturalHeight;
      setPageDimensions((prev) => {
        const next = [...prev];
        next[index] = { width: w, height: h };
        return next;
      });
    },
    [containerWidth]
  );

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className="exam-layout flex h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-slate-100"
    >
      {loading ? (
        <div className="flex h-full w-full min-h-0 items-center justify-center bg-slate-100 text-slate-500">
          Səhifələr yüklənir…
        </div>
      ) : (
        <>
      <div className="exam-header flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <h1 className="min-w-0 truncate text-lg font-bold text-slate-900">{title}</h1>
          <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => containerRef?.current?.requestFullscreen?.()}
              className="no-touch-target rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100"
              title="Tam Ekran"
            >
              <Maximize2 className="h-5 w-5" />
            </button>
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono font-semibold ${
                countdownMs < 60000 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-800"
              }`}
            >
              <Clock className="h-4 w-4" />
              {formatCountdown(countdownMs)}
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button type="button" onClick={() => setTool("pen")} className={`no-touch-target rounded p-1.5 ${tool === "pen" ? "bg-slate-200" : "hover:bg-slate-100"}`} title="Qələm">
                <Pen className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setTool("eraser")} className={`no-touch-target rounded p-1.5 ${tool === "eraser" ? "bg-slate-200" : "hover:bg-slate-100"}`} title="Pozan">
                <Eraser className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className="no-touch-target rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100"
              title={sidebarOpen ? "Cavab vərəqini gizlət" : "Cavab Vərəqi"}
            >
              {sidebarOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSubmitClick();
              }}
              disabled={submitMutation.isPending}
              className="btn-primary flex items-center gap-2 py-2"
            >
              <Send className="h-5 w-5" />
              Göndər
            </button>
          </div>
      </div>

      <div className="exam-panels flex flex-1 min-h-0 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className={`flex flex-col overflow-x-hidden overflow-y-auto border-r border-slate-200 ${
            isDrawerMode ? "panel-pdf-drawer-mode flex-1 min-w-0" : `panel-pdf ${!sidebarOpen ? "panel-pdf-expanded" : ""}`
          }`}
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <div ref={pdfContainerRef} className="mx-auto w-full max-w-4xl px-4 py-4">
              {error && <div className="py-12 text-center text-red-600">{error}</div>}
              {!error && pages.length > 0 && (
                <>
                  <div className="flex gap-4 mb-2">
                    <button type="button" onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))} className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100">
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))} className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100">
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <span className="flex items-center text-sm text-slate-600">{Math.round(scale * 100)}%</span>
                  </div>
                  {pages.map((src, i) => (
                    <div
                      key={i}
                      id={`image-page-${i}`}
                      className="relative mb-4 bg-white shadow page-wrapper"
                      style={{
                        width: pageDimensions[i]?.width ?? "100%",
                        height: pageDimensions[i]?.height ?? undefined,
                      }}
                    >
                      <img
                        src={src}
                        alt={`Səhifə ${i + 1}`}
                        className="exam-page block w-full h-auto"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          handleImageLoad(i, img.naturalWidth, img.naturalHeight);
                        }}
                      />
                      <canvas
                        ref={(el) => {
                          if (el) overlayCanvasesRef.current.set(i, el);
                        }}
                        className="scribble-layer absolute inset-0 block w-full h-full cursor-crosshair touch-none select-none"
                        style={{ pointerEvents: "auto", touchAction: "none" }}
                        onPointerDown={(e) => handlePointerDown(e, i)}
                        onPointerMove={(e) => handlePointerMove(e, i)}
                        onPointerUp={(e) => handlePointerUp(e, i)}
                        onPointerLeave={(e) => handlePointerUp(e, i)}
                      />
                      <div className="absolute bottom-2 right-2">
                        <button type="button" onClick={() => handleClearPage(i)} className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100" title="Səhifəni təmizlə">
                          <Trash2 className="h-3 w-3" />
                          Səhifəni təmizlə
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
        </div>

        {/* Desktop (xl): when answer sheet closed, show edge toggle to reopen */}
        {!isDrawerMode && !sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="fixed right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-lg border border-r-0 border-slate-300 bg-white px-2 py-4 shadow-md hover:bg-slate-50"
            title="Cavab vərəqini aç"
            aria-label="Cavab vərəqini aç"
          >
            <PanelRightOpen className="h-5 w-5 text-slate-700" />
          </button>
        )}

        {/* Desktop (xl): side-by-side answer panel — has its own scroll (no auto-scroll on question click) */}
        {!isDrawerMode && sidebarOpen ? (
          <aside ref={answerPanelScrollRef} className="panel-answers flex-1 min-h-0 overflow-x-hidden overflow-y-auto bg-white">
            <h2 className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">Cavab Vərəqi</h2>
            <div className="space-y-3 p-3 pb-6" onMouseDown={preventFocusScroll}>
              {questions.map((q, idx) => {
                const key = getAnswerKey(q);
                const kind = (q.kind || q.type || "").toLowerCase();
                const num = q.questionNumber ?? idx + 1;
                if (kind === "mc" || kind === "closed") {
                  const label = (i: number) => (q.options?.[i]?.key != null ? String(q.options![i].key) : LABELS[i] ?? String(i + 1));
                  return (
                    <div key={key} id={`pdf-answer-q-${idx}`} className="rounded border border-slate-200 p-2">
                      <div className="font-medium text-slate-800 text-sm mb-1">{num}.</div>
                        <div className="flex flex-wrap gap-1">
                          {(q.options || []).map((opt, optIdx) => (
                            <label
                              key={optIdx}
                              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium cursor-pointer ${
                                answers[key]?.selectedOptionKey === (opt.key ?? label(optIdx)) ? "border-primary bg-primary text-white" : "border-slate-300 hover:border-slate-400"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`q-${key}`}
                                className="sr-only"
                                checked={answers[key]?.selectedOptionKey === (opt.key ?? label(optIdx)) || answers[key]?.selectedOptionId === opt.id}
                                onChange={() => setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], selectedOptionKey: opt.key ?? label(optIdx), selectedOptionId: opt.id } }))}
                              />
                              {opt.key ?? label(optIdx)}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  if (kind === "situation") {
                    const sitIdx = situationIndexForQuestion(q);
                    return (
                      <div key={key} id={`pdf-answer-q-${idx}`} className="rounded border border-slate-200 p-2">
                        <div className="font-medium text-slate-800 text-sm mb-1">{num}. Situasiya</div>
                        <button type="button" onClick={() => setSituationModal(sitIdx)} className="w-full rounded border border-slate-300 py-1.5 text-sm hover:bg-slate-50">
                          Uzun cavab (rəsm)
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={key} id={`pdf-answer-q-${idx}`} className="rounded border border-slate-200 p-2">
                      <div className="font-medium text-slate-800 text-sm mb-1">{num}. Açıq</div>
                      <AutoExpandTextarea
                        className="input w-full text-sm min-h-[80px]"
                        placeholder="Cavab..."
                        value={answers[key]?.textAnswer ?? ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], textAnswer: e.target.value } }))}
                        rows={3}
                      />
                    </div>
                  );
                })}
            </div>
          </aside>
        ) : null}
      </div>

      {/* Tablet/mobile: floating button to open answer drawer */}
      {isDrawerMode && !sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="fixed right-4 bottom-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-white shadow-lg hover:bg-blue-600 md:flex xl:hidden"
          aria-label="Cavab vərəqini aç"
        >
          Cavab vərəqi <PanelRightOpen className="h-5 w-5" />
        </button>
      )}

      {/* Tablet/mobile: answer sheet as right drawer overlay */}
      {isDrawerMode && (
        <>
          {sidebarOpen && (
            <div
              role="presentation"
              className="fixed inset-0 z-30 bg-black/30 md:block xl:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-hidden
            />
          )}
          <div
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-hidden bg-white shadow-xl transition-transform duration-200 ease-out md:block xl:hidden"
            style={{
              width: isMobile ? "100%" : "85%",
              maxWidth: isMobile ? "100%" : "480px",
              height: "100dvh",
              minHeight: "100dvh",
              transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
            }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-700 hover:bg-slate-100"
                aria-label="Bağla"
              >
                ✕ Bağla
              </button>
              <h2 className="text-sm font-semibold text-slate-900">Cavab Vərəqi</h2>
              <div className="w-10" />
            </div>
            <div
              ref={answerDrawerScrollRef}
              className="answer-drawer-scroll overflow-x-hidden overflow-y-scroll p-3 pb-6"
              style={
                {
                  height: "calc(100dvh - 56px)",
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-y",
                } as React.CSSProperties
              }
            >
              <div className="space-y-3" onMouseDown={preventFocusScroll}>
                {questions.map((q, idx) => {
                  const key = getAnswerKey(q);
                  const kind = (q.kind || q.type || "").toLowerCase();
                  const num = q.questionNumber ?? idx + 1;
                  if (kind === "mc" || kind === "closed") {
                    const label = (i: number) => (q.options?.[i]?.key != null ? String(q.options![i].key) : LABELS[i] ?? String(i + 1));
                    return (
                      <div key={key} id={`pdf-answer-q-${idx}`} className="rounded border border-slate-200 p-2">
                        <div className="font-medium text-slate-800 text-sm mb-1">{num}.</div>
                        <div className="flex flex-wrap gap-1">
                          {(q.options || []).map((opt, optIdx) => (
                            <label
                              key={optIdx}
                              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium cursor-pointer ${
                                answers[key]?.selectedOptionKey === (opt.key ?? label(optIdx)) ? "border-primary bg-primary text-white" : "border-slate-300 hover:border-slate-400"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`drawer-q-${key}`}
                                className="sr-only"
                                checked={answers[key]?.selectedOptionKey === (opt.key ?? label(optIdx)) || answers[key]?.selectedOptionId === opt.id}
                                onChange={() => setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], selectedOptionKey: opt.key ?? label(optIdx), selectedOptionId: opt.id } }))}
                              />
                              {opt.key ?? label(optIdx)}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  if (kind === "situation") {
                    const sitIdx = situationIndexForQuestion(q);
                    return (
                      <div key={key} id={`pdf-answer-q-${idx}`} className="rounded border border-slate-200 p-2">
                        <div className="font-medium text-slate-800 text-sm mb-1">{num}. Situasiya</div>
                        <button type="button" onClick={() => setSituationModal(sitIdx)} className="w-full rounded border border-slate-300 py-1.5 text-sm hover:bg-slate-50 min-h-[44px]">
                          Uzun cavab (rəsm)
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={key} id={`pdf-answer-q-${idx}`} className="rounded border border-slate-200 p-2">
                      <div className="font-medium text-slate-800 text-sm mb-1">{num}. Açıq</div>
                      <AutoExpandTextarea
                        className="input w-full text-sm min-h-[80px]"
                        placeholder="Cavab..."
                        value={answers[key]?.textAnswer ?? ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], textAnswer: e.target.value } }))}
                        rows={3}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
        </>
      )}

      {situationModal != null && onSaveCanvas && (() => {
        const sitQ = situationQuestions[situationModal - 1];
        const sitKey = sitQ ? getAnswerKey(sitQ) : "";
        const questionId = sitQ?.questionId ?? undefined;
        const canvasForSituation = canvases?.find((c) => c.situationIndex === situationModal);
        const handleCloseModal = async () => {
          if (situationCanvasRef.current) {
            const data = situationCanvasRef.current.getCanvasData();
            if (data.snapshotBase64 || (data.json && Object.keys(data.json).length > 0)) {
              try {
                await onSaveCanvas(questionId, situationModal)({
                  json: data.json,
                  snapshotBase64: data.snapshotBase64,
                  width: data.width,
                  height: data.height,
                });
              } catch (_) {}
            }
          }
          setSituasiyaSaveStatus(null);
          setSituationModal(null);
        };
        const handleManualSave = async () => {
          if (!situationCanvasRef.current) return;
          const data = situationCanvasRef.current.getCanvasData();
          try {
            setSituasiyaSaveStatus("saving");
            await onSaveCanvas(questionId, situationModal)({
              json: data.json,
              snapshotBase64: data.snapshotBase64,
              width: data.width,
              height: data.height,
            });
            setSituasiyaSaveStatus("saved");
            setTimeout(() => setSituasiyaSaveStatus(null), 2000);
          } catch {
            setSituasiyaSaveStatus("error");
            setTimeout(() => setSituasiyaSaveStatus(null), 3000);
          }
        };
        return (
          <Modal isOpen={true} onClose={handleCloseModal} title="Situasiya cavabı" size="lg">
            <div className="space-y-4 bg-white min-h-0">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cavab (mətn)</label>
                <AutoExpandTextarea
                  className="input w-full min-h-[140px] text-sm"
                  placeholder="Cavabı bura yazın…"
                  value={sitKey ? (answers[sitKey]?.textAnswer ?? "") : ""}
                  onChange={(e) => {
                    if (!sitKey) return;
                    setAnswers((prev) => ({ ...prev, [sitKey]: { ...prev[sitKey], textAnswer: e.target.value } }));
                  }}
                  rows={5}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700 mb-1">Qaralama (rəsm)</p>
                <SituasiyaCanvas
                  key={situationModal}
                  ref={situationCanvasRef}
                  initialJson={(canvasForSituation as { canvasJson?: object })?.canvasJson ?? null}
                  initialImageUrl={canvasForSituation?.imageUrl ?? null}
                  situationIndex={situationModal}
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  {situasiyaSaveStatus === "saving" && <span className="text-sm text-slate-500">Saxlanılır...</span>}
                  {situasiyaSaveStatus === "saved" && <span className="text-sm text-green-600">Yadda saxlanıldı</span>}
                  {situasiyaSaveStatus === "error" && <span className="text-sm text-red-600">Xəta. Yenidən cəhd edin.</span>}
                  <button
                    type="button"
                    onClick={handleManualSave}
                    disabled={situasiyaSaveStatus === "saving"}
                    className="btn-primary text-sm px-3 py-1.5"
                  >
                    💾 Yadda saxla
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={handleCloseModal} className="btn-outline">
                Bağla
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
});
