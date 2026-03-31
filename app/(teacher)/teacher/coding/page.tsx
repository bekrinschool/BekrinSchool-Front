"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  teacherApi,
  CodingTask,
  CodingTopic,
  CodingTestCase,
  ImportCodingTask,
} from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Edit2, Trash2, FileCode, ChevronDown, Eye, FileJson } from "lucide-react";

const importTestCaseSchema = z.object({
  input: z.string().min(1, "Input tələb olunur"),
  expected_output: z.string().min(1, "Gözlənilən nəticə tələb olunur"),
  is_hidden: z.boolean().optional(),
});
const importTaskSchema = z.object({
  title: z.string().min(1, "Başlıq tələb olunur"),
  description: z.string().optional(),
  initial_code: z.string().optional(),
  difficulty: z.enum(["Easy", "Medium", "Hard", "easy", "medium", "hard"]).optional(),
  test_cases: z.array(importTestCaseSchema).min(1, "Ən azı bir test keysi tələb olunur"),
});
const importPayloadSchema = z.object({
  tasks: z.array(importTaskSchema),
  topic_id: z.number().optional(),
});

const taskSchema = z.object({
  title: z.string().min(1, "Başlıq tələb olunur"),
  description: z.string().min(1, "Təsvir tələb olunur"),
  difficulty: z.enum(["easy", "medium", "hard"]),
  topic: z.number().optional().nullable(),
  starter_code: z.string().optional(),
  points: z.number().nullable().optional(),
  order_index: z.number().nullable().optional(),
});

type TaskFormValues = z.infer<typeof taskSchema>;

export default function CodingPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editingTask, setEditingTask] = useState<CodingTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [testCaseTaskId, setTestCaseTaskId] = useState<string | null>(null);
  const [bulkJsonOpen, setBulkJsonOpen] = useState(false);
  const [createTopicOpen, setCreateTopicOpen] = useState(false);
  const [createDropdownOpen, setCreateDropdownOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [bulkJsonText, setBulkJsonText] = useState("");
  const [bulkJsonError, setBulkJsonError] = useState<string | null>(null);
  const [viewingTestCase, setViewingTestCase] = useState<CodingTestCase | null>(null);
  const [viewingTask, setViewingTask] = useState<CodingTask | null>(null);
  const [testCaseJsonEditOpen, setTestCaseJsonEditOpen] = useState(false);
  const [testCaseJsonEditText, setTestCaseJsonEditText] = useState("");
  const [testCaseJsonEditError, setTestCaseJsonEditError] = useState<string | null>(null);
  const [importJsonOpen, setImportJsonOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importJsonValidationError, setImportJsonValidationError] = useState<string | null>(null);
  const [importValidationOk, setImportValidationOk] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportModalContent, setExportModalContent] = useState<string>("");

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["teacher", "coding", topicFilter, searchQuery],
    queryFn: () =>
      teacherApi.getCodingTasks({
        topic_id: topicFilter || undefined,
        q: searchQuery || undefined,
      }),
  });
  const { data: topics } = useQuery({
    queryKey: ["teacher", "coding", "topics"],
    queryFn: () => teacherApi.getCodingTopics(),
  });
  const { data: testCases, isLoading: testCasesLoading } = useQuery({
    queryKey: ["teacher", "coding", "testcases", testCaseTaskId],
    queryFn: () => teacherApi.getCodingTestCases(testCaseTaskId!),
    enabled: !!testCaseTaskId,
  });
  const { data: viewingTaskTestCases } = useQuery({
    queryKey: ["teacher", "coding", "testcases", viewingTask?.id],
    queryFn: () => teacherApi.getCodingTestCases(viewingTask!.id),
    enabled: !!viewingTask?.id,
  });

  const createTopicMutation = useMutation({
    mutationFn: (name: string) => teacherApi.createCodingTopic({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding", "topics"] });
      setCreateTopicOpen(false);
      setNewTopicName("");
    },
  });
  const createMutation = useMutation({
    mutationFn: (data: Partial<CodingTask>) =>
      teacherApi.createCodingTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding"] });
      setCreating(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CodingTask> }) =>
      teacherApi.updateCodingTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding"] });
      setEditingTask(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteCodingTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding"] });
      if (testCaseTaskId) setTestCaseTaskId(null);
    },
  });
  const createTestCaseMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: { input_data: string; expected?: string; expected_output?: string; explanation?: string; order_index?: number; is_sample?: boolean } }) =>
      teacherApi.createCodingTestCase(taskId, data),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding", "testcases", taskId] });
    },
  });
  const updateTestCaseMutation = useMutation({
    mutationFn: ({ caseId, data }: { caseId: number; data: Partial<CodingTestCase> }) =>
      teacherApi.updateCodingTestCase(caseId, data),
    onSuccess: (_, { caseId }) => {
      if (testCaseTaskId) queryClient.invalidateQueries({ queryKey: ["teacher", "coding", "testcases", testCaseTaskId] });
    },
  });
  const deleteTestCaseMutation = useMutation({
    mutationFn: (caseId: number) => teacherApi.deleteCodingTestCase(caseId),
    onSuccess: () => {
      if (testCaseTaskId) queryClient.invalidateQueries({ queryKey: ["teacher", "coding", "testcases", testCaseTaskId] });
    },
  });

  const importJsonMutation = useMutation({
    mutationFn: (body: { tasks: ImportCodingTask[]; topic_id?: number }) => teacherApi.importCodingTasksJson(body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding"] });
      setImportJsonOpen(false);
      setImportJsonText("");
      setImportJsonValidationError(null);
      setImportValidationOk(false);
      toast.success(data.message || "Tapşırıqlar uğurla idxal edildi.");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "İdxal zamanı xəta baş verdi.");
    },
  });

  const validateImportJson = () => {
    setImportJsonValidationError(null);
    setImportValidationOk(false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJsonText);
    } catch {
      setImportJsonValidationError("Etibarsız JSON.");
      return;
    }
    const payload = typeof parsed === "object" && parsed !== null && "tasks" in parsed
      ? parsed
      : { tasks: Array.isArray(parsed) ? parsed : [parsed] };
    const result = importPayloadSchema.safeParse(payload);
    if (!result.success) {
      const first = result.error.flatten().fieldErrors;
      const msg = result.error.errors.map((e) => e.message).join("; ") || "Validasiya xətası.";
      setImportJsonValidationError(msg);
      return;
    }
    setImportValidationOk(true);
    setImportJsonValidationError(null);
  };

  const submitImportJson = () => {
    setImportJsonValidationError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJsonText);
    } catch {
      setImportJsonValidationError("Etibarsız JSON.");
      return;
    }
    const payload = typeof parsed === "object" && parsed !== null && "tasks" in parsed
      ? (parsed as { tasks: ImportCodingTask[]; topic_id?: number })
      : { tasks: Array.isArray(parsed) ? (parsed as ImportCodingTask[]) : [parsed as ImportCodingTask] };
    const result = importPayloadSchema.safeParse(payload);
    if (!result.success) {
      const msg = result.error.errors.map((e) => e.message).join("; ") || "Validasiya xətası.";
      setImportJsonValidationError(msg);
      return;
    }
    const topicId = topicFilter ? parseInt(topicFilter, 10) : (topics?.[0]?.id);
    importJsonMutation.mutate({ tasks: result.data.tasks, topic_id: Number.isFinite(topicId) ? topicId : undefined });
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { difficulty: "easy", topic: null, starter_code: "", points: null, order_index: null },
  });

  const onSubmit = (values: TaskFormValues) => {
    if (!editingTask && (values.topic == null || values.topic === 0)) {
      setError("topic", { message: "Mövzu tələb olunur" });
      return;
    }
    const payload = {
      ...values,
      topic: values.topic ?? (editingTask?.topic ?? null),
      starter_code: values.starter_code || "",
      points: values.points ?? null,
      order_index: values.order_index ?? null,
    };
    if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, data: payload });
    } else {
      if (!payload.topic) return;
      createMutation.mutate(payload);
      reset();
    }
  };

  const openEdit = (task: CodingTask) => {
    setEditingTask(task);
    reset({
      title: task.title,
      description: task.description,
      difficulty: task.difficulty,
      topic: task.topic ?? null,
      starter_code: task.starter_code ?? "",
      points: task.points ?? null,
      order_index: task.order_index ?? null,
    });
  };

  const validateAndImportBulkJson = async () => {
    setBulkJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bulkJsonText);
    } catch {
      setBulkJsonError("Etibarsız JSON");
      return;
    }
    const addTestcases = async (taskId: string, arr: Record<string, unknown>[]) => {
      let ok = 0;
      for (let i = 0; i < arr.length; i++) {
        const row = arr[i];
        const input_data = typeof row.input_data === "string" ? row.input_data : String(row.input ?? "");
        const expected = typeof row.expected === "string" ? row.expected : typeof row.expected_output === "string" ? row.expected_output : "";
        if (!input_data.trim() || !expected.trim()) {
          setBulkJsonError(`Sətir ${i + 1}: input və expected_output tələb olunur`);
          return;
        }
        const is_sample = typeof row.is_sample === "boolean" ? row.is_sample : i < 2;
        try {
          await teacherApi.createCodingTestCase(taskId, { input_data, expected_output: expected, explanation: typeof row.explanation === "string" ? row.explanation : undefined, order_index: i, is_sample });
          ok++;
        } catch (e) {
          setBulkJsonError(`Sətir ${i + 1}: xəta`);
          return;
        }
      }
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding", "testcases", taskId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding"] });
      setBulkJsonOpen(false);
      setBulkJsonText("");
      if (ok > 0) setTestCaseTaskId(taskId);
    };
    if (Array.isArray(parsed)) {
      const taskId = testCaseTaskId;
      if (!taskId) {
        setBulkJsonError("Əvvəlcə tapşırıq seçin və ya tam JSON formatı istifadə edin");
        return;
      }
      await addTestcases(taskId, parsed as Record<string, unknown>[]);
      return;
    }
    if (typeof parsed === "object" && parsed !== null && "testcases" in parsed) {
      const obj = parsed as { title?: string; statement?: string; description?: string; topic_id?: number; topic?: number; testcases?: unknown[] };
      const title = obj.title || obj.statement || "";
      const description = obj.statement || obj.description || "";
      const topicId = obj.topic_id ?? obj.topic ?? topics?.[0]?.id;
      if (!title.trim()) {
        setBulkJsonError("title və ya statement tələb olunur");
        return;
      }
      const testcases = Array.isArray(obj.testcases) ? obj.testcases : [];
      if (testcases.length === 0) {
        setBulkJsonError("testcases massivi tələb olunur");
        return;
      }
      try {
        const task = await teacherApi.createCodingTask({ title, description: description || title, topic: topicId ?? undefined, difficulty: "easy", is_active: true });
        queryClient.invalidateQueries({ queryKey: ["teacher", "coding"] });
        await addTestcases(String(task.id), testcases as Record<string, unknown>[]);
      } catch (e) {
        setBulkJsonError("Tapşırıq yaradılmadı");
      }
      return;
    }
    setBulkJsonError("JSON massiv və ya {title, statement, topic_id, testcases: [...]} formatında olmalıdır");
  };

  const diffLabels: Record<string, string> = {
    easy: "Asan",
    medium: "Orta",
    hard: "Çətin",
  };

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Kodlaşdırma Tapşırıqları
        </h1>
        <div className="flex flex-wrap gap-3 mt-4">
          <select
            className="input text-sm w-auto min-w-[140px]"
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
          >
            <option value="">Hamısı mövzular</option>
            {topics?.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.name}</option>
            ))}
          </select>
          <input
            type="text"
            className="input text-sm flex-1 min-w-[180px]"
            placeholder="Tapşırıqda axtar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="mb-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setImportJsonOpen(true);
            setImportJsonValidationError(null);
            setImportValidationOk(false);
            setImportJsonText("");
          }}
          className="btn-outline flex items-center gap-2"
        >
          <FileJson className="w-4 h-4" />
          İmport (JSON)
        </button>
        <button
          type="button"
          disabled={!tasks?.length || exporting}
          onClick={async () => {
            if (!tasks?.length) {
              toast.info("İxrac üçün ən azı bir tapşırıq olmalıdır.");
              return;
            }
            setExporting(true);
            try {
              const ids = tasks.map((t) => parseInt(String(t.id), 10)).filter(Number.isFinite);
              const data = await teacherApi.exportCodingTasksJson(ids);
              setExportModalContent(JSON.stringify({ tasks: data.tasks }, null, 2));
              setExportModalOpen(true);
            } catch {
              toast.error("İxrac zamanı xəta baş verdi.");
            } finally {
              setExporting(false);
            }
          }}
          className="btn-outline flex items-center gap-2"
        >
          {exporting ? (
            <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <FileJson className="w-4 h-4" />
          )}
          İxrac (JSON)
        </button>
        <div className="relative">
          <button
            onClick={() => setCreateDropdownOpen(!createDropdownOpen)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Yarat
            <ChevronDown className="w-4 h-4" />
          </button>
          {createDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setCreateDropdownOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1">
                <button
                  type="button"
                  onClick={() => {
                    setCreateTopicOpen(true);
                    setCreateDropdownOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700"
                >
                  Mövzu
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(true);
                    setEditingTask(null);
                    reset({ title: "", description: "", difficulty: "easy", topic: undefined, starter_code: "", points: null, order_index: null });
                    setCreateDropdownOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700"
                >
                  Tapşırıq
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tasks && tasks.length > 0 ? (
          tasks.map((task) => (
            <div key={task.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-semibold text-slate-900">
                  {task.title}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewingTask(task)}
                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"
                    title="Baxış"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEdit(task)}
                    className="p-2 hover:bg-blue-50 rounded-lg text-blue-600"
                    title="Redaktə"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setTestCaseTaskId(testCaseTaskId === task.id ? null : task.id)}
                    className={`p-2 rounded-lg ${testCaseTaskId === task.id ? "bg-slate-200" : "hover:bg-slate-100"}`}
                    title="Test Keysləri"
                  >
                    <FileCode className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`"${task.title}" tapşırığını silmək istədiyinizə əminsiniz?`)) {
                        deleteMutation.mutate(task.id);
                      }
                    }}
                    className="p-2 hover:bg-red-50 rounded-lg text-red-600"
                    title="Sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {task.topic_name && (
                <p className="text-xs text-slate-500 mb-1">{task.topic_name}</p>
              )}
              <p className="text-sm text-slate-600 mb-2 line-clamp-2">
                {task.description}
              </p>
              <span
                className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                  task.difficulty === "easy"
                    ? "bg-green-100 text-green-700"
                    : task.difficulty === "medium"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {diffLabels[task.difficulty]}
              </span>

              {testCaseTaskId === task.id && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">Test Keysləri</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setTestCaseJsonEditOpen(true);
                          setTestCaseJsonEditError(null);
                          setTestCaseJsonEditText(
                            JSON.stringify(
                              (testCases ?? []).map((tc) => ({
                                input: tc.input_data,
                                expected_output: tc.expected_output ?? tc.expected,
                                is_hidden: !tc.is_sample,
                              })),
                              null,
                              2
                            )
                          );
                        }}
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                      >
                        JSON ilə redaktə et
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkJsonOpen(true)}
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                      >
                        JSON əlavə et
                      </button>
                    </div>
                  </div>
                  {testCasesLoading ? (
                    <p className="text-sm text-slate-500">Yüklənir...</p>
                  ) : testCases && testCases.length > 0 ? (
                    <div className="space-y-1 text-sm">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1 text-xs font-semibold text-slate-600">
                        <span>Input → Gözlənilən</span>
                        <span>Nümunə</span>
                        <span></span>
                      </div>
                      {testCases.map((tc, idx) => (
                        <div key={tc.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded px-2 py-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="text-slate-700 truncate block">
                              {tc.input_data?.slice(0, 80)}{(tc.input_data?.length ?? 0) > 80 ? "…" : ""} → {(tc.expected_output ?? tc.expected)?.slice(0, 60)}{((tc.expected_output ?? tc.expected)?.length ?? 0) > 60 ? "…" : ""}
                            </span>
                            <span className="text-xs text-slate-500">#{idx + 1}</span>
                          </div>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${tc.is_sample ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}>
                            {tc.is_sample ? "Nümunə" : "Gizli"}
                          </span>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => setViewingTestCase(tc)}
                              className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-0.5"
                              title="Bax"
                            >
                              <Eye className="w-3.5 h-3.5" /> Bax
                            </button>
                            <button
                              onClick={() => {
                                if (confirm("Bu test case-i silmək?")) deleteTestCaseMutation.mutate(tc.id);
                              }}
                              className="text-red-600 text-xs"
                            >
                              Sil
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Test case yoxdur. &quot;JSON əlavə et&quot; və ya API ilə əlavə edin.</p>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-500">
            Tapşırıq tapılmadı. Yeni tapşırıq əlavə edin.
          </div>
        )}
      </div>

      <Modal
        isOpen={creating || !!editingTask}
        onClose={() => {
          setCreating(false);
          setEditingTask(null);
        }}
        title={editingTask ? "Tapşırığı Redaktə Et" : "Yeni Tapşırıq"}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Mövzu *</label>
            <select className="input" {...register("topic", { setValueAs: (v) => (v === "" ? null : Number(v)) })}>
              <option value="">— Seçin —</option>
              {topics?.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {errors.topic && (
              <p className="mt-1 text-xs text-red-600">{errors.topic.message}</p>
            )}
          </div>
          <div>
            <label className="label">Başlıq *</label>
            <input className="input" {...register("title")} />
            {errors.title && (
              <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>
            )}
          </div>
          <div>
            <label className="label">Təsvir *</label>
            <textarea
              className="input"
              rows={4}
              {...register("description")}
            />
            {errors.description && (
              <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
            )}
          </div>
          <div>
            <label className="label">İlkin Kod (isteğe bağlı)</label>
            <textarea
              className="input font-mono text-sm"
              rows={3}
              {...register("starter_code")}
              placeholder="# Python"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Çətinlik</label>
              <select className="input" {...register("difficulty")}>
                <option value="easy">Asan</option>
                <option value="medium">Orta</option>
                <option value="hard">Çətin</option>
              </select>
            </div>
            <div>
              <label className="label">Sıra</label>
              <input type="number" className="input" {...register("order_index", { setValueAs: (v) => (v === "" ? null : Number(v)) })} />
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "Yadda saxlanılır..." : "Yadda Saxla"}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setEditingTask(null); }}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {bulkJsonOpen && testCaseTaskId && (
        <Modal
          isOpen={true}
          onClose={() => { setBulkJsonOpen(false); setBulkJsonError(null); setBulkJsonText(""); }}
          title="Test case-lər JSON ilə əlavə et"
        >
          <p className="text-sm text-slate-600 mb-2">
            Format 1 (mövcud tapşırığa): [ {`{"input":"...","expected_output":"...","is_sample":true}`}, ... ]<br />
            Format 2 (yeni tapşırıq): {`{"title":"...","statement":"...","topic_id":1,"testcases":[...]}`}
          </p>
          <textarea
            className="input font-mono text-sm w-full h-48"
            value={bulkJsonText}
            onChange={(e) => setBulkJsonText(e.target.value)}
            placeholder='[{"input_data":"5\n3","expected":"8"},{"input_data":"0\n0","expected":"0"}]'
          />
          {bulkJsonError && (
            <p className="mt-2 text-sm text-red-600">{bulkJsonError}</p>
          )}
          <div className="flex gap-3 mt-4">
            <button type="button" onClick={() => validateAndImportBulkJson()} className="btn-primary flex-1">
              Yoxla və əlavə et
            </button>
            <button type="button" onClick={() => { setBulkJsonOpen(false); setBulkJsonText(""); setBulkJsonError(null); }} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </Modal>
      )}

      {testCaseJsonEditOpen && testCaseTaskId && (
        <Modal
          isOpen={true}
          onClose={() => { setTestCaseJsonEditOpen(false); setTestCaseJsonEditText(""); setTestCaseJsonEditError(null); }}
          title="Test Keysləri — JSON ilə redaktə"
        >
          <p className="text-sm text-slate-600 mb-2">
            Format: <code className="bg-slate-100 px-1 rounded">[{` { "input": "...", "expected_output": "...", "is_hidden": false }`}, ... ]</code>
          </p>
          <textarea
            className="input font-mono text-sm w-full h-48"
            value={testCaseJsonEditText}
            onChange={(e) => { setTestCaseJsonEditText(e.target.value); setTestCaseJsonEditError(null); }}
            placeholder='[{"input":"5\n3","expected_output":"8","is_hidden":false}]'
          />
          {testCaseJsonEditError && <p className="mt-2 text-sm text-red-600">{testCaseJsonEditError}</p>}
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              className="btn-primary"
              disabled={deleteTestCaseMutation.isPending || createTestCaseMutation.isPending}
              onClick={async () => {
                setTestCaseJsonEditError(null);
                let arr: { input: string; expected_output: string; is_hidden?: boolean }[];
                try {
                  const parsed = JSON.parse(testCaseJsonEditText);
                  arr = Array.isArray(parsed) ? parsed : [parsed];
                } catch {
                  setTestCaseJsonEditError("Etibarsız JSON.");
                  return;
                }
                for (const item of arr) {
                  if (typeof item?.input !== "string" || typeof item?.expected_output !== "string") {
                    setTestCaseJsonEditError("Hər elementdə input və expected_output tələb olunur.");
                    return;
                  }
                }
                const taskId = testCaseTaskId;
                const current = testCases ?? [];
                try {
                  for (const tc of current) {
                    await deleteTestCaseMutation.mutateAsync(tc.id);
                  }
                  for (let i = 0; i < arr.length; i++) {
                    const item = arr[i];
                    await createTestCaseMutation.mutateAsync({
                      taskId,
                      data: {
                        input_data: item.input,
                        expected_output: item.expected_output,
                        is_sample: !item.is_hidden,
                        order_index: i,
                      },
                    });
                  }
                  queryClient.invalidateQueries({ queryKey: ["teacher", "coding", "testcases", taskId] });
                  setTestCaseJsonEditOpen(false);
                  setTestCaseJsonEditText("");
                  setTestCaseJsonEditError(null);
                  toast.success("Test keysləri yeniləndi.");
                } catch (e) {
                  setTestCaseJsonEditError((e as { message?: string })?.message || "Xəta baş verdi.");
                  toast.error("Test keysləri tətbiq edilmədi.");
                }
              }}
            >
              {deleteTestCaseMutation.isPending || createTestCaseMutation.isPending ? "Yüklənir..." : "Tətbiq et"}
            </button>
            <button
              type="button"
              onClick={() => { setTestCaseJsonEditOpen(false); setTestCaseJsonEditText(""); setTestCaseJsonEditError(null); }}
              className="btn-outline"
            >
              Ləğv et
            </button>
          </div>
        </Modal>
      )}

      {viewingTestCase && (
        <Modal
          isOpen={true}
          onClose={() => setViewingTestCase(null)}
          title="Test case təfərrüatı"
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-600">Input</label>
              <pre className="mt-1 p-3 bg-slate-50 rounded text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                {viewingTestCase.input_data || "(boş)"}
              </pre>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(viewingTestCase.input_data || "")}
                className="mt-1 text-xs text-blue-600 hover:underline"
              >
                Kopyala
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Gözlənilən output</label>
              <pre className="mt-1 p-3 bg-slate-50 rounded text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                {viewingTestCase.expected_output ?? viewingTestCase.expected ?? "(boş)"}
              </pre>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(viewingTestCase.expected_output ?? viewingTestCase.expected ?? "")}
                className="mt-1 text-xs text-blue-600 hover:underline"
              >
                Kopyala
              </button>
            </div>
            {viewingTestCase.explanation && (
              <div>
                <label className="text-xs font-semibold text-slate-600">İzah</label>
                <p className="mt-1 text-sm text-slate-700">{viewingTestCase.explanation}</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {viewingTask && (
        <Modal
          isOpen={true}
          onClose={() => setViewingTask(null)}
          title="Baxış — tapşırıq"
        >
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="text-xs font-semibold text-slate-600">Başlıq</label>
              <p className="mt-1 text-base font-medium text-slate-900">{viewingTask.title}</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Təsvir</label>
              <div className="mt-1 p-3 bg-slate-50 rounded text-sm text-slate-700 whitespace-pre-wrap">
                {viewingTask.description || "(boş)"}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">İlkin Kod</label>
              <pre className="mt-1 p-3 bg-slate-50 rounded text-xs font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap border border-slate-200">
                {viewingTask.starter_code || "(boş)"}
              </pre>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Çətinlik</label>
              <p className="mt-1">
                <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                  viewingTask.difficulty === "easy" ? "bg-green-100 text-green-700" :
                  viewingTask.difficulty === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
                }`}>
                  {diffLabels[viewingTask.difficulty]}
                </span>
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Test Keysləri</label>
              {viewingTaskTestCases === undefined ? (
                <p className="mt-1 text-sm text-slate-500">Yüklənir...</p>
              ) : !viewingTaskTestCases?.length ? (
                <p className="mt-1 text-sm text-slate-500">Test keysi yoxdur.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {viewingTaskTestCases.map((tc, idx) => (
                    <div key={tc.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                      <span className="text-xs font-medium text-slate-500">#{idx + 1}</span>
                      <div className="mt-1 grid grid-cols-1 gap-2 text-sm">
                        <div>
                          <span className="text-slate-500">Input: </span>
                          <pre className="inline font-mono whitespace-pre-wrap break-all">{tc.input_data || "(boş)"}</pre>
                        </div>
                        <div>
                          <span className="text-slate-500">Gözlənilən: </span>
                          <pre className="inline font-mono whitespace-pre-wrap break-all">{tc.expected_output ?? tc.expected ?? "(boş)"}</pre>
                        </div>
                        <span className={`text-xs ${tc.is_sample ? "text-blue-600" : "text-slate-500"}`}>
                          {tc.is_sample ? "Nümunə" : "Gizli"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" onClick={() => setViewingTask(null)} className="btn-outline">
                Bağla
              </button>
            </div>
          </div>
        </Modal>
      )}

      {importJsonOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            setImportJsonOpen(false);
            setImportJsonText("");
            setImportJsonValidationError(null);
            setImportValidationOk(false);
          }}
          title="İmport (JSON)"
        >
          <p className="text-sm text-slate-600 mb-2">
            Format: <code className="bg-slate-100 px-1 rounded">{`{ "tasks": [ { "title": "...", "description": "...", "initial_code": "...", "difficulty": "Easy"|"Medium"|"Hard", "test_cases": [ { "input": "...", "expected_output": "...", "is_hidden": false } ] } ] }`}</code>
          </p>
          <textarea
            className="input font-mono text-sm w-full h-48"
            value={importJsonText}
            onChange={(e) => {
              setImportJsonText(e.target.value);
              setImportJsonValidationError(null);
              setImportValidationOk(false);
            }}
            placeholder='{"tasks":[{"title":"Tapşırıq 1","description":"Təsvir","initial_code":"","difficulty":"Easy","test_cases":[{"input":"5\n3","expected_output":"8","is_hidden":false}]}]}'
          />
          {importJsonValidationError && (
            <p className="mt-2 text-sm text-red-600">{importJsonValidationError}</p>
          )}
          {importValidationOk && !importJsonValidationError && (
            <p className="mt-2 text-sm text-green-600">Struktur etibarlıdır. İdxal etmək üçün &quot;İdxal et&quot; düyməsini basın.</p>
          )}
          <div className="flex flex-wrap gap-3 mt-4">
            <button
              type="button"
              onClick={validateImportJson}
              className="btn-outline"
            >
              Validasiya et
            </button>
            <button
              type="button"
              onClick={submitImportJson}
              disabled={importJsonMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {importJsonMutation.isPending ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Yüklənir...
                </>
              ) : (
                "İdxal et"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setImportJsonOpen(false);
                setImportJsonText("");
                setImportJsonValidationError(null);
                setImportValidationOk(false);
              }}
              className="btn-outline"
            >
              Ləğv et
            </button>
          </div>
        </Modal>
      )}

      {exportModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => { setExportModalOpen(false); setExportModalContent(""); }}
          title="İxrac (JSON)"
        >
          <p className="text-sm text-slate-600 mb-2">
            Aşağıdakı JSON-u kopyalayıb redaktə edə və İmport (JSON) ilə geri yükləyə bilərsiniz.
          </p>
          <textarea
            readOnly
            className="input font-mono text-sm w-full h-48"
            value={exportModalContent}
          />
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(exportModalContent);
                toast.success("JSON kopyalandı.");
              }}
              className="btn-primary"
            >
              Kopyala
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([exportModalContent], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "coding-tasks-export.json";
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Fayl endirildi.");
              }}
              className="btn-outline"
            >
              Fayl kimi endir
            </button>
            <button
              type="button"
              onClick={() => { setExportModalOpen(false); setExportModalContent(""); }}
              className="btn-outline"
            >
              Bağla
            </button>
          </div>
        </Modal>
      )}

      {createTopicOpen && (
        <Modal
          isOpen={true}
          onClose={() => { setCreateTopicOpen(false); setNewTopicName(""); }}
          title="Yeni Mövzu"
        >
          <div className="space-y-4">
            <div>
              <label className="label">Mövzu adı *</label>
              <input
                className="input"
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                placeholder="məs. Alqoritmlər"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => createTopicMutation.mutate(newTopicName.trim())}
                disabled={!newTopicName.trim() || createTopicMutation.isPending}
                className="btn-primary flex-1"
              >
                {createTopicMutation.isPending ? "Yadda saxlanılır..." : "Yadda Saxla"}
              </button>
              <button
                type="button"
                onClick={() => { setCreateTopicOpen(false); setNewTopicName(""); }}
                className="btn-outline flex-1"
              >
                Ləğv et
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
