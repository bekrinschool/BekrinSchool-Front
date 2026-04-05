import { api } from "./api";

export interface StudentAttendance {
  date: string;
  status: "present" | "absent" | "late";
  groupName?: string;
}

export interface StudentResult {
  id: string;
  testName: string;
  score: number;
  maxScore: number;
  date: string;
  groupName?: string;
}

export interface CodingExercise {
  id: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  topicId?: number | null;
  topicName?: string | null;
  solved?: boolean;
  attemptCount?: number;
  lastSubmissionStatus?: string | null;
  lastSubmissionAt?: string | null;
  createdAt?: string | null;
  completed?: boolean;
  score?: number | null;
}

export interface CodingTaskDetail {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  starterCode: string;
  topicId?: number | null;
  topicName?: string | null;
  testCaseCount: number;
}

export interface CodingSubmissionItem {
  id: number;
  status: string;
  score?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  runtimeMs?: number | null;
  attemptNo?: number | null;
  createdAt: string;
}

export interface CodingSubmissionDetail extends CodingSubmissionItem {
  submittedCode: string;
}

export interface RunCodeResultItem {
  testCaseId?: number;
  input: string;
  expected: string;
  output?: string;
  actual?: string;
  passed: boolean;
}

export interface RunCodeResult {
  status: "OK" | "ERROR" | "success" | "error";
  results?: RunCodeResultItem[];
  passedCount?: number;
  totalCount?: number;
  output?: string;
  execution_time_ms?: number;
}

export interface StudentStats {
  missedCount: number;
  absentCount: number;
  attendancePercent: number;
}

export const studentApi = {
  getStats: () => api.get<StudentStats>("/student/stats"),
  getAttendance: () => api.get<StudentAttendance[]>("/student/attendance"),
  
  getResults: () => api.get<StudentResult[]>("/student/results"),
  
  getCodingExercises: (params?: { topic?: string; status?: string; search?: string; sort?: string }) => {
    const sp = new URLSearchParams();
    if (params?.topic) sp.set("topic", params.topic);
    if (params?.status) sp.set("status", params.status);
    if (params?.search) sp.set("search", params.search);
    if (params?.sort) sp.set("sort", params.sort);
    const qs = sp.toString();
    return api.get<CodingExercise[]>(`/student/coding${qs ? `?${qs}` : ""}`);
  },
  runCoding: (taskId: number, code: string) =>
    api.post<RunCodeResult>("/student/coding/run", { task_id: taskId, code }),
  getCodingSubmissionDetail: (taskId: number, submissionId: number) =>
    api.get<CodingSubmissionDetail>(`/student/coding/${taskId}/submissions/${submissionId}`),
  getCodingTaskDetail: (id: string) =>
    api.get<CodingTaskDetail>(`/student/coding/${id}`),
  getCodingSubmissions: (taskId: string, params?: { page?: number; page_size?: number }) => {
    const sp = new URLSearchParams();
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    const qs = sp.toString();
    return api.get<{ count: number; next: number | null; previous: number | null; results: CodingSubmissionItem[] }>(
      `/student/coding/${taskId}/submissions${qs ? `?${qs}` : ""}`
    );
  },
  submitCoding: (taskId: string, code: string) =>
    api.post<{ submissionId: number; resultStatus: string; passedCount: number; totalCases: number; score?: number; createdAt: string }>(
      `/student/coding/${taskId}/submit`,
      { code }
    ),

  // Exams (run-based: runId, examId, remainingSeconds)
  getExams: () =>
    api.get<{
      runId: number;
      examId: number;
      id: number;
      title: string;
      type: string;
      status?: "active" | "suspended" | "scheduled" | "finished";
      suspendedAt?: string | null;
      teacherUnlockedAt?: string | null;
      sourceType?: string;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      remainingSeconds: number;
    }[]>("/student/exams"),
  getRunPages: (runId: number) =>
    api.get<{ pages: string[] }>(`/student/runs/${runId}/pages`),
  startRun: (runId: number) =>
    api.post<{
      attemptId: number;
      examId: number;
      runId: number;
      title: string;
      type?: "quiz" | "exam";
      status: string;
      sourceType?: string;
      pdfUrl?: string | null;
      startedAt: string;
      expiresAt?: string;
      endTime: string;
      questions: {
        examQuestionId?: number;
        questionId?: number;
        questionNumber?: number;
        order?: number;
        text: string;
        type: string;
        kind?: string;
        prompt?: string;
        options: { id?: number; key?: string; text: string; order?: number }[];
      }[];
      canvases?: { canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string }[];
      serverNow?: string;
      globalEndAt?: string;
      sessionRevision?: number;
      savedAnswers?: Array<{
        questionId?: number;
        questionNumber?: number;
        selectedOptionId?: number | string;
        selectedOptionKey?: string;
        textAnswer?: string;
      }>;
      resumeQuestionIndex?: number;
    }>(`/student/runs/${runId}/start`, {}),
  syncAttempt: (attemptId: number) =>
    api.get<{
      attemptId: number;
      serverNow: string;
      expiresAt?: string | null;
      globalEndAt?: string | null;
      sessionRevision: number;
      status: string;
      finishedAt?: string | null;
    }>(`/student/exams/attempts/${attemptId}/sync`),
  /** Active attempt snapshot (hydration / resume) without starting a new attempt */
  getAttemptState: (attemptId: number) =>
    api.get<{
      attemptId: number;
      examId?: number;
      runId?: number | null;
      status: string;
      submitted: boolean;
      serverNow?: string;
      expiresAt?: string | null;
      sessionRevision?: number;
      savedAnswers?: Array<{
        questionId?: number;
        questionNumber?: number;
        selectedOptionId?: number | string;
        selectedOptionKey?: string;
        textAnswer?: string;
      }>;
      scratchpadData?: { pageIndex: number; drawingData: Record<string, unknown> }[];
      scratchpad_data?: { pageIndex: number; drawingData: Record<string, unknown> }[];
    }>(`/student/exams/attempts/${attemptId}/state`),
  saveDraftAnswers: (
    attemptId: number,
    answers: Array<
      | {
          questionId?: number;
          questionNumber?: number;
          selectedOptionId?: number | string | null;
          selectedOptionKey?: string;
          textAnswer?: string;
        }
      | { no: number; qtype: string; answer: string; questionId?: number }
    >
  ) => api.post<{ ok: boolean; attemptId: number }>(`/student/exams/attempts/${attemptId}/draft-answers`, { answers }),
  getMyExamResults: (params?: { type?: "quiz" | "exam"; published_only?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.type) sp.set("type", params.type);
    if (params?.published_only) sp.set("published_only", "1");
    const qs = sp.toString();
    return api.get<{
      attemptId: number;
      examId: number;
      examTitle: string;
      examType: string;
      title: string;
      status: string;
      is_result_published: boolean;
      autoScore?: number | null;
      manualScore?: number | null;
      totalScore?: number | null;
      score?: number | null;
      maxScore: number;
      submittedAt?: string | null;
      finishedAt?: string | null;
    }[]>(`/student/exams/my-results${qs ? `?${qs}` : ""}`);
  },
  startExam: (examId: number) =>
    api.post<{
      attemptId: number;
      examId: number;
      title: string;
      status?: string;
      startedAt?: string;
      expiresAt?: string;
      endTime: string;
      questions: {
        examQuestionId: number;
        questionId: number;
        order: number;
        text: string;
        type: string;
        options: { id: number; text: string; order: number }[];
      }[];
      canvases?: { canvasId: number; questionId: number; imageUrl: string | null; updatedAt: string }[];
    }>(`/student/exams/${examId}/start`, {}),
  submitExam: (
    examId: number,
    attemptId: number,
    answers: Array<
      | {
          questionId?: number;
          questionNumber?: number;
          selectedOptionId?: number | string | null;
          selectedOptionKey?: string;
          textAnswer?: string;
        }
      | { no: number; qtype: string; answer: string; questionId?: number }
    >,
    extra?: { cheatingDetected?: boolean; type?: "quiz" | "exam" }
  ) =>
    api.post<{ attemptId: number; autoScore: number; maxScore: number; finishedAt: string }>(
      `/student/exams/${examId}/submit`,
      {
        attemptId,
        exam_id: examId,
        answers,
        ...(extra?.type ? { type: extra.type } : {}),
        ...(extra?.cheatingDetected ? { cheatingDetected: true } : {}),
      }
    ),
  getExamResult: (
    examId: number,
    attemptId: number,
    params?: { mode?: "score_summary" }
  ) => {
    const sp = new URLSearchParams();
    if (params?.mode) sp.set("mode", params.mode);
    const qs = sp.toString();
    return api.get<{
      attemptId: number;
      examId: number;
      title: string;
      autoScore?: number;
      manualScore?: number;
      score: number;
      totalScore?: number;
      maxScore?: number;
      finishedAt: string;
      contentLocked?: boolean;
      scoreSummaryMode?: boolean;
      questions?: Array<{
        questionNumber?: number;
        questionText?: string;
        questionType?: string;
        yourAnswer?: string;
        correctAnswer?: string;
        points?: number;
        options?: unknown[];
        pendingReview?: boolean;
        isBlank?: boolean;
        status?: string;
        awarded?: number | null;
        max?: number;
        scoreLabel?: string;
        situationSubScores?: Array<{ label: string; awarded?: number | null; max: number; scoreLabel: string }>;
      }>;
      canvases?: Array<{ canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string }>;
      scoreBreakdown?: { pointsFromCorrect: number; penaltyFromWrong: number; situationScore: number; total: number };
    }>(`/student/exams/${examId}/attempts/${attemptId}/result${qs ? `?${qs}` : ""}`);
  },
  saveCanvas: (
    attemptId: number,
    data: {
      questionId?: number;
      situationIndex?: number;
      pageIndex?: number;
      imageBase64?: string;
      canvas_json?: object;
      canvas_snapshot_base64?: string;
      strokes?: unknown;
    }
  ) =>
    api.post<{ canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string }>(
      `/student/exams/attempts/${attemptId}/canvas`,
      data
    ),
  getPdfScribbles: (attemptId: number) =>
    api.get<{ scribbles: { pageIndex: number; drawingData: Record<string, unknown> }[] }>(
      `/student/exams/attempts/${attemptId}/pdf-scribbles`
    ),
  savePdfScribbles: (
    attemptId: number,
    data:
      | { examId: number; pageIndex: number; drawingData: Record<string, unknown> }
      | { examId: number; scribbles: { pageIndex: number; drawingData: Record<string, unknown> }[] }
  ) => {
    const payload = { ...data, exam_id: data.examId, examId: data.examId };
    return api.post<{ saved?: { pageIndex: number; updatedAt: string }[]; pageIndex?: number; updatedAt?: string }>(
      `/student/exams/attempts/${attemptId}/pdf-scribbles`,
      payload
    );
  },
  /** Full scratchpad snapshot: attempt = student session; examId must match attempt (server-validated). */
  upsertScratchpad: (
    attemptId: number,
    body: { examId: number; scribbles: { pageIndex: number; drawingData: Record<string, unknown> }[] }
  ) =>
    api.put<{ saved?: { pageIndex: number; updatedAt: string }[] }>(
      `/student/exams/attempts/${attemptId}/upsert-scratchpad`,
      { exam_id: body.examId, examId: body.examId, scribbles: body.scribbles }
    ),
  suspendExam: (
    payload: {
      runId: number;
      attemptId: number;
      answers?: {
        questionId?: number;
        questionNumber?: number;
        selectedOptionId?: number | string | null;
        selectedOptionKey?: string;
        textAnswer?: string;
      }[];
      canvases?: {
        questionId?: number;
        situationIndex?: number;
        canvas_json?: object;
        canvas_snapshot_base64?: string;
      }[];
    }
  ) =>
    api.post<{ ok: boolean; runId: number; status: string; suspendedAt?: string | null }>(
      "/student/exams/suspend",
      payload
    ),
};
