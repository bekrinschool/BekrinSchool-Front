"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, QuestionBankItem, TeacherPDF } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useDebounce } from "@/lib/useDebounce";
import Link from "next/link";
import { Plus, Trash2, ChevronRight, Edit2, Search, Upload, FileText, Eye, Archive } from "lucide-react";
import { API_BASE_URL } from "@/lib/constants";
import { UniversalLatex } from "@/components/common/MathContent";
import { normalizeAnswer, subTypeFromRule, type OpenAnswerSubType } from "@/lib/answer-normalizer";

const DELETE_CONFIRM_MESSAGE = "Bu sualı/mövzunu tamamilə silmək istədiyinizə əminsiniz? Geri qaytarmaq olmayacaq.";
const DELETE_BULK_CONFIRM_MESSAGE = "Seçilmiş sualları/mövzuları tamamilə silmək istədiyinizə əminsiniz? Geri qaytarmaq olmayacaq.";
const OPTIONS_DUPLICATE_ERROR = "Eyni cavab variantını iki dəfə daxil edə bilməzsiniz.";
const MC_IMAGE_INCOMPLETE_ERROR = "Şəkil rejimində hər variant üçün şəkil faylı tələb olunur.";

type McFormOption = {
  text: string;
  is_correct: boolean;
  label?: string;
  id?: number;
  imageFile?: File | null;
  imageUrl?: string | null;
};

/** Returns indices of options that have duplicate text (case-insensitive; empty strings ignored). */
function getDuplicateOptionIndices(options: { text: string }[]): number[] {
  const seen = new Map<string, number[]>();
  options.forEach((opt, i) => {
    const t = (opt.text || "").trim();
    if (t === "") return;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(i);
  });
  const duplicateIndices: number[] = [];
  seen.forEach((indices) => {
    if (indices.length > 1) duplicateIndices.push(...indices);
  });
  return duplicateIndices;
}

const PAGE_SIZE = 10;
const PRIMARY_QUESTION_TYPES = [
  { value: "CLOSED", label: "Qapalı" },
  { value: "OPEN", label: "Açıq" },
  { value: "SITUATION", label: "Situasiya" },
] as const;
const QUESTION_TYPE_FILTERS = [
  { value: "MULTIPLE_CHOICE", label: "Qapalı" },
  { value: "OPEN_SINGLE_VALUE", label: "Açıq (Standart)" },
  { value: "OPEN_ORDERED", label: "Açıq (Ardıcıllıq)" },
  { value: "OPEN_UNORDERED", label: "Açıq (Uyğunluq)" },
  { value: "OPEN_PERMUTATION", label: "Açıq (Seçimli/Sırasız)" },
  { value: "SITUATION", label: "Situasiya" },
] as const;

function formatQuestionBankLine(q: QuestionBankItem): string {
  const label = QUESTION_TYPE_FILTERS.find((t) => t.value === q.type)?.label ?? q.type;
  const title = (q.short_title || "").trim() || `Sual ${q.id}`;
  return `Q-${q.id}: ${title} (${label})`;
}
const OPEN_SUBTYPES: { value: OpenAnswerSubType; label: string }[] = [
  { value: "STANDARD", label: "Standart" },
  { value: "MATCHING", label: "Uyğunluq" },
  { value: "SEQUENTIAL", label: "Ardıcıllıq" },
  { value: "PERMUTATION", label: "Seçimli (Sırasız)" },
];
const OPEN_QUESTION_HINTS: Record<OpenAnswerSubType, string> = {
  STANDARD: "Məs: 15 və ya 15.0 (dəqiq uyğun)",
  MATCHING: "Cavab: 1-a, 2-b, 3-c",
  SEQUENTIAL: "Məs: 1,3,5 və ya 135",
  PERMUTATION: "Məs: 135, 531 və ya 1,5,3 (sıra fərqi önəmsiz)",
};

export default function QuestionBankPage() {
  const [topicPage, setTopicPage] = useState(1);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [showCreateQuestion, setShowCreateQuestion] = useState(false);
  const [showEditQuestion, setShowEditQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionBankItem | null>(null);
  const [showRenameTopic, setShowRenameTopic] = useState(false);
  const [renamingTopicId, setRenamingTopicId] = useState<number | null>(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [topicSearch, setTopicSearch] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [questionTypeFilter, setQuestionTypeFilter] = useState("");
  const [showUploadPDF, setShowUploadPDF] = useState(false);
  const [pdfSearch, setPdfSearch] = useState("");
  const [pdfYearFilter, setPdfYearFilter] = useState("");
  
  const debouncedTopicSearch = useDebounce(topicSearch, 300);
  const debouncedQuestionSearch = useDebounce(questionSearch, 300);
  const debouncedPdfSearch = useDebounce(pdfSearch, 300);
  const [newPDF, setNewPDF] = useState({ title: "", year: "", tags: "", source: "" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [topicIdForNewQuestion, setTopicIdForNewQuestion] = useState<number | null>(null);
  const [topicIdForEditQuestion, setTopicIdForEditQuestion] = useState<number | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<number[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    kind: "question" | "topic" | "questions_bulk" | "topics_bulk";
    ids: number[];
  } | null>(null);
  const createTopicForQuestionRef = useRef(false);
  const [newQ, setNewQ] = useState({
    short_title: "",
    text: "",
    type: "MULTIPLE_CHOICE" as string,
    primaryType: "CLOSED" as "CLOSED" | "OPEN" | "SITUATION",
    openSubType: "STANDARD" as OpenAnswerSubType,
    answer_rule_type: "" as string,
    correct_answer: "",
    mcOptionMode: "text" as "text" | "image",
    options: [] as McFormOption[],
    questionImage: null as File | null,
  });
  const [questionImageObjectUrl, setQuestionImageObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!newQ.questionImage) {
      setQuestionImageObjectUrl(null);
      return;
    }
    const u = URL.createObjectURL(newQ.questionImage);
    setQuestionImageObjectUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [newQ.questionImage]);
  const queryClient = useQueryClient();

  const { data: topics = [], isLoading: topicsLoading } = useQuery({
    queryKey: ["teacher", "question-topics"],
    queryFn: () => teacherApi.getQuestionTopics(),
    staleTime: 60 * 1000, // Cache topics for 1 minute
  });
  const { data: allQuestionsForCounts = [] } = useQuery({
    queryKey: ["teacher", "questions", "all"],
    queryFn: () => teacherApi.getQuestions(),
    staleTime: 30 * 1000, // Cache for 30 seconds
  });
  const { data: pdfs = [], isLoading: pdfsLoading } = useQuery({
    queryKey: ["teacher", "pdfs", debouncedPdfSearch, pdfYearFilter],
    queryFn: () => teacherApi.getPDFs({
      ...(debouncedPdfSearch ? { q: debouncedPdfSearch } : {}),
      ...(pdfYearFilter ? { year: pdfYearFilter } : {}),
    }),
    staleTime: 30 * 1000, // Cache for 30 seconds
  });

  const { data: allQuestions = [], isLoading: questionsLoading } = useQuery({
    queryKey: ["teacher", "questions", selectedTopicId, questionTypeFilter, debouncedQuestionSearch],
    queryFn: () =>
      teacherApi.getQuestions({
        ...(selectedTopicId != null ? { topic: String(selectedTopicId) } : {}),
        ...(questionTypeFilter ? { type: questionTypeFilter } : {}),
        ...(debouncedQuestionSearch.trim() ? { q: debouncedQuestionSearch.trim() } : {}),
      }),
    enabled: selectedTopicId != null,
  });

  const filteredTopics = useMemo(() => {
    if (!debouncedTopicSearch.trim()) return topics;
    return topics.filter((t) => t.name.toLowerCase().includes(debouncedTopicSearch.toLowerCase()));
  }, [topics, debouncedTopicSearch]);

  const topicQuestionCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    allQuestionsForCounts.forEach((q) => {
      counts[q.topic] = (counts[q.topic] || 0) + 1;
    });
    return counts;
  }, [allQuestionsForCounts]);

  const mcDuplicateIndices = useMemo(
    () =>
      newQ.type === "MULTIPLE_CHOICE" && newQ.mcOptionMode === "text" ? getDuplicateOptionIndices(newQ.options) : [],
    [newQ.type, newQ.mcOptionMode, newQ.options]
  );
  const hasDuplicateOptions = mcDuplicateIndices.length > 0;

  const mcImageIncomplete = useMemo(() => {
    if (newQ.type !== "MULTIPLE_CHOICE" || newQ.mcOptionMode !== "image") return false;
    return newQ.options.some((o) => !o.imageFile && !o.imageUrl);
  }, [newQ.type, newQ.mcOptionMode, newQ.options]);

  const createTopicMutation = useMutation({
    mutationFn: (name: string) => teacherApi.createQuestionTopic({ name }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "question-topics"] });
      setShowCreateTopic(false);
      setNewTopicName("");
      if (createTopicForQuestionRef.current) {
        createTopicForQuestionRef.current = false;
        setTopicIdForNewQuestion(data.id);
      }
    },
  });
  const deleteTopicMutation = useMutation({
    mutationFn: (id: number) => teacherApi.deleteQuestionTopic(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "question-topics"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setSelectedTopicIds((prev) => prev.filter((x) => x !== id));
      setSelectedTopicId((curr) => (curr === id ? null : curr));
      setDeleteConfirm(null);
    },
  });
  const bulkDeleteTopicsMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => teacherApi.deleteQuestionTopic(id))),
    onSuccess: (_data, ids) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "question-topics"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setSelectedTopicIds([]);
      setSelectedTopicId((curr) => (curr != null && ids.includes(curr) ? null : curr));
      setDeleteConfirm(null);
    },
  });
  const bulkDeleteQuestionsMutation = useMutation({
    mutationFn: (ids: number[]) => teacherApi.bulkDeleteQuestions(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setSelectedQuestionIds([]);
      setDeleteConfirm(null);
    },
  });
  const deleteQuestionMutation = useMutation({
    mutationFn: (id: number) => teacherApi.deleteQuestion(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setSelectedQuestionIds((prev) => prev.filter((x) => x !== id));
      setDeleteConfirm(null);
    },
  });
  const createQuestionMutation = useMutation({
    mutationFn: () => {
      const topicId = topicIdForNewQuestion ?? selectedTopicId;
      if (topicId == null) throw new Error("Mövzu seçilməyib");
      if (newQ.type === "MULTIPLE_CHOICE" && newQ.mcOptionMode === "image") {
        const incomplete = newQ.options.some((o) => !o.imageFile);
        if (incomplete) throw new Error(MC_IMAGE_INCOMPLETE_ERROR);
      }
      const payload: Parameters<typeof teacherApi.createQuestion>[0] = {
        topic: topicId,
        short_title: newQ.short_title.trim(),
        text: newQ.text,
        type: newQ.type as "MULTIPLE_CHOICE" | "OPEN_SINGLE_VALUE" | "OPEN_ORDERED" | "OPEN_UNORDERED" | "OPEN_PERMUTATION" | "SITUATION",
        is_active: true,
        question_image: newQ.questionImage || undefined,
      };
      if (newQ.type === "MULTIPLE_CHOICE" && newQ.options.length) {
        payload.mc_option_display = newQ.mcOptionMode === "image" ? "IMAGE" : "TEXT";
        payload.options = newQ.options.map((o, i) => ({
          text: newQ.mcOptionMode === "image" ? "" : o.text,
          label: (o.label ?? "").trim(),
          is_correct: o.is_correct,
          order: i,
        }));
        if (newQ.mcOptionMode === "image") {
          payload.option_image_files = newQ.options.map((o) => o.imageFile ?? null);
        }
      } else if (["OPEN_SINGLE_VALUE", "OPEN_ORDERED", "OPEN_UNORDERED", "OPEN_PERMUTATION"].includes(newQ.type) && newQ.correct_answer) {
        const normalizedCorrect = normalizeAnswer(newQ.correct_answer, newQ.openSubType);
        payload.correct_answer = normalizedCorrect;
        const rule =
          newQ.answer_rule_type ||
          (newQ.openSubType === "MATCHING"
            ? "MATCHING"
            : newQ.openSubType === "SEQUENTIAL"
              ? "STRICT_ORDER"
              : newQ.openSubType === "PERMUTATION"
                ? "ANY_ORDER"
                : "EXACT_MATCH");
        if (rule) payload.answer_rule_type = rule;
      }
      return teacherApi.createQuestion(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setShowCreateQuestion(false);
      setTopicIdForNewQuestion(null);
      setNewQ({ short_title: "", text: "", type: "MULTIPLE_CHOICE", primaryType: "CLOSED", openSubType: "STANDARD", answer_rule_type: "", correct_answer: "", mcOptionMode: "text", options: [], questionImage: null });
    },
  });

  const updateQuestionMutation = useMutation({
    mutationFn: (id: number) => {
      const topicId = topicIdForEditQuestion ?? editingQuestion?.topic ?? selectedTopicId;
      if (newQ.type === "MULTIPLE_CHOICE" && newQ.mcOptionMode === "image") {
        const incomplete = newQ.options.some((o) => !o.imageFile && !o.imageUrl);
        if (incomplete) throw new Error(MC_IMAGE_INCOMPLETE_ERROR);
      }
      const payload: Record<string, unknown> = {
        short_title: newQ.short_title.trim(),
        text: newQ.text,
        type: newQ.type,
        ...(topicId != null ? { topic: topicId } : {}),
        ...(newQ.questionImage ? { question_image: newQ.questionImage } : {}),
      };
      if (newQ.type === "MULTIPLE_CHOICE" && newQ.options.length) {
        payload.mc_option_display = newQ.mcOptionMode === "image" ? "IMAGE" : "TEXT";
        payload.options = newQ.options.map((o, i) => ({
          ...(o.id != null ? { id: o.id } : {}),
          text: newQ.mcOptionMode === "image" ? "" : o.text,
          label: (o.label ?? "").trim(),
          is_correct: o.is_correct,
          order: i,
        }));
        if (newQ.mcOptionMode === "image") {
          payload.option_image_files = newQ.options.map((o) => o.imageFile ?? null);
        }
      } else if (["OPEN_SINGLE_VALUE", "OPEN_ORDERED", "OPEN_UNORDERED", "OPEN_PERMUTATION"].includes(newQ.type) && newQ.correct_answer) {
        const normalizedCorrect = normalizeAnswer(newQ.correct_answer, newQ.openSubType);
        payload.correct_answer = normalizedCorrect;
        const rule =
          newQ.answer_rule_type ||
          (newQ.openSubType === "MATCHING"
            ? "MATCHING"
            : newQ.openSubType === "SEQUENTIAL"
              ? "STRICT_ORDER"
              : newQ.openSubType === "PERMUTATION"
                ? "ANY_ORDER"
                : "EXACT_MATCH");
        if (rule) payload.answer_rule_type = rule;
      }
      return teacherApi.updateQuestion(id, payload as Partial<QuestionBankItem> & { question_image?: File | null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "questions"] });
      setShowEditQuestion(false);
      setEditingQuestion(null);
      setNewQ({ short_title: "", text: "", type: "MULTIPLE_CHOICE", primaryType: "CLOSED", openSubType: "STANDARD", answer_rule_type: "", correct_answer: "", mcOptionMode: "text", options: [], questionImage: null });
    },
  });

  const uploadPDFMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error("Fayl seçilməyib");
      const tags = newPDF.tags ? newPDF.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      return teacherApi.uploadPDF(uploadFile, {
        title: newPDF.title || uploadFile.name,
        year: newPDF.year ? parseInt(newPDF.year) : undefined,
        tags,
        source: newPDF.source || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "pdfs"] });
      setShowUploadPDF(false);
      setUploadFile(null);
      setNewPDF({ title: "", year: "", tags: "", source: "" });
    },
  });
  const deletePDFMutation = useMutation({
    mutationFn: (id: number) => teacherApi.deletePDF(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "pdfs"] });
    },
  });

  const handleEditQuestion = (q: QuestionBankItem) => {
    setEditingQuestion(q);
    setTopicIdForEditQuestion(q.topic ?? null);
    const options: McFormOption[] =
      q.options?.map((opt) => ({
        id: opt.id,
        text: opt.text ?? "",
        label: typeof opt.label === "string" ? opt.label : "",
        is_correct: opt.is_correct || false,
        imageUrl: opt.image_url ?? null,
        imageFile: null,
      })) || [];
    // If MULTIPLE_CHOICE and correct_answer is option_id, mark the correct option
    if (q.type === "MULTIPLE_CHOICE" && q.correct_answer) {
      let correctId: number | null = null;
      if (typeof q.correct_answer === "object" && q.correct_answer !== null && "option_id" in q.correct_answer) {
        correctId = (q.correct_answer as any).option_id;
      } else if (typeof q.correct_answer === "number") {
        correctId = q.correct_answer;
      }
      if (correctId !== null) {
        options.forEach((opt, idx) => {
          const origOpt = q.options?.[idx];
          if (origOpt && origOpt.id === correctId) {
            opt.is_correct = true;
          } else {
            opt.is_correct = false;
          }
        });
      }
    }
    setNewQ({
      short_title: q.short_title ?? "",
      text: q.text,
      type: q.type,
      primaryType: q.type === "SITUATION" ? "SITUATION" : q.type === "MULTIPLE_CHOICE" ? "CLOSED" : "OPEN",
      openSubType: subTypeFromRule(q.answer_rule_type),
      answer_rule_type: q.answer_rule_type || "",
      correct_answer: typeof q.correct_answer === "string" ? q.correct_answer : (q.correct_answer ? String(q.correct_answer) : ""),
      mcOptionMode: q.type === "MULTIPLE_CHOICE" && q.mc_option_display === "IMAGE" ? "image" : "text",
      options,
      questionImage: null,
    });
    setShowEditQuestion(true);
  };


  const addOption = () =>
    setNewQ((q) => ({
      ...q,
      options: [...q.options, { text: "", is_correct: false, label: "", imageFile: null, imageUrl: null }],
    }));
  const setOption = (i: number, text: string, is_correct: boolean) =>
    setNewQ((q) => ({
      ...q,
      options: q.options.map((o, j) =>
        j === i ? { ...o, text, is_correct } : { ...o, is_correct: j === i ? is_correct : false }
      ),
    }));
  const setOptionImageFile = (i: number, file: File | null) =>
    setNewQ((q) => ({
      ...q,
      options: q.options.map((o, j) => (j === i ? { ...o, imageFile: file, imageUrl: file ? null : o.imageUrl } : o)),
    }));
  const setOptionLabel = (i: number, label: string) =>
    setNewQ((q) => ({
      ...q,
      options: q.options.map((o, j) => (j === i ? { ...o, label } : o)),
    }));
  const removeOption = (i: number) => setNewQ((q) => ({ ...q, options: q.options.filter((_, j) => j !== i) }));

  if (topicsLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Sual bankı</h1>
        <div className="flex gap-2">
          <Link href="/teacher/tests?tab=archive" className="btn-outline flex items-center gap-2">
            <Archive className="w-4 h-4" />
            Arxiv
          </Link>
          <button onClick={() => setShowCreateTopic(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Yeni mövzu
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card md:col-span-1">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Mövzular</h2>
            {selectedTopicIds.length > 0 && (
              <button
                type="button"
                onClick={() => setDeleteConfirm({ kind: "topics_bulk", ids: selectedTopicIds })}
                className="btn-outline text-red-600 border-red-200 hover:bg-red-50 text-sm mb-2"
              >
                <Trash2 className="w-4 h-4 inline mr-1" />
                Seçilənləri Sil ({selectedTopicIds.length})
              </button>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                className="input !pl-12 w-full text-sm"
                placeholder="Mövzu axtar..."
                value={topicSearch}
                onChange={(e) => setTopicSearch(e.target.value)}
              />
            </div>
          </div>
          <ul className="space-y-2">
            {filteredTopics.slice((topicPage - 1) * PAGE_SIZE, topicPage * PAGE_SIZE).map((t) => (
              <li
                key={t.id}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                  selectedTopicId === t.id ? "bg-blue-50 border border-blue-200" : "hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedTopicIds.includes(t.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSelectedTopicIds((prev) =>
                      e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                    );
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded border-slate-300"
                />
                <button
                  type="button"
                  onClick={() => setSelectedTopicId(t.id)}
                  className="flex-1 text-left font-medium text-slate-900 flex items-center gap-2 min-w-0"
                >
                  <ChevronRight className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">({topicQuestionCounts[t.id] || 0})</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm({ kind: "topic", ids: [t.id] });
                  }}
                  className="p-1 text-red-600 hover:bg-red-50 rounded shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          {Math.ceil(filteredTopics.length / PAGE_SIZE) > 1 && (
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                disabled={topicPage <= 1}
                onClick={() => setTopicPage((p) => p - 1)}
                className="btn-outline text-sm"
              >
                Əvvəlki
              </button>
              <span className="self-center text-sm text-slate-500">
                {topicPage} / {Math.ceil(filteredTopics.length / PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={topicPage >= Math.ceil(filteredTopics.length / PAGE_SIZE)}
                onClick={() => setTopicPage((p) => p + 1)}
                className="btn-outline text-sm"
              >
                Növbəti
              </button>
            </div>
          )}
        </div>

        <div className="card md:col-span-2">
          {selectedTopicId == null && (
            <p className="text-slate-500 py-8 text-center">Mövzu seçin</p>
          )}
          {selectedTopicId != null && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-lg font-semibold text-slate-900">
                  Suallar ({allQuestions.length})
                </h2>
                <div className="flex gap-2">
                  {selectedQuestionIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm({ kind: "questions_bulk", ids: selectedQuestionIds })}
                      className="btn-outline text-red-600 border-red-200 hover:bg-red-50 text-sm"
                    >
                      <Trash2 className="w-4 h-4 inline mr-1" />
                      Seçilənləri Sil ({selectedQuestionIds.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setTopicIdForNewQuestion(selectedTopicId);
                      setNewQ({ short_title: "", text: "", type: "MULTIPLE_CHOICE", primaryType: "CLOSED", openSubType: "STANDARD", answer_rule_type: "", correct_answer: "", mcOptionMode: "text", options: [], questionImage: null });
                      setShowCreateQuestion(true);
                    }}
                    className="btn-primary text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Yeni sual
                  </button>
                </div>
              </div>
              <div className="mb-4 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    className="input !pl-12 w-full text-sm"
                    placeholder="Sual axtar..."
                    value={questionSearch}
                    onChange={(e) => setQuestionSearch(e.target.value)}
                  />
                </div>
                <select
                  className="input text-sm"
                  value={questionTypeFilter}
                  onChange={(e) => setQuestionTypeFilter(e.target.value)}
                >
                  <option value="">Bütün tiplər</option>
                  {QUESTION_TYPE_FILTERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {questionsLoading && (
                <p className="text-slate-500">Yüklənir...</p>
              )}
              {!questionsLoading && allQuestions.length === 0 && (
                <p className="text-slate-500 py-8 text-center">Bu mövzuda sual tapılmadı</p>
              )}
              {!questionsLoading && allQuestions.length > 0 && (
                <ul className="space-y-3">
                  {allQuestions.map((q) => (
                    <li
                      key={q.id}
                      className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 cursor-pointer flex items-start gap-2"
                      onClick={() => handleEditQuestion(q)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedQuestionIds.includes(q.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedQuestionIds((prev) =>
                            e.target.checked ? [...prev, q.id] : prev.filter((id) => id !== q.id)
                          );
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-slate-300 mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{formatQuestionBankLine(q)}</p>
                        <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">{q.text}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-slate-500">{q.type}</span>
                          {q.created_at && (
                            <span className="text-xs text-slate-400">
                              {new Date(q.created_at).toLocaleDateString("az-AZ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleEditQuestion(q)}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm({ kind: "question", ids: [q.id] })}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Silməyi təsdiqlə"
      >
        <div className="space-y-4">
          <p className="text-slate-700">
            {deleteConfirm?.kind === "questions_bulk" || deleteConfirm?.kind === "topics_bulk"
              ? DELETE_BULK_CONFIRM_MESSAGE
              : DELETE_CONFIRM_MESSAGE}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                if (!deleteConfirm) return;
                if (deleteConfirm.kind === "question") {
                  deleteQuestionMutation.mutate(deleteConfirm.ids[0]);
                } else if (deleteConfirm.kind === "topic") {
                  deleteTopicMutation.mutate(deleteConfirm.ids[0]);
                } else if (deleteConfirm.kind === "questions_bulk") {
                  bulkDeleteQuestionsMutation.mutate(deleteConfirm.ids);
                } else {
                  bulkDeleteTopicsMutation.mutate(deleteConfirm.ids);
                }
              }}
              disabled={
                deleteQuestionMutation.isPending ||
                deleteTopicMutation.isPending ||
                bulkDeleteQuestionsMutation.isPending ||
                bulkDeleteTopicsMutation.isPending
              }
              className="btn-primary bg-red-600 hover:bg-red-700 flex-1"
            >
              Bəli, sil
            </button>
            <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showCreateTopic} onClose={() => setShowCreateTopic(false)} title="Yeni mövzu">
        <div className="space-y-4">
          <div>
            <label className="label">Ad *</label>
            <input
              className="input w-full"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              placeholder="Mövzu adı"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => createTopicMutation.mutate(newTopicName)}
              disabled={!newTopicName.trim() || createTopicMutation.isPending}
              className="btn-primary flex-1"
            >
              Yadda saxla
            </button>
            <button type="button" onClick={() => setShowCreateTopic(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showEditQuestion} onClose={() => { setShowEditQuestion(false); setEditingQuestion(null); }} title="Sualı redaktə et" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Sualın Başlığı / Qısa Adı *</label>
            <input
              className="input w-full"
              value={newQ.short_title}
              onChange={(e) => setNewQ((q) => ({ ...q, short_title: e.target.value }))}
              placeholder="Məs: Faiz - Asan"
            />
            <p className="text-xs text-slate-500 mt-1">
              Bu ad tələbəyə görünməyəcək, yalnız sizin test bankında rahat tapmağınız üçündür.
            </p>
          </div>
          <div>
            <label className="label">Mövzu</label>
            <select
              className="input w-full"
              value={topicIdForEditQuestion ?? editingQuestion?.topic ?? ""}
              onChange={(e) => setTopicIdForEditQuestion(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Mövzu seçin</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Sual mətni *</label>
            <textarea
              className="input w-full h-24"
              value={newQ.text}
              onChange={(e) => setNewQ((q) => ({ ...q, text: e.target.value }))}
              placeholder="Sualı yazın..."
            />
            {newQ.text.trim() && (
              <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800">
                <UniversalLatex content={newQ.text} />
              </div>
            )}
          </div>
          <div>
            <label className="label">Şəkil (isteğe bağlı)</label>
            {editingQuestion?.question_image_url && !newQ.questionImage && (
              <div className="mb-2 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-2">
                <img
                  src={editingQuestion.question_image_url}
                  alt=""
                  className="max-h-36 max-w-full rounded border border-slate-200 object-contain"
                />
                <a
                  href={editingQuestion.question_image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  <Eye className="w-4 h-4" />
                  Bax
                </a>
              </div>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="input w-full text-sm"
              onChange={(e) => setNewQ((q) => ({ ...q, questionImage: e.target.files?.[0] ?? null }))}
            />
            {newQ.questionImage && <p className="text-xs text-slate-500 mt-1">{newQ.questionImage.name}</p>}
            {questionImageObjectUrl && (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-2">
                <img src={questionImageObjectUrl} alt="" className="max-h-36 max-w-full rounded border border-slate-200 object-contain" />
                <a
                  href={questionImageObjectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  <Eye className="w-4 h-4" />
                  Bax (yeni fayl)
                </a>
              </div>
            )}
          </div>
          <div>
            <label className="label">Sualın tipi</label>
            <select
              className="input w-full"
              value={newQ.primaryType}
              onChange={(e) =>
                setNewQ((q) => {
                  const primaryType = e.target.value as "CLOSED" | "OPEN" | "SITUATION";
                  return {
                    ...q,
                    primaryType,
                    type: primaryType === "CLOSED" ? "MULTIPLE_CHOICE" : primaryType === "SITUATION" ? "SITUATION" : (q.openSubType === "MATCHING" ? "OPEN_UNORDERED" : q.openSubType === "SEQUENTIAL" ? "OPEN_ORDERED" : q.openSubType === "PERMUTATION" ? "OPEN_PERMUTATION" : "OPEN_SINGLE_VALUE"),
                    answer_rule_type:
                      primaryType === "OPEN"
                        ? (q.openSubType === "MATCHING" ? "MATCHING" : q.openSubType === "SEQUENTIAL" ? "STRICT_ORDER" : q.openSubType === "PERMUTATION" ? "ANY_ORDER" : "EXACT_MATCH")
                        : "",
                  };
                })
              }
            >
              {PRIMARY_QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {newQ.type === "MULTIPLE_CHOICE" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="label mb-0">Variantlar (düzgün olanı işarələyin)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-600">Variant növü:</span>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                    <button
                      type="button"
                      className={`px-3 py-1 rounded-md text-sm font-medium transition ${newQ.mcOptionMode === "text" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
                      onClick={() =>
                        setNewQ((q) => ({
                          ...q,
                          mcOptionMode: "text",
                          options: q.options.map((o) => ({ ...o, imageFile: null, imageUrl: null })),
                        }))
                      }
                    >
                      Mətn
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1 rounded-md text-sm font-medium transition ${newQ.mcOptionMode === "image" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
                      onClick={() =>
                        setNewQ((q) => ({
                          ...q,
                          mcOptionMode: "image",
                          options: q.options.map((o) => ({ ...o, text: "", imageFile: null, imageUrl: null, label: "" })),
                        }))
                      }
                    >
                      Şəkil
                    </button>
                  </div>
                  <button type="button" onClick={addOption} className="text-sm text-blue-600">
                    + Variant
                  </button>
                </div>
              </div>
              {hasDuplicateOptions && (
                <p className="text-sm text-red-600 mb-2">{OPTIONS_DUPLICATE_ERROR}</p>
              )}
              {newQ.mcOptionMode === "text" &&
                newQ.options.map((opt, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="radio"
                      name="correct-edit"
                      checked={opt.is_correct}
                      onChange={() => setOption(i, opt.text, true)}
                    />
                    <input
                      className={`input flex-1 ${mcDuplicateIndices.includes(i) ? "border-red-500 ring-1 ring-red-500" : ""}`}
                      value={opt.text}
                      onChange={(e) => setOption(i, e.target.value, opt.is_correct)}
                      placeholder={`Variant ${i + 1}`}
                    />
                    {opt.text.trim() && (
                      <div className="text-xs text-slate-700 self-center max-w-[40%] truncate">
                        <UniversalLatex content={opt.text} />
                      </div>
                    )}
                    <button type="button" onClick={() => removeOption(i)} className="text-red-600">
                      Sil
                    </button>
                  </div>
                ))}
              {newQ.mcOptionMode === "image" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Şəkil rejimində hər variant üçün şəkil mütləqdir (isteğe bağlı LaTeX qeydi).</p>
                  {newQ.options.map((opt, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/80">
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="correct-edit-img"
                          checked={opt.is_correct}
                          onChange={() => setOption(i, opt.text, true)}
                        />
                        <span className="text-sm font-medium text-slate-700">Variant {i + 1}</span>
                        <button type="button" onClick={() => removeOption(i)} className="text-red-600 text-sm ml-auto">
                          Sil
                        </button>
                      </div>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="input w-full text-sm"
                        onChange={(e) => setOptionImageFile(i, e.target.files?.[0] ?? null)}
                      />
                      {opt.imageFile && <p className="text-xs text-slate-600">{opt.imageFile.name}</p>}
                      {!opt.imageFile && opt.imageUrl && (
                        <p className="text-xs text-slate-500">
                          Cari şəkil:{" "}
                          <a href={opt.imageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600">
                            bax
                          </a>
                        </p>
                      )}
                      <div>
                        <label className="text-xs text-slate-600">Qeyd (LaTeX, isteğe bağlı)</label>
                        <input
                          className="input w-full text-sm mt-0.5"
                          value={opt.label ?? ""}
                          onChange={(e) => setOptionLabel(i, e.target.value)}
                          placeholder="Məs: $x^2$"
                        />
                        {(opt.label ?? "").trim() ? (
                          <div className="mt-1 rounded border border-slate-200 bg-white p-1 text-xs">
                            <UniversalLatex content={opt.label ?? ""} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {newQ.primaryType === "OPEN" && (
            <>
              <div>
                <label className="label">Açıq sualın növü</label>
                <select
                  className="input w-full"
                  value={newQ.openSubType}
                  onChange={(e) =>
                    setNewQ((q) => {
                      const sub = e.target.value as OpenAnswerSubType;
                      return {
                        ...q,
                        openSubType: sub,
                        type: sub === "MATCHING" ? "OPEN_UNORDERED" : sub === "SEQUENTIAL" ? "OPEN_ORDERED" : sub === "PERMUTATION" ? "OPEN_PERMUTATION" : "OPEN_SINGLE_VALUE",
                        answer_rule_type: sub === "MATCHING" ? "MATCHING" : sub === "SEQUENTIAL" ? "STRICT_ORDER" : sub === "PERMUTATION" ? "ANY_ORDER" : "EXACT_MATCH",
                      };
                    })
                  }
                >
                  {OPEN_SUBTYPES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Düzgün cavab</label>
                <input
                  className="input w-full"
                  value={newQ.correct_answer}
                  onChange={(e) => setNewQ((q) => ({ ...q, correct_answer: e.target.value }))}
                  placeholder={OPEN_QUESTION_HINTS[newQ.openSubType] || "Düzgün cavab"}
                />
                {newQ.correct_answer.trim() && (
                  <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800">
                    <UniversalLatex content={newQ.correct_answer} />
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1">{OPEN_QUESTION_HINTS[newQ.openSubType]}</p>
              </div>
            </>
          )}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => editingQuestion && updateQuestionMutation.mutate(editingQuestion.id)}
              disabled={
                !newQ.short_title.trim() ||
                !newQ.text.trim() ||
                (newQ.type === "MULTIPLE_CHOICE" && newQ.options.length < 2) ||
                hasDuplicateOptions ||
                mcImageIncomplete ||
                updateQuestionMutation.isPending
              }
              className="btn-primary flex-1"
            >
              Yadda saxla
            </button>
            <button type="button" onClick={() => { setShowEditQuestion(false); setEditingQuestion(null); }} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showCreateQuestion} onClose={() => setShowCreateQuestion(false)} title="Yeni sual" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Sualın Başlığı / Qısa Adı *</label>
            <input
              className="input w-full"
              value={newQ.short_title}
              onChange={(e) => setNewQ((q) => ({ ...q, short_title: e.target.value }))}
              placeholder="Məs: Faiz - Asan"
            />
            <p className="text-xs text-slate-500 mt-1">
              Bu ad tələbəyə görünməyəcək, yalnız sizin test bankında rahat tapmağınız üçündür.
            </p>
          </div>
          <div>
            <label className="label">Mövzu *</label>
            <div className="flex gap-2">
              <select
                className="input flex-1"
                value={topicIdForNewQuestion ?? selectedTopicId ?? ""}
                onChange={(e) => setTopicIdForNewQuestion(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Mövzu seçin</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  createTopicForQuestionRef.current = true;
                  setShowCreateTopic(true);
                }}
                className="btn-outline whitespace-nowrap"
              >
                <Plus className="w-4 h-4 inline mr-1" />
                Yeni mövzu
              </button>
            </div>
          </div>
          <div>
            <label className="label">Sual mətni *</label>
            <textarea
              className="input w-full h-24"
              value={newQ.text}
              onChange={(e) => setNewQ((q) => ({ ...q, text: e.target.value }))}
              placeholder="Sualı yazın..."
            />
            {newQ.text.trim() && (
              <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800">
                <UniversalLatex content={newQ.text} />
              </div>
            )}
          </div>
          <div>
            <label className="label">Şəkil (isteğe bağlı)</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="input w-full text-sm"
              onChange={(e) => setNewQ((q) => ({ ...q, questionImage: e.target.files?.[0] ?? null }))}
            />
            {newQ.questionImage && <p className="text-xs text-slate-500 mt-1">{newQ.questionImage.name}</p>}
            {questionImageObjectUrl && (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-2">
                <img src={questionImageObjectUrl} alt="" className="max-h-36 max-w-full rounded border border-slate-200 object-contain" />
                <a
                  href={questionImageObjectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  <Eye className="w-4 h-4" />
                  Bax
                </a>
              </div>
            )}
          </div>
          <div>
            <label className="label">Sualın tipi</label>
            <select
              className="input w-full"
              value={newQ.primaryType}
              onChange={(e) =>
                setNewQ((q) => {
                  const primaryType = e.target.value as "CLOSED" | "OPEN" | "SITUATION";
                  return {
                    ...q,
                    primaryType,
                    type: primaryType === "CLOSED" ? "MULTIPLE_CHOICE" : primaryType === "SITUATION" ? "SITUATION" : (q.openSubType === "MATCHING" ? "OPEN_UNORDERED" : q.openSubType === "SEQUENTIAL" ? "OPEN_ORDERED" : q.openSubType === "PERMUTATION" ? "OPEN_PERMUTATION" : "OPEN_SINGLE_VALUE"),
                    answer_rule_type:
                      primaryType === "OPEN"
                        ? (q.openSubType === "MATCHING" ? "MATCHING" : q.openSubType === "SEQUENTIAL" ? "STRICT_ORDER" : q.openSubType === "PERMUTATION" ? "ANY_ORDER" : "EXACT_MATCH")
                        : "",
                  };
                })
              }
            >
              {PRIMARY_QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {newQ.type === "MULTIPLE_CHOICE" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="label mb-0">Variantlar (düzgün olanı işarələyin)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-600">Variant növü:</span>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                    <button
                      type="button"
                      className={`px-3 py-1 rounded-md text-sm font-medium transition ${newQ.mcOptionMode === "text" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
                      onClick={() =>
                        setNewQ((q) => ({
                          ...q,
                          mcOptionMode: "text",
                          options: q.options.map((o) => ({ ...o, imageFile: null, imageUrl: null })),
                        }))
                      }
                    >
                      Mətn
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1 rounded-md text-sm font-medium transition ${newQ.mcOptionMode === "image" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
                      onClick={() =>
                        setNewQ((q) => ({
                          ...q,
                          mcOptionMode: "image",
                          options: q.options.map((o) => ({ ...o, text: "", imageFile: null, imageUrl: null, label: "" })),
                        }))
                      }
                    >
                      Şəkil
                    </button>
                  </div>
                  <button type="button" onClick={addOption} className="text-sm text-blue-600">
                    + Variant
                  </button>
                </div>
              </div>
              {hasDuplicateOptions && (
                <p className="text-sm text-red-600 mb-2">{OPTIONS_DUPLICATE_ERROR}</p>
              )}
              {newQ.mcOptionMode === "text" &&
                newQ.options.map((opt, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="radio"
                      name="correct-create"
                      checked={opt.is_correct}
                      onChange={() => setOption(i, opt.text, true)}
                    />
                    <input
                      className={`input flex-1 ${mcDuplicateIndices.includes(i) ? "border-red-500 ring-1 ring-red-500" : ""}`}
                      value={opt.text}
                      onChange={(e) => setOption(i, e.target.value, opt.is_correct)}
                      placeholder={`Variant ${i + 1}`}
                    />
                    {opt.text.trim() && (
                      <div className="text-xs text-slate-700 self-center max-w-[40%] truncate">
                        <UniversalLatex content={opt.text} />
                      </div>
                    )}
                    <button type="button" onClick={() => removeOption(i)} className="text-red-600">
                      Sil
                    </button>
                  </div>
                ))}
              {newQ.mcOptionMode === "image" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Şəkil rejimində hər variant üçün şəkil mütləqdir (isteğe bağlı LaTeX qeydi).</p>
                  {newQ.options.map((opt, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/80">
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="correct-create-img"
                          checked={opt.is_correct}
                          onChange={() => setOption(i, opt.text, true)}
                        />
                        <span className="text-sm font-medium text-slate-700">Variant {i + 1}</span>
                        <button type="button" onClick={() => removeOption(i)} className="text-red-600 text-sm ml-auto">
                          Sil
                        </button>
                      </div>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="input w-full text-sm"
                        onChange={(e) => setOptionImageFile(i, e.target.files?.[0] ?? null)}
                      />
                      {opt.imageFile && <p className="text-xs text-slate-600">{opt.imageFile.name}</p>}
                      <div>
                        <label className="text-xs text-slate-600">Qeyd (LaTeX, isteğe bağlı)</label>
                        <input
                          className="input w-full text-sm mt-0.5"
                          value={opt.label ?? ""}
                          onChange={(e) => setOptionLabel(i, e.target.value)}
                          placeholder="Məs: $x^2$"
                        />
                        {(opt.label ?? "").trim() ? (
                          <div className="mt-1 rounded border border-slate-200 bg-white p-1 text-xs">
                            <UniversalLatex content={opt.label ?? ""} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {newQ.primaryType === "OPEN" && (
            <>
              <div>
                <label className="label">Açıq sualın növü</label>
                <select
                  className="input w-full"
                  value={newQ.openSubType}
                  onChange={(e) =>
                    setNewQ((q) => {
                      const sub = e.target.value as OpenAnswerSubType;
                      return {
                        ...q,
                        openSubType: sub,
                        type: sub === "MATCHING" ? "OPEN_UNORDERED" : sub === "SEQUENTIAL" ? "OPEN_ORDERED" : sub === "PERMUTATION" ? "OPEN_PERMUTATION" : "OPEN_SINGLE_VALUE",
                        answer_rule_type: sub === "MATCHING" ? "MATCHING" : sub === "SEQUENTIAL" ? "STRICT_ORDER" : sub === "PERMUTATION" ? "ANY_ORDER" : "EXACT_MATCH",
                      };
                    })
                  }
                >
                  {OPEN_SUBTYPES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Düzgün cavab</label>
                <input
                  className="input w-full"
                  value={newQ.correct_answer}
                  onChange={(e) => setNewQ((q) => ({ ...q, correct_answer: e.target.value }))}
                  placeholder={OPEN_QUESTION_HINTS[newQ.openSubType] || "Düzgün cavab"}
                />
                {newQ.correct_answer.trim() && (
                  <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800">
                    <UniversalLatex content={newQ.correct_answer} />
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1">{OPEN_QUESTION_HINTS[newQ.openSubType]}</p>
              </div>
            </>
          )}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => createQuestionMutation.mutate()}
              disabled={
                !newQ.short_title.trim() ||
                !newQ.text.trim() ||
                (topicIdForNewQuestion ?? selectedTopicId) == null ||
                (newQ.type === "MULTIPLE_CHOICE" && newQ.options.length < 2) ||
                hasDuplicateOptions ||
                mcImageIncomplete ||
                createQuestionMutation.isPending
              }
              className="btn-primary flex-1"
            >
              Yadda saxla
            </button>
            <button type="button" onClick={() => setShowCreateQuestion(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>

      {/* PDF Library Section */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">PDF Kitabxanası</h2>
          <button onClick={() => setShowUploadPDF(true)} className="btn-primary">
            <Upload className="w-4 h-4" />
            PDF yüklə
          </button>
        </div>
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              className="input !pl-12 w-full text-sm"
              placeholder="PDF axtar..."
              value={pdfSearch}
              onChange={(e) => setPdfSearch(e.target.value)}
            />
          </div>
          <input
            type="number"
            className="input text-sm w-32"
            placeholder="İl"
            value={pdfYearFilter}
            onChange={(e) => setPdfYearFilter(e.target.value)}
          />
        </div>
        {pdfsLoading ? (
          <p className="text-slate-500 py-4">Yüklənir...</p>
        ) : pdfs.length === 0 ? (
          <p className="text-slate-500 py-4">PDF tapılmadı</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pdfs.map((pdf) => (
              <div key={pdf.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-slate-600" />
                    <h3 className="font-medium text-slate-900 line-clamp-1">{pdf.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => confirm("Bu PDF-i silmək istədiyinizə əminsiniz?") && deletePDFMutation.mutate(pdf.id)}
                    className="text-red-600 hover:bg-red-50 p-1 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-2">{pdf.original_filename}</p>
                {pdf.file_size_mb && (
                  <p className="text-xs text-slate-500 mb-2">{pdf.file_size_mb} MB</p>
                )}
                {pdf.year && (
                  <p className="text-xs text-slate-500 mb-2">İl: {pdf.year}</p>
                )}
                {pdf.file_url && (
                  <a
                    href={pdf.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Eye className="w-4 h-4" />
                    Bax
                  </a>
                )}
                {pdf.file && !pdf.file_url && (
                  <a
                    href={
                      pdf.file.startsWith("http")
                        ? pdf.file
                        : `${API_BASE_URL.replace(/\/api\/?$/, "")}/media/${pdf.file}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Eye className="w-4 h-4" />
                    Bax
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload PDF Modal */}
      <Modal isOpen={showUploadPDF} onClose={() => { setShowUploadPDF(false); setUploadFile(null); setNewPDF({ title: "", year: "", tags: "", source: "" }); }} title="PDF yüklə">
        <div className="space-y-4">
          <div>
            <label className="label">PDF faylı *</label>
            <input
              type="file"
              accept=".pdf"
              className="input"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />
            {uploadFile && <p className="text-sm text-slate-600 mt-1">{uploadFile.name}</p>}
          </div>
          <div>
            <label className="label">Başlıq</label>
            <input
              className="input w-full"
              value={newPDF.title}
              onChange={(e) => setNewPDF((p) => ({ ...p, title: e.target.value }))}
              placeholder="PDF başlığı (boş qoysanız fayl adı istifadə olunacaq)"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">İl</label>
              <input
                type="number"
                className="input w-full"
                value={newPDF.year}
                onChange={(e) => setNewPDF((p) => ({ ...p, year: e.target.value }))}
                placeholder="2024"
              />
            </div>
            <div>
              <label className="label">Mənbə</label>
              <input
                className="input w-full"
                value={newPDF.source}
                onChange={(e) => setNewPDF((p) => ({ ...p, source: e.target.value }))}
                placeholder="Mənbə"
              />
            </div>
          </div>
          <div>
            <label className="label">Teqlər (vergüllə ayrılmış)</label>
            <input
              className="input w-full"
              value={newPDF.tags}
              onChange={(e) => setNewPDF((p) => ({ ...p, tags: e.target.value }))}
              placeholder="riyaziyyat, test, 2024"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => uploadPDFMutation.mutate()}
              disabled={!uploadFile || uploadPDFMutation.isPending}
              className="btn-primary flex-1"
            >
              Yüklə
            </button>
            <button
              type="button"
              onClick={() => { setShowUploadPDF(false); setUploadFile(null); setNewPDF({ title: "", year: "", tags: "", source: "" }); }}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}