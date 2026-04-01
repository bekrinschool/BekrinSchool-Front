"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { AutoExpandTextarea } from "@/components/exam/AutoExpandTextarea";
import { SituationSmartCard } from "@/components/exam/SituationSmartCard";
import { UniversalLatex } from "@/components/common/MathContent";
import { ExamWaitingScreen } from "@/components/student/ExamWaitingScreen";
import { useToast } from "@/components/Toast";
import { useExamRun } from "@/lib/exam-run-context";
import { Send, Clock, AlertCircle, Maximize2 } from "lucide-react";
import type { ImageExamViewerRef } from "@/components/exam/ImageExamViewer";
import { ImageExamViewer } from "@/components/exam/ImageExamViewer";
import { normalizeAnswer, normalizeMatchingAnswer, subTypeFromRule } from "@/lib/answer-normalizer";

const EXAM_RUN_STORAGE_KEY = "exam_run_state";

const LABELS = ["A", "B", "C", "D", "E", "F"];

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const QUESTION_TYPE_ORDER: Record<string, number> = {
  MULTIPLE_CHOICE: 0,
  mc: 0,
  closed: 0,
  OPEN_SINGLE_VALUE: 1,
  OPEN_ORDERED: 1,
  OPEN_UNORDERED: 1,
  OPEN_PERMUTATION: 1,
  open: 1,
  SITUATION: 2,
  situation: 2,
};

function sortQuestionsByOrder<T extends { type?: string; kind?: string; questionNumber?: number; order?: number }>(questions: T[]): T[] {
  return [...questions].sort((a, b) => {
    const kindA = (a.type || a.kind || "").toString().toLowerCase();
    const kindB = (b.type || b.kind || "").toString().toLowerCase();
    const orderA = QUESTION_TYPE_ORDER[kindA] ?? QUESTION_TYPE_ORDER[a.type ?? ""] ?? 99;
    const orderB = QUESTION_TYPE_ORDER[kindB] ?? QUESTION_TYPE_ORDER[b.type ?? ""] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return (a.questionNumber ?? a.order ?? 0) - (b.questionNumber ?? b.order ?? 0);
  });
}

type StartedQuestion = {
  examQuestionId?: number;
  questionId?: number;
  questionNumber?: number;
  displayNumber?: number;
  order?: number;
  text: string;
  type: string;
  kind?: string;
  prompt?: string;
  questionImageUrl?: string | null;
  mcOptionDisplay?: string;
  options: {
    id?: number | string;
    key?: string;
    text: string;
    label?: string;
    order?: number;
    imageUrl?: string | null;
    image?: string | null;
    optionImageUrl?: string | null;
  }[];
  open_rule?: string;
  matching_left?: string[];
  matching_right?: string[];
};

type RenderBlueprintItem = {
  displayNumber: number;
  sourceType: string;
  kind: "closed" | "open" | "situation" | "other";
  originalQuestionNumber?: number;
  questionId?: number;
  optionOrderPresented: string[];
  optionOrderOriginal: string[];
};

function normalizeKind(q: StartedQuestion): "closed" | "open" | "situation" | "other" {
  const k = (q.type || q.kind || "").toString().toLowerCase();
  if (k === "multiple_choice" || k === "mc" || k === "closed") return "closed";
  if (k === "situation") return "situation";
  if (k === "open" || k.startsWith("open")) return "open";
  return "other";
}

function normalizeQuestionsForRender(
  sourceType: string | undefined,
  questions: StartedQuestion[]
): { questions: StartedQuestion[]; blueprint: RenderBlueprintItem[] } {
  const src = (sourceType || "").toUpperCase();
  const withStableBase = questions.map((q, idx) => ({
    ...q,
    questionNumber: q.questionNumber ?? idx + 1,
  }));

  if (src === "PDF") {
    const pdfOrdered = withStableBase.map((q, idx) => ({ ...q, displayNumber: idx + 1 }));
    return {
      questions: pdfOrdered,
      blueprint: pdfOrdered.map((q) => ({
        displayNumber: q.displayNumber!,
        sourceType: "PDF",
        kind: normalizeKind(q),
        originalQuestionNumber: q.questionNumber,
        questionId: q.questionId,
        optionOrderPresented: (q.options ?? []).map((o, i) => String(o.key ?? o.id ?? i + 1)),
        optionOrderOriginal: (q.options ?? []).map((o, i) => String(o.key ?? o.id ?? i + 1)),
      })),
    };
  }

  const closed = withStableBase.filter((q) => normalizeKind(q) === "closed");
  const open = withStableBase.filter((q) => normalizeKind(q) === "open");
  const situation = withStableBase.filter((q) => normalizeKind(q) === "situation");
  const other = withStableBase.filter((q) => normalizeKind(q) === "other");

  const shuffledClosed = shuffle(closed).map((q) => {
    const options = q.options ?? [];
    const shuffledOptions = options.length ? shuffle([...options]) : [];
    return { ...q, options: shuffledOptions };
  });
  const shuffledOpen = shuffle(open);
  const shuffledSituation = shuffle(situation);
  const shuffledOther = shuffle(other);

  const finalQuestions = [...shuffledClosed, ...shuffledOpen, ...shuffledSituation, ...shuffledOther].map((q, idx) => ({
    ...q,
    displayNumber: idx + 1,
  }));

  const blueprint: RenderBlueprintItem[] = finalQuestions.map((q) => {
    const sourceQuestion = withStableBase.find((sq) => (sq.questionId != null && sq.questionId === q.questionId) || sq.questionNumber === q.questionNumber) ?? q;
    const originalOptions = sourceQuestion.options ?? [];
    const presentedOptions = q.options ?? [];
    return {
      displayNumber: q.displayNumber!,
      sourceType: src || "JSON",
      kind: normalizeKind(q),
      originalQuestionNumber: sourceQuestion.questionNumber,
      questionId: sourceQuestion.questionId,
      optionOrderPresented: presentedOptions.map((o, i) => String(o.key ?? o.id ?? i + 1)),
      optionOrderOriginal: originalOptions.map((o, i) => String(o.key ?? o.id ?? i + 1)),
    };
  });

  return { questions: finalQuestions, blueprint };
}

/** Run/start payload order matches the frozen blueprint; do not re-sort by type. */
function buildRunPayloadForRender(
  sourceType: string | undefined,
  questions: StartedQuestion[]
): { questions: StartedQuestion[]; blueprint: RenderBlueprintItem[] } {
  const src = (sourceType || "").toUpperCase();
  const withDisplay = questions.map((q, idx) => ({
    ...q,
    questionNumber: q.questionNumber ?? idx + 1,
    displayNumber: idx + 1,
  }));
  const blueprint: RenderBlueprintItem[] = withDisplay.map((q) => ({
    displayNumber: q.displayNumber!,
    sourceType: src || "BANK",
    kind: normalizeKind(q),
    originalQuestionNumber: q.questionNumber,
    questionId: q.questionId,
    optionOrderPresented: (q.options ?? []).map((o, i) => String(o.key ?? o.id ?? i + 1)),
    optionOrderOriginal: (q.options ?? []).map((o, i) => String(o.key ?? o.id ?? i + 1)),
  }));
  return { questions: withDisplay, blueprint };
}

function answersFromSavedRows(
  rows:
    | Array<{
        questionId?: number;
        questionNumber?: number;
        selectedOptionId?: number | string;
        selectedOptionKey?: string;
        textAnswer?: string;
      }>
    | undefined
): Record<string, { selectedOptionId?: number | string; selectedOptionKey?: string; textAnswer?: string }> {
  const out: Record<string, { selectedOptionId?: number | string; selectedOptionKey?: string; textAnswer?: string }> = {};
  if (!rows?.length) return out;
  for (const r of rows) {
    const key = r.questionId != null ? String(r.questionId) : `n-${r.questionNumber ?? 0}`;
    out[key] = {
      selectedOptionId: r.selectedOptionId,
      selectedOptionKey: r.selectedOptionKey,
      textAnswer: r.textAnswer,
    };
  }
  return out;
}

function getAnswerKey(q: StartedQuestion): string {
  return q.questionId != null ? String(q.questionId) : `n-${q.questionNumber ?? 0}`;
}

export default function StudentExamsPage() {
  const [startedExam, setStartedExam] = useState<{
    attemptId: number;
    examId: number;
    runId?: number;
    title: string;
    endTime: string;
    expiresAt?: string;
    status?: string;
    sourceType?: string;
    pdfUrl?: string | null;
    questions: StartedQuestion[];
    renderBlueprint?: RenderBlueprintItem[];
    canvases?: { canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string; canvasJson?: object; canvasSnapshot?: string | null }[];
    pdfScribbles?: { pageIndex: number; drawingData: Record<string, unknown> }[] | null;
    sessionRevision?: number;
    resumeQuestionIndex?: number;
  } | null>(null);
  const examRunnerRef = useRef<ImageExamViewerRef>(null);
  const [answers, setAnswers] = useState<Record<string, { selectedOptionId?: number | string; selectedOptionKey?: string; textAnswer?: string }>>({});
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [cheatingModalOpen, setCheatingModalOpen] = useState(false);
  const [suspendedModalOpen, setSuspendedModalOpen] = useState(false);
  const [isInternalModalOpen, setIsInternalModalOpen] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [expired, setExpired] = useState(false);
  const [reviewDisabledMessage, setReviewDisabledMessage] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { setExamRunning } = useExamRun();
  const examContainerRef = useRef<HTMLDivElement>(null);
  const examFormScrollRef = useRef<HTMLFormElement>(null);
  const finalSituationSaveHooksRef = useRef<Map<string, () => Promise<void>>>(new Map());
  const cheatingSubmittingRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const prevFullscreenElementRef = useRef<Element | null>(null);
  const plannedExitRef = useRef(false);
  const pendingRestoreRef = useRef<{ attemptId: number; answers: Record<string, { selectedOptionId?: number | string; selectedOptionKey?: string; textAnswer?: string }> } | null>(null);
  const suspendingRef = useRef(false);
  const serverTimeOffsetMsRef = useRef(0);
  const sessionRevisionRef = useRef(0);
  const startedExamRef = useRef(startedExam);
  useEffect(() => {
    startedExamRef.current = startedExam;
  }, [startedExam]);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const startMutationRef = useRef<{ mutate: (runId: number) => void } | null>(null);
  const examInitialFullscreenAttemptRef = useRef<number | null>(null);
  const localStorageSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expiresAt = startedExam?.expiresAt ?? startedExam?.endTime;
  const [countdownMs, setCountdownMs] = useState(0);
  useEffect(() => {
    const msg = searchParams.get("msg");
    if (msg === "exam-finished") {
      toast.info("Bu imtahan artıq başa çatıb.");
    }
  }, [searchParams, toast]);

  useEffect(() => {
    if (!expiresAt || submitted) return;
    const update = () => {
      const left = new Date(expiresAt).getTime() - (Date.now() + serverTimeOffsetMsRef.current);
      if (left <= 0) {
        setCountdownMs(0);
        setExpired(true);
        return;
      }
      setCountdownMs(left);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiresAt, submitted]);

  /** Reset window / exam scroll on attempt (fixes resume + mobile URL bar leaving header clipped or bottom gap). */
  useEffect(() => {
    if (!startedExam?.attemptId || submitted) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    examContainerRef.current?.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
    examFormScrollRef.current?.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
  }, [startedExam?.attemptId, submitted]);

  useEffect(() => {
    if (submitted || startedExam?.pdfUrl || startedExam?.resumeQuestionIndex == null) return;
    const id = `student-exam-q-${startedExam.resumeQuestionIndex}`;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 400);
    return () => window.clearTimeout(t);
  }, [startedExam?.attemptId, startedExam?.resumeQuestionIndex, startedExam?.pdfUrl, submitted]);

  const submitMutationRef = useRef<{ mutate: (opts?: { cheatingDetected?: boolean }) => void } | null>(null);

  useEffect(() => {
    if (!expired || !startedExamRef.current || submitted || (startedExamRef.current.questions?.length ?? 0) === 0) return;
    submitMutationRef.current?.mutate({ cheatingDetected: false });
  }, [expired, submitted]);

  /** One-time fullscreen suggestion per attempt — never re-enter after user exits (avoids ESC/focus fight). */
  useEffect(() => {
    const attemptId = startedExam?.attemptId;
    if (!attemptId || submitted) return;
    if (examInitialFullscreenAttemptRef.current === attemptId) return;
    examInitialFullscreenAttemptRef.current = attemptId;
    const t = requestAnimationFrame(() => {
      const examEl = examContainerRef.current;
      if (!examEl?.requestFullscreen || !document.fullscreenEnabled) return;
      if (document.fullscreenElement) return;
      void examEl.requestFullscreen().catch(() => {});
    });
    return () => cancelAnimationFrame(t);
  }, [startedExam?.attemptId, submitted]);

  useEffect(() => {
    const attemptId = startedExam?.attemptId;
    if (!attemptId || submitted) return;

    const saveCurrentState = async () => {
      try {
        if (examRunnerRef.current?.saveAllSituasiyaCanvases) {
          await examRunnerRef.current.saveAllSituasiyaCanvases();
        }
        const pendingSaves = Array.from(finalSituationSaveHooksRef.current.values()).map((fn) => fn());
        if (pendingSaves.length > 0) {
          await Promise.allSettled(pendingSaves);
        }
      } catch {
        // best-effort state save
      }
    };
    const forceCheatingSubmit = () => {
      if (cheatingSubmittingRef.current) return;
      cheatingSubmittingRef.current = true;
      setCheatingModalOpen(true);
      submitMutationRef.current?.mutate({ cheatingDetected: true });
    };
    const isSituationModalOpen = () =>
      !!document.querySelector('[data-situation-fullscreen="true"]');
    const isSituationFullscreenElement = (el: Element | null) =>
      !!(el && el instanceof HTMLElement && el.getAttribute("data-situation-fullscreen") === "true");
    const onFullscreenChange = () => {
      if (isInternalModalOpen) return;
      const current = document.fullscreenElement;
      const prev = prevFullscreenElementRef.current;
      prevFullscreenElementRef.current = current;

      if (isSituationModalOpen() || isSituationFullscreenElement(current) || isSituationFullscreenElement(prev)) {
        return;
      }

      const examEl = examContainerRef.current;
      const wasExamFullscreen = prev != null && examEl != null && prev === examEl;
      const isExamFullscreenNow = current != null && examEl != null && current === examEl;
      if (wasExamFullscreen && !isExamFullscreenNow) {
        forceCheatingSubmit();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden !== true || plannedExitRef.current) return;
      const suspendNow = async () => {
        if (suspendingRef.current) return;
        suspendingRef.current = true;
        setSuspendedModalOpen(true);
        await saveCurrentState();
        const ex = startedExamRef.current;
        const ans = answersRef.current;
        if (!ex) return;
        try {
          const answersList = ex.questions.map((q) => {
            const key = getAnswerKey(q);
            const a = ans[key];
            return {
              questionId: q.questionId,
              questionNumber: q.questionNumber,
              selectedOptionId: a?.selectedOptionId ?? null,
              selectedOptionKey: a?.selectedOptionKey,
              textAnswer: a?.textAnswer ?? "",
            };
          });
          await studentApi.suspendExam({
            runId: ex.runId ?? 0,
            attemptId: ex.attemptId,
            answers: answersList,
          });
        } catch {
          // best-effort; UI is still locked out
        } finally {
          setExamRunning(false);
          setStartedExam(null);
          queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
          queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
        }
      };
      void suspendNow();
    };
    const onSituationFullscreenChange = (e: Event) => {
      const ce = e as CustomEvent<{ open?: boolean }>;
      setIsInternalModalOpen(!!ce?.detail?.open);
    };
    prevFullscreenElementRef.current = document.fullscreenElement;
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("situation-fullscreen-change", onSituationFullscreenChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("situation-fullscreen-change", onSituationFullscreenChange as EventListener);
    };
  }, [startedExam?.attemptId, submitted, isInternalModalOpen, queryClient, setExamRunning]);

  useEffect(() => {
    if (!startedExam || submitted) return;
    const t = setInterval(() => {
      const canvases = document.querySelectorAll('canvas[data-canvas-pad="true"]');
      canvases.forEach((c) => {
        const fn = (c as HTMLCanvasElement & { finalSave?: () => Promise<void> }).finalSave;
        if (fn) fn().catch(() => {});
      });
    }, 30000);
    return () => clearInterval(t);
  }, [startedExam?.attemptId, submitted]);

  useEffect(() => {
    if (!startedExam || submitted) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Imtahan davam edir. Cixsaniz cavablariniz ite biler. Eminsiniz?";
      return "Imtahan davam edir. Cixsaniz cavablariniz ite biler. Eminsiniz?";
    };
    const lockMessage = "Imtahan davam edir. Cixsaniz cavablariniz ite biler. Eminsiniz?";
    const onPopState = () => {
      // Keep user on exam route unless they submit.
      window.history.pushState({ examLock: true }, "", window.location.href);
      const ok = window.confirm(lockMessage);
      if (ok) {
        window.removeEventListener("popstate", onPopState);
        window.history.back();
      } else {
        toast.info("Imtahan rejimi aktivdir. Cixis ucun 'Gonder' duymesinden istifade edin.");
      }
    };
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) return;
      if (anchor.target === "_blank") return;
      const to = new URL(anchor.href, window.location.origin);
      const now = new URL(window.location.href);
      const samePathWithHashOnly = to.pathname === now.pathname && to.search === now.search;
      if (samePathWithHashOnly) return;
      event.preventDefault();
      toast.info("Imtahan rejimi aktivdir. Cixis ucun 'Gonder' duymesinden istifade edin.");
    };
    window.history.pushState({ examLock: true }, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [startedExam, submitted, toast]);

  useEffect(() => {
    setExamRunning(!!(startedExam && !submitted && startedExam.questions.length > 0));
    return () => setExamRunning(false);
  }, [startedExam, submitted, setExamRunning]);

  useEffect(() => {
    if (!startedExam || submitted || startedExam.questions.length === 0) {
      if (localStorageSaveTimerRef.current) {
        clearTimeout(localStorageSaveTimerRef.current);
        localStorageSaveTimerRef.current = null;
      }
      return;
    }
    if (localStorageSaveTimerRef.current) clearTimeout(localStorageSaveTimerRef.current);
    localStorageSaveTimerRef.current = setTimeout(() => {
      localStorageSaveTimerRef.current = null;
      try {
        const ex = startedExamRef.current;
        if (!ex || ex.questions.length === 0) return;
        const payload = {
          attemptId: ex.attemptId,
          examId: ex.examId,
          runId: ex.runId,
          renderBlueprint: ex.renderBlueprint ?? [],
          answers: answersRef.current,
          savedAt: Date.now(),
        };
        localStorage.setItem(EXAM_RUN_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    }, 2000);
    return () => {
      if (localStorageSaveTimerRef.current) {
        clearTimeout(localStorageSaveTimerRef.current);
        localStorageSaveTimerRef.current = null;
      }
    };
  }, [startedExam?.attemptId, startedExam?.runId, startedExam?.examId, submitted, answers]);

  useEffect(() => {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(EXAM_RUN_STORAGE_KEY) : null;
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { runId?: number };
      if (saved.runId != null) {
        // Re-enter current run and hydrate from server-side savedAnswers for the active attempt.
        startMutation.mutate(saved.runId);
      }
    } catch {
      // ignore
    }
  }, []);

  const isClient = typeof window !== "undefined";
  const { data: exams, isLoading } = useQuery({
    queryKey: ["student", "exams"],
    queryFn: () => studentApi.getExams(),
    enabled: isClient,
    refetchInterval: startedExam ? false : 10000,
  });

  useEffect(() => {
    if (!exams?.length) return;
    for (const ex of exams) {
      const ts = ex.teacherUnlockedAt;
      if (!ts || ex.runId == null) continue;
      const key = `exam_unlock_seen_${ex.runId}`;
      let prev = "";
      try {
        prev = sessionStorage.getItem(key) || "";
      } catch {
        // ignore
      }
      if (ts > prev) {
        try {
          sessionStorage.setItem(key, ts);
        } catch {
          // ignore
        }
        toast.success("Müəllim imtahanı davam etməyinizə icazə verdi.");
      }
    }
  }, [exams, toast]);

  const startMutation = useMutation({
    mutationFn: (runId: number) => studentApi.startRun(runId),
    onError: (err: unknown) => {
      pendingRestoreRef.current = null;
      try {
        localStorage.removeItem(EXAM_RUN_STORAGE_KEY);
      } catch {
        // ignore
      }
      const e = err as { message?: string; status?: number; data?: { detail?: string; reason?: string } };
      const msg = e?.message ?? "";
      const reason = e?.data?.reason ?? e?.data?.detail;
      const displayMsg = [msg, reason].filter(Boolean).join(" — ") || "İmtahan başladılmadı.";
      if (msg.includes("Already submitted") || msg.toLowerCase().includes("already submitted")) {
        toast.info("Bu imtahan artıq təhvil verilib.");
        return;
      }
      if (msg.includes("yoxlaması söndürülüb")) {
        toast.info("İmtahan yoxlaması söndürülüb.");
        return;
      }
      if ((e?.status === 403 || msg.includes("Run is not active") || msg.includes("do not have access")) && !msg.includes("Already submitted")) {
        toast.info(displayMsg);
        return;
      }
      toast.error(displayMsg);
    },
    onSuccess: (data) => {
      setReviewDisabledMessage(null);
      const ext = data as {
        savedAnswers?: Array<{
          questionId?: number;
          questionNumber?: number;
          selectedOptionId?: number | string;
          selectedOptionKey?: string;
          textAnswer?: string;
        }>;
        serverNow?: string;
        sessionRevision?: number;
        resumeQuestionIndex?: number;
        pdfScribbles?: { pageIndex: number; drawingData: Record<string, unknown> }[];
      };
      if (ext.serverNow) {
        serverTimeOffsetMsRef.current = new Date(ext.serverNow).getTime() - Date.now();
      }
      sessionRevisionRef.current = ext.sessionRevision ?? 0;

      const fromServer = answersFromSavedRows(ext.savedAnswers);

      const mapQuestionOptions = (q: StartedQuestion) => ({
        ...q,
        options: (q.options?.length ? [...q.options] : []).map(
          (o: {
            id?: number | string;
            key?: string;
            text: string;
            label?: string;
            order?: number;
            imageUrl?: string | null;
            image?: string | null;
            optionImageUrl?: string | null;
          }) => ({
            id: o.id,
            key: o.key,
            text: o.text ?? "",
            label: o.label,
            order: o.order,
            imageUrl: o.imageUrl ?? o.optionImageUrl ?? o.image ?? null,
          })
        ),
      });

      if (data.status === "EXPIRED" || (data.questions?.length ?? 0) === 0) {
        setStartedExam({
          attemptId: data.attemptId,
          examId: data.examId,
          runId: data.runId,
          title: data.title,
          endTime: data.endTime ?? "",
          expiresAt: data.expiresAt ?? data.endTime,
          status: data.status ?? "EXPIRED",
          sourceType: data.sourceType,
          pdfUrl: data.pdfUrl,
          questions: [],
          canvases: data.canvases ?? [],
          pdfScribbles: ext.pdfScribbles ?? null,
          sessionRevision: ext.sessionRevision,
        });
        setExpired(true);
        setAnswers(fromServer);
      } else {
        const rawQs = (data.questions ?? []) as StartedQuestion[];
        const normalized =
          data.runId != null
            ? buildRunPayloadForRender(data.sourceType, rawQs)
            : normalizeQuestionsForRender(data.sourceType, sortQuestionsByOrder(rawQs));
        setStartedExam({
          attemptId: data.attemptId,
          examId: data.examId,
          runId: data.runId,
          title: data.title,
          endTime: data.endTime,
          expiresAt: data.expiresAt ?? data.endTime,
          status: data.status ?? "IN_PROGRESS",
          sourceType: data.sourceType,
          pdfUrl: data.pdfUrl,
          questions: normalized.questions.map(mapQuestionOptions),
          renderBlueprint: normalized.blueprint,
          canvases: data.canvases ?? [],
          pdfScribbles: ext.pdfScribbles ?? null,
          sessionRevision: ext.sessionRevision,
          resumeQuestionIndex: ext.resumeQuestionIndex,
        });
        setExpired(false);
        setAnswers(fromServer);
      }
      setSubmitted(false);
    },
  });

  startMutationRef.current = startMutation;

  useEffect(() => {
    if (!startedExam?.attemptId || submitted) return;
    const attemptId = startedExam.attemptId;
    const SYNC_MS = 60_000;
    const syncOnce = async () => {
      try {
        const s = await studentApi.syncAttempt(attemptId);
        const serverMs = new Date(s.serverNow).getTime();
        serverTimeOffsetMsRef.current = serverMs - Date.now();
        if (s.expiresAt) {
          setStartedExam((prev) => (prev ? { ...prev, expiresAt: s.expiresAt! } : prev));
        }
        if (s.sessionRevision > sessionRevisionRef.current) {
          const runId = startedExamRef.current?.runId ?? null;
          toastRef.current.info("Müəllim imtahanı yenidən başlatdı. İmtahan ekranı yenidən açılır.");
          try {
            localStorage.removeItem(EXAM_RUN_STORAGE_KEY);
          } catch {
            // ignore
          }
          setStartedExam(null);
          setAnswers({});
          setExamRunning(false);
          queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
          if (runId != null) {
            queueMicrotask(() => startMutationRef.current?.mutate(runId));
          }
        }
        sessionRevisionRef.current = s.sessionRevision;
      } catch {
        // offline: keep local offset
      }
    };
    void syncOnce();
    const iv = setInterval(() => void syncOnce(), SYNC_MS);
    return () => clearInterval(iv);
  }, [startedExam?.attemptId, submitted, queryClient, setExamRunning]);

  const saveCanvasMutation = useMutation({
    mutationFn: ({
      attemptId,
      questionId,
      situationIndex,
      pageIndex,
      imageBase64,
      canvas_json,
      canvas_snapshot_base64,
    }: {
      attemptId: number;
      questionId?: number;
      situationIndex?: number;
      pageIndex?: number;
      imageBase64?: string;
      canvas_json?: object;
      canvas_snapshot_base64?: string;
    }) =>
      studentApi.saveCanvas(attemptId, {
        questionId,
        situationIndex,
        pageIndex,
        ...(canvas_json != null && canvas_snapshot_base64 != null
          ? { canvas_json, canvas_snapshot_base64 }
          : { imageBase64: imageBase64! }),
      }),
    onSuccess: (response, { questionId, situationIndex }) => {
      setStartedExam((prev) => {
        const r = response as { canvasId?: number; questionId?: number; situationIndex?: number; imageUrl?: string | null; updatedAt?: string; canvasJson?: object; canvasSnapshot?: string | null };
        const list = prev?.canvases ?? [];
        const idx = list.findIndex((c) => (questionId != null && c.questionId === questionId) || (situationIndex != null && c.situationIndex === situationIndex));
        const updated = [...list];
        const merged = {
          canvasId: r.canvasId ?? (idx >= 0 ? updated[idx].canvasId : 0),
          questionId: questionId ?? r.questionId ?? (idx >= 0 ? updated[idx].questionId : undefined),
          situationIndex: situationIndex ?? r.situationIndex ?? (idx >= 0 ? updated[idx].situationIndex : undefined),
          imageUrl: r.imageUrl ?? (idx >= 0 ? updated[idx].imageUrl : null) ?? null,
          updatedAt: r.updatedAt ?? new Date().toISOString(),
          ...(r.canvasJson != null ? { canvasJson: r.canvasJson } : idx >= 0 && updated[idx].canvasJson != null ? { canvasJson: updated[idx].canvasJson } : {}),
          ...(r.canvasSnapshot != null ? { canvasSnapshot: r.canvasSnapshot } : idx >= 0 && updated[idx].canvasSnapshot != null ? { canvasSnapshot: updated[idx].canvasSnapshot } : {}),
        };
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], ...merged };
        } else {
          updated.push(merged);
        }
        return prev ? { ...prev, canvases: updated } : prev;
      });
    },
  });

  const saveAttemptIdRef = useRef<number | null>(null);
  useEffect(() => {
    saveAttemptIdRef.current = startedExam?.attemptId ?? null;
  }, [startedExam?.attemptId]);

  const handleFullscreen = () => {
    const el = examContainerRef.current;
    if (!el || !el.requestFullscreen) return;
    el
      .requestFullscreen()
      .catch((err) => {
        console.error("Fullscreen failed:", err);
      });
  };

  const handleSaveCanvas = useCallback(
    (questionId?: number, situationIndexBase?: number) =>
      async (
        data: string | { json: object; snapshotBase64: string; width: number; height: number },
        pageIndex?: number
      ): Promise<void> => {
        const attemptId = saveAttemptIdRef.current;
        if (!attemptId) throw new Error("No exam");
        const situationIndex = situationIndexBase != null ? situationIndexBase : undefined;
        const isFabricPayload = typeof data === "object" && data !== null && "json" in data && "snapshotBase64" in data;
        await saveCanvasMutation.mutateAsync({
          attemptId,
          questionId,
          situationIndex,
          pageIndex: pageIndex ?? 0,
          ...(isFabricPayload
            ? { canvas_json: (data as { json: object }).json, canvas_snapshot_base64: (data as { snapshotBase64: string }).snapshotBase64 }
            : { imageBase64: data as string }),
        });
      },
    [saveCanvasMutation]
  );

  const submitMutation = useMutation({
    mutationFn: async (opts?: { cheatingDetected?: boolean }) => {
      if (submitInFlightRef.current) throw new Error("Already submitting");
      submitInFlightRef.current = true;
      const ex = startedExamRef.current;
      if (!ex) {
        submitInFlightRef.current = false;
        throw new Error("No exam");
      }
      const answerSnap = answersRef.current;
      plannedExitRef.current = true;

      if (ex.pdfUrl && examRunnerRef.current?.flushScribbles) {
        await examRunnerRef.current.flushScribbles();
      }
      if (examRunnerRef.current?.saveAllSituasiyaCanvases) {
        await examRunnerRef.current.saveAllSituasiyaCanvases();
      }
      // Non-PDF situation cards register their save hooks here. Run them before submit.
      const pendingSaves = Array.from(finalSituationSaveHooksRef.current.values()).map((fn) => fn());
      if (pendingSaves.length > 0) {
        await Promise.allSettled(pendingSaves);
      }

      const answersList = ex.questions.map((q) => {
        const key = getAnswerKey(q);
        const a = answerSnap[key];
        const openSubType = subTypeFromRule(q.open_rule);
        const normalizedTextAnswer = normalizeAnswer(a?.textAnswer ?? "", openSubType);
        const qNumber = q.questionNumber ?? q.displayNumber;
        if (q.questionId != null) {
          return {
            questionId: q.questionId,
            questionNumber: qNumber,
            selectedOptionId: a?.selectedOptionId ?? null,
            selectedOptionKey: a?.selectedOptionKey ?? undefined,
            textAnswer: normalizedTextAnswer,
          };
        }
        return {
          questionNumber: qNumber,
          selectedOptionId: a?.selectedOptionId ?? null,
          selectedOptionKey: a?.selectedOptionKey ?? undefined,
          textAnswer: normalizedTextAnswer,
        };
      });
      const result = await studentApi.submitExam(ex.examId, ex.attemptId, answersList, {
        cheatingDetected: !!opts?.cheatingDetected,
      });
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      return result;
    },
    onSettled: () => {
      submitInFlightRef.current = false;
    },
    onSuccess: (data) => {
      setSubmitted(true);
      setShowSubmitModal(false);
      setCheatingModalOpen(false);
      setExamRunning(false);
      try {
        localStorage.removeItem(EXAM_RUN_STORAGE_KEY);
      } catch {
        // ignore
      }
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
    },
    onError: () => {
      plannedExitRef.current = false;
    },
  });

  submitMutationRef.current = submitMutation;

  if (isLoading) return <Loading />;

  if (reviewDisabledMessage) {
    return (
      <div className="page-container">
        <div className="max-w-[760px] mx-auto">
          <div className="card text-center py-12">
            <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">İmtahan yoxlaması söndürülüb</h1>
            <p className="text-slate-600 mb-4">{reviewDisabledMessage}</p>
            <p className="text-sm text-slate-500">Təhvil verdikdən sonra suallara baxmaq mümkün deyil.</p>
            <button onClick={() => setReviewDisabledMessage(null)} className="btn-primary mt-6">
              Geri qayıt
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (startedExam && !submitted) {
    const isExpiredOrNoQuestions = expired || startedExam.questions.length === 0;
    const closedQuestions = startedExam.questions.filter((q) => q.type === "MULTIPLE_CHOICE" || q.kind === "mc");
    const openQuestions = startedExam.questions.filter((q) =>
      ["OPEN_SINGLE_VALUE", "OPEN_ORDERED", "OPEN_UNORDERED", "OPEN_PERMUTATION"].includes(q.type) || q.kind === "open"
    );
    const situationQuestions = startedExam.questions.filter((q) => q.type === "SITUATION" || q.kind === "situation");

    const globalQuestionIndex = (q: StartedQuestion) => {
      const i = startedExam.questions.indexOf(q);
      if (i >= 0) return i;
      return startedExam.questions.findIndex(
        (x) =>
          (q.questionId != null && x.questionId === q.questionId) ||
          (q.questionId == null &&
            x.questionId == null &&
            Number(x.questionNumber ?? x.displayNumber ?? 0) === Number(q.questionNumber ?? q.displayNumber ?? 0))
      );
    };

    if (isExpiredOrNoQuestions) {
      return (
        <div className="page-container">
          <div className="max-w-[760px] mx-auto">
            <div className="card text-center py-12">
              <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
              <h1 className="text-xl font-bold text-slate-900 mb-2">Vaxt bitib / artıq baxmaq olmur</h1>
              <p className="text-slate-600 mb-4">Sual məzmununa artıq daxil olmaq mümkün deyil.</p>
              <p className="text-sm text-slate-500">Nəticə müəllim tərəfindən yoxlanıldıqdan sonra dərc ediləcək.</p>
              <button onClick={() => { setStartedExam(null); setExpired(false); }} className="btn-primary mt-6">
                İmtahanlar siyahısına qayıt
              </button>
            </div>
          </div>
        </div>
      );
    }

    const isPdfExam = startedExam.sourceType === "PDF" || !!startedExam.pdfUrl;
    if (isPdfExam && !startedExam.pdfUrl) {
      return (
        <div className="page-container">
          <div className="max-w-[760px] mx-auto">
            <div className="card text-center py-12">
              <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
              <h1 className="text-xl font-bold text-slate-900 mb-2">PDF yüklənmədi…</h1>
              <p className="text-slate-600 mb-6">PDF faylına giriş alınmadı. İnternet bağlantısını yoxlayın və yenidən cəhd edin.</p>
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => startedExam.runId && startMutation.mutate(startedExam.runId)}
                  disabled={startMutation.isPending}
                  className="btn-primary"
                >
                  Yenidən yüklə
                </button>
                <button type="button" onClick={() => { setStartedExam(null); setExpired(false); }} className="btn-outline">
                  Geri qayıt
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (startedExam.pdfUrl && startedExam.runId != null) {
      return (
        <>
          <ImageExamViewer
            ref={examRunnerRef}
            runId={startedExam.runId}
            attemptId={startedExam.attemptId}
            examId={startedExam.examId}
            title={startedExam.title}
            questions={startedExam.questions}
            answers={answers}
            setAnswers={setAnswers}
            canvases={startedExam.canvases}
            onSaveCanvas={handleSaveCanvas}
            onSubmitClick={() => setShowSubmitModal(true)}
            submitMutation={submitMutation}
            countdownMs={countdownMs}
            containerRef={examContainerRef}
            initialPdfScribbles={startedExam.pdfScribbles ?? null}
            formatCountdown={formatCountdown}
            resumeQuestionIndex={startedExam.resumeQuestionIndex}
          />
          <Modal
            isOpen={showSubmitModal}
            onClose={() => setShowSubmitModal(false)}
            title="Təsdiq"
            size="sm"
          >
            <p className="text-slate-600 mb-4">İmtahanı təsdiq etmək istədiyinizə əminsiniz? Göndərildikdən sonra dəyişiklik etmək mümkün olmayacaq.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSubmitModal(false)} className="btn-outline">
                Ləğv et
              </button>
              <button
                onClick={() => submitMutation.mutate({ cheatingDetected: false })}
                disabled={submitMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {submitMutation.isPending ? "Göndərilir…" : "Təsdiq et"}
              </button>
            </div>
          </Modal>
          <Modal isOpen={cheatingModalOpen} onClose={() => {}} title="Xəbərdarlıq" size="sm">
            <p className="text-slate-700">Cheating detected! You left the exam environment.</p>
            <p className="text-xs text-slate-500 mt-2">İmtahan avtomatik təhvil verilir...</p>
          </Modal>
          <Modal isOpen={suspendedModalOpen} onClose={() => {}} title="İmtahan dayandırıldı" size="sm">
            <p className="text-slate-700">Sistemdən kənarlaşdığınız üçün imtahanınız dayandırıldı. Müəllimin icazəsini gözləyin.</p>
          </Modal>
        </>
      );
    }

    return (
      <div
        ref={examContainerRef}
        className="exam-content-container flex min-h-0 flex-col overflow-hidden bg-white"
        style={{ height: "100dvh", maxHeight: "100dvh" }}
      >
        <div className="max-w-[900px] mx-auto flex min-h-0 w-full flex-1 flex-col px-4 py-4">
          <div className="sticky top-0 z-10 mb-0 shrink-0 border-b border-slate-200 bg-white/95 py-3 backdrop-blur flex items-center justify-between gap-4">
            <h1 className="text-lg font-bold text-slate-900 truncate">{startedExam.title}</h1>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={handleFullscreen}
                className="min-h-[44px] min-w-[44px] p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-center"
                title="Tam Ekran"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-semibold ${
                  countdownMs < 60000 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-800"
                }`}
              >
                <Clock className="w-4 h-4" />
                {formatCountdown(countdownMs)}
              </div>
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                disabled={submitMutation.isPending}
                className="btn-primary flex items-center gap-2 min-h-[44px] px-4 py-2"
              >
                <Send className="w-4 h-4" />
                Göndər
              </button>
            </div>
          </div>

          <form
            ref={examFormScrollRef}
            onSubmit={(e) => {
              e.preventDefault();
              setShowSubmitModal(true);
            }}
            className="min-h-0 flex-1 space-y-8 overflow-y-auto overflow-x-hidden overscroll-none pb-8 pt-4"
          >
            {closedQuestions.length > 0 && (
              <section>
                <div className="space-y-4">
                  {closedQuestions.map((q, idx) => {
                    const key = getAnswerKey(q);
                    const gIdx = globalQuestionIndex(q);
                    const label = (i: number) => (LABELS[i] ?? String(i + 1));
                    const isImageMc = (q.mcOptionDisplay || "").toUpperCase() === "IMAGE";
                    return (
                      <div key={key} id={gIdx >= 0 ? `student-exam-q-${gIdx}` : undefined} className="card">
                        <div className="font-medium text-slate-900 mb-3">
                          <UniversalLatex content={`${idx + 1}. ${q.text || q.prompt || ""}`} className="whitespace-pre-wrap" />
                        </div>
                        {q.questionImageUrl && <img src={q.questionImageUrl} alt="" className="max-w-full max-h-40 rounded border mb-2 object-contain" />}
                        {isImageMc ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {q.options?.map((opt, optIdx) => {
                              const imgSrc = String(opt.imageUrl ?? opt.optionImageUrl ?? opt.image ?? "");
                              const sel =
                                opt.id != null &&
                                String(answers[key]?.selectedOptionId ?? "") === String(opt.id);
                              return (
                                <div
                                  key={String(opt.id ?? opt.key ?? optIdx)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setAnswers((prev) => ({
                                        ...prev,
                                        [key]: opt.id != null ? { ...prev[key], selectedOptionId: opt.id } : { ...prev[key], selectedOptionKey: opt.key ?? label(optIdx) },
                                      }));
                                    }
                                  }}
                                  onClick={() =>
                                    setAnswers((prev) => ({
                                      ...prev,
                                      [key]: opt.id != null ? { ...prev[key], selectedOptionId: opt.id } : { ...prev[key], selectedOptionKey: opt.key ?? label(optIdx) },
                                    }))
                                  }
                                  className={`rounded-xl border-2 p-3 cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                                    sel ? "border-blue-600 ring-2 ring-blue-300 shadow-md bg-blue-50/30" : "border-slate-200 hover:border-slate-300 bg-white"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <span className="text-sm font-semibold text-slate-800">{label(optIdx)})</span>
                                    {imgSrc ? (
                                      <button
                                        type="button"
                                        className="text-xs font-medium text-blue-600 hover:underline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setZoomImageUrl(imgSrc);
                                        }}
                                      >
                                        Böyüt
                                      </button>
                                    ) : null}
                                  </div>
                                  {imgSrc ? (
                                    <img src={imgSrc} alt="" className="w-full max-h-52 object-contain rounded-md border border-slate-100 bg-white" />
                                  ) : null}
                                  {(opt.label ?? "").trim() ? (
                                    <div className="mt-2 text-xs text-slate-800">
                                      <UniversalLatex content={opt.label ?? ""} className="whitespace-pre-wrap" />
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {q.options?.map((opt, optIdx) => (
                              <li key={opt.id ?? opt.key ?? optIdx}>
                                <label className="flex items-center gap-3 cursor-pointer py-1">
                                  <span className="font-medium text-slate-700 w-6 shrink-0">{label(optIdx)})</span>
                                  <input
                                    type="radio"
                                    name={`q-${key}`}
                                    checked={
                                      opt.id != null
                                        ? String(answers[key]?.selectedOptionId ?? "") === String(opt.id)
                                        : answers[key]?.selectedOptionKey === (opt.key ?? label(optIdx))
                                    }
                                    onChange={() =>
                                      setAnswers((prev) => ({
                                        ...prev,
                                        [key]: opt.id != null
                                          ? { ...prev[key], selectedOptionId: opt.id }
                                          : { ...prev[key], selectedOptionKey: opt.key ?? label(optIdx) },
                                      }))
                                    }
                                    className="rounded border-slate-300"
                                  />
                                  <div className="flex flex-col gap-1">
                                    {typeof opt.text === "string" && opt.text.trim().length > 0 && (
                                      <UniversalLatex content={opt.text} />
                                    )}
                                    {opt.imageUrl ?? opt.optionImageUrl ?? opt.image ? (
                                      <img
                                        src={String(opt.imageUrl ?? opt.optionImageUrl ?? opt.image)}
                                        alt=""
                                        className="max-w-full max-h-28 rounded border object-contain"
                                      />
                                    ) : null}
                                  </div>
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {openQuestions.length > 0 && (
              <section>
                <div className="space-y-4">
                  {openQuestions.map((q, idx) => {
                    const key = getAnswerKey(q);
                    const oGidx = globalQuestionIndex(q);
                    const openRule = (q.open_rule || "EXACT_MATCH").toUpperCase();
                    const isMatching = openRule === "MATCHING";
                    const isOrderedDigits = openRule === "ORDERED_DIGITS";

                    if (isMatching) {
                      return (
                        <div key={key} id={oGidx >= 0 ? `student-exam-q-${oGidx}` : undefined} className="card">
                          <div className="font-medium text-slate-900 mb-3">
                            <UniversalLatex content={`${closedQuestions.length + idx + 1}. ${q.text || q.prompt || ""}`} className="whitespace-pre-wrap" />
                          </div>
                          {q.questionImageUrl && <img src={q.questionImageUrl} alt="" className="max-w-full max-h-40 rounded border mb-2 object-contain" />}
                          <p className="text-xs text-slate-500 mb-2">
                            Cavabınızı bu formatda daxil edin (məs: 1-a, 2-b, 3-c)
                          </p>
                          <AutoExpandTextarea
                            className="input w-full min-h-[120px]"
                            placeholder="Məs: 1-a, 2-b, 3-c"
                            value={answers[key]?.textAnswer ?? ""}
                            onChange={(e) =>
                              setAnswers((prev) => ({
                                ...prev,
                                [key]: {
                                  ...prev[key],
                                  textAnswer: normalizeMatchingAnswer(e.target.value).slice(0, 250),
                                },
                              }))
                            }
                            maxLength={250}
                            rows={4}
                          />
                        </div>
                      );
                    }

                    if (isOrderedDigits) {
                      const digits = (answers[key]?.textAnswer ?? "").replace(/\D/g, "").split("");
                      const expectedLen = 5;
                      const setDigit = (i: number, char: string) => {
                        const next = [...digits];
                        while (next.length < i + 1) next.push("");
                        next[i] = char.replace(/\D/g, "").slice(-1);
                        const str = next.join("");
                        setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], textAnswer: str.slice(0, 250) } }));
                      };
                      return (
                        <div key={key} id={oGidx >= 0 ? `student-exam-q-${oGidx}` : undefined} className="card">
                          <div className="font-medium text-slate-900 mb-2">
                            <UniversalLatex content={`${closedQuestions.length + idx + 1}. ${q.text || q.prompt || ""}`} className="whitespace-pre-wrap" />
                          </div>
                          {q.questionImageUrl && <img src={q.questionImageUrl} alt="" className="max-w-full max-h-40 rounded border mb-2 object-contain" />}
                          <p className="text-xs text-slate-500 mb-2">Ardıcıllıq vacibdir: rəqəmləri sıra ilə daxil edin.</p>
                          <div className="flex flex-wrap gap-2">
                            {Array.from({ length: expectedLen }, (_, i) => (
                              <input
                                key={i}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                className="input w-12 text-center font-mono text-lg"
                                value={digits[i] ?? ""}
                                onChange={(e) => setDigit(i, e.target.value)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={key} id={oGidx >= 0 ? `student-exam-q-${oGidx}` : undefined} className="card">
                        <div className="font-medium text-slate-900 mb-2">
                          <UniversalLatex content={`${closedQuestions.length + idx + 1}. ${q.text || q.prompt || ""}`} className="whitespace-pre-wrap" />
                        </div>
                        {q.questionImageUrl && <img src={q.questionImageUrl} alt="" className="max-w-full max-h-40 rounded border mb-2 object-contain" />}
                        <AutoExpandTextarea
                          className="input w-full min-h-[120px]"
                          placeholder="Cavabı yazın…"
                          value={answers[key]?.textAnswer ?? ""}
                          onChange={(e) =>
                            setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], textAnswer: e.target.value.slice(0, 250) } }))
                          }
                          maxLength={250}
                          rows={5}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {situationQuestions.length > 0 && (
              <section>
                <div className="space-y-4">
                  {situationQuestions.map((q, idx) => {
                    const sitIndex = idx + 1;
                    const key = getAnswerKey(q);
                    const sGidx = globalQuestionIndex(q);
                    const canvasForThis = startedExam.canvases?.find(
                      (c) => (q.questionId != null && c.questionId === q.questionId) || (c.situationIndex === sitIndex)
                    );
                    return (
                      <div key={key} id={sGidx >= 0 ? `student-exam-q-${sGidx}` : undefined}>
                      <SituationSmartCard
                        mode="student"
                        saveHookId={key}
                        onRegisterFinalSave={(id, fn) => {
                          if (!fn) {
                            finalSituationSaveHooksRef.current.delete(id);
                            return;
                          }
                          finalSituationSaveHooksRef.current.set(id, fn);
                        }}
                        questionNumber={closedQuestions.length + openQuestions.length + idx + 1}
                        questionText={q.text || q.prompt || "—"}
                        questionImageUrl={q.questionImageUrl ?? null}
                        answerText={answers[key]?.textAnswer ?? ""}
                        onAnswerTextChange={(value) =>
                          setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], textAnswer: value } }))
                        }
                        initialCanvasJson={(canvasForThis as { canvasJson?: object })?.canvasJson ?? null}
                        initialCanvasSnapshot={(canvasForThis as { canvasSnapshot?: string | null })?.canvasSnapshot ?? canvasForThis?.imageUrl ?? null}
                        onCanvasSave={async (data) => {
                          await handleSaveCanvas(q.questionId, q.questionId == null ? sitIndex : undefined)({
                            json: data.json,
                            snapshotBase64: data.snapshotBase64,
                            width: data.width,
                            height: data.height,
                          });
                        }}
                      />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                disabled={submitMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Göndər
              </button>
            </div>
          </form>

          <Modal
            isOpen={showSubmitModal}
            onClose={() => setShowSubmitModal(false)}
            title="Təsdiq"
            size="sm"
          >
            <p className="text-slate-600 mb-4">İmtahanı təsdiq etmək istədiyinizə əminsiniz? Göndərildikdən sonra dəyişiklik etmək mümkün olmayacaq.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSubmitModal(false)} className="btn-outline">
                Ləğv et
              </button>
              <button
                onClick={() => submitMutation.mutate({ cheatingDetected: false })}
                disabled={submitMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {submitMutation.isPending ? "Göndərilir…" : "Təsdiq et"}
              </button>
            </div>
          </Modal>
          <Modal isOpen={cheatingModalOpen} onClose={() => {}} title="Xəbərdarlıq" size="sm">
            <p className="text-slate-700">Cheating detected! You left the exam environment.</p>
            <p className="text-xs text-slate-500 mt-2">İmtahan avtomatik təhvil verilir...</p>
          </Modal>
          <Modal isOpen={suspendedModalOpen} onClose={() => {}} title="İmtahan dayandırıldı" size="sm">
            <p className="text-slate-700">Sistemdən kənarlaşdığınız üçün imtahanınız dayandırıldı. Müəllimin icazəsini gözləyin.</p>
          </Modal>
          <Modal isOpen={!!zoomImageUrl} onClose={() => setZoomImageUrl(null)} title="Şəkil" size="lg">
            {zoomImageUrl ? (
              <div className="max-h-[80vh] overflow-auto flex justify-center bg-slate-50 rounded-lg p-2">
                <img src={zoomImageUrl} alt="" className="max-w-full h-auto object-contain" />
              </div>
            ) : null}
          </Modal>
        </div>
      </div>
    );
  }

  if (startedExam && submitted) {
    return <ExamWaitingScreen onBack={() => { setStartedExam(null); setSubmitted(false); }} />;
  }

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">İmtahanlar</h1>
        <p className="text-sm text-slate-600 mt-2">Aktiv imtahanları görürsünüz. Başlatmaq üçün &quot;Başla&quot; düyməsini basın.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exams && exams.length > 0 ? (
          exams.map((exam) => (
            <div key={exam.runId ?? exam.examId} className="card flex flex-col">
              <h3 className="text-lg font-semibold text-slate-900">{exam.title}</h3>
              <p className="text-sm text-slate-500 mt-1">
                {exam.type === "exam" ? "İmtahan" : "Quiz"}
                {exam.remainingSeconds != null && (
                  <span className="ml-2 font-mono text-amber-700">
                    Qalan: {formatCountdown(exam.remainingSeconds * 1000)}
                  </span>
                )}
              </p>
              {exam.status === "suspended" && (
                <p className="mt-2 inline-flex w-fit items-center rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                  Dayandırıldı {exam.suspendedAt ? `(${new Date(exam.suspendedAt).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" })})` : ""}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-0.5">
                {new Date(exam.startTime).toLocaleString("az-AZ")} - {new Date(exam.endTime).toLocaleString("az-AZ")}
              </p>
              <button
                onClick={() => startMutation.mutate(exam.runId ?? exam.examId)}
                disabled={startMutation.isPending || exam.status === "suspended"}
                className="btn-primary mt-4 self-start"
              >
                {exam.status === "suspended" ? "Dayandırılıb" : "Başla"}
              </button>
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-500">
            Hal-hazırda aktiv imtahan yoxdur
          </div>
        )}
      </div>
    </div>
  );
}
