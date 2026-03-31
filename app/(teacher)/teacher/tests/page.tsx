"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useDebounce } from "@/lib/useDebounce";
import {
  teacherApi,
  Test,
  TestResult,
  ExamListItem,
  ExamDetail,
  ExamAttempt,
  ExamAttemptDetail,
  Payment,
  ActiveRunItem,
  FinishedRunItem,
  QuestionBankItem,
} from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatPaymentDisplay } from "@/lib/formatPayment";
import dynamic from "next/dynamic";
import { Plus, Trash2, Clock, CheckCircle2, Eye, Check, X, StopCircle, RotateCcw, Archive, AlertCircle, ChevronDown, Save, Send } from "lucide-react";

import ExamPreview from "@/components/exam/ExamPreview";
import { SituationSmartCard } from "@/components/exam/SituationSmartCard";
import { UniversalLatex } from "@/components/common/MathContent";
import { normalizeAnswer, normalizeMatchingAnswer, subTypeFromRule } from "@/lib/answer-normalizer";

type TabType = "bank" | "active" | "grading" | "old" | "archive";
type ArchiveSubTab = "exams" | "questions" | "topics" | "pdfs" | "codingTopics" | "codingTasks";

const testSchema = z.object({
  type: z.enum(["quiz", "exam"]),
  title: z.string().min(1, "Başlıq tələb olunur"),
});

const resultSchema = z.object({
  studentProfileId: z.number().min(1, "Şagird seçilməlidir"),
  groupId: z.number().optional(),
  testName: z.string().min(1, "Test adı tələb olunur"),
  maxScore: z.number().min(1, "Maksimum xal tələb olunur"),
  score: z.number().min(0, "Xal 0-dan kiçik ola bilməz"),
  date: z.string().min(1, "Tarix tələb olunur"),
});

const examSchema = z.object({
  title: z.string().min(1, "Başlıq tələb olunur"),
  type: z.enum(["quiz", "exam"]),
  status: z.enum(["draft"]),
  maxScore: z.number().min(1, "Maksimum bal tələb olunur").max(500, "Maksimum 500 ola bilər").optional(),
});

/** Exam: exactly 30 (22 closed + 5 open + 3 situation). Quiz: min 1 question, no maximum. */
const EXAM_REQUIRED = { closed: 22, open: 5, situation: 3, total: 30 };
const QUIZ_MIN_TOTAL = 1;

function getRequiredCounts(type: "quiz" | "exam") {
  return type === "exam" ? EXAM_REQUIRED : { minTotal: QUIZ_MIN_TOTAL };
}

function canTeacherHardRestartAttempt(
  a: ExamAttempt & { runEndAt?: string; examGlobalEndAt?: string | null }
): boolean {
  const end = a.runEndAt ?? a.examGlobalEndAt ?? undefined;
  if (!end) return true;
  return Date.now() < new Date(end).getTime();
}

const BANK_Q_TYPE_LABELS: Record<string, string> = {
  MULTIPLE_CHOICE: "Qapalı",
  OPEN_SINGLE_VALUE: "Açıq (Standart)",
  OPEN_ORDERED: "Açıq (Ardıcıllıq)",
  OPEN_UNORDERED: "Açıq (Uyğunluq)",
  OPEN_PERMUTATION: "Açıq (Seçimli)",
  SITUATION: "Situasiya",
};

function formatBankQuestionPickerLine(q: QuestionBankItem): string {
  const label = BANK_Q_TYPE_LABELS[q.type] || q.type;
  const title = (q.short_title || "").trim() || `Sual ${q.id}`;
  return `Q-${q.id}: ${title} (${label})`;
}

function formatExamQuestionEqLine(eq: NonNullable<ExamDetail["questions"]>[number]): string {
  const label = BANK_Q_TYPE_LABELS[eq.question_type] || eq.question_type;
  const raw = (eq.question_short_title || "").trim();
  const title =
    raw ||
    (eq.question_text.length > 100 ? `${eq.question_text.slice(0, 100)}…` : eq.question_text);
  return `Q-${eq.question}: ${title} (${label})`;
}

function getCountsFromDetail(examDetail: ExamDetail | null | undefined): { closed: number; open: number; situation: number } | null {
  if (!examDetail) return null;
  const st = (examDetail as { source_type?: string }).source_type;
  if (st === "PDF" || st === "JSON") {
    const qc = examDetail.question_counts;
    if (qc) return { closed: qc.closed, open: qc.open, situation: qc.situation };
    return null;
  }
  const qs = examDetail.questions ?? [];
  let closed = 0, open = 0, situation = 0;
  for (const q of qs) {
    const t = (q as { question_type?: string }).question_type;
    if (t === "MULTIPLE_CHOICE") closed++;
    else if (t?.startsWith("OPEN")) open++;
    else if (t === "SITUATION") situation++;
  }
  return { closed, open, situation };
}

function isCompositionValid(
  counts: { closed: number; open: number; situation: number } | null,
  type: "quiz" | "exam"
): boolean {
  if (!counts) return false;
  const total = counts.closed + counts.open + counts.situation;
  if (type === "exam") {
    const r = getRequiredCounts("exam") as { closed: number; open: number; situation: number; total: number };
    return total === r.total && counts.closed === r.closed && counts.open === r.open && counts.situation === r.situation;
  }
  return total >= QUIZ_MIN_TOTAL;
}

/** Same order as Django: situation rows = requires_manual_check, order_by question_number */
function getOrderedSituationAnswers(answers: ExamAttemptDetail["answers"] | undefined) {
  return (answers ?? [])
    .filter(
      (a) =>
        (a.questionType as string) === "SITUATION" ||
        (a.questionType as string)?.toLowerCase() === "situation"
    )
    .sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0));
}

/** New: direct explicit numeric mapping by SITUATION answer id. */
function buildPerSituationScoresPayloadV2(
  attemptDetail: ExamAttemptDetail | undefined,
  situationManualScores: Record<string, number | undefined>
): { index: number; manual_score: number }[] | undefined {
  const situationAnswers = getOrderedSituationAnswers(attemptDetail?.answers);
  if (situationAnswers.length === 0) return undefined;
  const rows: { index: number; manual_score: number }[] = [];
  situationAnswers.forEach((a, idx) => {
    const key = String(a.id);
    const v = situationManualScores[key];
    if (typeof v === "number" && !Number.isNaN(v)) {
      rows.push({ index: idx + 1, manual_score: Number(v) });
    }
  });
  return rows.length ? rows : undefined;
}

/** Only send explicit teacher edits — omit keys for "leave auto" so Django does not overwrite with 0. */
function compactManualScoresForApi(
  manualScores: Record<string, number | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(manualScores)) {
    if (typeof v === "number" && !Number.isNaN(v)) {
      out[k] = v;
    }
  }
  return out;
}

function areScoreMapsEqual(
  a: Record<string, number | undefined>,
  b: Record<string, number | undefined>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    const av = a[k];
    const bv = b[k];
    if (av == null && bv == null) continue;
    if (typeof av !== typeof bv) return false;
    if (typeof av === "number" && typeof bv === "number") {
      if (Math.abs(av - bv) > 0.0001) return false;
      continue;
    }
    if (av !== bv) return false;
  }
  return true;
}

type TestFormValues = z.infer<typeof testSchema>;
type ResultFormValues = z.infer<typeof resultSchema>;
type ExamFormValues = z.infer<typeof examSchema>;
type AttemptCanvasLike = {
  questionId?: number | null;
  situationIndex?: number;
  pageIndex?: number;
  imageUrl?: string | null;
  canvasJson?: object | null;
  canvasSnapshot?: string | null;
};
type BlueprintItemLike = {
  questionNumber?: number;
  questionId?: number;
  kind: string;
  mcOptionDisplay?: string;
  /** Question stem image (JSON/PDF blueprint or bank) */
  imageUrl?: string | null;
  options?: Array<{ id: string; text: string; imageUrl?: string; label?: string }>;
  correctOptionId?: string;
};

/** Loose match for MC option id vs stored selection (number/string/key). */
function optionIdMatchesSelection(optId: unknown, selectedToken: string | null): boolean {
  if (selectedToken == null || selectedToken === "") return false;
  const a = String(optId ?? "").trim();
  const b = String(selectedToken).trim();
  if (a === b) return true;
  if (a.toUpperCase() === b.toUpperCase()) return true;
  return false;
}

function normalizeQuestionKind(t?: string | null): "mc" | "open" | "situation" | "other" {
  const v = (t || "").toLowerCase();
  if (v === "situation") return "situation";
  if (v === "mc" || v === "multiple_choice" || v === "closed") return "mc";
  if (v === "open" || v.startsWith("open")) return "open";
  return "other";
}

function selectedOptionToken(ans: ExamAttemptDetail["answers"][number]): string | null {
  if (ans.selectedOptionId != null) return String(ans.selectedOptionId);
  if (ans.selectedOptionKey) return String(ans.selectedOptionKey).trim().toUpperCase();
  return null;
}

/** True if the student saved any text/open answer or selected an MC option (not "blank"). */
function studentHasProvidedAnswer(ans: ExamAttemptDetail["answers"][number]): boolean {
  const text = String((ans.textAnswer ?? (ans as { text_answer?: string }).text_answer) ?? "").trim();
  if (text.length > 0) return true;
  return Boolean(selectedOptionToken(ans));
}

/** Yoxlama: "Cavab verilməyib" only if no points and no stored answer (matching/MC/open). */
function answerProvidedOrScored(ans: ExamAttemptDetail["answers"][number], detail: ExamAttemptDetail): boolean {
  const auto = Number((ans as { autoScore?: number }).autoScore ?? 0);
  const manual = Number((ans as { manualScore?: number | null }).manualScore ?? 0);
  if (auto > 0 || manual > 0) return true;
  return studentHasProvidedAnswerForGrading(ans, detail);
}

function getAnswerOpenRule(ans: ExamAttemptDetail["answers"][number], bp: BlueprintItemLike | null): string {
  const fromAns =
    (ans as { answerRuleType?: string }).answerRuleType ??
    (ans as { answer_rule_type?: string }).answer_rule_type ??
    (ans as { openRule?: string }).openRule ??
    (ans as { open_rule?: string }).open_rule ??
    "";
  if (String(fromAns).trim()) return String(fromAns);
  if (bp) {
    const o =
      (bp as { openRule?: string; open_rule?: string }).openRule ?? (bp as { open_rule?: string }).open_rule;
    if (o) return String(o);
  }
  return "";
}

function hasMeaningfulOpenAnswer(text: string, ruleLike: string): boolean {
  const sub = subTypeFromRule(ruleLike);
  if (sub === "MATCHING") {
    return /\d+\s*[-–—:]\s*[a-zA-Z]/.test(text);
  }
  const normalized = normalizeAnswer(text, sub);
  if (normalized.length > 0) return true;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const v = JSON.parse(t) as unknown;
      if (Array.isArray(v)) return v.some((x) => x != null && String(x).trim() !== "");
      if (v && typeof v === "object") {
        return Object.values(v as Record<string, unknown>).some((x) => {
          if (x == null) return false;
          if (typeof x === "string") return x.trim() !== "";
          if (typeof x === "number") return !Number.isNaN(x);
          return true;
        });
      }
    } catch {
      return t.length > 0;
    }
  }
  return t.length > 0;
}

function situationHasStudentWork(ans: ExamAttemptDetail["answers"][number], detail: ExamAttemptDetail): boolean {
  const text = String((ans.textAnswer ?? (ans as { text_answer?: string }).text_answer) ?? "").trim();
  if (text.length > 0) return true;
  const situationIndex = getOrderedSituationAnswers(detail.answers).findIndex((a) => a.id === ans.id) + 1;
  const isPdf = detail.sourceType === "PDF";
  const canvases = detail.canvases ?? [];
  return canvases.some((c) => {
    const si = (c as { situationIndex?: number | null }).situationIndex;
    const qid = (c as { questionId?: number | null }).questionId;
    if (isPdf) return si === situationIndex;
    return (ans.questionId != null && qid === ans.questionId) || si === situationIndex;
  });
}

function studentHasProvidedAnswerForGrading(
  ans: ExamAttemptDetail["answers"][number],
  detail: ExamAttemptDetail
): boolean {
  if (selectedOptionToken(ans)) return true;
  const qk = normalizeQuestionKind(ans.questionType);
  if (qk === "situation") {
    return situationHasStudentWork(ans, detail);
  }
  const blueprint = (detail.attemptBlueprint ?? []) as BlueprintItemLike[];
  const bp =
    blueprint.find(
      (b) =>
        (b.questionNumber != null && b.questionNumber === ans.questionNumber) ||
        (b.questionId != null && b.questionId === ans.questionId)
    ) ?? null;
  const text = String((ans.textAnswer ?? (ans as { text_answer?: string }).text_answer) ?? "").trim();
  if (!text) return false;
  const rule = getAnswerOpenRule(ans, bp);
  const qt = String(ans.questionType || "").toUpperCase();
  if (qt === "MULTIPLE_CHOICE" || qt.includes("MC") || qt === "CLOSED") return true;
  if (qt.startsWith("OPEN") || qt.includes("OPEN")) {
    return hasMeaningfulOpenAnswer(text, rule);
  }
  return hasMeaningfulOpenAnswer(text, rule);
}

function getEffectiveUnitX(detail: ExamAttemptDetail): number {
  const uv = Number(detail.unitValue ?? 0);
  if (Number.isFinite(uv) && uv > 0) return uv;
  const max = Number(detail.maxScore ?? 150);
  const tu = detail.totalUnits;
  if (tu && tu > 0) return max / tu;
  return max / 33;
}

function scoresApproxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.009;
}

type QuestionGradeUiKind = "correct" | "partial" | "wrong" | "blank";

function getQuestionStatus(
  ans: ExamAttemptDetail["answers"][number],
  detail: ExamAttemptDetail
): { kind: QuestionGradeUiKind; label: string; badgeClass: string; dotClass: string } {
  const unitX = getEffectiveUnitX(detail);
  const qKind = normalizeQuestionKind(ans.questionType);
  const maxPts = qKind === "situation" ? unitX * 2 : unitX;
  const auto = Number(ans.autoScore ?? 0);
  const manual = Number(ans.manualScore ?? (ans as { manual_score?: number | null }).manual_score ?? 0);
  const total = auto + manual;
  const hasAnswer = studentHasProvidedAnswerForGrading(ans, detail);

  if (maxPts > 0 && scoresApproxEqual(total, maxPts)) {
    return {
      kind: "correct",
      label: "Doğru",
      badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
      dotClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
    };
  }
  if (total > 0 && (maxPts <= 0 || !scoresApproxEqual(total, maxPts))) {
    return {
      kind: "partial",
      label: "Yarımçıq",
      badgeClass: "bg-amber-100 text-amber-800 border-amber-300",
      dotClass: "bg-amber-100 text-amber-800 border-amber-300",
    };
  }
  if (hasAnswer) {
    return {
      kind: "wrong",
      label: "Səhv",
      badgeClass: "bg-rose-100 text-rose-800 border-rose-300",
      dotClass: "bg-rose-100 text-rose-800 border-rose-300",
    };
  }
  return {
    kind: "blank",
    label: "Cavab verilməyib",
    badgeClass: "border-2 border-orange-400 text-orange-900 bg-orange-50/60",
    dotClass: "border-2 border-orange-400 text-orange-900 bg-orange-50/60",
  };
}

const VARIANT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * PDF/JSON exams store MC keys like opt_1, opt_2. Map to A, B, C… using the same
 * option order the student saw (blueprint `options` array).
 */
function formatMcVariantLabelForTeacher(
  raw: string | null | undefined,
  blueprintOptions: Array<{ id?: string | number }>
): string {
  if (raw == null) return "—";
  const s = String(raw).trim();
  if (s === "") return "—";
  const opts = blueprintOptions ?? [];
  const byMatch = opts.findIndex((o) => optionIdMatchesSelection(o.id, s));
  if (byMatch >= 0) return VARIANT_LETTERS[byMatch] ?? s;
  const optPat = /^opt_(\d+)$/i.exec(s);
  if (optPat) {
    const n = parseInt(optPat[1], 10);
    if (Number.isFinite(n) && n >= 1) {
      const i = n - 1;
      if (opts.length > 0 && i < opts.length) {
        return VARIANT_LETTERS[i] ?? s;
      }
      return VARIANT_LETTERS[i] ?? s;
    }
  }
  if (/^[A-Za-z]$/.test(s)) return s.toUpperCase();
  return s;
}

function findMcOptionTextById(
  bpOptions: Array<{ id?: string | number; text?: string | null }> | undefined,
  optionId: unknown
): string | null {
  if (!bpOptions || !Array.isArray(bpOptions) || optionId == null) return null;
  const token = String(optionId).trim();
  if (!token) return null;
  const opt = bpOptions.find((o) => String(o.id ?? "").trim() === token);
  return opt?.text ?? null;
}

function resolveStudentMcOptionText(
  ans: ExamAttemptDetail["answers"][number],
  bpOptions: Array<{ id?: string | number; text?: string | null }>
): string | null {
  const selectedId =
    ans.selectedOptionId ??
    (ans as { selected_option_id?: number | null }).selected_option_id ??
    null;
  if (selectedId != null) {
    return findMcOptionTextById(bpOptions, selectedId);
  }

  // Some payloads only carry selectedOptionKey (e.g. opt_1 for JSON/PDF).
  const keyToken =
    (ans as { selectedOptionKey?: string | null }).selectedOptionKey ??
    (ans as { selected_option_key?: string | null }).selected_option_key ??
    null;
  if (!keyToken) return null;
  return findMcOptionTextById(bpOptions, keyToken);
}

const VALID_TABS: TabType[] = ["bank", "active", "grading", "old", "archive"];
function parseTab(value: string | null): TabType {
  if (value && VALID_TABS.includes(value as TabType)) return value as TabType;
  return "bank";
}

export default function TestsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab = parseTab(tabParam);

  const gradingExamIdParam = searchParams.get("examId");
  const gradingExamId = useMemo(() => {
    if (!gradingExamIdParam || activeTab !== "grading") return null;
    const n = parseInt(gradingExamIdParam, 10);
    return Number.isFinite(n) ? n : null;
  }, [gradingExamIdParam, activeTab]);

  const gradingGroupId = activeTab === "grading" ? (searchParams.get("groupId") ?? "") : "";
  const gradingStatus = activeTab === "grading" ? (searchParams.get("status") ?? "") : "";
  const gradingShowArchived = activeTab === "grading" && searchParams.get("showArchived") === "true";

  const activeRunStatusFilter = activeTab === "active" ? (searchParams.get("runStatus") ?? "") : "";
  const activeRunTypeFilter = activeTab === "active" ? (searchParams.get("runType") ?? "") : "";
  const activeRunSearchFromUrl = activeTab === "active" ? (searchParams.get("runSearch") ?? "") : "";

  const updateTestsUrl = useCallback(
    (updates: {
      tab?: TabType;
      examId?: number | null;
      groupId?: string;
      status?: string;
      showArchived?: boolean;
      runStatus?: string;
      runType?: string;
      runSearch?: string;
    }) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (updates.tab !== undefined) {
        qs.set("tab", updates.tab);
        if (updates.tab !== "grading") {
          qs.delete("examId");
          qs.delete("groupId");
          qs.delete("status");
          qs.delete("showArchived");
        }
        if (updates.tab !== "active") {
          qs.delete("runStatus");
          qs.delete("runType");
          qs.delete("runSearch");
        }
      }
      if (updates.examId !== undefined) {
        if (updates.examId == null) qs.delete("examId");
        else qs.set("examId", String(updates.examId));
      }
      if (updates.groupId !== undefined) {
        if (!updates.groupId) qs.delete("groupId");
        else qs.set("groupId", updates.groupId);
      }
      if (updates.status !== undefined) {
        if (!updates.status) qs.delete("status");
        else qs.set("status", updates.status);
      }
      if (updates.showArchived !== undefined) {
        if (!updates.showArchived) qs.delete("showArchived");
        else qs.set("showArchived", "true");
      }
      if (updates.runStatus !== undefined) {
        if (!updates.runStatus) qs.delete("runStatus");
        else qs.set("runStatus", updates.runStatus);
      }
      if (updates.runType !== undefined) {
        if (!updates.runType) qs.delete("runType");
        else qs.set("runType", updates.runType);
      }
      if (updates.runSearch !== undefined) {
        if (!updates.runSearch) qs.delete("runSearch");
        else qs.set("runSearch", updates.runSearch);
      }
      const query = qs.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const [oldGroupId, setOldGroupId] = useState<string>("");
  const [oldStudentId, setOldStudentId] = useState<string>("");
  const [oldTestName, setOldTestName] = useState("");
  const [oldPage, setOldPage] = useState(1);
  const [expandedOldRunId, setExpandedOldRunId] = useState<number | null>(null);
  const debouncedOldTestName = useDebounce(oldTestName, 300);
  const [showCreateTest, setShowCreateTest] = useState(false);
  const [showCreateResult, setShowCreateResult] = useState(false);
  const [showCreateExam, setShowCreateExam] = useState(false);
  const [showAddQuestions, setShowAddQuestions] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [selectedArchiveExams, setSelectedArchiveExams] = useState<Set<number>>(new Set());
  const [examTopicFilter, setExamTopicFilter] = useState("");
  const [examQuestionSearch, setExamQuestionSearch] = useState("");
  const debouncedExamQuestionSearch = useDebounce(examQuestionSearch, 300);
  const [activeRunSearch, setActiveRunSearch] = useState("");
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(null);
  const [showGradingModal, setShowGradingModal] = useState(false);
  const [manualScores, setManualScores] = useState<Record<string, number | undefined>>({});
  const [situationManualScores, setSituationManualScores] = useState<Record<string, number | undefined>>({});
  const [situationSaveState, setSituationSaveState] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [canvasPreviewUrl, setCanvasPreviewUrl] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [publishConfirmRun, setPublishConfirmRun] = useState<{ runId: number; title: string } | null>(null);
  const [bulkCancelModal, setBulkCancelModal] = useState<{ title: string; attemptIds: number[] } | null>(null);
  const [isPdfReady, setIsPdfReady] = useState(false);
  const [pdfFallbackReady, setPdfFallbackReady] = useState(false);

  const [showExamSettings, setShowExamSettings] = useState(false);
  const [examDuration, setExamDuration] = useState<number>(60);
  const [examDurationInput, setExamDurationInput] = useState<string>("60");
  const [examStartTime, setExamStartTime] = useState<string>("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [assignMode, setAssignMode] = useState<"groups" | "student" | "students">("groups");
  const [archiveSubTab, setArchiveSubTab] = useState<ArchiveSubTab>("exams");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [showHardDeleteModal, setShowHardDeleteModal] = useState<{ type: string; id: number; name: string } | null>(null);
  const [hardDeleteStep, setHardDeleteStep] = useState<1 | 2>(1);
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState(false);
  const [hardDeleteTyped, setHardDeleteTyped] = useState("");
  const [createExamSource, setCreateExamSource] = useState<"BANK" | "JSON" | "PDF">("BANK");
  const [groupStudentSearch, setGroupStudentSearch] = useState("");
  const [extendRunModal, setExtendRunModal] = useState<ActiveRunItem | null>(null);
  const [extendRunDuration, setExtendRunDuration] = useState(60);
  const [extendRunDurationInput, setExtendRunDurationInput] = useState<string>("60");
  const [extendRunStartAt, setExtendRunStartAt] = useState("");
  const [createExamJson, setCreateExamJson] = useState("");
  const [createExamPdfId, setCreateExamPdfId] = useState<number | null>(null);
  const [createExamJsonError, setCreateExamJsonError] = useState<string | null>(null);
  const [createExamMaxScorePreset, setCreateExamMaxScorePreset] = useState<"100" | "150" | "custom">("150");
  const [createExamMaxScoreCustom, setCreateExamMaxScoreCustom] = useState<number>(100);
  const [showActivateExamModal, setShowActivateExamModal] = useState(false);
  const [activateExamId, setActivateExamId] = useState<number | null>(null);
  const [activateExamStartTime, setActivateExamStartTime] = useState("");
  const [activateExamDuration, setActivateExamDuration] = useState(60);
  const [activateExamDurationInput, setActivateExamDurationInput] = useState<string>("60");
  const [showExamPreview, setShowExamPreview] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (activeTab === "grading") {
      queryClient.refetchQueries({ queryKey: ["teacher", "exams"] });
    }
  }, [activeTab, queryClient]);
  const debouncedArchiveSearch = useDebounce(archiveSearch, 300);
  const debouncedActiveRunSearch = useDebounce(activeRunSearch, 300);

  useEffect(() => {
    if (activeTab === "active") setActiveRunSearch(activeRunSearchFromUrl);
  }, [activeTab, activeRunSearchFromUrl]);

  useEffect(() => {
    if (activeTab !== "active") return;
    if (debouncedActiveRunSearch !== activeRunSearchFromUrl) {
      updateTestsUrl({ runSearch: debouncedActiveRunSearch });
    }
  }, [activeTab, debouncedActiveRunSearch, activeRunSearchFromUrl, updateTestsUrl]);

  const { data: pdfsList = [] } = useQuery({
    queryKey: ["teacher", "pdfs"],
    queryFn: () => teacherApi.getPDFs(),
    enabled: showCreateExam && createExamSource === "PDF",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["teacher", "tests"],
    queryFn: () => teacherApi.getTests(),
  });
  const { data: exams = [], isLoading: examsLoading } = useQuery({
    queryKey: ["teacher", "exams"],
    queryFn: () => teacherApi.getExams(),
  });

  const now = new Date();
  const activeExams = (exams as ExamListItem[]).filter((ex) => ex.status === "active");
  const { data: examDetail, isLoading: examDetailLoading } = useQuery({
    queryKey: ["teacher", "exam", selectedExamId],
    queryFn: () => teacherApi.getExamDetail(selectedExamId!),
    enabled: selectedExamId != null,
  });
  const { data: topics = [] } = useQuery({
    queryKey: ["teacher", "question-topics"],
    queryFn: () => teacherApi.getQuestionTopics(),
  });
  const { data: questionsForExam = [] } = useQuery({
    queryKey: ["teacher", "questions", "exam-picker", examTopicFilter, debouncedExamQuestionSearch],
    queryFn: () =>
      teacherApi.getQuestions({
        ...(examTopicFilter ? { topic: examTopicFilter } : {}),
        ...(debouncedExamQuestionSearch.trim() ? { q: debouncedExamQuestionSearch.trim() } : {}),
      }),
    enabled: showAddQuestions,
  });

  const { data: students } = useQuery({
    queryKey: ["teacher", "students", "active"],
    queryFn: () => teacherApi.getStudents("active"),
  });
  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
    staleTime: 60 * 1000, // Cache groups for 1 minute
  });
  const gradingParams = {
    groupId: gradingGroupId || undefined,
    status: gradingStatus || undefined,
    showArchived: gradingShowArchived,
    gradingQueueOnly: true, // only show runs that need grading (teacher_graded=False, published=False)
  };
  const { data: attemptsData, isLoading: attemptsLoading } = useQuery({
    queryKey: ["teacher", "grading-attempts", gradingExamId, gradingGroupId, gradingStatus, gradingShowArchived],
    queryFn: () =>
      gradingExamId != null
        ? teacherApi.getExamAttempts(gradingExamId, gradingParams)
        : teacherApi.getGradingAttempts(gradingParams),
    enabled: activeTab === "grading",
    staleTime: 0,
    refetchInterval: 10000, // Real-time polling 10s
    placeholderData: keepPreviousData,
  });
  const { data: oldRunAttemptsData } = useQuery({
    queryKey: ["teacher", "run-attempts", expandedOldRunId],
    queryFn: () => teacherApi.getRunAttempts(expandedOldRunId!),
    enabled: expandedOldRunId != null,
  });
  const { data: finishedRunsData } = useQuery({
    queryKey: ["teacher", "finished-runs", oldGroupId, oldStudentId, debouncedOldTestName, oldPage],
    queryFn: () => {
      const gid = oldGroupId ? parseInt(oldGroupId, 10) : undefined;
      const sid = oldStudentId ? parseInt(oldStudentId, 10) : undefined;
      return teacherApi.getFinishedRuns({
        group_id: gid != null && Number.isFinite(gid) ? gid : undefined,
        student_id: sid != null && Number.isFinite(sid) ? sid : undefined,
        q: debouncedOldTestName || undefined,
        page: oldPage,
        page_size: 20,
      });
    },
    enabled: activeTab === "old",
  });
  const { data: archiveExamsData } = useQuery({
    queryKey: ["teacher", "archive", "exams", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveExams({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "exams",
  });
  const { data: archiveQuestionsData } = useQuery({
    queryKey: ["teacher", "archive", "questions", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveQuestions({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "questions",
  });
  const { data: archiveTopicsData } = useQuery({
    queryKey: ["teacher", "archive", "question-topics", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveQuestionTopics({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "topics",
  });
  const { data: archiveCodingTopicsData } = useQuery({
    queryKey: ["teacher", "archive", "coding-topics", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveCodingTopics({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "codingTopics",
  });
  const { data: archiveCodingTasksData } = useQuery({
    queryKey: ["teacher", "archive", "coding-tasks", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveCodingTasks({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "codingTasks",
  });
  const { data: archivePdfsData } = useQuery({
    queryKey: ["teacher", "archive", "pdfs", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchivePdfs({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "pdfs",
  });
  const {
    data: attemptDetail,
    isLoading: attemptDetailLoading,
    refetch: refetchAttemptDetail,
  } = useQuery({
    queryKey: ["teacher", "attempt-detail", selectedAttemptId],
    queryFn: () => teacherApi.getAttemptDetail(selectedAttemptId!),
    enabled: selectedAttemptId != null,
    staleTime: 0,
  });

  useEffect(() => {
    if (!showGradingModal) return;
    if (selectedAttemptId == null) return;
    // Always fetch the latest attempt-detail when the grading modal is opened.
    void refetchAttemptDetail();
  }, [showGradingModal, selectedAttemptId, refetchAttemptDetail]);

  useEffect(() => {
    // Prevent previous student's transient manual state from leaking visually.
    setManualScores({});
    setSituationManualScores({});
  }, [selectedAttemptId]);

  useEffect(() => {
    if (!attemptDetail?.answers || selectedAttemptId == null) return;
    const next: Record<string, number | undefined> = {};
    const nextSituationManual: Record<string, number | undefined> = {};
    for (const a of attemptDetail.answers) {
      if (a.id != null) {
        const v = a.manualScore ?? (a as { manual_score?: number }).manual_score;
        if (typeof v === "number" && !Number.isNaN(v)) {
          next[String(a.id)] = v;
          const isSituation =
            (a.questionType as string) === "SITUATION" ||
            (a.questionType as string)?.toLowerCase() === "situation";
          if (isSituation) {
            nextSituationManual[String(a.id)] = v;
          }
        }
      }
    }
    setManualScores((prev) => (areScoreMapsEqual(prev, next) ? prev : next));
    setSituationManualScores((prev) =>
      areScoreMapsEqual(prev, nextSituationManual) ? prev : nextSituationManual
    );
  }, [attemptDetail, selectedAttemptId]);
  /** Match student presentation order: backend sends answers in blueprint order; sort by presentationOrder when present. */
  const orderedGradingAnswers = useMemo(() => {
    const answers = [...(attemptDetail?.answers ?? [])];
    return answers.sort((a, b) => {
      const ao = (a as { presentationOrder?: number }).presentationOrder;
      const bo = (b as { presentationOrder?: number }).presentationOrder;
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      const na = Number(a.questionNumber ?? 0);
      const nb = Number(b.questionNumber ?? 0);
      if (na !== nb) return na - nb;
      return (a.id ?? 0) - (b.id ?? 0);
    });
  }, [attemptDetail?.answers]);
  const { data: activeRuns = [], isLoading: activeRunsLoading } = useQuery({
    queryKey: ["teacher", "active-runs", activeRunStatusFilter, activeRunTypeFilter, debouncedActiveRunSearch],
    queryFn: () => teacherApi.getActiveRuns({
      status: (activeRunStatusFilter === "active" || activeRunStatusFilter === "scheduled" ? activeRunStatusFilter : undefined) as "" | "active" | "scheduled" | undefined,
      type: (activeRunTypeFilter === "quiz" || activeRunTypeFilter === "exam" ? activeRunTypeFilter : undefined) as "" | "quiz" | "exam" | undefined,
      q: debouncedActiveRunSearch || undefined,
    }),
    enabled: activeTab === "active",
    placeholderData: keepPreviousData,
  });

  const examComposition = useMemo(() => {
    const d = examDetail;
    const counts = getCountsFromDetail(d);
    const required = d?.type ? getRequiredCounts(d.type) : null;
    const valid = counts && required ? isCompositionValid(counts, d!.type) : false;
    const sourceType = (d as { source_type?: string })?.source_type;
    const hasPdfAndAnswerKey = Boolean(
      (d as { pdf_url?: string })?.pdf_url
    ) && Boolean((d as { has_answer_key?: boolean })?.has_answer_key);
    const canActivate = valid && (sourceType !== "PDF" || hasPdfAndAnswerKey);
    const invalidReason = !valid
      ? "Sual tərkibi uyğun deyil (imtahan: tam 30 sual — 22 qapalı + 5 açıq + 3 situasiya; quiz: ən azı 1 sual)."
      : sourceType === "PDF" && !hasPdfAndAnswerKey
        ? "PDF imtahanı üçün PDF faylı və cavab açarı tələb olunur."
        : null;
    return { counts, required, canActivate, invalidReason };
  }, [examDetail]);

  const createTestMutation = useMutation({
    mutationFn: (data: Partial<Test>) => teacherApi.createTest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "tests"] });
      setShowCreateTest(false);
    },
  });

  const createResultMutation = useMutation({
    mutationFn: (data: ResultFormValues) =>
      teacherApi.createTestResult({
        studentProfileId: data.studentProfileId,
        groupId: data.groupId && data.groupId > 0 ? data.groupId : undefined,
        testName: data.testName,
        maxScore: data.maxScore,
        score: data.score,
        date: data.date,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "tests"] });
      setShowCreateResult(false);
    },
  });

  const createExamMutation = useMutation({
    mutationFn: (data: Parameters<typeof teacherApi.createExam>[0]) =>
      teacherApi.createExam(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      setShowCreateExam(false);
    },
    onError: (error: any) => {
      console.error("Create exam error:", error);
      console.error("Error status:", error?.status);
      console.error("Error message:", error?.message);
      console.error("Error response data:", error?.response?.data || error?.data);
      console.error("Full error object:", JSON.stringify(error, null, 2));
      const errorData = error?.response?.data || error?.data;
      let errorMessage = error?.message || "İmtahan yaradıla bilmədi";
      if (errorData) {
        if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (typeof errorData === 'object' && !Array.isArray(errorData)) {
          const fieldErrors: string[] = [];
          for (const [field, errors] of Object.entries(errorData)) {
            if (Array.isArray(errors)) {
              fieldErrors.push(`${field}: ${errors.join(', ')}`);
            } else if (typeof errors === 'string') {
              fieldErrors.push(`${field}: ${errors}`);
            } else if (errors && typeof errors === 'object') {
              fieldErrors.push(`${field}: ${JSON.stringify(errors)}`);
            }
          }
          errorMessage = fieldErrors.length > 0 ? fieldErrors.join('; ') : (errorData.message || JSON.stringify(errorData));
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      }
      alert(`Xəta: ${errorMessage}`);
    },
  });

  const activateExamMutation = useMutation({
    mutationFn: ({ examId, start_time, duration_minutes }: { examId: number; start_time: string; duration_minutes: number }) =>
      teacherApi.activateExam(examId, { start_time, duration_minutes }),
    onSuccess: (_data, { examId }) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam", examId] });
      setShowActivateExamModal(false);
      setActivateExamId(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || err?.message || "Aktivləşdirmə xətası";
      alert(msg);
    },
  });

  const addExamQuestionMutation = useMutation({
    mutationFn: ({ examId, questionId }: { examId: number; questionId: number }) =>
      teacherApi.addExamQuestion(examId, questionId),
    onSuccess: (_data, { examId }) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam", examId] });
    },
  });
  const removeExamQuestionMutation = useMutation({
    mutationFn: ({ examId, questionId }: { examId: number; questionId: number }) =>
      teacherApi.removeExamQuestion(examId, questionId),
    onSuccess: () => {
      if (selectedExamId) queryClient.invalidateQueries({ queryKey: ["teacher", "exam", selectedExamId] });
    },
  });
  const gradeAttemptMutation = useMutation({
    mutationFn: ({ attemptId, publish }: { attemptId: number; publish: boolean }) => {
      const per_situation_scores = buildPerSituationScoresPayloadV2(attemptDetail, situationManualScores);
      const manualScoresPayload = compactManualScoresForApi({ ...manualScores, ...situationManualScores });
      return teacherApi.gradeAttempt(attemptId, {
        manualScores: manualScoresPayload,
        per_situation_scores,
        publish,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "attempt-detail"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "finished-runs"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "run-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      setShowGradingModal(false);
      setManualScores({});
      setSituationManualScores({});
      setSelectedAttemptId(null);
    },
  });

  const handleSaveSituation = useCallback(async (params: {
    answerId: number;
    examRunId?: number | null;
    situationIndex: number;
    score: number;
    sourceType: "BANK" | "PDF" | "JSON";
    teacherComment?: string;
  }) => {
    if (!selectedAttemptId) return;
    const key = String(params.answerId);
    setSituationSaveState((prev) => ({ ...prev, [key]: "saving" }));
    // optimistic score sync
    setSituationManualScores((prev) => ({ ...prev, [key]: params.score }));
    setManualScores((prev) => ({ ...prev, [key]: params.score }));
    try {
      const basePayload = {
        student_answer_id: params.answerId,
        score: params.score,
        teacher_notes: params.teacherComment ?? "",
        exam_run_id: params.examRunId ?? attemptDetail?.runId ?? null,
        publish: false,
      };
      // Debug aid: verify source-agnostic grading payload
      console.info("handleSaveSituation payload", basePayload);
      if (params.sourceType === "PDF") {
        await teacherApi.gradeAttempt(selectedAttemptId, {
          ...basePayload,
          per_situation_scores: [{ index: params.situationIndex, manual_score: params.score }],
          manualScores: { [key]: params.score },
          notes: params.teacherComment ?? "",
        });
      } else {
        await teacherApi.gradeAttempt(selectedAttemptId, {
          ...basePayload,
          manualScores: { [key]: params.score },
          notes: params.teacherComment ?? "",
        });
      }
      setSituationSaveState((prev) => ({ ...prev, [key]: "saved" }));
      toast.success("Yadda saxlanıldı");
      setTimeout(() => {
        setSituationSaveState((prev) => ({ ...prev, [key]: "idle" }));
      }, 1800);
      queryClient.invalidateQueries({ queryKey: ["teacher", "attempt-detail", selectedAttemptId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
    } catch (e: any) {
      setSituationSaveState((prev) => ({ ...prev, [key]: "error" }));
      const backendMsg =
        e?.data?.detail ||
        e?.response?.data?.detail ||
        e?.data?.message ||
        e?.message ||
        "Saxlama alınmadı";
      toast.error(String(backendMsg));
    }
  }, [attemptDetail?.runId, queryClient, selectedAttemptId, toast]);

  useEffect(() => {
    const pages = (attemptDetail as { pages?: string[] } | undefined)?.pages;
    const ok = Array.isArray(pages) && pages.length > 0;
    setIsPdfReady(ok);
    setPdfFallbackReady(false);
  }, [(attemptDetail as { pages?: string[] } | undefined)?.pages]);
  const publishAttemptMutation = useMutation({
    mutationFn: ({ attemptId, publish }: { attemptId: number; publish: boolean }) =>
      teacherApi.publishAttempt(attemptId, publish),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
    },
  });
  const startExamMutation = useMutation({
    mutationFn: (examId: number) => {
      const parsed = Number(examDurationInput);
      const duration = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : Math.max(1, Number(examDuration) || 60);
      setExamDuration(duration);
      setExamDurationInput(String(duration));
      const payload: { groupIds?: number[]; studentId?: number; studentIds?: number[]; durationMinutes: number; startTime?: string } = {
        durationMinutes: duration,
      };
      if (examStartTime) {
        payload.startTime = new Date(examStartTime).toISOString();
      }
      if (assignMode === "groups" && selectedGroupIds.length > 0) {
        const validIds = selectedGroupIds.filter((id) => Number.isFinite(Number(id)));
        if (validIds.length === 0) throw new Error("Etibarlı qrup seçin");
        payload.groupIds = validIds.map(Number);
      } else if (assignMode === "student" && selectedStudentId) {
        const sid = Number(selectedStudentId);
        if (!Number.isFinite(sid)) throw new Error("Etibarlı şagird seçin");
        payload.studentId = sid;
      } else if (assignMode === "students" && selectedStudentIds.length > 0) {
        const validIds = selectedStudentIds.filter((id) => Number.isFinite(Number(id))).map(Number);
        if (validIds.length === 0) throw new Error("Etibarlı şagird seçin");
        payload.studentIds = validIds;
      } else {
        throw new Error("Qrup, şagird və ya çoxlu şagird seçin");
      }
      return teacherApi.startExamNow(examId, payload);
    },
    onSuccess: (_, examId) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam", examId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "active-runs"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      setShowExamSettings(false);
      setSelectedGroupIds([]);
      setSelectedStudentId(null);
      setSelectedStudentIds([]);
    },
  });
  const stopExamMutation = useMutation({
    mutationFn: (examId: number) => teacherApi.stopExam(examId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "active-runs"] });
    },
  });
  const stopRunMutation = useMutation({
    mutationFn: (runId: number) => teacherApi.stopRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "active-runs"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
    },
  });
  const updateRunMutation = useMutation({
    mutationFn: ({ runId, duration_minutes, start_at }: { runId: number; duration_minutes?: number; start_at?: string }) =>
      teacherApi.updateRun(runId, { duration_minutes, start_at }),
    onSuccess: (data: { flashEndTriggered?: boolean; bulkSubmittedCount?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "active-runs"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      if (data?.flashEndTriggered) {
        toast.success(
          `İmtahan müddəti bitmiş hesab olunur. ${data.bulkSubmittedCount ?? 0} şagirdin cavabı təqdim edildi — Yoxlama üçün hazırdır.`
        );
      }
      setExtendRunModal(null);
    },
    onError: (err: { message?: string; data?: { detail?: string } }) => {
      toast.error(err?.data?.detail || err?.message || "Yeniləmə alınmadı");
    },
  });
  const publishRunMutation = useMutation({
    mutationFn: ({ runId }: { runId: number }) => teacherApi.publishRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "finished-runs"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "run-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      setPublishConfirmRun(null);
    },
  });
  const deleteOldRunMutation = useMutation({
    mutationFn: ({ runId }: { runId: number }) => teacherApi.deleteRunFromHistory(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "finished-runs"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
      queryClient.invalidateQueries({ queryKey: ["parent", "exam-results"] });
      toast.success("Köhnə imtahan tarixçədən silindi");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Silmə zamanı xəta baş verdi");
    },
  });
  const bulkDeleteExamsMutation = useMutation({
    mutationFn: (ids: number[]) => teacherApi.bulkDeleteExams(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "archive"] });
      setSelectedArchiveExams(new Set());
    },
  });
  const hardDeleteMutation = useMutation({
    mutationFn: async ({ type, id, force }: { type: string; id: number; force?: boolean }) => {
      if (type === "exam") return teacherApi.hardDeleteExam(id, force);
      if (type === "question") return teacherApi.hardDeleteQuestion(id);
      if (type === "topic") return teacherApi.hardDeleteQuestionTopic(id);
      if (type === "pdf") return teacherApi.hardDeletePdf(id);
      if (type === "codingTopic") return teacherApi.hardDeleteCodingTopic(id);
      if (type === "codingTask") return teacherApi.hardDeleteCodingTask(id);
      throw new Error("Unknown type");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher"] });
      setShowHardDeleteModal(null);
      setHardDeleteStep(1);
      setHardDeleteConfirm(false);
      setHardDeleteTyped("");
    },
    onError: (err: any) => {
      if (err?.response?.status === 409 && err?.response?.data?.code === "HAS_ATTEMPTS") {
        alert("İmtahanda cəhdlər var. Tam silmək mümkün deyil.");
      }
    },
  });
  const restartAttemptMutation = useMutation({
    mutationFn: ({ attemptId, duration }: { attemptId: number; duration?: number }) =>
      teacherApi.restartAttempt(attemptId, duration ?? 60),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
    },
  });
  const continueAttemptMutation = useMutation({
    mutationFn: ({ attemptId }: { attemptId: number }) => teacherApi.continueAttempt(attemptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
    },
  });
  const cancelAttemptMutation = useMutation({
    mutationFn: ({ attemptId }: { attemptId: number }) => teacherApi.cancelAttempt(attemptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
    },
  });

  const bulkCancelAttemptsMutation = useMutation({
    mutationFn: async (attemptIds: number[]) => {
      for (const id of attemptIds) {
        await teacherApi.cancelAttempt(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "grading-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
      setBulkCancelModal(null);
      toast.success("Seçilmiş cəhdlər ləğv edildi");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Toplu ləğv zamanı xəta baş verdi");
    },
  });

  const {
    register: registerTest,
    handleSubmit: handleSubmitTest,
    formState: { errors: errorsTest },
    reset: resetTest,
  } = useForm<TestFormValues>({
    resolver: zodResolver(testSchema),
    defaultValues: { type: "quiz" },
  });

  const {
    register: registerResult,
    handleSubmit: handleSubmitResult,
    formState: { errors: errorsResult },
    reset: resetResult,
  } = useForm<ResultFormValues>({
    resolver: zodResolver(resultSchema),
  });

  const {
    register: registerExam,
    handleSubmit: handleSubmitExam,
    formState: { errors: errorsExam },
    reset: resetExam,
  } = useForm<ExamFormValues>({
    resolver: zodResolver(examSchema),
    defaultValues: { type: "exam", status: "draft" },
  });

  const [addQuestionIds, setAddQuestionIds] = useState<number[]>([]);
  const examQuestionIds = new Set((examDetail?.questions ?? []).map((q) => q.question));

  if (isLoading) return <Loading />;

  const tests: Test[] = data?.tests || [];
  const results: TestResult[] = data?.results || [];

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Testlər</h1>
        {activeTab === "bank" && (
          <button
            onClick={() => {
              setShowCreateExam(true);
              resetExam({
                type: "exam",
                status: "draft",
                title: "",
              });
            }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Yeni imtahan
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-slate-200">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => updateTestsUrl({ tab: "bank" })}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "bank"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Test bankı
          </button>
          <button
            type="button"
            onClick={() => updateTestsUrl({ tab: "active" })}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "active"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Aktiv testlər
          </button>
          <button
            type="button"
            onClick={() => updateTestsUrl({ tab: "grading" })}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "grading"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Yoxlama
          </button>
          <button
            type="button"
            onClick={() => updateTestsUrl({ tab: "old" })}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "old"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Köhnə İmtahanlar
          </button>
          <button
            type="button"
            onClick={() => updateTestsUrl({ tab: "archive" })}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "archive"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Arxiv
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "bank" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">İmtahanlar</h2>
            {examsLoading ? (
              <p className="text-slate-500 py-4">Yüklənir...</p>
            ) : (exams as ExamListItem[]).length > 0 ? (
              <ul className="space-y-2">
                {(exams as ExamListItem[]).map((ex) => (
                  <li
                    key={ex.id}
                    className={`flex items-center justify-between py-2 px-2 rounded border cursor-pointer ${
                      selectedExamId === ex.id ? "border-primary-500 bg-primary-50" : "border-slate-100"
                    }`}
                    onClick={() => setSelectedExamId(ex.id)}
                  >
                    <span className="font-medium text-slate-900">{ex.title}</span>
                    <span className="text-xs text-slate-500">
                      {ex.type === "quiz" ? "Quiz" : "İmtahan"} · {ex.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 py-4">İmtahan tapılmadı</p>
            )}
          </div>
          <div className="card">
            {selectedExamId == null ? (
              <p className="text-slate-500 py-4">İmtahan seçin</p>
            ) : examDetailLoading ? (
              <p className="text-slate-500 py-4">Yüklənir...</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900">{examDetail?.title}</h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-outline text-sm"
                      onClick={() => {
                        setAddQuestionIds([]);
                        setExamTopicFilter("");
                        setExamQuestionSearch("");
                        setShowAddQuestions(true);
                      }}
                    >
                      Sual əlavə et
                    </button>
                    <button
                      type="button"
                      className="btn-outline text-sm text-amber-700 border-amber-200 hover:bg-amber-50 flex items-center gap-1"
                      onClick={() => {
                        if (confirm("İmtahanı arxivə göndərmək istədiyinizə əminsiniz?")) {
                          teacherApi.updateExam(selectedExamId!, { is_archived: true }).then(() => {
                            queryClient.invalidateQueries({ queryKey: ["teacher"] });
                            setSelectedExamId(null);
                          });
                        }
                      }}
                    >
                      <Archive className="w-4 h-4" />
                      Arxivə göndər
                    </button>
                    <button
                      type="button"
                      className="btn-outline text-sm text-rose-700 border-rose-200 hover:bg-rose-50"
                      onClick={() => {
                        if (
                          confirm(
                            "İmtahan silinsin? Şagirdlər bu imtahanı aktiv siyahılarda və nəticələrdə görə bilməyəcək (yumşaq silmə)."
                          )
                        ) {
                          teacherApi.deleteExam(selectedExamId!).then(() => {
                            queryClient.invalidateQueries({ queryKey: ["teacher"] });
                            queryClient.invalidateQueries({ queryKey: ["student"] });
                            setSelectedExamId(null);
                          });
                        }
                      }}
                    >
                      Sil
                    </button>
                  </div>
                </div>
                
                {/* Exam Status & Metadata */}
                <div className="mb-4 space-y-2 border-b border-slate-200 pb-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <span className="text-xs text-slate-500">Status:</span>
                      <span className="text-sm font-medium ml-2">
                        {examDetail?.status === "draft" ? "Qaralama" : 
                         examDetail?.status === "active" ? "Aktiv" : 
                         examDetail?.status === "finished" ? "Bitmiş" : 
                         examDetail?.is_archived ? "Arxiv" : "Qaralama"}
                      </span>
                    </div>
                    {examDetail?.duration_minutes && (
                      <div>
                        <span className="text-xs text-slate-500">Müddət:</span>
                        <span className="text-sm font-medium ml-2">{examDetail.duration_minutes} dəq</span>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-slate-600">
                    <div>
                      <span className="text-xs text-slate-500">Başlanğıc:</span>{" "}
                      {examDetail?.start_time ? new Date(examDetail.start_time).toLocaleString("az-AZ") : "-"}
                    </div>
                    <div>
                      <span className="text-xs text-slate-500">Bitmə:</span>{" "}
                      {examDetail?.start_time != null && examDetail?.duration_minutes != null
                        ? new Date(new Date(examDetail.start_time).getTime() + (examDetail.duration_minutes || 0) * 60 * 1000).toLocaleString("az-AZ")
                        : "-"}
                    </div>
                  </div>
                  {examDetail?.assigned_groups && examDetail.assigned_groups.length > 0 && (
                    <div>
                      <span className="text-xs text-slate-500">Qruplar:</span>{" "}
                      <span className="text-sm">{examDetail.assigned_groups.map((g: any) => g.name).join(", ")}</span>
                    </div>
                  )}
                  <>
                        {(examDetail as any)?.source_type && (
                          <p className="text-xs text-slate-500 mt-1">
                            Mənbə: {(examDetail as any).source_type === "BANK" ? "Hazır suallar" : (examDetail as any).source_type === "PDF" ? "PDF + Cavab açarı" : "JSON"}
                          </p>
                        )}
                        {examComposition.counts && (
                          <div className="space-y-1 mt-1">
                            {examDetail?.type === "exam" && "closed" in (examComposition.required || {}) ? (
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                <span className={examComposition.counts.closed === (examComposition.required as { closed: number }).closed ? "text-green-600 font-medium" : "text-orange-600"}>
                                  Qapalı: {examComposition.counts.closed} / {(examComposition.required as { closed: number }).closed}
                                </span>
                                <span className={examComposition.counts.open === (examComposition.required as { open: number }).open ? "text-green-600 font-medium" : "text-orange-600"}>
                                  Açıq: {examComposition.counts.open} / {(examComposition.required as { open: number }).open}
                                </span>
                                <span className={examComposition.counts.situation === (examComposition.required as { situation: number }).situation ? "text-green-600 font-medium" : "text-orange-600"}>
                                  Situasiya: {examComposition.counts.situation} / {(examComposition.required as { situation: number }).situation}
                                </span>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-600">
                                Sual sayı: {examComposition.counts.closed + examComposition.counts.open + examComposition.counts.situation} (quiz üçün ən azı 1 tələb olunur)
                              </p>
                            )}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2 items-center">
                          {examDetail?.status === "draft" && (examDetail?.start_time == null || examDetail?.duration_minutes == null) && (
                            <button
                              type="button"
                              className="btn-primary text-sm"
                              onClick={() => {
                                if (examDetail?.id == null) return;
                                setActivateExamId(examDetail.id);
                                const now = new Date();
                                now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                                setActivateExamStartTime(now.toISOString().slice(0, 16));
                                const d = examDetail?.duration_minutes ?? 60;
                                setActivateExamDuration(d);
                                setActivateExamDurationInput(String(d));
                                setShowActivateExamModal(true);
                              }}
                            >
                              Aktivləşdir
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-outline text-sm"
                            disabled={!examComposition.canActivate}
                            onClick={() => {
                              if (examDetail?.assigned_groups) {
                                setSelectedGroupIds(examDetail.assigned_groups.map((g: any) => g.id));
                              }
                              const d = examDetail?.duration_minutes || 60;
                              setExamDuration(d);
                              setExamDurationInput(String(d));
                              const now = new Date();
                              now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                              setExamStartTime(now.toISOString().slice(0, 16));
                              setShowExamSettings(true);
                            }}
                          >
                            Seç və Başlat
                          </button>
                          {!examComposition.canActivate && examComposition.invalidReason && (
                            <span className="text-xs text-orange-600 max-w-xs">{examComposition.invalidReason}</span>
                          )}
                        </div>
                      </>
                </div>

                {((examDetail as { source_type?: string })?.source_type === "PDF" || (examDetail as { source_type?: string })?.source_type === "JSON" || (examDetail?.questions && examDetail.questions.length > 0)) && (
                  <div className="mb-6 max-h-[72vh] overflow-y-auto border border-slate-200 rounded-lg bg-white">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 border-b border-slate-200 pb-6">
                    <div className="lg:col-span-2">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h4 className="text-sm font-medium text-slate-700">İmtahan Vərəqinə Bax</h4>
                        <button
                          type="button"
                          onClick={() => setShowExamPreview(true)}
                          className="text-xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        >
                          Önizləmə pəncərəsi
                        </button>
                      </div>
                      {((examDetail as { source_type?: string })?.source_type === "PDF" || (examDetail as { source_type?: string })?.source_type === "JSON") && (examDetail as { pdf_url?: string })?.pdf_url ? (() => {
                        const pdfUrl = (examDetail as { pdf_url?: string }).pdf_url!;
                          const embeddedUrl = `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}embedded=true`;
                        return (
                          <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                            <iframe
                              title="İmtahan PDF"
                              src={embeddedUrl}
                                allow="fullscreen"
                                allowFullScreen
                              className="w-full min-h-[400px] max-h-[60vh]"
                            />
                          </div>
                        );
                      })() : (examDetail as { source_type?: string })?.source_type === "BANK" && examDetail?.questions?.length ? (
                        <p className="text-sm text-slate-500 py-4">Hazır suallar imtahanı. Önizləmə üçün &quot;Önizləmə pəncərəsi&quot; düyməsinə basın.</p>
                      ) : (
                        <p className="text-sm text-slate-500 py-4">PDF yüklənməyib və ya mövcud deyil.</p>
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">Cavab vərəqi</h4>
                      {(examDetail as ExamDetail).answer_key_preview && (examDetail as ExamDetail).answer_key_preview!.length > 0 ? (
                        <ul className="space-y-2 text-xs border border-slate-200 rounded-lg p-3 bg-slate-50">
                          {((examDetail as ExamDetail).answer_key_preview!).map((q, idx) => {
                            const raw = [q.correct, q.open_answer].find((x) => x != null && String(x).trim() !== "");
                            const display = raw != null ? String(raw) : "—";
                            return (
                              <li
                                key={idx}
                                id={`cavab-vereqi-${q.number ?? idx + 1}`}
                                className="flex flex-col gap-1 py-2 border-b border-slate-100 last:border-0"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-medium text-slate-800 tabular-nums">#{q.number ?? idx + 1}</span>
                                  <span className="text-slate-600 shrink-0">
                                    {q.kind === "mc" ? "Qapalı" : q.kind === "open" ? "Açıq" : "Situasiya"}
                                  </span>
                                </div>
                                <div className="text-green-800 font-medium text-[11px] leading-snug min-w-0">
                                  {display === "—" ? (
                                    <span>—</span>
                                  ) : (
                                    <UniversalLatex content={display} className="!text-inherit" />
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500 py-2">Cavab açarı siyahısı mövcud deyil.</p>
                      )}
                    </div>
                    </div>
                  </div>
                )}

                {examDetail?.questions && examDetail.questions.length > 0 ? (
                  <ul className="space-y-2">
                    {examDetail.questions.map((eq) => (
                      <li
                        key={eq.id}
                        className="flex items-center justify-between py-2 border-b border-slate-100"
                      >
                        <span className="text-sm text-slate-800 truncate flex-1">{formatExamQuestionEqLine(eq)}</span>
                        <button
                          type="button"
                          className="text-red-600 hover:bg-red-50 p-1 rounded"
                          onClick={() =>
                            removeExamQuestionMutation.mutate({ examId: selectedExamId, questionId: eq.question })
                          }
                          disabled={removeExamQuestionMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500 py-4">Bu imtahanda hələ sual yoxdur. &quot;Sual əlavə et&quot; ilə əlavə edin.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "active" && (
        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Aktiv testlər</h2>
          <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label text-xs">Status</label>
              <select
                className="input w-full"
                value={activeRunStatusFilter}
                onChange={(e) => updateTestsUrl({ runStatus: (e.target.value || "") as "active" | "scheduled" | "" })}
              >
                <option value="">Hamısı</option>
                <option value="active">Aktiv</option>
                <option value="scheduled">Planlaşdırılıb</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Növ</label>
              <select
                className="input w-full"
                value={activeRunTypeFilter}
                onChange={(e) => updateTestsUrl({ runType: (e.target.value || "") as "quiz" | "exam" | "" })}
              >
                <option value="">Hamısı</option>
                <option value="quiz">Quiz</option>
                <option value="exam">İmtahan</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Axtarış (qrup / şagird)</label>
              <input
                type="text"
                className="input w-full"
                placeholder="Qrup və ya şagird adı..."
                value={activeRunSearch}
                onChange={(e) => setActiveRunSearch(e.target.value)}
              />
            </div>
          </div>
          {activeRunsLoading ? (
            <p className="text-slate-500 py-4">Yüklənir...</p>
          ) : (activeRuns as ActiveRunItem[]).length > 0 ? (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {(activeRuns as ActiveRunItem[]).map((run) => {
                const end = new Date(run.end_at);
                const remaining = Math.max(0, Math.floor((end.getTime() - now.getTime()) / (1000 * 60)));
                const targetName = run.groupName || run.studentName || "—";
                return (
                  <div key={run.runId} className="border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-900 truncate">{run.examTitle}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {run.examType === "quiz" ? "Quiz" : "İmtahan"} · {targetName}
                      </p>
                      <p className="text-sm text-slate-600 mt-1">
                        {new Date(run.start_at).toLocaleString("az-AZ")} – {new Date(run.end_at).toLocaleString("az-AZ")} · {run.duration_minutes} dəq
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {run.status === "active" ? "Aktiv" : "Planlaşdırılıb"}
                        {run.status === "active" && remaining > 0 && ` · ${remaining} dəq qalıb`}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateTestsUrl({ tab: "grading", examId: run.examId })}
                        className="btn-outline text-sm flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />
                        Nəticələr
                      </button>
                      {(run.status === "active" || run.status === "scheduled") && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setExtendRunDuration(run.duration_minutes);
                              setExtendRunDurationInput(String(run.duration_minutes));
                              const d = new Date(run.start_at);
                              setExtendRunStartAt(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
                              setExtendRunModal(run);
                            }}
                            className="btn-outline text-sm flex items-center gap-1"
                          >
                            <Clock className="w-3 h-3" />
                            Vaxtı Uzat
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm("Bu başlamanı dayandırmaq istədiyinizə əminsiniz?")) {
                                stopRunMutation.mutate(run.runId);
                              }
                            }}
                            disabled={stopRunMutation.isPending}
                            className="btn-outline text-sm flex items-center gap-1 text-red-600 border-red-200 hover:bg-red-50"
                          >
                            <StopCircle className="w-3 h-3" />
                            Dayandır
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 py-4">Hazırda aktiv və ya planlaşdırılmış test yoxdur</p>
          )}
        </div>
      )}

      <Modal
        isOpen={!!extendRunModal}
        onClose={() => setExtendRunModal(null)}
        title="Vaxtı Uzat"
        size="sm"
      >
        {extendRunModal && (() => {
          const modalStartMs =
            extendRunModal.status === "scheduled" && extendRunStartAt?.trim()
              ? new Date(extendRunStartAt).getTime()
              : new Date(extendRunModal.start_at).getTime();
          const elapsedMin = Math.max(0, Math.ceil((Date.now() - modalStartMs) / 60000));
          const minRequired = Math.max(1, elapsedMin + 2);
          const parsedDur = Number(extendRunDurationInput);
          const safeDuration = Number.isFinite(parsedDur) && parsedDur >= 1 ? Math.floor(parsedDur) : extendRunDuration;
          const endsInPast = modalStartMs + safeDuration * 60000 <= Date.now();
          const marginBlocked = safeDuration < minRequired && !endsInPast;
          return (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{extendRunModal.examTitle} · {extendRunModal.groupName || extendRunModal.studentName || "—"}</p>
            {extendRunModal.status === "scheduled" && (
              <div>
                <label className="label">Başlanğıc tarix və vaxt</label>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={extendRunStartAt}
                  onChange={(e) => setExtendRunStartAt(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label">Müddət (dəqiqə)</label>
              <input
                type="number"
                min={1}
                className="input w-full"
                value={extendRunDurationInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setExtendRunDurationInput(v);
                  if (v.trim() === "") return;
                  const n = Number(v);
                  if (Number.isFinite(n) && n >= 1) setExtendRunDuration(Math.floor(n));
                }}
              />
            </div>
            {marginBlocked ? (
              <p className="text-sm text-red-700 font-medium bg-red-50 border border-red-200 rounded px-2 py-2">
                İmtahanın bitməsinə ən azı 2 dəqiqə qalmalıdır. (Minimum müddət: {minRequired} dəq)
              </p>
            ) : null}
            {endsInPast ? (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-2">
                Bu müddət ilə imtahanın bitmə vaxtı keçmiş hesab olunur — aktiv şagirdlər üçün cavablar avtomatik təqdim ediləcək və Yoxlama üçün görünəcək.
              </p>
            ) : null}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={updateRunMutation.isPending || marginBlocked}
                onClick={() => {
                  const parsed = Number(extendRunDurationInput);
                  const sd = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 60;
                  setExtendRunDuration(sd);
                  setExtendRunDurationInput(String(sd));
                  const payload: { duration_minutes: number; start_at?: string } = { duration_minutes: sd };
                  if (extendRunModal.status === "scheduled" && extendRunStartAt) {
                    payload.start_at = new Date(extendRunStartAt).toISOString();
                  }
                  updateRunMutation.mutate({ runId: extendRunModal.runId, ...payload });
                }}
              >
                {updateRunMutation.isPending ? "Yadda saxlanılır..." : "Yadda saxla"}
              </button>
              <button type="button" onClick={() => setExtendRunModal(null)} className="btn-outline flex-1">Ləğv et</button>
            </div>
          </div>
          );
        })()}
      </Modal>

      {activeTab === "grading" && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">İmtahan</label>
                <select
                  className="input w-full"
                  value={gradingExamId || ""}
                  onChange={(e) => updateTestsUrl({ examId: e.target.value ? parseInt(e.target.value) : null })}
                >
                  <option value="">Hamısı</option>
                  {(exams as ExamListItem[])
                    .filter((ex) => ex.needs_grading === true)
                    .map((ex) => (
                      <option key={ex.id} value={ex.id}>{ex.title}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="label">Qrup</label>
                <select
                  className="input w-full"
                  value={gradingGroupId}
                  onChange={(e) => updateTestsUrl({ groupId: e.target.value })}
                >
                  <option value="">Hamısı</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  className="input w-full"
                  value={gradingStatus}
                  onChange={(e) => updateTestsUrl({ status: e.target.value })}
                >
                  <option value="">Hamısı</option>
                  <option value="submitted">Təqdim edilmiş</option>
                  <option value="waiting_manual">Manual gözləyir</option>
                  <option value="graded">Qiymətləndirilmiş</option>
                  <option value="published">Yayımlanıb</option>
                </select>
              </div>
            </div>
          </div>

          {/* Attempts List */}
          <div className="card overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                Göndərişlər
                {(attemptsData?.attempts?.some((a: ExamAttempt) => a.status === "SUBMITTED") || attemptsData?.runs?.some((r: any) => r.attempts?.some((a: ExamAttempt) => a.status === "SUBMITTED"))) && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full animate-pulse">Yeni submit</span>
                )}
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                {gradingExamId != null &&
                  (attemptsData?.attempts?.length ?? 0) > 0 &&
                  !(attemptsData?.runs && attemptsData.runs.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        const ids = (attemptsData!.attempts as ExamAttempt[])
                          .map((x) => x.id)
                          .filter((x): x is number => typeof x === "number");
                        if (ids.length === 0) {
                          toast.info("Ləğv ediləcək aktiv cəhd yoxdur.");
                          return;
                        }
                        setBulkCancelModal({
                          title: (exams as ExamListItem[]).find((e) => e.id === gradingExamId)?.title || "İmtahan",
                          attemptIds: ids,
                        });
                      }}
                      disabled={bulkCancelAttemptsMutation.isPending}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
                    >
                      Hamısını ləğv et
                    </button>
                  )}
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={gradingShowArchived}
                    onChange={(e) => updateTestsUrl({ showArchived: e.target.checked })}
                  />
                  Köhnə attempt-lər
                </label>
              </div>
            </div>
            {attemptsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
              </div>
            ) : ((attemptsData?.runs?.length ?? 0) === 0 && (attemptsData?.attempts?.length ?? 0) === 0) ? (
              <p className="text-slate-500 py-4 text-center">
                {(exams as ExamListItem[]).filter((ex) => ex.status === "finished" && ex.needs_grading).length === 0
                  ? "Yoxlanılacaq imtahan yoxdur. Bitmiş imtahanlar nəticə yayımlandıqdan sonra Köhnə İmtahanlarda görünər."
                  : "Seçilmiş filterlərə uyğun yoxlanılmalı imtahan tapılmadı."}
              </p>
            ) : (attemptsData?.runs && attemptsData.runs.length > 0) || (attemptsData?.attempts && attemptsData.attempts.length > 0) ? (
              attemptsData.runs ? (
                // Group exam: show runs as expandable blocks
                <div className="space-y-4">
                  {attemptsData.runs.map((run: any) => {
                    const gradedUnpublishedCount = (run.attempts as ExamAttempt[]).filter((a: ExamAttempt) => a.isChecked && !a.isPublished).length;
                    const allPublished = (run.attempts as ExamAttempt[]).length > 0 && (run.attempts as ExamAttempt[]).every((a: ExamAttempt) => {
                      const row = a as ExamAttempt & { id?: number | null; isPublished?: boolean };
                      return row.id != null && row.isPublished === true;
                    });
                    const isTimeEnded = !!run.endAt && new Date(run.endAt).getTime() <= Date.now();
                    const canPublish = true;
                    const allFullyChecked = (run.attempts as ExamAttempt[]).every((a: ExamAttempt) => {
                      const row = a as ExamAttempt & { isChecked?: boolean; status?: string; id?: number | null };
                      return row.id != null && (row.status === "SUBMITTED" || row.status === "EXPIRED") && row.isChecked === true;
                    });
                    const canExecutePublishAll = true;
                    return (
                    <div key={run.runId} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-50 p-4 flex items-center justify-between cursor-pointer hover:bg-slate-100" onClick={() => {
                        const expanded = (document.getElementById(`run-${run.runId}`) as HTMLDivElement)?.style.display !== 'none';
                        const el = document.getElementById(`run-${run.runId}`);
                        if (el) el.style.display = expanded ? 'none' : 'block';
                      }}>
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900">{run.examTitle}</h3>
                          <div className="text-sm text-slate-600 mt-1">
                            {run.groupName ? `Qrup: ${run.groupName}` : run.studentName ? `Şagird: ${run.studentName}` : ""}
                            {" · "}
                            Başlanğıc: {new Date(run.startAt).toLocaleString("az-AZ")}
                            {" · "}
                            Müddət: {run.durationMinutes} dəq
                            {" · "}
                            {run.attemptCount} nəfər başladı
                          </div>
                        </div>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        </div>
                      </div>
                      <div id={`run-${run.runId}`} className="hidden">
                        <div className="px-4 pt-3 pb-1 flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const ids = (run.attempts as ExamAttempt[])
                                .map((x) => x.id)
                                .filter((x): x is number => typeof x === "number");
                              if (ids.length === 0) {
                                toast.info("Ləğv ediləcək aktiv cəhd yoxdur.");
                                return;
                              }
                              setBulkCancelModal({
                                title: `${run.examTitle} — ${run.groupName || run.studentName || "Seans"}`,
                                attemptIds: ids,
                              });
                            }}
                            disabled={bulkCancelAttemptsMutation.isPending}
                            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
                            title="Bu seansdakı bütün şagird cəhdlərini ləğv et"
                          >
                            Hamısını ləğv et
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPublishConfirmRun({ runId: run.runId, title: run.groupName || run.studentName || run.examTitle || "Seans" });
                            }}
                            disabled={publishRunMutation.isPending}
                            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-white hover:bg-blue-600"
                            title="Hamısını yayımla"
                          >
                            Hamısını Yayımla
                          </button>
                        </div>
                        {(run as { group_aggregate?: { total_members: number; submitted_count: number; average_score?: number | null; sum_score: number } }).group_aggregate && (
                          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm text-slate-700">
                            <span className="font-medium">Qrup nəticəsi: </span>
                            Ortalama: {(run as { group_aggregate: { average_score?: number | null } }).group_aggregate.average_score != null
                              ? Number((run as { group_aggregate: { average_score: number } }).group_aggregate.average_score).toFixed(1)
                              : "—"}
                            {" / "}
                            {(run.attempts as ExamAttempt[])[0]?.maxScore ?? "—"}
                            {" — "}
                            {(run as { group_aggregate: { submitted_count: number; total_members: number } }).group_aggregate.submitted_count}
                            {" / "}
                            {(run as { group_aggregate: { total_members: number } }).group_aggregate.total_members}
                            {" iştirakçı cavablandırdı"}
                          </div>
                        )}
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Şagird</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Nəticə statusu</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Status</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Avto</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Manual</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Cəmi</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Əməliyyat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(run.attempts as ExamAttempt[]).map((a: ExamAttempt) => (
                              <tr
                                key={a.id || a.studentId}
                                className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                                onClick={() => {
                                  if (a.id) {
                                    setSelectedAttemptId(a.id);
                                    setShowGradingModal(true);
                                  }
                                }}
                              >
                                <td className="py-2 px-4 text-sm">
                                  <span className={(a as any).runStatus === "suspended" ? "text-rose-700 font-semibold" : "text-slate-900"}>
                                    {a.studentName}
                                  </span>
                                  {(a as any).runStatus === "suspended" && (
                                    <span className="ml-2 inline-flex items-center rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                                      Cheating/Exit Detected
                                    </span>
                                  )}
                                  {(a as any).runStatus === "suspended" && (a as any).suspendedAt && (
                                    <div className="text-[11px] text-rose-700 mt-0.5">
                                      {new Date((a as any).suspendedAt).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" })}-də dayandırıldı
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-4 text-sm">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                      (a as { resultReleaseStatus?: string }).resultReleaseStatus === "PUBLISHED"
                                        ? "bg-green-100 text-green-800"
                                        : (a as { resultReleaseStatus?: string }).resultReleaseStatus === "GRADED"
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-slate-100 text-slate-600"
                                    }`}
                                  >
                                    {(a as { resultReleaseStatus?: string }).resultReleaseStatus === "PUBLISHED"
                                      ? "Yayımlandı"
                                      : (a as { resultReleaseStatus?: string }).resultReleaseStatus === "GRADED"
                                        ? "Yoxlanılıb"
                                        : "Gözləyir"}
                                  </span>
                                </td>
                                <td className="py-2 px-4 text-sm">
                                  <span
                                    className={
                                      (a as any).runStatus === "suspended"
                                        ? "text-rose-700"
                                        : a.status === "SUBMITTED"
                                        ? "text-green-600"
                                        : a.status === "EXPIRED"
                                          ? "text-amber-600"
                                          : a.status === "NOT_STARTED"
                                            ? "text-slate-400"
                                            : "text-blue-600"
                                    }
                                  >
                                    {(a as any).runStatus === "suspended"
                                      ? "Dayandırıldı"
                                      : a.status === "SUBMITTED"
                                        ? "Təqdim"
                                        : a.status === "EXPIRED"
                                          ? "Vaxt bitdi"
                                          : a.status === "NOT_STARTED"
                                            ? "Başlamayıb"
                                            : "Davam edir"}
                                  </span>
                                </td>
                                <td className="py-2 px-4 text-sm">{a.autoScore != null ? Number(a.autoScore).toFixed(1) : "-"}</td>
                                <td className="py-2 px-4 text-sm">
                                  {a.isChecked || a.manualScore != null ? (
                                    <span className="text-green-700 font-medium">Yoxlanıldı</span>
                                  ) : a.manualPendingCount > 0 ? (
                                    <span className="text-orange-600 font-medium">{a.manualPendingCount} gözləyir</span>
                                  ) : null}
                                  {a.manualScore != null && <span className="ml-2">{Number(a.manualScore).toFixed(1)}</span>}
                                </td>
                                <td className="py-2 px-4 text-sm font-medium">
                                  {a.finalScore != null ? Number(a.finalScore).toFixed(1) : "-"} / {a.maxScore ?? "-"}
                                </td>
                                <td className="py-2 px-4 text-sm" onClick={(e) => e.stopPropagation()}>
                                  {a.id ? (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedAttemptId(a.id!);
                                          setShowGradingModal(true);
                                        }}
                                        className="text-blue-600 hover:underline flex items-center gap-1 text-sm"
                                      >
                                        <Eye className="w-4 h-4" />
                                        Bax
                                      </button>
                                      {(a.status === "EXPIRED" ||
                                        a.status === "IN_PROGRESS" ||
                                        (a.status === "SUBMITTED" && !a.isChecked)) &&
                                        a.id && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            restartAttemptMutation.mutate({ attemptId: a.id!, duration: 60 })
                                          }
                                          disabled={restartAttemptMutation.isPending || !canTeacherHardRestartAttempt(a)}
                                          className="text-amber-600 hover:underline flex items-center gap-1 text-xs disabled:opacity-40 disabled:pointer-events-none"
                                          title={
                                            !canTeacherHardRestartAttempt(a)
                                              ? "Ümumi imtahan vaxtı bitib"
                                              : "Şagird üçün yenidən başlat"
                                          }
                                        >
                                          <RotateCcw className="w-3 h-3" />
                                          Yenidən başlat
                                        </button>
                                      )}
                                      {a.id && !a.isChecked && (((a as any).runStatus === "suspended") || a.status === "SUBMITTED") && (
                                        <button
                                          type="button"
                                          onClick={() => continueAttemptMutation.mutate({ attemptId: a.id! })}
                                          disabled={continueAttemptMutation.isPending}
                                          className="text-emerald-700 hover:underline flex items-center gap-1 text-xs"
                                          title="Şagird üçün davam et"
                                        >
                                          Davam et
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 text-xs">Başlamayıb</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {!!((run as { summary?: { averageScore?: number | null }; group_aggregate?: { average_score?: number | null } }).summary ?? (run as { group_aggregate?: unknown }).group_aggregate) && (
                            <tfoot>
                              <tr className="border-t-2 border-slate-200 bg-slate-100 font-medium">
                                <td className="py-2 px-4 text-sm text-slate-700" colSpan={5}>
                                  Qrup ortalaması
                                </td>
                                <td className="py-2 px-4 text-sm text-slate-900">
                                  {(run as { group_aggregate?: { average_score?: number | null } }).group_aggregate?.average_score != null
                                    ? Number((run as { group_aggregate: { average_score: number } }).group_aggregate.average_score).toFixed(2)
                                    : (run as { summary?: { averageScore?: number | null } }).summary?.averageScore != null
                                      ? Number((run as { summary: { averageScore: number } }).summary.averageScore).toFixed(2)
                                      : "—"}
                                </td>
                                <td className="py-2 px-4" />
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  ); })}
                </div>
              ) : (
                // Individual student exam: show flat list
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Şagird</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Qrup</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Nəticə statusu</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Cəhd</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Təqdim</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Avto</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Manual</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Cəmi</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Əməliyyat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(attemptsData.attempts ?? []).map((a: ExamAttempt) => (
                      <tr
                        key={a.id}
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => {
                          setSelectedAttemptId(a.id);
                          setShowGradingModal(true);
                        }}
                      >
                        <td className="py-2 text-sm">
                          <span className={(a as any).runStatus === "suspended" ? "text-rose-700 font-semibold" : "text-slate-900"}>
                            {a.studentName}
                          </span>
                          {(a as any).runStatus === "suspended" && (
                            <span className="ml-2 inline-flex items-center rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                              Cheating/Exit Detected
                            </span>
                          )}
                          {(a as any).runStatus === "suspended" && (a as any).suspendedAt && (
                            <div className="text-[11px] text-rose-700 mt-0.5">
                              {new Date((a as any).suspendedAt).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" })}-də dayandırıldı
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-sm text-slate-600">{a.groupName || "-"}</td>
                        <td className="py-2 text-sm">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              a.resultReleaseStatus === "PUBLISHED"
                                ? "bg-green-100 text-green-800"
                                : a.resultReleaseStatus === "GRADED"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {a.resultReleaseStatus === "PUBLISHED" ? "Yayımlandı" : a.resultReleaseStatus === "GRADED" ? "Yoxlanılıb" : "Gözləyir"}
                          </span>
                        </td>
                        <td className="py-2 text-sm">
                          <span
                            className={
                              (a as any).runStatus === "suspended"
                                ? "text-rose-700"
                                : a.status === "SUBMITTED"
                                ? "text-green-600"
                                : a.status === "EXPIRED"
                                  ? "text-amber-600"
                                  : "text-blue-600"
                            }
                          >
                            {(a as any).runStatus === "suspended"
                              ? "Dayandırıldı"
                              : a.status === "SUBMITTED"
                                ? "Təqdim"
                                : a.status === "EXPIRED"
                                  ? "Vaxt bitdi"
                                  : "Davam edir"}
                          </span>
                        </td>
                        <td className="py-2 text-sm text-slate-600">
                          {(a.submittedAt ?? a.finishedAt) ? new Date(a.submittedAt ?? a.finishedAt!).toLocaleString("az-AZ") : "-"}
                        </td>
                        <td className="py-2 text-sm">{a.autoScore != null ? Number(a.autoScore).toFixed(1) : "-"}</td>
                        <td className="py-2 text-sm">
                          {a.isChecked || a.manualScore != null ? (
                            <span className="text-green-700 font-medium">Yoxlanıldı</span>
                          ) : a.manualPendingCount > 0 ? (
                            <span className="text-orange-600 font-medium">{a.manualPendingCount} gözləyir</span>
                          ) : null}
                          {a.manualScore != null && <span className="ml-2">{Number(a.manualScore).toFixed(1)}</span>}
                        </td>
                        <td className="py-2 text-sm font-medium">
                          {a.finalScore != null ? Number(a.finalScore).toFixed(1) : "-"} / {a.maxScore ?? "-"}
                        </td>
                        <td className="py-2 text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAttemptId(a.id);
                                setShowGradingModal(true);
                              }}
                              className="text-blue-600 hover:underline flex items-center gap-1 text-sm"
                            >
                              <Eye className="w-4 h-4" />
                              Bax
                            </button>
                            {(a.status === "EXPIRED" ||
                              a.status === "IN_PROGRESS" ||
                              (a.status === "SUBMITTED" && !a.isChecked)) && (
                              <button
                                type="button"
                                onClick={() =>
                                  restartAttemptMutation.mutate({ attemptId: a.id, duration: 60 })
                                }
                                disabled={restartAttemptMutation.isPending || !canTeacherHardRestartAttempt(a)}
                                className="text-amber-600 hover:underline flex items-center gap-1 text-xs disabled:opacity-40 disabled:pointer-events-none"
                                title={
                                  !canTeacherHardRestartAttempt(a)
                                    ? "Ümumi imtahan vaxtı bitib"
                                    : "Şagird üçün yenidən başlat"
                                }
                              >
                                <RotateCcw className="w-3 h-3" />
                                Yenidən başlat
                              </button>
                            )}
                            {a.id && !a.isChecked && (((a as any).runStatus === "suspended") || a.status === "SUBMITTED") && (
                              <button
                                type="button"
                                onClick={() => continueAttemptMutation.mutate({ attemptId: a.id })}
                                disabled={continueAttemptMutation.isPending}
                                className="text-emerald-700 hover:underline flex items-center gap-1 text-xs"
                                title="Şagird üçün davam et"
                              >
                                Davam et
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {attemptsData.attempts && attemptsData.attempts.length > 0 && (() => {
                    const finished = (attemptsData.attempts as ExamAttempt[]).filter((a: ExamAttempt) => a.status === "SUBMITTED" && a.finalScore != null);
                    const avg = finished.length ? finished.reduce((s: number, a: ExamAttempt) => s + Number(a.finalScore), 0) / finished.length : null;
                    return avg != null ? (
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-100 font-medium">
                          <td className="py-2 text-sm text-slate-700" colSpan={7}>Qrup Ortalaması</td>
                          <td className="py-2 text-sm text-slate-900">{Number(avg).toFixed(2)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    ) : null;
                  })()}
                </table>
              )
            ) : (
              <p className="text-slate-500 py-4">Göndəriş tapılmadı</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "old" && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Köhnə İmtahanlar</h2>
            <p className="text-sm text-slate-600 mb-4">Bitmiş imtahanların siyahısı. Qrup, şagird və test adına görə filtrləyə bilərsiniz.</p>
            <div className="flex flex-wrap gap-4 mb-4">
              <div className="min-w-[180px]">
                <label className="label">Qrup</label>
                <select
                  className="input w-full"
                  value={oldGroupId}
                  onChange={(e) => { setOldGroupId(e.target.value); setOldPage(1); }}
                >
                  <option value="">Hamısı</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-[180px]">
                <label className="label">Şagird</label>
                <select
                  className="input w-full"
                  value={oldStudentId}
                  onChange={(e) => { setOldStudentId(e.target.value); setOldPage(1); }}
                >
                  <option value="">Hamısı</option>
                  {students?.map((s) => (
                    <option key={s.id} value={(s as { userId?: number }).userId ?? s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[200px]">
                <label className="label">Test adı</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="Axtar..."
                  value={oldTestName}
                  onChange={(e) => { setOldTestName(e.target.value); setOldPage(1); }}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              {finishedRunsData?.items && finishedRunsData.items.length > 0 ? (
                <>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="w-8 py-2 px-2 text-sm font-semibold text-slate-700"></th>
                        <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Test adı</th>
                        <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Qrup / Şagird</th>
                        <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Başlanğıc</th>
                        <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Status</th>
                        <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Nəticə</th>
                        <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {finishedRunsData.items.map((r: FinishedRunItem) => {
                        const isExpanded = expandedOldRunId === r.runId;
                        const attempts = isExpanded && oldRunAttemptsData?.attempts ? oldRunAttemptsData.attempts : [];
                        return (
                          <React.Fragment key={r.runId}>
                            <tr
                              className={`border-b border-slate-100 hover:bg-slate-50 ${isExpanded ? "bg-slate-50" : ""}`}
                            >
                              <td className="py-2 px-2 text-slate-500">
                                {r.attempt_count > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedOldRunId(isExpanded ? null : r.runId)}
                                    className="p-1 rounded hover:bg-slate-200"
                                    aria-label={isExpanded ? "Bağla" : "Aç"}
                                  >
                                    <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                  </button>
                                ) : null}
                              </td>
                              <td className="py-2 px-4 text-sm font-medium text-slate-900">{r.examTitle}</td>
                              <td className="py-2 px-4 text-sm text-slate-600">
                                {r.group_id != null ? (
                                  <span>{r.groupName ?? "—"} ({r.attempt_count} nəfər)</span>
                                ) : (
                                  r.studentName ?? "—"
                                )}
                              </td>
                              <td className="py-2 px-4 text-sm text-slate-600">
                                {new Date(r.start_at).toLocaleString("az-AZ")}
                              </td>
                              <td className="py-2 px-4 text-sm">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                    r.statusLabel === "Yayımlanıb" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {r.statusLabel}
                                </span>
                              </td>
                              <td className="py-2 px-4 text-sm text-slate-600">
                                {r.published_count} / {r.attempt_count}
                              </td>
                              <td className="py-2 px-4 text-sm">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!confirm("Bu köhnə imtahan tarixçədən silinsin?")) return;
                                    deleteOldRunMutation.mutate({ runId: r.runId });
                                  }}
                                  disabled={deleteOldRunMutation.isPending}
                                  className="text-rose-700 hover:underline text-xs font-medium disabled:opacity-60"
                                >
                                  Sil
                                </button>
                              </td>
                            </tr>
                            {isExpanded && attempts.length > 0 && (
                              <tr key={`${r.runId}-exp`} className="border-b border-slate-100 bg-slate-50/80">
                                <td colSpan={7} className="py-2 px-4">
                                  <div className="pl-6 flex flex-wrap items-center justify-between gap-2 mb-2" />
                                  <div className="pl-6 space-y-1">
                                    {attempts.map((a: { id?: number | null; studentId?: number | null; studentName?: string; finalScore?: number; status?: string }) => (
                                      <div key={a.id ?? a.studentId ?? a.studentName} className="flex items-center justify-between py-1.5 text-sm text-slate-600">
                                        <span className={r.group_id != null ? "text-slate-500" : ""}>
                                          {a.studentName ?? "—"} — {(a.finalScore ?? 0).toFixed(1)} ball
                                        </span>
                                        {a.id != null && (
                                          <button
                                            type="button"
                                            onClick={() => { setSelectedAttemptId(a.id!); setShowGradingModal(true); }}
                                            className="text-primary-600 hover:underline text-sm font-medium"
                                          >
                                            Balı Dəyiş
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-slate-600">
                      Cəmi {finishedRunsData.meta?.total ?? 0} nəticə
                    </p>
                    <div className="flex gap-2">
                      {oldPage > 1 && (
                        <button
                          type="button"
                          onClick={() => setOldPage((p) => Math.max(1, p - 1))}
                          className="btn-outline text-sm"
                        >
                          Əvvəlki
                        </button>
                      )}
                      {finishedRunsData.meta?.has_next && (
                        <button
                          type="button"
                          onClick={() => setOldPage((p) => p + 1)}
                          className="btn-outline text-sm"
                        >
                          Növbəti
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-slate-500 py-8 text-center">Bitmiş imtahan tapılmadı</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "archive" && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {(["exams", "questions", "topics", "pdfs", "codingTopics", "codingTasks"] as ArchiveSubTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setArchiveSubTab(t)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-200 ease-in-out ${
                  archiveSubTab === t
                    ? "bg-primary text-white shadow-sm"
                    : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
                }`}
              >
                {t === "exams" ? "İmtahanlar" : t === "questions" ? "Suallar" : t === "topics" ? "Sual mövzuları" : t === "pdfs" ? "PDFs" : t === "codingTopics" ? "Kod mövzuları" : "Kod tapşırıqları"}
              </button>
            ))}
          </div>
          <div className="mb-4">
            <input
              type="text"
              className="input w-full max-w-md"
              placeholder="Axtar…"
              value={archiveSearch}
              onChange={(e) => setArchiveSearch(e.target.value)}
            />
          </div>
          <div className="card">
            {archiveSubTab === "exams" && archiveExamsData?.items && archiveExamsData.items.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={archiveExamsData.items.every((ex: ExamListItem) => selectedArchiveExams.has(ex.id)) && archiveExamsData.items.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedArchiveExams(new Set(archiveExamsData.items.map((ex: ExamListItem) => ex.id)));
                        } else {
                          setSelectedArchiveExams(new Set());
                        }
                      }}
                    />
                    Hamısını seç
                  </label>
                  {selectedArchiveExams.size > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`${selectedArchiveExams.size} seçilmiş imtahan silinsin?`)) {
                          bulkDeleteExamsMutation.mutate(Array.from(selectedArchiveExams));
                        }
                      }}
                      className="btn-outline text-sm text-red-600 border-red-200 hover:bg-red-50"
                    >
                      {selectedArchiveExams.size} seçilmiş silinsin
                    </button>
                  )}
                </div>
                <ul className="space-y-2">
                  {archiveExamsData.items.map((ex: ExamListItem & { attemptCount?: number }) => (
                    <li key={ex.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                      <input
                        type="checkbox"
                        checked={selectedArchiveExams.has(ex.id)}
                        onChange={(e) => {
                          const newSet = new Set(selectedArchiveExams);
                          if (e.target.checked) {
                            newSet.add(ex.id);
                          } else {
                            newSet.delete(ex.id);
                          }
                          setSelectedArchiveExams(newSet);
                        }}
                        className="cursor-pointer"
                      />
                      <span className="flex-1 font-medium text-slate-900">{ex.title} {ex.type === "quiz" ? "(Quiz)" : "(İmtahan)"} · {(ex as any).attemptCount ?? 0} cəhd</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => teacherApi.restoreExam(typeof ex.id === "number" ? ex.id : Number(ex.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-4 h-4" /> Bərpa et</button>
                        <button type="button" onClick={() => setShowHardDeleteModal({ type: "exam", id: ex.id, name: ex.title })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {archiveSubTab === "questions" && archiveQuestionsData?.items && archiveQuestionsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveQuestionsData.items.map((q: QuestionBankItem) => (
                  <li key={q.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="line-clamp-2 text-slate-900 text-sm">
                      <span className="font-medium">{formatBankQuestionPickerLine(q)}</span>
                      <span className="block text-xs text-slate-600 line-clamp-1">{q.text}</span>
                    </span>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => teacherApi.restoreQuestion(typeof q.id === "number" ? q.id : Number(q.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm">Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "question", id: q.id, name: (q.short_title || q.text)?.slice(0, 50) || `Sual ${q.id}` })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "topics" && archiveTopicsData?.items && archiveTopicsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveTopicsData.items.map((t: any) => (
                  <li key={t.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{t.name}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restoreQuestionTopic(typeof t.id === "number" ? t.id : Number(t.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm">Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "topic", id: t.id, name: t.name })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "pdfs" && archivePdfsData?.items && archivePdfsData.items.length > 0 && (
              <ul className="space-y-2">
                {archivePdfsData.items.map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{p.title}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restorePdf(typeof p.id === "number" ? p.id : Number(p.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm">Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "pdf", id: p.id, name: p.title })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "codingTopics" && archiveCodingTopicsData?.items && archiveCodingTopicsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveCodingTopicsData.items.map((t: { id: number; name: string }) => (
                  <li key={t.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{t.name}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restoreCodingTopic(t.id).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "codingTopic", id: t.id, name: t.name })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "codingTasks" && archiveCodingTasksData?.items && archiveCodingTasksData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveCodingTasksData.items.map((t) => {
                  const tid = typeof t.id === "string" ? parseInt(t.id, 10) : t.id;
                  return (
                    <li key={tid} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <span className="font-medium text-slate-900">{t.title}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => teacherApi.restoreCodingTask(tid).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Bərpa et</button>
                        <button type="button" onClick={() => setShowHardDeleteModal({ type: "codingTask", id: tid, name: t.title })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {((archiveSubTab === "exams" && (!archiveExamsData?.items || archiveExamsData.items.length === 0)) ||
              (archiveSubTab === "questions" && (!archiveQuestionsData?.items || archiveQuestionsData.items.length === 0)) ||
              (archiveSubTab === "topics" && (!archiveTopicsData?.items || archiveTopicsData.items.length === 0)) ||
              (archiveSubTab === "pdfs" && (!archivePdfsData?.items || archivePdfsData.items.length === 0)) ||
              (archiveSubTab === "codingTopics" && (!archiveCodingTopicsData?.items || archiveCodingTopicsData.items.length === 0)) ||
              (archiveSubTab === "codingTasks" && (!archiveCodingTasksData?.items || archiveCodingTasksData.items.length === 0))) && (
              <p className="text-slate-500 py-8 text-center">Arxivdə element tapılmadı</p>
            )}
          </div>
        </div>
      )}

      <Modal
        isOpen={showCreateTest}
        onClose={() => setShowCreateTest(false)}
        title="Yeni Test"
      >
        <form onSubmit={handleSubmitTest((v) => createTestMutation.mutate(v))} className="space-y-4">
          <div>
            <label className="label">Tip</label>
            <select className="input" {...registerTest("type")}>
              <option value="quiz">Quiz</option>
              <option value="exam">İmtahan</option>
            </select>
          </div>
          <div>
            <label className="label">Başlıq *</label>
            <input className="input" {...registerTest("title")} />
            {errorsTest.title && (
              <p className="mt-1 text-xs text-red-600">{errorsTest.title.message}</p>
            )}
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn-primary flex-1" disabled={createTestMutation.isPending}>
              Yadda Saxla
            </button>
            <button type="button" onClick={() => setShowCreateTest(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showCreateExam}
        onClose={() => {
          setShowCreateExam(false);
          setCreateExamSource("BANK");
          setCreateExamJson("");
          setCreateExamPdfId(null);
          setCreateExamJsonError(null);
        }}
        title="Yeni imtahan"
        size={createExamSource !== "BANK" ? "lg" : undefined}
      >
        <form
          onSubmit={handleSubmitExam((v) => {
            setCreateExamJsonError(null);
            const maxScoreResolved = createExamMaxScorePreset === "custom" ? createExamMaxScoreCustom : Number(createExamMaxScorePreset);
            if (maxScoreResolved < 1 || maxScoreResolved > 500) {
              alert("Maksimum bal 1–500 aralığında olmalıdır");
              return;
            }
            const payload: Parameters<typeof teacherApi.createExam>[0] = {
              title: v.title,
              type: v.type,
              status: v.status || "draft",
              max_score: maxScoreResolved,
            };
            if (createExamSource === "BANK") {
              payload.source_type = "BANK";
            } else if (createExamSource === "JSON") {
              let ak: Record<string, unknown>;
              try {
                ak = JSON.parse(createExamJson) as Record<string, unknown>;
              } catch {
                setCreateExamJsonError("JSON formatı səhvdir");
                return;
              }
              payload.source_type = "JSON";
              payload.answer_key_json = ak;
              payload.type = (ak.type as "quiz" | "exam") || v.type;
            } else {
              let ak: Record<string, unknown>;
              try {
                ak = JSON.parse(createExamJson) as Record<string, unknown>;
              } catch {
                setCreateExamJsonError(createExamSource === "PDF" ? "Cavab vərəqi JSON formatı səhvdir" : "Sual və cavablar JSON formatı səhvdir");
                return;
              }
              if (!createExamPdfId) {
                setCreateExamJsonError("PDF seçin");
                return;
              }
              payload.source_type = "PDF";
              payload.answer_key_json = ak;
              payload.pdf_id = createExamPdfId;
              payload.type = (ak.type as "quiz" | "exam") || v.type;
            }
            createExamMutation.mutate(payload);
          })}
          className="space-y-4"
        >
          <div>
            <label className="label">Mənbə</label>
            <select
              className="input"
              value={createExamSource}
              onChange={(e) => setCreateExamSource(e.target.value as "BANK" | "JSON" | "PDF")}
            >
              <option value="BANK">Sual bankı</option>
              <option value="JSON">JSON</option>
              <option value="PDF">PDF + Cavab vərəqi</option>
            </select>
          </div>
          <div>
            <label className="label">Başlıq *</label>
            <input className="input" {...registerExam("title")} />
            {errorsExam.title && (
              <p className="mt-1 text-xs text-red-600">{errorsExam.title.message}</p>
            )}
          </div>
          <div>
            <label className="label">Maksimum Bal *</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-28"
                value={createExamMaxScorePreset}
                onChange={(e) => setCreateExamMaxScorePreset(e.target.value as "100" | "150" | "custom")}
              >
                <option value="100">100</option>
                <option value="150">150</option>
                <option value="custom">Başqa</option>
              </select>
              {createExamMaxScorePreset === "custom" && (
                <input
                  type="number"
                  min={1}
                  max={500}
                  className="input w-24"
                  value={createExamMaxScoreCustom}
                  onChange={(e) => setCreateExamMaxScoreCustom(e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0)}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">İmtahanın balı dinamik hesablanır: X = Maksimum bal / (qapalı suallar + açıq suallar + 2 × situasiya sualları). Hər situasiya sualı adi sualdan 2 dəfə çox bal verir.</p>
          </div>
          {createExamSource === "BANK" && (
            <>
              <div>
                <label className="label">Tip</label>
                <select className="input" {...registerExam("type")}>
                  <option value="quiz">Quiz</option>
                  <option value="exam">İmtahan</option>
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" {...registerExam("status")}>
                  <option value="draft">Qaralama</option>
                  <option value="active">Aktiv</option>
                </select>
              </div>
            </>
          )}
          {createExamSource === "PDF" && (
            <div>
              <label className="label">PDF</label>
              <select
                className="input"
                value={createExamPdfId ?? ""}
                onChange={(e) => setCreateExamPdfId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">—</option>
                {(pdfsList as { id: number; title: string }[]).map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Əvvəlcə PDF kitabxanasına yükləyin (PDFs sekmesi)</p>
            </div>
          )}
          {(createExamSource === "JSON" || createExamSource === "PDF") && (
            <div>
              <label className="label">{createExamSource === "PDF" ? "Cavab vərəqi (JSON)" : "Sual və Cavablar (JSON)"}</label>
              <textarea
                className="input min-h-[120px] font-mono text-sm"
                placeholder='{"type":"exam","questions":[{"number":1,"kind":"mc","options":[{"key":"A","text":"Variant A mətni"},{"key":"B","text":"Variant B"},{"key":"C","text":"Variant C"},{"key":"D","text":"Variant D"},{"key":"E","text":"Variant E"}],"correct":"A"},{"number":2,"kind":"open","prompt":"Açıq sual mətni"},{"number":23,"kind":"situation","prompt":"Situasiya sualı"}]}'
                value={createExamJson}
                onChange={(e) => {
                  setCreateExamJson(e.target.value);
                  setCreateExamJsonError(null);
                }}
              />
              {createExamJsonError && (
                <p className="mt-1 text-xs text-red-600">{createExamJsonError}</p>
              )}
              {createExamJson.trim() && (() => {
                try {
                  const q = JSON.parse(createExamJson) as { type?: string; questions?: { qtype?: string; kind?: string }[] };
                  const qs = q?.questions ?? [];
                  const closed = qs.filter((x) => (x.qtype || x.kind || "").toString().toLowerCase() === "closed" || (x.qtype || x.kind) === "mc").length;
                  const open = qs.filter((x) => (x.qtype || x.kind || "").toString().toLowerCase() === "open").length;
                  const sit = qs.filter((x) => (x.qtype || x.kind || "").toString().toLowerCase() === "situation").length;
                  const isQuiz = (q.type || "quiz") === "quiz";
                  const total = closed + open + sit;
                  const ok = isQuiz ? total >= 1 : (closed === 22 && open === 5 && sit === 3);
                  return (
                    <p className={`mt-1 text-xs ${ok ? "text-green-600" : "text-amber-600"}`}>
                      Sual sayı: qapalı {closed}, açıq {open}, situasiya {sit}. {isQuiz ? "Quiz: ən azı 1 sual" : "İmtahan: tam 30 (22+5+3)"}. {ok ? "Düzgündür" : "Tərkib qaydalarına uyğun yoxlayın."}
                    </p>
                  );
                } catch {
                  return null;
                }
              })()}
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn-primary flex-1" disabled={createExamMutation.isPending}>
              Yadda saxla
            </button>
            <button type="button" onClick={() => setShowCreateExam(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showAddQuestions}
        onClose={() => {
          setShowAddQuestions(false);
          setAddQuestionIds([]);
          setExamTopicFilter("");
          setExamQuestionSearch("");
        }}
        title="Sual əlavə et"
        size="lg"
      >
        {selectedExamId != null && (
          <>
            <div className="mb-4 space-y-3">
              <div>
                <label className="label">Mövzu</label>
                <select
                  className="input w-full"
                  value={examTopicFilter}
                  onChange={(e) => setExamTopicFilter(e.target.value)}
                >
                  <option value="">Hamısı</option>
                  {topics.map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Axtarış (başlıq və ya mətn)</label>
                <input
                  type="text"
                  className="input w-full text-sm"
                  placeholder="Məs: Faiz"
                  value={examQuestionSearch}
                  onChange={(e) => setExamQuestionSearch(e.target.value)}
                />
              </div>
            </div>
            {(() => {
              const isQuiz = examDetail?.type === "quiz";
              const req = isQuiz ? null : { closed: 22, open: 5, situation: 3, total: 30 };
              const current = {
                closed: (examDetail?.questions ?? []).filter((q: any) => q.question_type === "MULTIPLE_CHOICE").length,
                open: (examDetail?.questions ?? []).filter((q: any) => (q.question_type || "").startsWith("OPEN")).length,
                situation: (examDetail?.questions ?? []).filter((q: any) => q.question_type === "SITUATION").length,
              };
              const selectedQs = questionsForExam.filter((q) => addQuestionIds.includes(q.id));
              const sel = {
                closed: selectedQs.filter((q) => q.type === "MULTIPLE_CHOICE").length,
                open: selectedQs.filter((q) => (q.type || "").startsWith("OPEN")).length,
                situation: selectedQs.filter((q) => q.type === "SITUATION").length,
              };
              const after = { closed: current.closed + sel.closed, open: current.open + sel.open, situation: current.situation + sel.situation };
              const afterTotal = after.closed + after.open + after.situation;
              const valid = isQuiz
                ? afterTotal >= 1
                : req && after.closed <= req.closed && after.open <= req.open && after.situation <= req.situation && afterTotal <= req.total;
              return (
                <>
                  <div className="text-xs text-slate-600 mb-2">
                    {isQuiz ? "Quiz: istənilən sayda sual (ən azı 1)" : "İmtahan: tam 30 sual (22 qapalı + 5 açıq + 3 situasiya)"}. Əlavədən sonra: Qapalı {after.closed}{req ? `/${req.closed}` : ""}, Açıq {after.open}{req ? `/${req.open}` : ""}{req ? `, Situasiya ${after.situation}/${req.situation}` : ""}
                    {!valid && addQuestionIds.length > 0 && <span className="block text-red-600 mt-1">Sual sayı qaydalara uyğun deyil</span>}
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
                    {questionsForExam
                      .filter((q) => !examQuestionIds.has(q.id))
                      .map((q) => (
                        <label key={q.id} className="flex items-center gap-2 py-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={addQuestionIds.includes(q.id)}
                            onChange={(e) =>
                              setAddQuestionIds((prev) =>
                                e.target.checked ? [...prev, q.id] : prev.filter((id) => id !== q.id)
                              )
                            }
                          />
                          <span className="text-sm text-slate-800 truncate flex-1">{formatBankQuestionPickerLine(q)}</span>
                          <span className="text-xs text-slate-500 shrink-0">{BANK_Q_TYPE_LABELS[q.type] || q.type}</span>
                        </label>
                      ))}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="btn-primary flex-1"
                      disabled={addQuestionIds.length === 0 || !valid || addExamQuestionMutation.isPending}
                onClick={async () => {
                  for (const questionId of addQuestionIds) {
                    await addExamQuestionMutation.mutateAsync({ examId: selectedExamId, questionId });
                  }
                  setShowAddQuestions(false);
                  setAddQuestionIds([]);
                  setExamTopicFilter("");
                  setExamQuestionSearch("");
                  if (selectedExamId) queryClient.invalidateQueries({ queryKey: ["teacher", "exam", selectedExamId] });
                }}
              >
                Seçilənləri əlavə et ({addQuestionIds.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddQuestions(false);
                  setAddQuestionIds([]);
                  setExamTopicFilter("");
                  setExamQuestionSearch("");
                }}
                className="btn-outline flex-1"
              >
                Bağla
              </button>
            </div>
                </>
              );
            })()}
          </>
        )}
      </Modal>

      <Modal
        isOpen={showActivateExamModal}
        onClose={() => {
          setShowActivateExamModal(false);
          setActivateExamId(null);
        }}
        title="Aktivləşdir"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Başlama tarixi və saatı *</label>
            <input
              type="datetime-local"
              className="input w-full"
              value={activateExamStartTime}
              onChange={(e) => setActivateExamStartTime(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
          <div>
            <label className="label">İmtahan müddəti (dəqiqə) *</label>
            <input
              type="number"
              min={1}
              className="input w-full"
              value={activateExamDurationInput}
              onChange={(e) => {
                const v = e.target.value;
                setActivateExamDurationInput(v);
                if (v.trim() === "") return;
                const n = Number(v);
                if (Number.isFinite(n) && n >= 1) setActivateExamDuration(Math.floor(n));
              }}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={!activateExamStartTime || activateExamDuration < 1 || activateExamMutation.isPending}
              onClick={() => {
                if (activateExamId == null) return;
                const parsed = Number(activateExamDurationInput);
                const safeDuration = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 60;
                setActivateExamDuration(safeDuration);
                setActivateExamDurationInput(String(safeDuration));
                activateExamMutation.mutate({
                  examId: activateExamId,
                  start_time: new Date(activateExamStartTime).toISOString(),
                  duration_minutes: safeDuration,
                });
              }}
            >
              {activateExamMutation.isPending ? "Göndərilir..." : "Aktivləşdir"}
            </button>
            <button
              type="button"
              className="btn-outline flex-1"
              onClick={() => { setShowActivateExamModal(false); setActivateExamId(null); }}
            >
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showExamSettings}
        onClose={() => {
          setShowExamSettings(false);
          setSelectedGroupIds([]);
          setSelectedStudentId(null);
          setExamStartTime("");
          setGroupStudentSearch("");
        }}
        title="Seç və Başlat"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Başlanğıc tarix və vaxt *</label>
            <input
              type="datetime-local"
              className="input w-full"
              value={examStartTime}
              onChange={(e) => setExamStartTime(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
          <div>
            <label className="label">Müddət (dəqiqə) *</label>
            <input
              type="number"
              min={1}
              className="input w-full"
              value={examDurationInput}
              onChange={(e) => {
                const v = e.target.value;
                setExamDurationInput(v);
                if (v.trim() === "") return;
                const n = Number(v);
                if (Number.isFinite(n) && n >= 1) setExamDuration(Math.floor(n));
              }}
            />
            {examStartTime && (Number(examDurationInput) >= 1 || examDuration >= 1) && (
              <p className="text-xs text-slate-500 mt-1">
                Bitmə: {new Date(new Date(examStartTime).getTime() + (Number.isFinite(Number(examDurationInput)) && Number(examDurationInput) >= 1 ? Math.floor(Number(examDurationInput)) : examDuration) * 60 * 1000).toLocaleString("az-AZ")}
              </p>
            )}
          </div>
          <div>
            <label className="label">Qrup və ya şagird *</label>
            <input
              type="text"
              className="input w-full mb-2"
              placeholder="Qrup və ya şagird adı ilə axtar..."
              value={groupStudentSearch}
              onChange={(e) => setGroupStudentSearch(e.target.value)}
            />
            <div className="flex gap-4 mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={assignMode === "groups"}
                  onChange={() => setAssignMode("groups")}
                />
                <span>Qruplar</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={assignMode === "student"}
                  onChange={() => setAssignMode("student")}
                />
                <span>Tək şagird</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={assignMode === "students"}
                  onChange={() => setAssignMode("students")}
                />
                <span>Çoxlu şagird</span>
              </label>
            </div>
            {assignMode === "groups" && (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {(groups ?? [])
                  .filter((g) => !groupStudentSearch.trim() || g.name.toLowerCase().includes(groupStudentSearch.toLowerCase()))
                  .map((g) => (
                    <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(Number(g.id))}
                        onChange={(e) =>
                          setSelectedGroupIds((prev) =>
                            e.target.checked
                              ? [...prev, Number(g.id)]
                              : prev.filter((id) => id !== Number(g.id))
                          )
                        }
                      />
                      <span>{g.name}</span>
                    </label>
                  ))}
              </div>
            )}
            {assignMode === "student" && (
              <select
                className="input w-full"
                value={selectedStudentId || ""}
                onChange={(e) => setSelectedStudentId(e.target.value ? parseInt(e.target.value, 10) : null)}
              >
                <option value="">—</option>
                {(students ?? [])
                  .filter((s) => !groupStudentSearch.trim() || (s.fullName || "").toLowerCase().includes(groupStudentSearch.toLowerCase()))
                  .map((s) => (
                    <option key={s.id} value={s.userId ?? s.id}>{s.fullName}</option>
                  ))}
              </select>
            )}
            {assignMode === "students" && (
              <div className="space-y-2 max-h-48 overflow-y-auto rounded border border-slate-200 p-2 bg-slate-50">
                {(students ?? [])
                  .filter((s) => !groupStudentSearch.trim() || (s.fullName || "").toLowerCase().includes(groupStudentSearch.toLowerCase()))
                  .map((s) => {
                    const sid = Number(s.userId ?? s.id);
                    const checked = selectedStudentIds.includes(sid);
                    return (
                      <label key={`multi-${sid}`} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedStudentIds((prev) =>
                              e.target.checked ? [...prev, sid] : prev.filter((x) => x !== sid)
                            )
                          }
                        />
                        <span>{s.fullName}</span>
                      </label>
                    );
                  })}
              </div>
            )}
          </div>
          {!examComposition.canActivate && examComposition.invalidReason && (
            <p className="text-xs text-orange-600">{examComposition.invalidReason}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={
                startExamMutation.isPending ||
                !examStartTime ||
                !examDuration ||
                (assignMode === "groups" && selectedGroupIds.length === 0) ||
                (assignMode === "student" && !selectedStudentId) ||
                (assignMode === "students" && selectedStudentIds.length === 0) ||
                !examComposition.canActivate
              }
              onClick={() => {
                if (selectedExamId) {
                  if (assignMode === "student" && selectedStudentId) {
                    startExamMutation.mutate(selectedExamId);
                  } else if (assignMode === "students" && selectedStudentIds.length > 0) {
                    startExamMutation.mutate(selectedExamId);
                  } else if (assignMode === "groups" && selectedGroupIds.length > 0) {
                    startExamMutation.mutate(selectedExamId);
                  }
                }
              }}
            >
              {assignMode === "students" ? "Seçilənlər üçün İmtahan Başlat" : "Başlat"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowExamSettings(false);
                setSelectedGroupIds([]);
                setSelectedStudentId(null);
                setSelectedStudentIds([]);
                setGroupStudentSearch("");
              }}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!showHardDeleteModal}
        onClose={() => { setShowHardDeleteModal(null); setHardDeleteStep(1); setHardDeleteConfirm(false); setHardDeleteTyped(""); }}
        title="Tam sil (geri qaytarmaq olmaz)"
        size="sm"
      >
        {showHardDeleteModal && (
          <div className="space-y-4">
            {hardDeleteStep === 1 ? (
              <>
                <p className="text-slate-600">Bu əməliyyat geri alına bilməz. Davam etmək üçün təsdiq edin.</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hardDeleteConfirm}
                    onChange={(e) => setHardDeleteConfirm(e.target.checked)}
                  />
                  <span>Başa düşürəm, geri qaytarmaq olmaz</span>
                </label>
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setShowHardDeleteModal(null)} className="btn-outline">Ləğv et</button>
                  <button
                    type="button"
                    onClick={() => hardDeleteConfirm && setHardDeleteStep(2)}
                    disabled={!hardDeleteConfirm}
                    className="btn-primary text-red-700 border-red-300 hover:bg-red-50"
                  >
                    Növbəti
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-slate-600">Təsdiq üçün <strong>DELETE</strong> və ya element adını yazın: &quot;{showHardDeleteModal.name}&quot;</p>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="DELETE və ya element adı"
                  value={hardDeleteTyped}
                  onChange={(e) => setHardDeleteTyped(e.target.value)}
                />
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setHardDeleteStep(1)} className="btn-outline">Geri</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (hardDeleteTyped === "DELETE" || hardDeleteTyped === showHardDeleteModal.name) {
                        hardDeleteMutation.mutate({ type: showHardDeleteModal.type, id: showHardDeleteModal.id });
                      }
                    }}
                    disabled={hardDeleteTyped !== "DELETE" && hardDeleteTyped !== showHardDeleteModal.name || hardDeleteMutation.isPending}
                    className="btn-primary text-red-700 border-red-300 hover:bg-red-50"
                  >
                    {hardDeleteMutation.isPending ? "Silinir…" : "Tam sil"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showCreateResult}
        onClose={() => setShowCreateResult(false)}
        title="Qiymət Əlavə Et"
        size="lg"
      >
        <form onSubmit={handleSubmitResult((v) => createResultMutation.mutate({ ...v, studentProfileId: Number(v.studentProfileId) }))} className="space-y-4">
          <div>
            <label className="label">Şagird *</label>
            <select
              className="input"
              {...registerResult("studentProfileId", { valueAsNumber: true })}
            >
              <option value={0}>Seçin</option>
              {students?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Qrup</label>
            <select className="input" {...registerResult("groupId", { valueAsNumber: true })}>
              <option value={0}>Seçin</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Test Adı *</label>
            <input className="input" {...registerResult("testName")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Xal *</label>
              <input
                type="number"
                className="input"
                {...registerResult("score", { valueAsNumber: true })}
              />
            </div>
            <div>
              <label className="label">Maks. Xal *</label>
              <input
                type="number"
                className="input"
                {...registerResult("maxScore", { valueAsNumber: true })}
              />
            </div>
          </div>
          <div>
            <label className="label">Tarix *</label>
            <input
              type="date"
              className="input"
              {...registerResult("date")}
              defaultValue={new Date().toISOString().split("T")[0]}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn-primary flex-1" disabled={createResultMutation.isPending}>
              Əlavə et
            </button>
            <button type="button" onClick={() => setShowCreateResult(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Grading Modal */}
      <Modal
        isOpen={showGradingModal}
        onClose={() => {
          setShowGradingModal(false);
          setSelectedAttemptId(null);
          setManualScores({});
          setSituationManualScores({});
        }}
        title="Qiymətləndirmə"
        size="lg"
      >
        {attemptDetailLoading ? (
          <p className="text-slate-500 py-4">Yüklənir...</p>
        ) : attemptDetail ? (
          <div className="space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{attemptDetail.examTitle}</p>
                  <p className="text-sm text-slate-600">{attemptDetail.studentName}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Avto: {attemptDetail.autoScore.toFixed(1)} / {attemptDetail.maxScore}
                  </p>
                  {typeof attemptDetail.unitValue === "number" && (
                    <>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Maksimum Bal: {attemptDetail.maxScore} · Sualın dəyəri (X): {attemptDetail.unitValue.toFixed(4)}
                        {attemptDetail.totalUnits != null && ` · Cəmi vahid: ${attemptDetail.totalUnits}`}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        İmtahanın balı dinamik hesablanır: X = Maksimum bal / (qapalı suallar + açıq suallar + 2 × situasiya sualları). Hər situasiya sualı adi sualdan 2 dəfə çox bal verir.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <span className="text-xs font-medium text-slate-600 mr-1">Suallara keçid:</span>
              {orderedGradingAnswers.map((ans, idx) => {
                const qs = getQuestionStatus(ans, attemptDetail);
                return (
                  <button
                    key={`jump-${ans.id}-${idx}`}
                    type="button"
                    onClick={() => document.getElementById(`review-q-${ans.id ?? idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className={`px-2 py-1 rounded border text-xs font-medium ${qs.dotClass}`}
                    title={qs.label}
                  >
                    {(ans as { presentationOrder?: number }).presentationOrder ?? ans.questionNumber ?? idx + 1}
                  </button>
                );
              })}
            </div>
            <div className="max-h-[28rem] overflow-y-auto space-y-3">
              {orderedGradingAnswers.map((ans, idx) => {
                const qs = getQuestionStatus(ans, attemptDetail);
                const isMcOrOpen = (ans.questionType === "MULTIPLE_CHOICE" || (ans.questionType as string)?.toLowerCase() === "mc" || (ans.questionType as string)?.toLowerCase() === "open");
                const isMcQ =
                  ans.questionType === "MULTIPLE_CHOICE" ||
                  String(ans.questionType || "")
                    .toLowerCase()
                    .includes("mc");
                const isSituation = (ans.questionType === "SITUATION" || (ans.questionType as string)?.toLowerCase() === "situation");
                const answerRuleType =
                  (ans as { answerRuleType?: string; answer_rule_type?: string; openRule?: string; open_rule?: string }).answerRuleType ??
                  (ans as { answer_rule_type?: string }).answer_rule_type ??
                  (ans as { openRule?: string }).openRule ??
                  (ans as { open_rule?: string }).open_rule ??
                  "";
                const openSubType = subTypeFromRule(answerRuleType);
                const isPdfSource = attemptDetail.sourceType === "PDF";
                const blueprint = (attemptDetail.attemptBlueprint ?? []) as BlueprintItemLike[];
                const bp = blueprint.find((b) => (b.questionNumber != null && b.questionNumber === ans.questionNumber) || (b.questionId != null && b.questionId === ans.questionId)) ?? null;
                const bpOptions = bp?.options ?? [];
                const selectedToken = selectedOptionToken(ans);
                const correctToken = bp?.correctOptionId ?? null;
                const studentMcOptionText = isMcQ && bpOptions.length > 0 ? resolveStudentMcOptionText(ans, bpOptions) : null;
                const correctMcOptionText = isMcQ && bpOptions.length > 0 && correctToken != null ? findMcOptionTextById(bpOptions, correctToken) : null;
                const isBlankChoice = isSituation
                  ? false
                  : isMcQ
                    ? !selectedToken && !answerProvidedOrScored(ans, attemptDetail)
                    : !answerProvidedOrScored(ans, attemptDetail);
                const isCorrectChoice =
                  !isBlankChoice && correctToken != null && optionIdMatchesSelection(correctToken, selectedToken);
                const answerStatusLabel = qs.label;
                const answerStatusClass = qs.badgeClass;
                const unitX = Number(attemptDetail?.unitValue ?? (attemptDetail?.totalUnits ? (attemptDetail?.maxScore ?? 150) / attemptDetail.totalUnits : (attemptDetail?.maxScore ?? 150) / 33));
                const situationIndex =
                  getOrderedSituationAnswers(attemptDetail.answers).findIndex((a) => a.id === ans.id) + 1;
                const canvasesForThisSituation = ((attemptDetail.canvases ?? []) as AttemptCanvasLike[])
                  .filter((c) => (isPdfSource ? c?.situationIndex === situationIndex : ((ans.questionId != null && c?.questionId === ans.questionId) || c?.situationIndex === situationIndex)))
                  .sort((a, b) => (a?.pageIndex ?? 0) - (b?.pageIndex ?? 0));
                const mainCanvasForSituation: AttemptCanvasLike | null = canvasesForThisSituation[0] ?? null;
                const questionImageUrl = (ans as { questionImageUrl?: string | null })?.questionImageUrl ?? null;
                const blueprintQuestionImage = bp?.imageUrl ?? null;
                const effectiveQuestionImage = questionImageUrl || blueprintQuestionImage;
                const isImageOptions =
                  (bp?.mcOptionDisplay || "").toUpperCase() === "IMAGE" ||
                  bpOptions.some((o) => Boolean(o.imageUrl));
                const mainCanvasJson = mainCanvasForSituation?.canvasJson ?? null;
                const mainCanvasSnapshot =
                  mainCanvasForSituation?.canvasSnapshot ?? mainCanvasForSituation?.imageUrl ?? null;
                const questionBlockClass =
                  qs.kind === "blank"
                    ? "border-orange-200 bg-orange-50/50"
                    : qs.kind === "correct"
                      ? "border-emerald-300 bg-emerald-50"
                      : qs.kind === "partial"
                        ? "border-amber-300 bg-amber-50/50"
                        : "border-rose-300 bg-rose-50";
                return (
                <div id={`review-q-${ans.id ?? idx}`} key={`ans-${ans.id ?? ans.questionId}-${idx}`} className={`border rounded-lg p-3 ${questionBlockClass}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-medium text-slate-500">
                      Sual {(ans as { presentationOrder?: number }).presentationOrder ?? ans.questionNumber ?? idx + 1}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${answerStatusClass}`}>
                      {answerStatusLabel}
                    </span>
                  </div>
                  {effectiveQuestionImage ? (
                    <img
                      src={effectiveQuestionImage}
                      alt="Sual şəkli"
                      className="max-w-full max-h-56 rounded border border-slate-200 mb-2 object-contain bg-white"
                    />
                  ) : null}
                  <div className="text-sm font-medium text-slate-900 mb-1">
                    <UniversalLatex content={ans.questionText} className="whitespace-pre-wrap" />
                  </div>
                  <p className="text-xs text-slate-500 mb-2">Tip: {ans.questionType}</p>
                  {attemptDetail.isCheatingDetected && (
                    <p className="mb-2 inline-flex items-center rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                      Auto-Submitted (Cheating Detected)
                    </p>
                  )}
                  {!isPdfSource && !isSituation && bpOptions.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-white p-2 mb-2">
                      <p className="text-xs font-medium text-slate-600 mb-1">Şagirdin gördüyü variant sırası (imtahan zamanı saxlanıb)</p>
                      {isImageOptions && (
                        <p className="text-[11px] text-slate-500 mb-2">
                          <span className="inline-flex items-center gap-1 font-medium text-blue-700">● Mavi halqa</span> — şagirdin seçdiyi;
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700 ml-2">● Yaşıl çərçivə</span> — düzgün cavab.
                        </p>
                      )}
                      <div className={isImageOptions ? "grid grid-cols-1 sm:grid-cols-2 gap-2" : "space-y-1.5"}>
                        {bpOptions.map((opt) => {
                          const isSelected = optionIdMatchesSelection(opt.id, selectedToken);
                          const isCorrect = correctToken != null && optionIdMatchesSelection(opt.id, String(correctToken));
                          const rowClass = isSelected && isCorrect
                            ? "border-emerald-500 bg-emerald-50"
                            : isSelected && !isCorrect
                              ? "border-rose-500 bg-rose-50"
                              : isCorrect
                                ? "border-emerald-400 bg-emerald-50/70"
                                : "border-slate-200 bg-slate-50";
                          const studentRing = isSelected ? "ring-4 ring-blue-500 ring-offset-1 border-blue-600" : "";
                          return (
                            <div key={String(opt.id)} className={`rounded-md border-2 px-2 py-1.5 text-sm ${rowClass} ${studentRing}`}>
                              {opt.imageUrl ? (
                                <img
                                  src={opt.imageUrl}
                                  alt="Variant şəkli"
                                  className="max-h-44 w-full object-contain rounded border border-slate-100 mb-1 bg-white"
                                />
                              ) : isImageOptions ? (
                                <div className="min-h-[48px] flex items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50 text-[11px] text-slate-400 mb-1">
                                  Şəkil yoxdur
                                </div>
                              ) : null}
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-800 min-w-0">
                                  {opt.text?.trim() ? (
                                    <UniversalLatex content={opt.text} />
                                  ) : !opt.imageUrl ? (
                                    <span>—</span>
                                  ) : null}
                                </span>
                                <span className="inline-flex flex-col items-end gap-0.5 text-[10px] shrink-0 font-medium">
                                  {isSelected && isCorrect && (
                                    <span className="text-emerald-700 flex items-center gap-0.5">
                                      <Check className="w-3 h-3" />
                                      Seçdiyi · Düz
                                    </span>
                                  )}
                                  {isSelected && !isCorrect && (
                                    <span className="text-rose-700 flex items-center gap-0.5">
                                      <X className="w-3 h-3" />
                                      Şagirdin seçimi
                                    </span>
                                  )}
                                  {!isSelected && isCorrect && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">Düzgün cavab</span>
                                  )}
                                </span>
                              </div>
                              {opt.label ? (
                                <div className="mt-1 text-xs text-slate-600">
                                  <UniversalLatex content={opt.label} />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {isBlankChoice && (
                        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          Cavab verilməyib
                        </p>
                      )}
                    </div>
                  )}
                  {/* Comparison: Correct vs Student answer */}
                  <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                    <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
                      <span className="font-medium text-emerald-800">Düzgün cavab:</span>
                      <div className="mt-0.5 text-slate-700">
                        {isMcQ && bpOptions.length > 0 && correctToken != null
                          ? (() => {
                              const t = correctMcOptionText;
                              return t ? (
                                <span className="font-semibold text-emerald-900">
                                  <UniversalLatex content={t} />
                                </span>
                              ) : (ans as { correctOptionKey?: string; correctTextAnswer?: string }).correctOptionKey != null ? (
                                <span className="font-semibold text-emerald-900">
                                  {formatMcVariantLabelForTeacher(
                                    (ans as { correctOptionKey?: string }).correctOptionKey,
                                    bpOptions
                                  )}
                                </span>
                              ) : (ans as { correctTextAnswer?: string }).correctTextAnswer != null ? (
                                <UniversalLatex content={(ans as { correctTextAnswer?: string }).correctTextAnswer} />
                              ) : (
                                "—"
                              );
                            })()
                          : (ans as { correctOptionKey?: string; correctTextAnswer?: string }).correctOptionKey != null
                            ? isMcQ && bpOptions.length > 0 ? (
                                <span className="font-semibold text-emerald-900">
                                  {formatMcVariantLabelForTeacher((ans as { correctOptionKey?: string }).correctOptionKey, bpOptions)}
                                </span>
                              ) : (
                                <UniversalLatex content={(ans as { correctOptionKey?: string }).correctOptionKey!} />
                              )
                            : (ans as { correctTextAnswer?: string }).correctTextAnswer != null
                              ? <UniversalLatex content={(ans as { correctTextAnswer?: string }).correctTextAnswer} />
                              : "—"}
                      </div>
                      {(() => {
                        if (isSituation) return null;
                        if (isMcQ && (ans as { correctOptionKey?: string }).correctOptionKey != null) return null;
                        const rawCorrect =
                          (ans as { correctTextAnswer?: string }).correctTextAnswer ??
                          (ans as { correctOptionKey?: string }).correctOptionKey ??
                          "";
                        if (!rawCorrect) return null;
                        const normalizedCorrect = normalizeAnswer(rawCorrect, openSubType);
                        return (
                          <p className="mt-1 text-[11px] text-emerald-700 break-all">
                            Normallaşdırılmış: {normalizedCorrect || "—"}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-2">
                      <span className="font-medium text-slate-700">Şagirdin cavabı:</span>
                      {(() => {
                        const studentText = (ans.textAnswer ?? (ans as { text_answer?: string }).text_answer) ?? "";
                        const studentVariant = (ans as { selectedOptionKey?: string; selected_option_key?: string }).selectedOptionKey ??
                          (ans as { selected_option_key?: string }).selected_option_key ??
                          (ans.selectedOptionId != null ? String(ans.selectedOptionId) : null) ??
                          ((ans as { selected_option_id?: number }).selected_option_id != null ? String((ans as { selected_option_id?: number }).selected_option_id) : null);
                        const displayRaw = studentText.trim()
                          ? (openSubType === "MATCHING" ? normalizeMatchingAnswer(studentText) : studentText)
                          : (studentMcOptionText ?? (studentVariant ?? ""));

                        const display =
                          studentText.trim()
                            ? (openSubType === "MATCHING" ? normalizeMatchingAnswer(studentText) : studentText)
                            : studentMcOptionText != null
                              ? studentMcOptionText
                              : studentVariant && isMcQ && bpOptions.length > 0
                                ? formatMcVariantLabelForTeacher(studentVariant, bpOptions)
                                : (studentVariant ?? "—");

                        const isLongText =
                          display.length > 200 || (display.includes("\n") && display.length > 80);
                        const shouldRenderAsLatex =
                          Boolean(studentText.trim()) ||
                          (!isMcQ && Boolean(studentVariant)) ||
                          (isMcQ && studentMcOptionText != null) ||
                          (isMcQ && Boolean(studentVariant) && bpOptions.length === 0);
                        return (
                          <>
                            <div className={`mt-0.5 text-slate-700 ${isLongText ? "max-h-[280px] overflow-y-auto rounded border border-slate-200 bg-white p-2 text-sm" : ""}`}>
                              {shouldRenderAsLatex ? (
                                <UniversalLatex content={displayRaw || "—"} className="whitespace-pre-wrap" />
                              ) : (
                                <span className="font-semibold">{display}</span>
                              )}
                            </div>
                            {!isSituation && (
                              <p className="mt-1 text-[11px] text-slate-600 break-all">
                                Normallaşdırılmış: {openSubType === "MATCHING" ? normalizeMatchingAnswer(studentText) || "—" : normalizeAnswer(studentText, openSubType) || "—"}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {ans.selectedOptionId != null && !(ans as { correctOptionKey?: string }).correctOptionKey && (
                    <p className="text-xs text-slate-600 mb-1">
                      Seçilmiş variant:{" "}
                      {bpOptions.length > 0 && isMcQ
                        ? studentMcOptionText ?? findMcOptionTextById(bpOptions, ans.selectedOptionId) ?? formatMcVariantLabelForTeacher(String(ans.selectedOptionId), bpOptions)
                        : String(ans.selectedOptionId)}
                    </p>
                  )}
                  {isSituation && (() => {
                    const xUnit = Number(attemptDetail?.unitValue ?? (attemptDetail?.totalUnits ? (attemptDetail?.maxScore ?? 150) / attemptDetail.totalUnits : (attemptDetail?.maxScore ?? 150) / 33));
                    const situationScoresConfig = [
                      { label: "0", value: 0 },
                      { label: "2/3", value: 2 / 3 },
                      { label: "1", value: 1 },
                      { label: "4/3", value: 4 / 3 },
                      { label: "2", value: 2 },
                    ];
                    const currentPoints = situationManualScores[String(ans.id)] ?? manualScores[String(ans.id)] ?? (ans.manualScore ?? undefined);
                    const currentVal = typeof currentPoints === "number" ? currentPoints / xUnit : undefined;
                    return (
                      <div className="mt-2">
                        <SituationSmartCard
                          mode="grading"
                          studentAnswerId={ans?.id ?? (ans as any)?.student_answer_id}
                          examRunId={attemptDetail?.runId ?? null}
                          questionNumber={
                            (ans as { presentationOrder?: number }).presentationOrder ?? ans.questionNumber ?? idx + 1
                          }
                          questionText={ans.questionText || "—"}
                          questionImageUrl={effectiveQuestionImage}
                          canvasJson={mainCanvasJson}
                          canvasSnapshot={mainCanvasSnapshot}
                          currentScore={typeof currentPoints === "number" ? currentPoints : undefined}
                          maxScoreLabel={`(max ${(xUnit * 2).toFixed(1)} bal)`}
                          chips={situationScoresConfig}
                          selectedChipValue={currentVal}
                          onSelectChip={(chipValue) => {
                            const sid = String(ans.id);
                            const pts = Number((chipValue * xUnit).toFixed(2));
                            setSituationManualScores((prev) => ({ ...prev, [sid]: pts }));
                            setManualScores((prev) => ({ ...prev, [sid]: pts }));
                            if (ans.id != null && situationIndex > 0) {
                              void handleSaveSituation({
                                answerId: ans.id,
                                examRunId: attemptDetail?.runId ?? null,
                                situationIndex,
                                score: pts,
                                sourceType: attemptDetail.sourceType,
                              });
                            }
                          }}
                          onScoreChange={(value) => {
                            const sid = String(ans.id);
                            setManualScores((prev) => ({ ...prev, [sid]: value }));
                            setSituationManualScores((prev) => ({ ...prev, [sid]: value }));
                          }}
                          onSave={() => {
                            const sid = String(ans.id);
                            const score = situationManualScores[sid] ?? manualScores[sid] ?? (ans.manualScore ?? undefined);
                            if (ans.id == null || situationIndex <= 0 || typeof score !== "number" || Number.isNaN(score)) {
                              toast.info("Əvvəlcə bal daxil edin");
                              return;
                            }
                            void handleSaveSituation({
                              answerId: ans.id,
                              examRunId: attemptDetail?.runId ?? null,
                              situationIndex,
                              score,
                              sourceType: attemptDetail.sourceType,
                            });
                          }}
                          saveStatus={situationSaveState[String(ans.id)] ?? "idle"}
                          onOpenPreview={() => {
                            const preview = mainCanvasSnapshot ?? "";
                            setCanvasPreviewUrl(preview);
                            setCanvasZoom(1);
                          }}
                        />
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                    <span className="text-xs text-slate-600">Avto: {ans.autoScore.toFixed(1)}</span>
                    {isMcOrOpen && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-700">Manual (0 / 1X):</label>
                        <select
                          className="input text-sm w-24"
                          value={
                            manualScores[String(ans.id)] !== undefined
                              ? manualScores[String(ans.id)] === 0
                                ? "0"
                                : Math.abs((manualScores[String(ans.id)] ?? 0) - unitX) < 0.01
                                  ? "1"
                                  : "custom"
                              : "auto"
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            const key = String(ans.id);
                            if (v === "auto") {
                              setManualScores((prev) => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                            } else if (v === "0") {
                              setManualScores((prev) => ({ ...prev, [key]: 0 }));
                            } else if (v === "1") {
                              setManualScores((prev) => ({ ...prev, [key]: unitX }));
                            }
                          }}
                        >
                          <option value="auto">Avto</option>
                          <option value="0">0</option>
                          <option value="1">1 (1X)</option>
                        </select>
                      </div>
                    )}
                    {!isSituation && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-700">Manual xal:</label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        className="input text-sm w-20"
                        value={manualScores[String(ans.id)] ?? (ans.manualScore ?? "")}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const key = String(ans.id);
                          if (raw === "") {
                            setManualScores((prev) => ({ ...prev, [key]: undefined }));
                            return;
                          }
                          const num = parseFloat(raw);
                          const safe = Number.isNaN(num) ? undefined : num;
                          setManualScores((prev) => ({ ...prev, [key]: safe }));
                        }}
                      />
                      <span className="text-xs text-slate-500">(max {((attemptDetail?.unitValue ?? (attemptDetail?.totalUnits ? (attemptDetail?.maxScore ?? 150) / attemptDetail.totalUnits : (attemptDetail?.maxScore ?? 150) / 33)) * 2).toFixed(1)} bal)</span>
                    </div>
                    )}
                  </div>
                </div>
              ); })}
            </div>
            {(() => {
              const unitX = Number(attemptDetail?.unitValue ?? (attemptDetail?.totalUnits ? (attemptDetail?.maxScore ?? 150) / attemptDetail.totalUnits : (attemptDetail?.maxScore ?? 150) / 33));
              let gradingTotal = 0;
              for (const ans of attemptDetail?.answers ?? []) {
                const isSit = (ans.questionType as string) === "SITUATION" || (ans.questionType as string)?.toLowerCase() === "situation";
                if (isSit) {
                  const sid = String(ans.id);
                  const explicitSituation = situationManualScores[sid];
                  const typed = manualScores[sid];
                  if (typeof explicitSituation === "number" && !Number.isNaN(explicitSituation)) {
                    gradingTotal += explicitSituation;
                  } else if (typeof typed === "number" && !Number.isNaN(typed)) {
                    gradingTotal += typed;
                  } else {
                    gradingTotal += Number((ans as { manualScore?: number }).manualScore ?? 0);
                  }
                } else {
                  const sid = String(ans.id);
                  const m = manualScores[sid];
                  const serverM = (ans as { manualScore?: number | null }).manualScore;
                  gradingTotal +=
                    typeof m === "number"
                      ? m
                      : typeof serverM === "number" && !Number.isNaN(serverM)
                        ? serverM
                        : (ans.autoScore ?? 0);
                }
              }
              return (
                <p className="text-sm font-medium text-slate-700 py-2 border-t border-slate-200">
                  Yekun bal (cari): <span className="font-semibold text-slate-900">{Math.max(0, gradingTotal).toFixed(2)}</span> / {attemptDetail.maxScore}
                </p>
              );
            })()}
            {(() => {
              const manualAnswers = (attemptDetail?.answers ?? []).filter((a) => (a as { requiresManualCheck?: boolean }).requiresManualCheck === true);
              const allManualFilled = manualAnswers.length === 0 || manualAnswers.every((ans) => {
                const isSit = (ans.questionType as string) === "SITUATION" || (ans.questionType as string)?.toLowerCase() === "situation";
                if (isSit) {
                  const sid = String(ans.id);
                  const hasSituationInput =
                    typeof situationManualScores[sid] === "number" &&
                    !Number.isNaN(situationManualScores[sid] as number);
                  const typed = typeof manualScores[sid] === "number" && !Number.isNaN(manualScores[sid] as number);
                  const hadServer = (ans as { manualScore?: number | null }).manualScore != null;
                  return hasSituationInput || typed || hadServer;
                }
                return manualScores[String(ans.id)] != null || (ans as { manualScore?: number | null }).manualScore != null;
              });
              const bitirDisabled = gradeAttemptMutation.isPending || !allManualFilled;
              return (
                <>
                  {!allManualFilled && manualAnswers.length > 0 && (
                    <p className="text-sm text-amber-700 py-1">Bütün manual suallara bal daxil edin, sonra &quot;Bitir&quot; aktiv olacaq.</p>
                  )}
                  <div className="flex gap-3 pt-4 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedAttemptId) {
                          gradeAttemptMutation.mutate({ attemptId: selectedAttemptId, publish: false });
                        }
                      }}
                      disabled={bitirDisabled}
                      className="btn-primary flex-1"
                    >
                      Bitir
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowGradingModal(false);
                        setSelectedAttemptId(null);
                        setManualScores({});
                        setSituationManualScores({});
                        setCanvasPreviewUrl(null);
                        setCanvasZoom(1);
                      }}
                      className="btn-outline"
                    >
                      Bağla
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <p className="text-slate-500 py-4">Məlumat yüklənmədi</p>
        )}
      </Modal>

      <Modal
        isOpen={!!publishConfirmRun}
        onClose={() => setPublishConfirmRun(null)}
        title="Nəticələri yayımla"
        size="sm"
      >
        {publishConfirmRun && (
          <div className="space-y-4">
            <p className="text-slate-600">
              Bu seansın bütün nəticələri yayımlansın? Bu əməliyyatdan sonra şagirdlər balını görə biləcəklər.
            </p>
            <p className="text-sm text-slate-500">
              Seans: <strong>{publishConfirmRun.title}</strong>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setPublishConfirmRun(null)}
                className="btn-outline"
              >
                Ləğv et
              </button>
              <button
                type="button"
                onClick={() => publishRunMutation.mutate({ runId: publishConfirmRun.runId })}
                disabled={publishRunMutation.isPending}
                className="btn-primary"
              >
                {publishRunMutation.isPending ? "Yayımlanır..." : "Yayımla"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!bulkCancelModal}
        onClose={() => setBulkCancelModal(null)}
        title="Bütün cəhdləri ləğv et"
        size="sm"
      >
        {bulkCancelModal && (
          <div className="space-y-4">
            <p className="text-slate-600">
              Bu əməliyyat <strong>{bulkCancelModal.attemptIds.length}</strong> şagird cəhdini siləcək və geri qaytarılmayacaq.
              Şagirdlər bu imtahan sessiyası üzrə nəticə görə bilməyəcəklər.
            </p>
            <p className="text-sm text-slate-500">
              {bulkCancelModal.title}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setBulkCancelModal(null)}
                className="btn-outline"
                disabled={bulkCancelAttemptsMutation.isPending}
              >
                Bağla
              </button>
              <button
                type="button"
                onClick={() => bulkCancelAttemptsMutation.mutate(bulkCancelModal.attemptIds)}
                disabled={bulkCancelAttemptsMutation.isPending}
                className="btn-primary bg-rose-600 hover:bg-rose-700 border-rose-600"
              >
                {bulkCancelAttemptsMutation.isPending ? "Ləğv edilir..." : "Bəli, hamısını ləğv et"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!canvasPreviewUrl}
        onClose={() => { setCanvasPreviewUrl(null); setCanvasZoom(1); }}
        title="Situasiya qaralama"
        size="lg"
      >
        {canvasPreviewUrl && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.min(2.5, z + 0.25))}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-sm font-medium"
              >
                Yaxınlaşdır
              </button>
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.max(0.5, z - 0.25))}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-sm font-medium"
              >
                Uzaqlaşdır
              </button>
              <span className="text-sm text-slate-500">{Math.round(canvasZoom * 100)}%</span>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded border border-slate-200 bg-slate-100">
              <img
                src={canvasPreviewUrl}
                alt="Qaralama"
                className="block rounded"
                style={{ width: `${canvasZoom * 100}%`, maxWidth: 'none', height: 'auto' }}
              />
            </div>
          </div>
        )}
      </Modal>

      <ExamPreview
        isOpen={showExamPreview}
        onClose={() => setShowExamPreview(false)}
        title="İmtahan Vərəqinə Bax"
        pdfUrl={(examDetail as { pdf_url?: string })?.pdf_url ?? null}
        sourceType={(examDetail as { source_type?: string })?.source_type}
        questions={examDetail?.questions ?? []}
      />
    </div>
  );
}
