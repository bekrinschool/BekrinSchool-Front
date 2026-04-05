"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type Ref,
} from "react";
import {
  Clock,
  Eraser,
  Loader2,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Pen,
  Send,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import SituasiyaCanvas, { SituasiyaCanvasRef } from "@/components/exam/SituasiyaCanvas";
import { AutoExpandTextarea } from "@/components/exam/AutoExpandTextarea";
import { PortalDialog } from "@/components/PortalDialog";
import { useToast } from "@/components/Toast";
import { studentApi } from "@/lib/student";

const LABELS = ["A", "B", "C", "D", "E", "F"];
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.25;

export type PdfExamTakerQuestion = {
  questionNumber?: number;
  displayNumber?: number;
  questionId?: number;
  /** User JSON: closed | open | situation (preferred when present) */
  qtype?: string;
  kind?: string;
  type?: string;
  text?: string;
  prompt?: string;
  options?: { id?: number | string; key?: string; text: string; order?: number }[];
  open_rule?: string;
  matching_left?: string[];
  matching_right?: string[];
};

export type PdfQuestionQtype = "closed" | "open" | "situation" | "other";

/** Data-driven: use `qtype` from API/JSON, then kind/type aliases. */
export function resolvePdfQtype(q: PdfExamTakerQuestion): PdfQuestionQtype {
  const raw = (q.qtype || q.kind || q.type || "").toString().trim().toLowerCase();
  if (raw === "closed" || raw === "mc" || raw === "multiple_choice") return "closed";
  if (raw === "open" || raw.startsWith("open")) return "open";
  if (raw === "situation" || raw === "sit" || raw === "situasiya") return "situation";
  return "other";
}

export const PDF_ATTEMPT_ANSWERS_LS_PREFIX = "bekrin_pdf_attempt_answers_v1_";

export function clearPdfAttemptAnswersLocalStorage(attemptId: number) {
  try {
    localStorage.removeItem(PDF_ATTEMPT_ANSWERS_LS_PREFIX + String(attemptId));
  } catch {
    /* ignore */
  }
}

export type PdfCompactAnswerRow = {
  no: number;
  qtype: string;
  answer: string;
  questionId?: number;
};

/** Stable question number for PDF/JSON blueprint (`number` or `questionNumber`). */
export function questionNo(q: PdfExamTakerQuestion): number {
  const n = (q as { number?: number }).number ?? q.questionNumber ?? q.displayNumber;
  if (n == null) return 0;
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function qtypeForPayload(q: PdfExamTakerQuestion): string {
  const t = (q.qtype || "").toString().trim().toLowerCase();
  if (t === "mc" || t === "multiple_choice") return "closed";
  if (t) return t;
  const r = resolvePdfQtype(q);
  if (r === "closed") return "closed";
  if (r === "situation") return "situation";
  return "open";
}

export function buildPdfCompactAnswers(
  qs: PdfExamTakerQuestion[],
  studentAnswers: Record<number, string>
): PdfCompactAnswerRow[] {
  return qs.map((q) => {
    const no = questionNo(q);
    const raw = studentAnswers[no];
    return {
      no,
      qtype: qtypeForPayload(q),
      answer: raw == null ? "" : String(raw),
      ...(q.questionId != null ? { questionId: q.questionId } : {}),
    };
  });
}

function readPdfStudentAnswersLs(attemptId: number, examId: number): Record<number, string> | null {
  try {
    const raw = localStorage.getItem(PDF_ATTEMPT_ANSWERS_LS_PREFIX + String(attemptId));
    if (!raw) return null;
    const p = JSON.parse(raw) as {
      examId?: number;
      studentAnswers?: Record<string, string>;
      answers?: Record<string, { selectedOptionKey?: string; selectedOptionId?: unknown; textAnswer?: string }>;
    };
    if (p.examId != null && Number(p.examId) !== Number(examId)) return null;
    if (p.studentAnswers && typeof p.studentAnswers === "object") {
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(p.studentAnswers)) {
        const n = Number(k);
        if (Number.isFinite(n)) out[n] = String(v ?? "");
      }
      return out;
    }
    if (p.answers && typeof p.answers === "object") {
      const out: Record<number, string> = {};
      for (const [k, a] of Object.entries(p.answers)) {
        const m = /^n-(\d+)$/.exec(k);
        if (!m) continue;
        const n = Number(m[1]);
        const key = String(a?.selectedOptionKey ?? "").trim();
        if (key) out[n] = key;
        else if (a?.selectedOptionId != null && String(a.selectedOptionId).trim() !== "") out[n] = String(a.selectedOptionId);
        else if (a?.textAnswer != null) out[n] = String(a.textAnswer);
      }
      return Object.keys(out).length ? out : null;
    }
    return null;
  } catch {
    return null;
  }
}

function writePdfStudentAnswersLs(attemptId: number, examId: number, map: Record<number, string>) {
  try {
    const serial: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      serial[String(k)] = String(v ?? "");
    }
    localStorage.setItem(
      PDF_ATTEMPT_ANSWERS_LS_PREFIX + String(attemptId),
      JSON.stringify({ examId, savedAt: Date.now(), studentAnswers: serial })
    );
  } catch {
    /* ignore */
  }
}

function hasEmptyStudentAnswers(qs: PdfExamTakerQuestion[], map: Record<number, string>): boolean {
  for (const q of qs) {
    const no = questionNo(q);
    if (!no) continue;
    if (!String(map[no] ?? "").trim()) return true;
  }
  return false;
}

export type ScribbleDrawingData = {
  strokes?: { tool: "pen" | "eraser"; width: number; points: { x: number; y: number }[] }[];
};

/** True if scratchpad page has drawable ink (avoids ghost saves / empty upserts wiping DB). */
export function pdfScribbleDrawingHasInk(data: ScribbleDrawingData | undefined | null): boolean {
  const strokes = data?.strokes;
  if (!Array.isArray(strokes) || strokes.length === 0) return false;
  return strokes.some((s) => (s?.points?.length ?? 0) >= 2);
}

function normalizeDrawingDataFromApi(dd: unknown): ScribbleDrawingData {
  if (dd == null) return { strokes: [] };
  if (typeof dd === "string") {
    try {
      const p = JSON.parse(dd) as unknown;
      if (p && typeof p === "object") return p as ScribbleDrawingData;
    } catch {
      /* ignore */
    }
    return { strokes: [] };
  }
  if (typeof dd === "object") return dd as ScribbleDrawingData;
  return { strokes: [] };
}

function coerceFabricCanvasJson(raw: unknown): object | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as object;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return p != null && typeof p === "object" ? (p as object) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** draft_{examId}_{attemptId} — attempt is unique per student session (user id not required on client). */
export function pdfScratchpadStorageKey(examId: number, attemptId: number) {
  return `draft_${examId}_${attemptId}`;
}

export function clearPdfScratchpadLocalStorage(examId: number, attemptId: number) {
  try {
    localStorage.removeItem(pdfScratchpadStorageKey(examId, attemptId));
  } catch {
    /* ignore */
  }
}

type ScratchpadLsFile = { savedAt?: number; scribbles: { pageIndex: number; drawingData: ScribbleDrawingData }[] };

function readScratchpadLs(examId: number, attemptId: number): ScratchpadLsFile | null {
  try {
    const raw = localStorage.getItem(pdfScratchpadStorageKey(examId, attemptId));
    if (!raw) return null;
    const p = JSON.parse(raw) as ScratchpadLsFile;
    if (!Array.isArray(p.scribbles)) return null;
    return p;
  } catch {
    return null;
  }
}

function writeScratchpadLs(examId: number, attemptId: number, scribbles: ScratchpadLsFile["scribbles"]) {
  try {
    localStorage.setItem(
      pdfScratchpadStorageKey(examId, attemptId),
      JSON.stringify({ savedAt: Date.now(), scribbles })
    );
  } catch {
    /* ignore */
  }
}

function applyScratchpadPayloadToRef(
  items: unknown,
  ref: MutableRefObject<Map<number, ScribbleDrawingData>>
): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  let any = false;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const pi = rec.pageIndex ?? rec.page_index;
    const dd = rec.drawingData ?? rec.drawing_data;
    if (pi == null) continue;
    const pageIndex = Number(pi);
    if (!Number.isFinite(pageIndex) || pageIndex < 0) continue;
    ref.current.set(pageIndex, normalizeDrawingDataFromApi(dd));
    any = true;
  }
  return any;
}

function getAnswerKey(q: PdfExamTakerQuestion): string {
  return q.questionId != null ? String(q.questionId) : `n-${q.questionNumber ?? 0}`;
}

type SavedAnswerRow = {
  questionId?: number;
  questionNumber?: number;
  selectedOptionId?: number | string;
  selectedOptionKey?: string;
  textAnswer?: string;
  text_answer?: string;
};

/** Map DB draft rows → studentAnswers keyed by question `no` (fixes situasiya mətni “Davam et”). */
function studentAnswersFromSavedRows(
  questions: PdfExamTakerQuestion[],
  rows: SavedAnswerRow[] | undefined
): Record<number, string> {
  const out: Record<number, string> = {};
  if (!rows?.length) return out;
  const byNum = new Map<number, SavedAnswerRow>();
  for (const r of rows) {
    if (r.questionNumber == null) continue;
    byNum.set(Number(r.questionNumber), r);
  }
  for (const q of questions) {
    const no = questionNo(q);
    if (!no) continue;
    const r = byNum.get(no);
    if (!r) continue;
    const qt = resolvePdfQtype(q);
    const rawText = r.textAnswer ?? r.text_answer;
    if (qt === "closed") {
      const k = (r.selectedOptionKey || "").trim();
      if (k) out[no] = String(k);
      else if (r.selectedOptionId != null && String(r.selectedOptionId).trim() !== "") out[no] = String(r.selectedOptionId);
    } else if (qt === "situation" || qt === "open") {
      if (rawText != null) out[no] = String(rawText);
    } else if (rawText != null && String(rawText).trim() !== "") {
      out[no] = String(rawText);
    }
  }
  return out;
}

type PdfAttemptCanvasRow = {
  questionId?: number;
  situationIndex?: number;
  imageUrl?: string | null;
  canvasJson?: object;
  canvasSnapshot?: string | null;
};

/**
 * Hazır İmtahan-style: which situasiya `no` already has DB mətn and/or canvas (Davam et).
 * PDF exam uses attempt APIs + props (no shared useExamStore scratchpad).
 */
function computePdfSituationResumeSyncedByNo(
  qs: PdfExamTakerQuestion[],
  savedAnswerRows: SavedAnswerRow[] | undefined,
  canvases: PdfAttemptCanvasRow[] | undefined,
  textOverlay?: Record<number, string>
): Record<number, boolean> {
  const fromServer = studentAnswersFromSavedRows(qs, savedAnswerRows);
  const idxMap = new Map<string, number>();
  let ord = 0;
  for (const qq of qs) {
    if (resolvePdfQtype(qq) !== "situation") continue;
    ord += 1;
    idxMap.set(getAnswerKey(qq), ord);
  }
  const out: Record<number, boolean> = {};
  for (const q of qs) {
    if (resolvePdfQtype(q) !== "situation") continue;
    const num = questionNo(q);
    if (!num) continue;
    const hasText = String(fromServer[num] ?? textOverlay?.[num] ?? "").trim().length > 0;
    const sitIdx = idxMap.get(getAnswerKey(q)) ?? 0;
    let hasCanvas = false;
    if (sitIdx >= 1 && canvases?.length) {
      const row = canvases.find(
        (c) => (q.questionId != null && c.questionId === q.questionId) || c.situationIndex === sitIdx
      );
      const r = row as PdfAttemptCanvasRow | undefined;
      hasCanvas = !!(
        r &&
        (r.canvasJson != null ||
          (typeof r.imageUrl === "string" && r.imageUrl.length > 0) ||
          (typeof r.canvasSnapshot === "string" && r.canvasSnapshot.length > 0))
      );
    }
    if (hasText || hasCanvas) out[num] = true;
  }
  return out;
}

function mergePdfSituationResumeFlags(
  prev: Record<number, boolean>,
  incoming: Record<number, boolean>
): Record<number, boolean> {
  const next = { ...prev };
  for (const [nk, v] of Object.entries(incoming)) {
    const n = Number(nk);
    if (v && next[n] !== false) next[n] = true;
  }
  return next;
}

export interface PdfExamTakerRef {
  getAnswersForSubmit: () => PdfCompactAnswerRow[];
  flushScribbles: () => Promise<void>;
  saveAllSituasiyaCanvases: () => Promise<void>;
  /** Flush scratchpad + bubble-sheet draft to the server (anti-cheat / pre-submit). */
  persistDraftAndScratchpad: () => Promise<void>;
  /** True while PDF scratchpad or situasiya draft save is in flight (submit should wait). */
  isDraftSaveInProgress: () => boolean;
}

export interface PdfExamTakerProps {
  /** Anticheat fullscreen target (parent compares document.fullscreenElement to this node). */
  rootRef?: Ref<HTMLDivElement>;
  runId: number;
  attemptId: number;
  /** Used for localStorage scoping + recovery */
  examId: number;
  title: string;
  questions: PdfExamTakerQuestion[];
  /** From run/start response — immediate hydration before GET /state returns */
  bootstrapSavedAnswers?: Array<{
    questionId?: number;
    questionNumber?: number;
    selectedOptionId?: number | string;
    selectedOptionKey?: string;
    textAnswer?: string;
  }>;
  canvases?: {
    canvasId: number;
    questionId?: number;
    situationIndex?: number;
    imageUrl: string | null;
    updatedAt: string;
    canvasJson?: object;
    canvasSnapshot?: string | null;
  }[];
  onSaveCanvas?: (
    questionId?: number,
    situationIndex?: number
  ) => (
    data: string | { json: object; snapshotBase64: string; width: number; height: number },
    pageIndex?: number
  ) => Promise<void>;
  initialPdfScribbles?: { pageIndex: number; drawingData: ScribbleDrawingData }[] | null;
  countdownMs: number;
  formatCountdown: (ms: number) => string;
  submitMutation: { isPending: boolean };
  /** Called after user confirms submit in the header dialog (parent runs submitMutation) */
  onSubmitConfirmed: () => void;
  /** Set true at start of Göndər, false if user cancels empty-answer confirm — prevents fullscreen anti-cheat hijack. */
  onManualSubmitLockChange?: (locked: boolean) => void;
  resumeQuestionIndex?: number;
}

export const PdfExamTaker = forwardRef<PdfExamTakerRef, PdfExamTakerProps>(function PdfExamTaker(
  {
    rootRef,
    runId,
    attemptId,
    examId,
    title,
    questions,
    bootstrapSavedAnswers,
    canvases = [],
    onSaveCanvas,
    initialPdfScribbles,
    countdownMs,
    formatCountdown,
    submitMutation,
    onSubmitConfirmed,
    onManualSubmitLockChange,
    resumeQuestionIndex,
  },
  ref
) {
  const toast = useToast();
  const [pages, setPages] = useState<string[]>([]);
  const [loadingPages, setLoadingPages] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const lineWidth = 4;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [situationFsNo, setSituationFsNo] = useState<number | null>(null);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }[]>([]);
  const [containerWidth, setContainerWidth] = useState(800);
  const [windowWidth, setWindowWidth] = useState(1280);
  const [studentAnswers, setStudentAnswers] = useState<Record<number, string>>(() => {
    const fromBootstrap = studentAnswersFromSavedRows(questions, bootstrapSavedAnswers);
    const ls = readPdfStudentAnswersLs(attemptId, examId);
    return { ...fromBootstrap, ...(ls ?? {}) };
  });

  const isDrawerMode = windowWidth < 1280;
  const isMobile = windowWidth < 768;
  const [scratchpadSavePending, setScratchpadSavePending] = useState(false);
  /** PDF page scratchpad rows were loaded from DB — show green “Yadda saxlanıldı” in header. */
  const [pdfScratchpadDbRestored, setPdfScratchpadDbRestored] = useState(false);
  /** SituationSmartCard: `studentSaveStatus` per sual `no` */
  const [pdfSituationSaveStatus, setPdfSituationSaveStatus] = useState<
    Record<number, "idle" | "saving" | "saved" | "error">
  >({});
  /** Davam et: server had mətn/canvas for this `no` → show “Yadda saxlanıldı” until user edits */
  const [pdfSituationResumeSynced, setPdfSituationResumeSynced] = useState<Record<number, boolean>>({});
  const [scribbleRedrawTick, setScribbleRedrawTick] = useState(0);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const submitConfirmHasEmptyRef = useRef(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Unscaled width source for page layout (scroll surface, not the scaled pages node). */
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const pinchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const overlayCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const scribblesRef = useRef<Map<number, ScribbleDrawingData>>(new Map());
  /** After explicit “clear page”, allow one persist of empty strokes so DB matches. */
  const forcePersistEmptyScratchPagesRef = useRef<Set<number>>(new Set());
  const scribbleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scratchpadLsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scratchpadSaveLockRef = useRef(false);
  const situationDraftSaveLockRef = useRef(false);
  const answersPersistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStrokeRef = useRef<{ tool: "pen" | "eraser"; width: number; points: { x: number; y: number }[] } | null>(
    null
  );
  const isDrawingRef = useRef(false);
  const situationCanvasRefsMap = useRef<Map<number, SituasiyaCanvasRef | null>>(new Map());
  const answerPanelScrollRef = useRef<HTMLDivElement>(null);
  const answerDrawerScrollRef = useRef<HTMLDivElement>(null);
  const studentAnswersRef = useRef(studentAnswers);
  const questionsRef = useRef(questions);
  const canvasesRef = useRef(canvases);
  studentAnswersRef.current = studentAnswers;
  questionsRef.current = questions;
  canvasesRef.current = canvases ?? [];

  /** 1-based index for API canvas rows (must match server situationIndex). Document order. */
  const situationIndexByAnswerKey = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const q of questions) {
      if (resolvePdfQtype(q) !== "situation") continue;
      n += 1;
      m.set(getAnswerKey(q), n);
    }
    return m;
  }, [questions]);

  const situationIndexForQuestion = (q: PdfExamTakerQuestion): number => {
    return situationIndexByAnswerKey.get(getAnswerKey(q)) ?? 0;
  };

  const situationQuestionNos = useMemo(() => {
    const s = new Set<number>();
    for (const q of questions) {
      if (resolvePdfQtype(q) !== "situation") continue;
      const n = questionNo(q);
      if (n) s.add(n);
    }
    return s;
  }, [questions]);

  const anySituationSaving = useMemo(
    () => Object.values(pdfSituationSaveStatus).some((x) => x === "saving"),
    [pdfSituationSaveStatus]
  );

  useEffect(() => {
    if (answersPersistDebounceRef.current) clearTimeout(answersPersistDebounceRef.current);
    answersPersistDebounceRef.current = setTimeout(() => {
      answersPersistDebounceRef.current = null;
      const map = studentAnswersRef.current;
      writePdfStudentAnswersLs(attemptId, examId, map);
      const list = buildPdfCompactAnswers(questionsRef.current, map);
      void studentApi.saveDraftAnswers(attemptId, list).catch(() => {});
    }, 550);
    return () => {
      if (answersPersistDebounceRef.current) {
        clearTimeout(answersPersistDebounceRef.current);
        answersPersistDebounceRef.current = null;
      }
    };
  }, [studentAnswers, attemptId, examId]);

  const scheduleScribblePersist = useCallback(() => {
    if (scribbleDebounceRef.current) clearTimeout(scribbleDebounceRef.current);
    scribbleDebounceRef.current = setTimeout(() => {
      scribbleDebounceRef.current = null;
      const pending = Array.from(scribblesRef.current.entries()).filter(
        ([pageIndex, drawingData]) =>
          pdfScribbleDrawingHasInk(drawingData || {}) || forcePersistEmptyScratchPagesRef.current.has(pageIndex)
      );
      if (pending.length === 0) return;
      void Promise.all(
        pending.map(([pageIndex, drawingData]) =>
          studentApi.savePdfScribbles(attemptId, {
            examId,
            pageIndex,
            drawingData: drawingData || {},
          })
        )
      )
        .then(() => {
          for (const [pi] of pending) forcePersistEmptyScratchPagesRef.current.delete(pi);
        })
        .catch(() => {});
    }, 1000);
  }, [attemptId, examId]);

  const scheduleScratchpadLsBackup = useCallback(() => {
    if (scratchpadLsDebounceRef.current) clearTimeout(scratchpadLsDebounceRef.current);
    scratchpadLsDebounceRef.current = setTimeout(() => {
      scratchpadLsDebounceRef.current = null;
      const scribbles = Array.from(scribblesRef.current.entries()).map(([pageIndex, drawingData]) => ({
        pageIndex,
        drawingData: drawingData || { strokes: [] },
      }));
      writeScratchpadLs(examId, attemptId, scribbles);
    }, 2000);
  }, [examId, attemptId]);

  useEffect(() => {
    const check = () => setWindowWidth(window.innerWidth);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  /** Single scroll surface for PDF: hide document scroll to avoid double scrollbars / layout shift. */
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [st, scribbleGet] = await Promise.all([
          studentApi.getAttemptState(attemptId),
          studentApi.getPdfScribbles(attemptId).catch(() => ({ scribbles: [] as { pageIndex: number; drawingData: Record<string, unknown> }[] })),
        ]);
        if (cancelled || st.submitted) return;
        const fromServer = studentAnswersFromSavedRows(questionsRef.current, st.savedAnswers);
        const mergedAnswers = (() => {
          const prev = studentAnswersRef.current;
          const next = { ...fromServer, ...prev };
          for (const q of questionsRef.current) {
            if (resolvePdfQtype(q) !== "situation") continue;
            const no = questionNo(q);
            if (fromServer[no] !== undefined) next[no] = String(fromServer[no]);
          }
          return next;
        })();
        studentAnswersRef.current = mergedAnswers;
        setStudentAnswers(mergedAnswers);

        const stExt = st as {
          scratchpadData?: unknown;
          scratchpad_data?: unknown;
        };
        const sp = stExt.scratchpadData ?? stExt.scratchpad_data;
        let applied = false;
        let appliedFromDb = false;
        if (applyScratchpadPayloadToRef(sp, scribblesRef)) {
          applied = true;
          appliedFromDb = true;
        }

        const resumeFlags = computePdfSituationResumeSyncedByNo(
          questionsRef.current,
          st.savedAnswers as SavedAnswerRow[] | undefined,
          (canvasesRef.current ?? []) as PdfAttemptCanvasRow[],
          mergedAnswers
        );
        if (Object.keys(resumeFlags).length > 0) {
          setPdfSituationResumeSynced((prev) => mergePdfSituationResumeFlags(prev, resumeFlags));
        }
        if (!applied && scribbleGet?.scribbles?.length) {
          if (applyScratchpadPayloadToRef(scribbleGet.scribbles, scribblesRef)) {
            applied = true;
            appliedFromDb = true;
          }
        }
        if (!applied) {
          const ls = readScratchpadLs(examId, attemptId);
          if (ls?.scribbles?.length) {
            applied = applyScratchpadPayloadToRef(ls.scribbles, scribblesRef);
          }
        }
        if (applied) {
          if (appliedFromDb) {
            setPdfScratchpadDbRestored(true);
            console.log("PDF scratchpad restored from DB", { examId, attemptId, attempt_id: attemptId });
          }
          setScribbleRedrawTick((t) => t + 1);
        }
      } catch {
        if (cancelled) return;
        const ls = readScratchpadLs(examId, attemptId);
        if (ls?.scribbles?.length && applyScratchpadPayloadToRef(ls.scribbles, scribblesRef)) {
          setScribbleRedrawTick((t) => t + 1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId, examId]);

  useEffect(() => {
    const fromBootstrap = studentAnswersFromSavedRows(questionsRef.current, bootstrapSavedAnswers);
    const ls = readPdfStudentAnswersLs(attemptId, examId);
    const next = { ...fromBootstrap, ...(ls ?? {}) };
    setStudentAnswers(next);
    studentAnswersRef.current = next;
  }, [attemptId, examId, bootstrapSavedAnswers]);

  useEffect(() => {
    const flags = computePdfSituationResumeSyncedByNo(
      questions,
      bootstrapSavedAnswers as SavedAnswerRow[] | undefined,
      (canvases ?? []) as PdfAttemptCanvasRow[],
      studentAnswersRef.current
    );
    if (Object.keys(flags).length === 0) return;
    setPdfSituationResumeSynced((prev) => mergePdfSituationResumeFlags(prev, flags));
  }, [questions, bootstrapSavedAnswers, canvases]);

  useEffect(() => {
    return () => {
      if (answersPersistDebounceRef.current) clearTimeout(answersPersistDebounceRef.current);
      if (scribbleDebounceRef.current) clearTimeout(scribbleDebounceRef.current);
      if (scratchpadLsDebounceRef.current) clearTimeout(scratchpadLsDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingPages(true);
    setPageError(null);
    studentApi
      .getRunPages(runId)
      .then((res) => {
        if (!cancelled) setPages(res.pages || []);
      })
      .catch(() => {
        if (!cancelled) {
          setPageError("Səhifələr yüklənmədi");
          setPages([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateWidth = () => setContainerWidth(el.clientWidth || 800);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.length]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = (t: TouchList) => {
      if (t.length < 2) return 0;
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.hypot(dx, dy);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const d = dist(e.touches);
        if (d > 0) pinchStartRef.current = { dist: d, scale: scaleRef.current };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchStartRef.current) return;
      e.preventDefault();
      const d = dist(e.touches);
      if (d <= 0) return;
      const s0 = pinchStartRef.current.scale;
      const d0 = pinchStartRef.current.dist;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (s0 * d) / d0));
      pinchStartRef.current = { dist: d, scale: next };
      setScale(next);
    };
    const endPinch = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchStartRef.current = null;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", endPinch);
    el.addEventListener("touchcancel", endPinch);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", endPinch);
      el.removeEventListener("touchcancel", endPinch);
    };
  }, [loadingPages, pages.length]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    scrollContainerRef.current?.scrollTo({ top: 0, left: 0 });
    answerPanelScrollRef.current?.scrollTo({ top: 0, left: 0 });
    answerDrawerScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [attemptId]);

  useEffect(() => {
    if (resumeQuestionIndex == null || resumeQuestionIndex < 0) return;
    const id = `pdf-taker-q-${resumeQuestionIndex}`;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 400);
    return () => window.clearTimeout(t);
  }, [resumeQuestionIndex, questions.length]);

  useEffect(() => {
    if (!initialPdfScribbles?.length) return;
    initialPdfScribbles.forEach(({ pageIndex, drawingData }) => {
      scribblesRef.current.set(pageIndex, drawingData || { strokes: [] });
    });
    if (initialPdfScribbles.some(({ drawingData }) => pdfScribbleDrawingHasInk(drawingData))) {
      setPdfScratchpadDbRestored(true);
    }
    setScribbleRedrawTick((t) => t + 1);
  }, [initialPdfScribbles]);

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
    if (pageDimensions.length === 0) return;
    for (let i = 0; i < pageDimensions.length; i++) {
      const data = scribblesRef.current.get(i);
      const overlay = overlayCanvasesRef.current.get(i);
      if (!overlay) continue;
      const ctx = overlay.getContext("2d");
      if (!ctx) continue;
      if (overlay.width > 0 && overlay.height > 0) ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (!data?.strokes?.length) continue;
      data.strokes.forEach((stroke) => {
        ctx.strokeStyle = stroke.tool === "eraser" ? "rgba(255,255,255,1)" : "#000";
        ctx.lineWidth = stroke.tool === "eraser" ? stroke.width * 2 : stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
        if (!stroke.points || stroke.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        stroke.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      });
    }
  }, [pageDimensions, scribbleRedrawTick]);

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
    (_e: React.PointerEvent, pageIndex: number) => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return;
      const stroke = currentStrokeRef.current;
      currentStrokeRef.current = null;
      isDrawingRef.current = false;
      const data = scribblesRef.current.get(pageIndex) || { strokes: [] };
      const strokes = [...(data.strokes || []), stroke];
      scribblesRef.current.set(pageIndex, { ...data, strokes });
      scheduleScribblePersist();
      scheduleScratchpadLsBackup();
    },
    [scheduleScribblePersist, scheduleScratchpadLsBackup]
  );

  const handleClearPage = useCallback(
    (pageIndex: number) => {
      const overlay = overlayCanvasesRef.current.get(pageIndex);
      if (overlay) {
        const ctx = overlay.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
      scribblesRef.current.set(pageIndex, { strokes: [] });
      forcePersistEmptyScratchPagesRef.current.add(pageIndex);
      scheduleScribblePersist();
      scheduleScratchpadLsBackup();
    },
    [scheduleScribblePersist, scheduleScratchpadLsBackup]
  );

  const flushScribbles = useCallback(async () => {
    if (scribbleDebounceRef.current) {
      clearTimeout(scribbleDebounceRef.current);
      scribbleDebounceRef.current = null;
    }
    const pending = Array.from(scribblesRef.current.entries());
    if (pending.length) {
      await Promise.all(
        pending.map(([pageIndex, drawingData]) =>
          studentApi.savePdfScribbles(attemptId, {
            examId,
            pageIndex,
            drawingData: drawingData || {},
          })
        )
      ).catch(() => {});
    }
  }, [attemptId, examId]);

  const persistPdfDraftNow = useCallback(async () => {
    if (answersPersistDebounceRef.current) {
      clearTimeout(answersPersistDebounceRef.current);
      answersPersistDebounceRef.current = null;
    }
    const raw = studentAnswersRef.current;
    const map: Record<number, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(k);
      if (Number.isFinite(n)) map[n] = String(v ?? "");
    }
    writePdfStudentAnswersLs(attemptId, examId, map);
    const list = buildPdfCompactAnswers(questionsRef.current, map);
    await studentApi.saveDraftAnswers(attemptId, list);
  }, [attemptId, examId]);

  const saveSituationCanvasAtIndex = useCallback(
    async (sitIdx: number, questionId?: number) => {
      if (!onSaveCanvas || sitIdx < 1) return;
      const canvasRef = situationCanvasRefsMap.current.get(sitIdx);
      if (!canvasRef?.getCanvasData) return;
      const data = canvasRef.getCanvasData();
      if (!data.snapshotBase64 && !(data.json && Object.keys(data.json || {}).length > 0)) return;
      // Mirror Hazır İmtahan: send situationIndex only when questionId is absent (exams/page handleSaveCanvas).
      const situationIndexForApi = questionId == null ? sitIdx : undefined;
      await onSaveCanvas(questionId, situationIndexForApi)({
        json: data.json,
        snapshotBase64: data.snapshotBase64,
        width: data.width,
        height: data.height,
      });
    },
    [onSaveCanvas]
  );

  /**
   * SituationSmartCard.saveStudentCanvas + PDF `saveDraftAnswers` (mətn by `no`).
   * Same sequence: saving → await onCanvasSave(data) when canvas non-empty → saved → toast → idle @ 1800ms.
   */
  const pdfSituationSaveDraft = useCallback(
    async (sitIdx: number, questionId: number | undefined, questionNo: number) => {
      situationDraftSaveLockRef.current = true;
      setPdfSituationSaveStatus((prev) => ({ ...prev, [questionNo]: "saving" }));
      const fabricRef = sitIdx >= 1 ? situationCanvasRefsMap.current.get(sitIdx) : undefined;
      fabricRef?.markServerSaving?.();
      try {
        await persistPdfDraftNow();
        if (sitIdx >= 1 && onSaveCanvas) {
          const canvasRef = situationCanvasRefsMap.current.get(sitIdx);
          if (canvasRef?.getCanvasData) {
            const data = canvasRef.getCanvasData();
            if (data.snapshotBase64 || Object.keys(data.json || {}).length > 0) {
              const situationIndexForApi = questionId == null ? sitIdx : undefined;
              await onSaveCanvas(questionId, situationIndexForApi)({
                json: data.json,
                snapshotBase64: data.snapshotBase64,
                width: data.width,
                height: data.height,
              });
            }
          }
        }
        fabricRef?.markServerSaved?.();
        setPdfSituationSaveStatus((prev) => ({ ...prev, [questionNo]: "saved" }));
        setPdfSituationResumeSynced((prev) => ({ ...prev, [questionNo]: true }));
        toast.success("Uğurla saxlanıldı");
        window.setTimeout(() => {
          setPdfSituationSaveStatus((prev) => {
            if (prev[questionNo] !== "saved") return prev;
            return { ...prev, [questionNo]: "idle" };
          });
        }, 1800);
      } catch (e: unknown) {
        console.error("Situation save failed", e);
        fabricRef?.markServerSaveFailed?.();
        setPdfSituationSaveStatus((prev) => ({ ...prev, [questionNo]: "error" }));
        const msg =
          e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : "";
        toast.error(msg || "Saxlama alınmadı");
      } finally {
        situationDraftSaveLockRef.current = false;
      }
    },
    [onSaveCanvas, persistPdfDraftNow, toast]
  );

  /** Best-effort: persist every inline situation canvas before submit. */
  const saveAllSituasiyaCanvases = useCallback(async () => {
    if (!onSaveCanvas) return;
    const qs = questionsRef.current;
    const idxMap = new Map<string, number>();
    let n = 0;
    for (const q of qs) {
      if (resolvePdfQtype(q) !== "situation") continue;
      n += 1;
      idxMap.set(getAnswerKey(q), n);
    }
    for (const q of qs) {
      if (resolvePdfQtype(q) !== "situation") continue;
      const sitIdx = idxMap.get(getAnswerKey(q)) ?? 0;
      if (sitIdx < 1) continue;
      await saveSituationCanvasAtIndex(sitIdx, q.questionId ?? undefined);
    }
  }, [onSaveCanvas, saveSituationCanvasAtIndex]);

  const handleScratchpadManualSave = useCallback(async () => {
    if (scratchpadSaveLockRef.current) return;
    scratchpadSaveLockRef.current = true;
    setScratchpadSavePending(true);
    try {
      if (answersPersistDebounceRef.current) {
        clearTimeout(answersPersistDebounceRef.current);
        answersPersistDebounceRef.current = null;
      }
      if (scribbleDebounceRef.current) {
        clearTimeout(scribbleDebounceRef.current);
        scribbleDebounceRef.current = null;
      }
      const scribbles = Array.from(scribblesRef.current.entries()).map(([pageIndex, drawingData]) => ({
        pageIndex,
        drawingData: drawingData || { strokes: [] },
      }));
      const toUpsert = scribbles.filter(
        ({ pageIndex, drawingData }) =>
          pdfScribbleDrawingHasInk(drawingData) || forcePersistEmptyScratchPagesRef.current.has(pageIndex)
      );
      console.log("Saving Draft for ID:", examId, {
        attemptId,
        scratchpadPages: toUpsert.map((s) => s.pageIndex),
        scribbleCount: toUpsert.length,
      });
      if (toUpsert.length > 0) {
        await studentApi.upsertScratchpad(attemptId, { examId, scribbles: toUpsert });
        for (const s of toUpsert) forcePersistEmptyScratchPagesRef.current.delete(s.pageIndex);
      }
      writeScratchpadLs(examId, attemptId, scribbles);
      await persistPdfDraftNow();
      await saveAllSituasiyaCanvases();
      toast.success("Uğurla yadda saxlanıldı");
    } catch {
      toast.error("Qaralama saxlanılmadı");
    } finally {
      scratchpadSaveLockRef.current = false;
      setScratchpadSavePending(false);
    }
  }, [attemptId, examId, persistPdfDraftNow, saveAllSituasiyaCanvases, toast]);

  const persistDraftAndScratchpad = useCallback(async () => {
    await flushScribbles();
    await persistPdfDraftNow();
  }, [flushScribbles, persistPdfDraftNow]);

  useImperativeHandle(
    ref,
    () => ({
      getAnswersForSubmit: () => buildPdfCompactAnswers(questionsRef.current, studentAnswersRef.current),
      flushScribbles,
      saveAllSituasiyaCanvases,
      persistDraftAndScratchpad,
      isDraftSaveInProgress: () =>
        scratchpadSaveLockRef.current ||
        situationDraftSaveLockRef.current ||
        scratchpadSavePending ||
        Object.values(pdfSituationSaveStatus).some((x) => x === "saving"),
    }),
    [flushScribbles, saveAllSituasiyaCanvases, persistDraftAndScratchpad, scratchpadSavePending, pdfSituationSaveStatus]
  );

  const preventFocusScroll = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const label = t.closest?.("label") as HTMLLabelElement | null;
    const focusable: HTMLElement | null = label
      ? ((label.control ?? (label.htmlFor ? document.getElementById(label.htmlFor) : null)) as HTMLElement | null)
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

  const setAnswer = useCallback((no: number, value: string) => {
    if (!no) return;
    const s = String(value);
    if (situationQuestionNos.has(no)) {
      setPdfSituationResumeSynced((prev) => ({ ...prev, [no]: false }));
      setPdfSituationSaveStatus((prev) => (prev[no] === "error" ? { ...prev, [no]: "idle" } : prev));
    }
    setStudentAnswers((prev) => {
      const next = { ...prev, [no]: s };
      studentAnswersRef.current = next;
      return next;
    });
  }, [situationQuestionNos]);

  const blockSubmitWhileDraftSaving = scratchpadSavePending || anySituationSaving;

  const handleFinalSubmit = useCallback(() => {
    if (submitMutation.isPending || blockSubmitWhileDraftSaving) return;
    submitConfirmHasEmptyRef.current = hasEmptyStudentAnswers(questionsRef.current, studentAnswersRef.current);
    setSubmitConfirmOpen(true);
  }, [submitMutation.isPending, blockSubmitWhileDraftSaving]);

  const confirmSubmitExam = useCallback(() => {
    if (
      scratchpadSaveLockRef.current ||
      situationDraftSaveLockRef.current ||
      scratchpadSavePending ||
      anySituationSaving
    ) {
      return;
    }
    setSubmitConfirmOpen(false);
    onManualSubmitLockChange?.(true);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onSubmitConfirmed();
  }, [onManualSubmitLockChange, onSubmitConfirmed, scratchpadSavePending, anySituationSaving]);

  const renderQuestionBlock = (q: PdfExamTakerQuestion, idx: number) => {
    const key = getAnswerKey(q);
    const no = questionNo(q);
    const qt = resolvePdfQtype(q);
    const num = q.questionNumber ?? idx + 1;
    const ansVal = studentAnswers[no] ?? "";
    const mcMatches = (optKey: string, optId: unknown) =>
      ansVal.toUpperCase() === optKey.toUpperCase() || (optId != null && ansVal === String(optId));
    if (qt === "closed") {
      const label = (i: number) => (q.options?.[i]?.key != null ? String(q.options![i].key) : LABELS[i] ?? String(i + 1));
      return (
        <div key={key} id={`pdf-taker-q-${idx}`} className="rounded border border-slate-200 p-2">
          <div className="mb-1 text-sm font-medium text-slate-800">{num}.</div>
          <div className="flex flex-wrap gap-1">
            {(q.options || []).map((opt, optIdx) => (
              <label
                key={optIdx}
                className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 text-sm font-medium ${
                  mcMatches(String(opt.key ?? label(optIdx)), opt.id)
                    ? "border-primary bg-primary text-white"
                    : "border-slate-300 hover:border-slate-400"
                }`}
              >
                <input
                  type="radio"
                  name={`pdf-taker-q-${key}-${idx}`}
                  className="sr-only"
                  checked={mcMatches(String(opt.key ?? label(optIdx)), opt.id)}
                  onChange={() => setAnswer(no, String(opt.key ?? label(optIdx)))}
                />
                {opt.key ?? label(optIdx)}
              </label>
            ))}
          </div>
        </div>
      );
    }
    if (qt === "situation") {
      const sitIdx = situationIndexForQuestion(q);
      const canvasForSituation = canvases?.find(
        (c) => (q.questionId != null && c.questionId === q.questionId) || c.situationIndex === sitIdx
      );
      const situationCanvasSnapshot =
        (canvasForSituation as { canvasSnapshot?: string | null })?.canvasSnapshot ?? canvasForSituation?.imageUrl ?? null;
      const promptText = (q.prompt || q.text || "").trim();
      const st = pdfSituationSaveStatus[no] ?? "idle";
      const canvasRow = canvasForSituation as { canvasId?: number } | undefined;
      const situationCanvasJson = coerceFabricCanvasJson(
        (canvasForSituation as { canvasJson?: unknown })?.canvasJson
      );
      const hasServerJson = situationCanvasJson != null;
      const hasServerImg = !!(situationCanvasSnapshot && String(situationCanvasSnapshot).length > 0);
      const situationFabricKey = `sit-${sitIdx}-${attemptId}-${canvasRow?.canvasId ?? "new"}-${hasServerJson ? "j" : hasServerImg ? "p" : "0"}`;
      return (
        <div
          key={key}
          id={`pdf-taker-q-${idx}`}
          className="rounded border border-slate-200 bg-white p-2 shadow-sm"
          style={{ minHeight: "12rem" }}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-800">
              {num}. Situasiya
            </div>
            <button
              type="button"
              onClick={() => setSituationFsNo(no)}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Tam ekran
            </button>
          </div>
          {promptText ? (
            <p className="mb-2 text-xs leading-snug text-slate-600 line-clamp-4">{promptText}</p>
          ) : null}
          <AutoExpandTextarea
            className="input mb-3 min-h-[120px] w-full text-sm"
            placeholder="Cavabınızı bura yazın…"
            value={ansVal}
            onChange={(e) => setAnswer(no, e.target.value)}
            rows={5}
          />
          {sitIdx >= 1 && onSaveCanvas ? (
            <div className="rounded border border-slate-100 bg-slate-50/80 p-2">
              <p className="mb-1 text-xs font-medium text-slate-600">Qaralama (rəsm)</p>
              <div className="min-h-[140px] overflow-hidden rounded border border-slate-200 bg-white">
                <SituasiyaCanvas
                  key={situationFabricKey}
                  ref={(el) => {
                    if (el) situationCanvasRefsMap.current.set(sitIdx, el);
                    else situationCanvasRefsMap.current.delete(sitIdx);
                  }}
                  initialJson={situationCanvasJson}
                  initialImageUrl={situationCanvasSnapshot}
                  situationIndex={sitIdx}
                />
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  className="btn-outline px-3 py-1 text-xs"
                  disabled={st === "saving"}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await pdfSituationSaveDraft(sitIdx, q.questionId ?? undefined, no);
                  }}
                >
                  {st === "saving" ? "Saxlanılır..." : "Qaralamanı saxla"}
                </button>
              </div>
            </div>
          ) : sitIdx >= 1 ? (
            <div className="mt-2">
              <button
                type="button"
                className="btn-outline px-3 py-1 text-xs"
                disabled={st === "saving"}
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  await pdfSituationSaveDraft(0, q.questionId ?? undefined, no);
                }}
              >
                {st === "saving" ? "Saxlanılır..." : "Qaralamanı saxla"}
              </button>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs text-amber-800">Situasiya indeksi tapılmadı — mətni aşağıdakı düymə ilə saxlayın.</p>
              <div className="mt-2">
                <button
                  type="button"
                  className="btn-outline px-3 py-1 text-xs"
                  disabled={st === "saving"}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await pdfSituationSaveDraft(0, q.questionId ?? undefined, no);
                  }}
                >
                  {st === "saving" ? "Saxlanılır..." : "Qaralamanı saxla"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={key} id={`pdf-taker-q-${idx}`} className="rounded border border-slate-200 p-2">
        <div className="mb-1 text-sm font-medium text-slate-800">{num}. Açıq</div>
        <AutoExpandTextarea
          className="input min-h-[80px] w-full text-sm"
          placeholder="Cavab..."
          value={ansVal}
          onChange={(e) => setAnswer(no, e.target.value)}
          rows={3}
        />
      </div>
    );
  };

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!rootRef) return;
      if (typeof rootRef === "function") rootRef(node);
      else (rootRef as { current: HTMLDivElement | null }).current = node;
    },
    [rootRef]
  );

  return (
    <div
      ref={setRootRef}
      className="relative flex h-[100dvh] max-h-[100dvh] w-full min-h-0 flex-col overflow-hidden bg-slate-100"
      data-pdf-exam-taker="true"
    >
      <header className="z-20 flex min-h-0 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
            <h1 className="min-w-0 truncate text-lg font-bold text-slate-900">{title}</h1>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  const root = document.querySelector("[data-pdf-exam-taker='true']") as HTMLElement | null;
                  root?.requestFullscreen?.().catch(() => {});
                }}
                className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100"
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
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1 py-0.5">
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
                  className="rounded p-1.5 text-slate-700 hover:bg-slate-100"
                  title="Kiçilt"
                  aria-label="Kiçilt"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
                  className="rounded p-1.5 text-slate-700 hover:bg-slate-100"
                  title="Böyüt"
                  aria-label="Böyüt"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <span className="min-w-[2.75rem] px-1 text-center text-xs font-medium text-slate-600">
                  {Math.round(scale * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                {pdfScratchpadDbRestored ? (
                  <span className="max-w-[9rem] truncate px-1 text-xs font-medium text-emerald-600" title="Səhifə qaralaması serverdən yüklənib">
                    Yadda saxlanıldı
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setTool("pen")}
                  className={`rounded p-1.5 ${tool === "pen" ? "bg-slate-200" : "hover:bg-slate-100"}`}
                  title="Qələm"
                >
                  <Pen className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTool("eraser")}
                  className={`rounded p-1.5 ${tool === "eraser" ? "bg-slate-200" : "hover:bg-slate-100"}`}
                  title="Pozan"
                >
                  <Eraser className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleScratchpadManualSave();
                }}
                disabled={scratchpadSavePending}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                title="PDF səhifə qərələməsini serverə yaz"
              >
                {scratchpadSavePending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
                Qaralamanı yadda saxla
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen((o) => !o)}
                className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100"
                title={sidebarOpen ? "Cavab vərəqini gizlət" : "Cavab vərəqi"}
              >
                {sidebarOpen ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleFinalSubmit();
                }}
                disabled={submitMutation.isPending || blockSubmitWhileDraftSaving}
                className="btn-primary flex items-center gap-2 py-2"
              >
                <Send className="h-5 w-5" />
                Göndər
              </button>
            </div>
          </header>

          {loadingPages ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-slate-500">Səhifələr yüklənir…</div>
      ) : (
        <>
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 xl:grid-cols-[1fr_minmax(280px,400px)]">
            <div
              ref={scrollContainerRef}
              className={`pdf-taker-scroll relative min-h-0 min-w-0 flex-1 overflow-auto border-slate-200 xl:border-r ${
                isDrawerMode ? "min-h-0" : ""
              }`}
              style={{ scrollbarGutter: "stable" }}
            >
              <div
                className="mx-auto box-content w-max min-w-full px-3 py-3 sm:px-4 sm:py-4"
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "top center",
                  width: scale !== 1 ? `${100 / scale}%` : undefined,
                }}
              >
                {pageError && <div className="py-12 text-center text-red-600">{pageError}</div>}
                {!pageError &&
                  pages.length > 0 &&
                  pages.map((src, i) => (
                    <div
                      key={i}
                      className="relative isolate z-0 mb-4 overflow-hidden bg-white shadow"
                      style={{
                        width: pageDimensions[i]?.width ?? "100%",
                        height: pageDimensions[i]?.height ?? undefined,
                      }}
                    >
                      <img
                        src={src}
                        alt={`Səhifə ${i + 1}`}
                        className="block h-auto w-full"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          handleImageLoad(i, img.naturalWidth, img.naturalHeight);
                        }}
                      />
                      <canvas
                        ref={(el) => {
                          if (el) overlayCanvasesRef.current.set(i, el);
                        }}
                        className="absolute inset-0 z-[1] block h-full w-full cursor-crosshair touch-none select-none"
                        style={{ pointerEvents: "auto", touchAction: "none" }}
                        onPointerDown={(e) => handlePointerDown(e, i)}
                        onPointerMove={(e) => handlePointerMove(e, i)}
                        onPointerUp={(e) => handlePointerUp(e, i)}
                        onPointerLeave={(e) => handlePointerUp(e, i)}
                      />
                      <div className="absolute bottom-2 right-2">
                        <button
                          type="button"
                          onClick={() => handleClearPage(i)}
                          className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                        >
                          <Trash2 className="h-3 w-3" />
                          Təmizlə
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {!isDrawerMode && !sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 rounded-l-lg border border-r-0 border-slate-300 bg-white px-2 py-4 shadow-md hover:bg-slate-50 xl:block"
                aria-label="Cavab vərəqini aç"
              >
                <PanelRightOpen className="h-5 w-5 text-slate-700" />
              </button>
            )}

            {!isDrawerMode && sidebarOpen ? (
              <aside
                ref={answerPanelScrollRef}
                className="hidden min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-white xl:block"
              >
                <h2 className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                  Cavab vərəqi
                </h2>
                <div className="space-y-3 p-3 pb-8" onMouseDown={preventFocusScroll}>
                  {questions.map((q, idx) => renderQuestionBlock(q, idx))}
                </div>
              </aside>
            ) : null}
          </div>

          {isDrawerMode && !sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="fixed bottom-6 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-white shadow-lg md:flex xl:hidden"
            >
              Cavab vərəqi <PanelRightOpen className="h-5 w-5" />
            </button>
          )}

          {isDrawerMode && (
            <>
              {sidebarOpen && (
                <div
                  role="presentation"
                  className="fixed inset-0 z-30 bg-black/30 xl:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
              <div
                className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-hidden bg-white shadow-xl transition-transform duration-200 ease-out xl:hidden"
                style={{
                  width: isMobile ? "100%" : "85%",
                  maxWidth: isMobile ? "100%" : "480px",
                  height: "100dvh",
                  transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
                }}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2"
                  >
                    ✕ Bağla
                  </button>
                  <h2 className="text-sm font-semibold">Cavab vərəqi</h2>
                  <div className="w-10" />
                </div>
                <div
                  ref={answerDrawerScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto p-3 pb-8"
                  style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" } as React.CSSProperties}
                >
                  <div className="space-y-3" onMouseDown={preventFocusScroll}>
                    {questions.map((q, idx) => renderQuestionBlock(q, idx))}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {submitConfirmOpen ? (
        <div
          className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-submit-confirm-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 id="pdf-submit-confirm-title" className="text-base font-semibold text-slate-900">
              Təsdiq
            </h2>
            <p className="mt-3 text-sm text-slate-700">İmtahanı bitirmək istədiyinizə əminsiniz?</p>
            {submitConfirmHasEmptyRef.current ? (
              <p className="mt-2 text-xs text-amber-700">Diqqət: bəzi suallar hələ boşdur.</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setSubmitConfirmOpen(false)}>
                Xeyr
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmSubmitExam();
                }}
                disabled={submitMutation.isPending || blockSubmitWhileDraftSaving}
              >
                Bəli
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PortalDialog
        open={situationFsNo != null}
        onClose={() => setSituationFsNo(null)}
        title="Situasiya — tam ekran mətn"
        size="lg"
      >
        <div data-situation-fullscreen="true" className="min-h-[50vh] space-y-3">
          <AutoExpandTextarea
            className="input min-h-[60vh] w-full text-sm"
            placeholder="Cavabınızı bura yazın…"
            value={situationFsNo != null ? (studentAnswers[situationFsNo] ?? "") : ""}
            onChange={(e) => {
              if (situationFsNo == null) return;
              setAnswer(situationFsNo, e.target.value);
            }}
            rows={12}
          />
          <div className="flex justify-end">
            <button type="button" onClick={() => setSituationFsNo(null)} className="btn-outline">
              Bağla
            </button>
          </div>
        </div>
      </PortalDialog>
    </div>
  );
});
