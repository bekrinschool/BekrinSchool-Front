import { api } from "./api";
import { API_BASE_URL } from "./constants";

export interface Student {
  id: string;
  userId?: number;
  email: string;
  fullName: string;
  class?: string;
  phone?: string;
  balance: number;
  status?: "active" | "deleted";
}

/** Weekday numbers: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7 */
export const LESSON_DAY_LABELS: Record<number, string> = {
  1: "B.e",   // Bazar ertəsi (Mon)
  2: "Ç.a",   // Çərşənbə axşamı (Tue)
  3: "Ç",     // Çərşənbə (Wed)
  4: "C.a",   // Cümə axşamı (Thu)
  5: "C",     // Cümə (Fri)
  6: "Ş",     // Şənbə (Sat)
  7: "B",     // Bazar (Sun)
};

/** Derive compact day label from lesson_days (Mon=1..Sun=7). "1-4" = days 1 and 4 only. */
export function deriveDisplayNameFromDays(days: number[], startTime?: string | null): string {
  if (!days?.length) return "";
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const dayPart = sorted.join("-");
  if (startTime) {
    const t = startTime.replace(/^(\d{1,2}):(\d{2}).*/, "$1:$2");
    return `${dayPart} ${t}`.trim();
  }
  return dayPart;
}

export interface Group {
  id: string;
  name: string;
  display_name?: string | null;
  display_name_is_manual?: boolean;
  lesson_days?: number[];
  start_time?: string | null;
  studentCount?: number;
  active?: boolean;
  order?: number;
  monthly_fee?: number | null;
  monthly_lessons_count?: number;
}

export interface Payment {
  id: string;
  studentId: string;
  studentName?: string;
  groupId?: string;
  groupName?: string;
  amount: number;
  date: string;
  method: "cash" | "card" | "bank";
  status: "paid" | "pending";
  note?: string;
  paymentNumber?: string;
  sequenceNumber?: number | null;
}

export interface Notification {
  id: number;
  type: "BALANCE_ZERO" | "BALANCE_LOW" | "EXAM_RESULT_PUBLISHED" | "EXAM_SUSPENDED";
  student?: { id: number; fullName: string } | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface TeacherStats {
  totalStudents: number;
  activeStudents: number;
  todayAttendance: number;
  codingExercisesCount: number;
  /** Count of students with real balance below zero (lesson overdraft) */
  negativeBalanceStudents?: number;
}

/** Low-balance alert for teacher dashboard (balance_real <= 0). */
export interface LowBalanceNotification {
  studentId: string;
  fullName: string;
  grade: string;
  displayBalanceTeacher: number;
  realBalance: number;
  reason: string;
  groupId?: string | null;
  groupName?: string | null;
  lastLessonDate?: string | null;
}

export const teacherApi = {
  getStats: () => api.get<TeacherStats>("/teacher/stats"),

  getLowBalanceNotifications: () =>
    api.get<{ items: LowBalanceNotification[]; unread_count: number }>("/teacher/notifications/low-balance"),
  
  getNotifications: () =>
    api.get<{ notifications: Notification[]; unread_count: number }>("/teacher/notifications/"),
  
  getNotificationsCount: () =>
    api.get<{ count: number }>("/teacher/notifications/count/"),
  
  markNotificationRead: (notificationId: number) =>
    api.post(`/teacher/notifications/${notificationId}/read/`),
  markAllNotificationsRead: () =>
    api.post<{ detail: string }>(`/teacher/notifications/mark-all-read/`, {}),
  
  getStudents: (
    status?: "active" | "deleted",
    search?: string,
    signal?: AbortSignal
  ) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (search?.trim()) p.set("search", search.trim());
    const qs = p.toString();
    return api.get<Student[]>(`/teacher/students${qs ? `?${qs}` : ""}`, {
      signal,
    });
  },

  createStudent: (data: {
    fullName: string;
    class?: string;
    phone?: string;
    balance?: number;
  }) =>
    api.post<Student & {
      credentials?: {
        studentEmail: string;
        studentPassword: string;
        parentEmail: string;
        parentPassword: string;
      };
    }>("/teacher/students", data),
  
  updateStudent: (id: string, data: Partial<Student>) =>
    api.patch<Student>(`/teacher/students/${id}`, data),
  
  deleteStudent: (id: string) => api.delete(`/teacher/students/${id}`),

  restoreStudent: (id: string) => api.post<Student>(`/teacher/students/${id}/restore`),

  hardDeleteStudent: (id: string) => api.delete(`/teacher/students/${id}/hard`),
  
  getGroups: () => api.get<Group[]>("/teacher/groups"),

  impersonateStudent: (studentUserId: number) =>
    api.post<{ accessToken: string; user: { email: string; fullName: string; role: "student" | "teacher" | "parent"; mustChangePassword?: boolean } }>(
      `/teacher/impersonate/${studentUserId}`,
      {}
    ),
  stopImpersonation: () =>
    api.post<{ accessToken: string; user: { email: string; fullName: string; role: "student" | "teacher" | "parent"; mustChangePassword?: boolean } }>(
      "/teacher/stop-impersonation",
      {}
    ),
  
  createGroup: (data: { name: string; lesson_days?: number[]; start_time?: string | null; display_name?: string | null; display_name_is_manual?: boolean; monthly_fee?: number | null; monthly_lessons_count?: number }) =>
    api.post<Group>("/teacher/groups", data),
  
  updateGroup: (id: string, data: Partial<Group>) =>
    api.patch<Group>(`/teacher/groups/${id}`, data),
  
  deleteGroup: (id: string) => api.delete(`/teacher/groups/${id}`),
  
  addStudentsToGroup: (groupId: string, studentIds: string[]) =>
    api.post(`/teacher/groups/${groupId}/students`, { studentIds }),
  
  removeStudentFromGroup: (groupId: string, studentId: string) =>
    api.delete(`/teacher/groups/${groupId}/students/${studentId}`),
  
  moveStudent: (studentId: string, fromGroupId: string, toGroupId: string) =>
    api.post("/teacher/groups/move-student", {
      studentId,
      fromGroupId,
      toGroupId,
    }),
  
  getPayments: (params?: { groupId?: string; studentId?: string }) => {
    const query = new URLSearchParams();
    if (params?.groupId && params.groupId !== "all") query.append("groupId", params.groupId);
    if (params?.studentId && params.studentId !== "all") query.append("studentId", params.studentId);
    const queryString = query.toString();
    return api.get<Payment[]>(`/teacher/payments${queryString ? `?${queryString}` : ""}`);
  },
  
  createPayment: (data: {
    studentId: string;
    groupId?: string;
    amount: number;
    date: string;
    method: "cash" | "card" | "bank";
    status: "paid" | "pending";
    note?: string;
  }) => api.post<Payment>("/teacher/payments", data),
  
  deletePayment: (id: string) => api.delete(`/teacher/payments/${id}`),

  // Attendance
  getAttendanceGrid: (year: number, month: number) =>
    api.get<AttendanceGrid>(`/teacher/attendance?year=${year}&month=${month}`),
  updateAttendance: (data: {
    groupId: string;
    studentId: string;
    date: string;
    status: "present" | "absent" | "late" | "excused";
  }) => api.post("/teacher/attendance/update", data),

  // New attendance endpoints
  getAttendanceGridNew: (params: { groupId: string; from: string; to: string }) => {
    const sp = new URLSearchParams();
    sp.set("groupId", params.groupId);
    sp.set("from", params.from);
    sp.set("to", params.to);
    return api.get<AttendanceGridNew>(`/teacher/attendance/grid?${sp.toString()}`);
  },
  bulkUpsertAttendance: (data: {
    groupId: string;
    items: { studentId: string; date: string; status: AttendanceStatus }[];
    entry_state?: AttendanceEntryState;
  }) => api.post<{ saved: number; entry_state?: AttendanceEntryState; items: { studentId: string; date: string; status: string; entry_state?: AttendanceEntryState }[] }>("/teacher/attendance/bulk-upsert", data),
  bulkDeleteAttendance: (data: {
    groupId: string;
    items: { studentId: string; date: string }[];
  }) => api.post<{ deleted: number }>("/teacher/attendance/bulk-delete", data),
  getAttendanceMonthlyNew: (params: { groupId: string; month: string }) => {
    const sp = new URLSearchParams();
    sp.set("groupId", params.groupId);
    sp.set("month", params.month);
    return api.get<AttendanceMonthlyNew>(`/teacher/attendance/monthly?${sp.toString()}`);
  },
  markAllPresentForDate: (data: { groupId: string; date: string }) =>
    api.post<{ saved: number; items: { student_id: string; date: string; status: string }[] }>(
      "/teacher/attendance/mark-all-present",
      data
    ),
  getAttendanceDaily: (groupId: string, date: string) =>
    api.get<AttendanceDaily>(`/teacher/attendance/group/${groupId}/daily?date=${date}`),
  saveAttendance: (data: {
    date: string;
    groupId: string;
    records: { studentId: string; status: "present" | "absent" | "late" | "excused" }[];
    finalize?: boolean;
    entry_state?: AttendanceEntryState;
  }) => api.post<{ ok: boolean; date: string; groupId: string; saved: boolean; charged: boolean; charged_count: number; delivered_marked: boolean; entry_state?: AttendanceEntryState; charged_students?: Array<{studentId: string; oldBalance: number; newBalance: number; chargeAmount: number}>; message: string }>("/teacher/attendance/save", data),
  getAttendanceMonthly: (groupId: string, year: number, month: number) =>
    api.get<AttendanceMonthly>(
      `/teacher/attendance/group/${groupId}/monthly?year=${year}&month=${month}`
    ),
  getStudentDailyBreakdown: (
    groupId: string,
    studentId: string,
    year: number,
    month: number
  ) =>
    api.get<{
      studentId: string;
      year: number;
      month: number;
      records: { date: string; status: string | null }[];
    }>(
      `/teacher/attendance/group/${groupId}/student/${studentId}/daily?year=${year}&month=${month}`
    ),
  finalizeLesson: (data: { groupId: string; date: string }) =>
    api.post<{ ok: boolean; lesson_finalized: boolean; students_charged: number; charge_details: Array<{studentId: string; oldBalance: number; newBalance: number; chargeAmount: number}>; message: string }>("/teacher/lessons/finalize", data),
  unlockLesson: (data: { groupId: string; date: string }) =>
    api.post<{ ok: boolean; message: string }>("/teacher/lessons/unlock", data),

  // Groups - students in group
  getGroupStudents: (groupId: string) =>
    api.get<Student[]>(`/teacher/groups/${groupId}/students`),

  // Coding
  getCodingTopics: () => api.get<CodingTopic[]>("/teacher/coding/topics"),
  createCodingTopic: (data: { name: string }) => api.post<CodingTopic>("/teacher/coding/topics", data),
  getCodingTasks: (params?: { topic_id?: string; q?: string; archived?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.topic_id) sp.set("topic_id", params.topic_id);
    if (params?.q) sp.set("q", params.q);
    if (params?.archived) sp.set("archived", "1");
    const qs = sp.toString();
    return api.get<CodingTask[]>(`/teacher/coding${qs ? `?${qs}` : ""}`);
  },
  createCodingTask: (data: Partial<CodingTask>) =>
    api.post<CodingTask>("/teacher/coding", data),
  updateCodingTask: (id: string, data: Partial<CodingTask>) =>
    api.patch<CodingTask>(`/teacher/coding/${id}`, data),
  deleteCodingTask: (id: string) => api.delete(`/teacher/coding/${id}`),
  getCodingTestCases: (taskId: string) =>
    api.get<CodingTestCase[]>(`/teacher/coding/${taskId}/testcases`),
  createCodingTestCase: (taskId: string, data: { input_data: string; expected?: string; expected_output?: string; explanation?: string; order_index?: number; is_sample?: boolean }) =>
    api.post<CodingTestCase>(`/teacher/coding/${taskId}/testcases`, data),
  updateCodingTestCase: (caseId: number, data: Partial<CodingTestCase>) =>
    api.patch<CodingTestCase>(`/teacher/coding/testcases/${caseId}`, data),
  deleteCodingTestCase: (caseId: number) =>
    api.delete(`/teacher/coding/testcases/${caseId}`),

  /** Bulk import: POST body { tasks: ImportCodingTask[], topic_id?: number } */
  importCodingTasksJson: (body: { tasks: ImportCodingTask[]; topic_id?: number }) =>
    api.post<{ message: string; imported_count: number }>("/teacher/coding/import-json", body),

  /** Export: GET ?task_ids=1,2,3 returns { tasks: ExportCodingTask[] } */
  exportCodingTasksJson: (taskIds: number[]) => {
    const qs = taskIds.length ? `?task_ids=${taskIds.join(",")}` : "";
    return api.get<{ tasks: ExportCodingTask[] }>(`/teacher/coding/export-json${qs}`);
  },

  // Coding Monitor
  getCodingMonitor: (params?: { groupId?: string; topic?: string; search?: string; page?: number; page_size?: number; sort?: string; include_run?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.groupId && params.groupId !== "all") sp.set("groupId", params.groupId);
    if (params?.topic) sp.set("topic", params.topic);
    if (params?.search) sp.set("search", params.search);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    if (params?.sort) sp.set("sort", params.sort);
    if (params?.include_run) sp.set("include_run", "1");
    const qs = sp.toString();
    return api.get<{
      ranking: {
        student: Student;
        groupName?: string;
        totalTasksSolved: number;
        totalAttempts: number;
        perTaskAttemptCount: Record<string, number>;
      }[];
      submissions: { count: number; next: number | null; previous: number | null; results: CodingSubmission[] };
    }>(`/teacher/coding-monitor${qs ? `?${qs}` : ""}`);
  },
  getCodingSubmissions: (params?: { taskId?: string; groupId?: string; studentId?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.taskId) sp.set("taskId", params.taskId);
    if (params?.groupId && params.groupId !== "all") sp.set("groupId", params.groupId);
    if (params?.studentId && params.studentId !== "all") sp.set("studentId", params.studentId);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{
      count: number;
      page: number;
      pageSize: number;
      next: number | null;
      previous: number | null;
      results: { id: string; taskId: string; taskTitle: string; topicName?: string; studentId: string; studentName: string; status: string; score?: number; passedCount?: number; failedCount?: number; attemptNo?: number; createdAt: string }[];
    }>(`/teacher/coding/submissions${qs ? `?${qs}` : ""}`);
  },
  getCodingSubmissionDetail: (id: string) =>
    api.get<{
      id: string;
      taskId: string;
      taskTitle: string;
      topicName?: string;
      studentId: string;
      studentName: string;
      submittedCode: string;
      status: string;
      score?: number;
      passedCount?: number;
      failedCount?: number;
      errorMessage?: string;
      runtimeMs?: number;
      attemptNo?: number;
      createdAt: string;
      detailsJson: { test_case_id: number; is_sample: boolean; passed: boolean; output?: string; expected?: string }[];
    }>(`/teacher/coding/submissions/${id}`),
  getStudentSubmissions: (studentId: string, params?: { topic?: string; taskId?: string; group_id?: string; page?: number; page_size?: number; include_run?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.topic) sp.set("topic", params.topic ?? "");
    if (params?.taskId) sp.set("taskId", params.taskId ?? "");
    if (params?.group_id) sp.set("group_id", params.group_id);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    if (params?.include_run) sp.set("include_run", "1");
    const qs = sp.toString();
    return api.get<{
      studentId: string;
      studentName: string;
      submissions: {
        id: string;
        taskId: string;
        taskTitle: string;
        topicName?: string;
        submittedCode: string;
        status: string;
        runType?: "RUN" | "SUBMIT";
        passedCount?: number;
        totalCount?: number;
        score?: number;
        failedCount?: number;
        errorMessage?: string;
        runtimeMs?: number;
        attemptNo?: number;
        createdAt: string;
        detailsJson?: { test_case_id: number; is_sample: boolean; passed: boolean; output?: string; expected?: string }[];
      }[];
    }>(`/teacher/coding/student/${studentId}/submissions${qs ? `?${qs}` : ""}`);
  },

  // Question Bank & Exams
  getQuestionTopics: () => api.get<{ id: number; name: string; order: number; is_active: boolean }[]>("/teacher/question-topics"),
  createQuestionTopic: (data: { name: string; order?: number }) => api.post<{ id: number; name: string; order: number; is_active: boolean }>("/teacher/question-topics", data),
  deleteQuestionTopic: (id: number) => api.delete(`/teacher/question-topics/${id}`),
  getQuestions: (params?: { topic?: string; type?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.topic) sp.set("topic", params.topic);
    if (params?.type) sp.set("type", params.type);
    if (params?.q) sp.set("q", params.q);
    const qs = sp.toString();
    return api.get<QuestionBankItem[]>(`/teacher/questions${qs ? `?${qs}` : ""}`);
  },
  createQuestion: (data: QuestionBankCreate) => {
    const hasQuestionImage = !!data.question_image;
    const hasOptionFiles = data.option_image_files?.some((f) => f instanceof File);
    if (hasQuestionImage || hasOptionFiles) {
      const fd = new FormData();
      fd.append("topic", String(data.topic));
      fd.append("short_title", data.short_title);
      fd.append("text", data.text);
      fd.append("type", data.type);
      if (data.is_active !== undefined) fd.append("is_active", String(data.is_active));
      if (data.mc_option_display) fd.append("mc_option_display", data.mc_option_display);
      if (data.options?.length) fd.append("options", JSON.stringify(data.options));
      // Must be valid JSON: DRF JSONField on multipart uses json.loads() when the value is treated as a JSON string.
      if (data.correct_answer !== undefined) fd.append("correct_answer", JSON.stringify(data.correct_answer));
      if (data.answer_rule_type) fd.append("answer_rule_type", data.answer_rule_type);
      if (data.question_image) fd.append("question_image", data.question_image);
      data.option_image_files?.forEach((f, i) => {
        if (f) fd.append(`option_image_${i}`, f);
      });
      return api.post<QuestionBankItem>("/teacher/questions", fd);
    }
    const { question_image: _, option_image_files: __, ...rest } = data;
    return api.post<QuestionBankItem>("/teacher/questions", rest);
  },
  updateQuestion: (id: number, data: Partial<QuestionBankItem> & { question_image?: File | null; option_image_files?: (File | null | undefined)[] }) => {
    const hasQuestionImage = !!data.question_image;
    const hasOptionFiles = data.option_image_files?.some((f) => f instanceof File);
    if (hasQuestionImage || hasOptionFiles) {
      const fd = new FormData();
      if (data.short_title !== undefined) fd.append("short_title", data.short_title);
      if (data.text !== undefined) fd.append("text", data.text);
      if (data.type !== undefined) fd.append("type", data.type);
      if (data.topic !== undefined) fd.append("topic", String(data.topic));
      if (data.mc_option_display !== undefined) fd.append("mc_option_display", data.mc_option_display);
      if (data.options !== undefined) fd.append("options", JSON.stringify(data.options));
      if (data.correct_answer !== undefined) fd.append("correct_answer", JSON.stringify(data.correct_answer));
      if (data.answer_rule_type !== undefined) fd.append("answer_rule_type", data.answer_rule_type ?? "");
      if (data.is_active !== undefined) fd.append("is_active", String(data.is_active));
      if (data.question_image) fd.append("question_image", data.question_image);
      data.option_image_files?.forEach((f, i) => {
        if (f) fd.append(`option_image_${i}`, f);
      });
      return api.patch<QuestionBankItem>(`/teacher/questions/${id}`, fd);
    }
    const { question_image: __, option_image_files: ___, ...rest } = data;
    return api.patch<QuestionBankItem>(`/teacher/questions/${id}`, rest);
  },
  deleteQuestion: (id: number) => api.delete(`/teacher/questions/${id}`),
  bulkDeleteQuestions: (ids: number[]) =>
    api.post<{ deleted: number; message: string }>("/teacher/questions/bulk-delete", { ids }),
  getExams: () => api.get<ExamListItem[]>("/teacher/exams"),
  createExam: (data: ExamCreate) => api.post<ExamListItem>("/teacher/exams", data),
  updateExam: (id: number, data: Partial<ExamListItem>) => api.patch<ExamListItem>(`/teacher/exams/${id}`, data),
  /** Soft-delete exam (status deleted, hidden from students). */
  deleteExam: (id: number) => api.delete(`/teacher/exams/${id}`),
  restoreExam: (id: number) => api.post<{ id: number; message: string }>(`/teacher/exams/${id}/restore`, {}),
  hardDeleteExam: (id: number, force?: boolean) =>
    api.delete(`/teacher/exams/${id}/hard-delete${force ? "?force=true" : ""}`),
  getArchiveExams: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: ExamListItem[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/exams${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveQuestions: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: QuestionBankItem[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/questions${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveQuestionTopics: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: { id: number; name: string }[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/question-topics${qs ? `?${qs}` : ""}`
    );
  },
  getArchivePdfs: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: TeacherPDF[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/pdfs${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveCodingTopics: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: { id: number; name: string }[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/coding-topics${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveCodingTasks: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: CodingTask[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/coding-tasks${qs ? `?${qs}` : ""}`
    );
  },
  getArchivePayments: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: Payment[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/payments${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveGroups: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: Group[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/groups${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveStudents: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: Student[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/students${qs ? `?${qs}` : ""}`
    );
  },
  restorePayment: (id: number) => api.post<Payment>(`/teacher/payments/${id}/restore`, {}),
  restoreGroup: (id: number) => api.post<Group>(`/teacher/groups/${id}/restore`, {}),
  restoreCodingTopic: (id: number) => api.post<{ id: number; message: string }>(`/teacher/coding/topics/${id}/restore`, {}),
  hardDeleteCodingTopic: (id: number) => api.delete(`/teacher/coding/topics/${id}/hard-delete`),
  restoreCodingTask: (id: number) => api.post<{ id: number; message: string }>(`/teacher/coding/${id}/restore`, {}),
  hardDeleteCodingTask: (id: number) => api.delete(`/teacher/coding/${id}/hard-delete`),
  restoreQuestionTopic: (id: number) => api.post<{ id: number; message: string }>(`/teacher/question-topics/${id}/restore`, {}),
  hardDeleteQuestionTopic: (id: number) => api.delete(`/teacher/question-topics/${id}/hard-delete`),
  restoreQuestion: (id: number) => api.post<{ id: number; message: string }>(`/teacher/questions/${id}/restore`, {}),
  hardDeleteQuestion: (id: number) => api.delete(`/teacher/questions/${id}/hard-delete`),
  restorePdf: (id: number) => api.post<{ id: number; message: string }>(`/teacher/pdfs/${id}/restore`, {}),
  hardDeletePdf: (id: number) => api.delete(`/teacher/pdfs/${id}/hard-delete`),
  bulkDeleteExams: (ids: number[]) => api.post<{ deleted: number; message: string }>(`/teacher/archive/exams/bulk-delete`, { ids }),
  bulkDeletePdfs: (ids: number[]) => api.post<{ deleted: number; message: string }>(`/teacher/archive/pdfs/bulk-delete`, { ids }),
  /** Unified archive bulk delete (archived items only). Body: { category, ids: number[] } */
  archiveBulkDelete: (
    category: string,
    ids: number[]
  ) =>
    api.delete<{ deleted: number; message?: string; errors?: { type?: string; id?: number; detail?: string }[] }>(
      `/teacher/archive/bulk`,
      { body: { category, ids } }
    ),
  getExamDetail: (id: number) => api.get<ExamDetail>(`/teacher/exams/${id}`),
  activateExam: (examId: number, data: { start_time: string; duration_minutes: number }) =>
    api.post<ExamListItem>(`/teacher/exams/${examId}/activate`, data),
  createExamRun: (examId: number, data: { groupId?: number; studentId?: number; duration_minutes: number; start_now?: boolean }) =>
    api.post<{ runId: number; start_at: string; end_at: string; duration_minutes: number }>(`/teacher/exams/${examId}/create-run`, data),
  getExamRuns: (examId: number) => api.get<ExamRunItem[]>(`/teacher/exams/${examId}/runs`),
  getRunAttempts: (runId: number) =>
    api.get<{
      attempts: ExamAttempt[];
      summary?: { averageScore?: number | null; totalStudents: number; gradedCount: number };
      group_aggregate?: { total_members: number; submitted_count: number; average_score?: number | null; sum_score: number };
    }>(`/teacher/runs/${runId}/attempts`),
  resetRunStudent: (runId: number, studentId: number) => api.post<{ message: string; studentId: number; runId: number }>(`/teacher/runs/${runId}/reset-student`, { studentId }),
  addExamQuestion: (examId: number, questionId: number) => api.post(`/teacher/exams/${examId}/questions`, { question_id: questionId }),
  removeExamQuestion: (examId: number, questionId: number) => api.delete(`/teacher/exams/${examId}/questions/${questionId}`),
  assignExamToGroups: (examId: number, groupIds: number[]) => api.post(`/teacher/exams/${examId}/assign`, { groupIds }),
  startExamNow: (examId: number, data: { groupIds?: number[]; studentId?: number; studentIds?: number[]; durationMinutes: number; startTime?: string }) =>
    api.post(`/teacher/exams/${examId}/start-now`, data),
  stopExam: (examId: number) => api.post(`/teacher/exams/${examId}/stop`),
  getActiveRuns: (params?: { status?: "active" | "scheduled" | ""; type?: "quiz" | "exam" | ""; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    if (params?.type) sp.set("type", params.type);
    if (params?.q && String(params.q).trim() !== "") sp.set("q", params.q);
    const qs = sp.toString();
    return api.get<ActiveRunItem[]>(`/teacher/active-runs${qs ? `?${qs}` : ""}`);
  },
  getFinishedRuns: (params?: { group_id?: number; student_id?: number; q?: string; page?: number; page_size?: number }) => {
    const sp = new URLSearchParams();
    if (params?.group_id != null) sp.set("group_id", String(params.group_id));
    if (params?.student_id != null) sp.set("student_id", String(params.student_id));
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    const qs = sp.toString();
    return api.get<{ items: FinishedRunItem[]; meta: { page: number; page_size: number; total: number; has_next: boolean } }>(
      `/teacher/finished-runs${qs ? `?${qs}` : ""}`
    );
  },
  stopRun: (runId: number) => api.post(`/teacher/runs/${runId}/stop`),
  deleteRunFromHistory: (runId: number) =>
    api.post<{ ok: boolean; runId: number; message: string }>(`/teacher/runs/${runId}/history-delete`, {}),
  /** Hide one student's submitted result from Köhnə/Nəticələr (does not delete Exam or run). */
  deleteAttemptResultSession: (attemptId: number) =>
    api.post<{ ok: boolean; attemptId: number; message: string }>(`/teacher/attempts/${attemptId}/result-session-delete`, {}),
  updateRun: (runId: number, data: { duration_minutes?: number; start_at?: string }) =>
    api.patch<{ flashEndTriggered?: boolean; bulkSubmittedCount?: number }>(`/teacher/runs/${runId}`, data),
  getExamAttempts: (examId: number, params?: { groupId?: string; status?: string; showArchived?: boolean; gradingQueueOnly?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.groupId && params.groupId !== "all") sp.set("groupId", params.groupId);
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.showArchived) sp.set("showArchived", "true");
    if (params?.gradingQueueOnly) sp.set("gradingQueueOnly", "1");
    const qs = sp.toString();
    return api.get<GradingAttemptsResponse>(`/teacher/exams/${examId}/attempts${qs ? `?${qs}` : ""}`);
  },
  /** List attempts for grading across all (or selected) exams. Use when no specific exam is selected. */
  getGradingAttempts: (params?: { groupId?: string; status?: string; showArchived?: boolean; examIds?: number[] }) => {
    const sp = new URLSearchParams();
    if (params?.groupId && params.groupId !== "all") sp.set("groupId", params.groupId);
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.showArchived) sp.set("showArchived", "true");
    if (params?.examIds?.length) params.examIds.forEach((id) => sp.append("examId", String(id)));
    const qs = sp.toString();
    return api.get<GradingAttemptsResponse>(`/teacher/grading/attempts${qs ? `?${qs}` : ""}`);
  },
  examAttemptsCleanup: (examId: number, data: { scope: "exam" | "group" | "student"; group_id?: number; student_id?: number; only_unpublished?: boolean }) =>
    api.post<{ archived: number; message: string }>(`/teacher/exams/${examId}/attempts/cleanup`, data),
  publishRun: (runId: number) =>
    api.post<{ publishedCount: number; runPublished: boolean; publishedAt?: string; message: string }>(`/teacher/runs/${runId}/publish`),
  publishExamGroupResults: (examId: number, groupId: number) =>
    api.post<{ publishedCount: number; message: string }>(`/teacher/exams/${examId}/groups/${groupId}/publish`),
  publishExamAll: (examId: number) =>
    api.post<{ publishedCount: number; runsUpdated: number; message: string }>(`/teacher/exams/${examId}/publish-all`),
  getAttemptDetail: (attemptId: number) => api.get<ExamAttemptDetail>(`/teacher/attempts/${attemptId}`),
  gradeAttempt: (attemptId: number, data: {
    manualScores?: Record<string, number>;
    /** index = 1-based order of situation answers (question_number order). Use fraction (SET2) or manual_score (raw points). */
    per_situation_scores?: { index: number; fraction?: number | string; manual_score?: number; points?: number }[];
    /** explicit single-answer save payload for source-agnostic situation save */
    student_answer_id?: number;
    score?: number;
    teacher_notes?: string;
    exam_run_id?: number | null;
    publish?: boolean;
    notes?: string;
  }) =>
    api.post<{ attemptId: number; manualScore: number; autoScore: number; finalScore: number; isPublished: boolean }>(`/teacher/attempts/${attemptId}/grade`, data),
  publishAttempt: (attemptId: number, publish: boolean) => api.post(`/teacher/attempts/${attemptId}/publish`, { publish }),
  restartAttempt: (attemptId: number, durationMinutes?: number) =>
    api.post<{ message: string; studentId: number; durationMinutes: number; endTime: string }>(
      `/teacher/attempts/${attemptId}/restart`,
      { durationMinutes: durationMinutes ?? 60 }
    ),
  continueAttempt: (attemptId: number) =>
    api.post<{ message: string; attemptId: number }>(`/teacher/attempts/${attemptId}/continue`, {}),
  cancelAttempt: (attemptId: number) =>
    api.post<{ message: string }>(`/teacher/attempts/${attemptId}/cancel`, {}),
  resetStudent: (examId: number, studentId: number, durationMinutes?: number) =>
    api.post<{ message: string; studentId: number; durationMinutes: number; endTime: string }>(
      `/teacher/exams/${examId}/reset-student`,
      { studentId, durationMinutes: durationMinutes ?? 60 }
    ),
  reopenAttempt: (attemptId: number) => api.post(`/teacher/attempts/${attemptId}/reopen`),
  getPDFs: (params?: { q?: string; year?: string; tag?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.year) sp.set("year", params.year);
    if (params?.tag) sp.set("tag", params.tag);
    const qs = sp.toString();
    return api.get<TeacherPDF[]>(`/teacher/pdfs${qs ? `?${qs}` : ""}`);
  },
  uploadPDF: (file: File, data: { title?: string; year?: number; tags?: string[]; source?: string }) => {
    const formData = new FormData();
    formData.append("file", file);
    if (data.title) formData.append("title", data.title);
    if (data.year) formData.append("year", String(data.year));
    if (data.tags && data.tags.length > 0) {
      formData.append("tags", JSON.stringify(data.tags));
    }
    if (data.source) formData.append("source", data.source);
    return api.post<TeacherPDF>("/teacher/pdfs", formData);
  },
  updatePDF: (id: number, data: Partial<TeacherPDF>) => api.patch<TeacherPDF>(`/teacher/pdfs/${id}`, data),
  deletePDF: (id: number) => api.delete(`/teacher/pdfs/${id}`),

  // Tests (legacy)
  getTests: () =>
    api.get<{ tests: Test[]; results: TestResult[] }>("/teacher/tests"),
  createTest: (data: Partial<Test>) =>
    api.post<Test>("/teacher/tests", data),
  createTestResult: (data: {
    studentProfileId: number;
    groupId?: number;
    testName: string;
    maxScore: number;
    score: number;
    date: string;
  }) => api.post("/teacher/test-results", data),

  // Bulk Import - preview then confirm
  bulkImportPreview: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<{
      preview: {
        row: number;
        fullName: string;
        grade: string | null;
        phone: string | null;
        status: "valid" | "invalid" | "duplicate_in_file" | "duplicate_in_db";
        message: string | null;
      }[];
      summary: { total: number; valid: number; invalid: number; duplicateInFile: number; duplicateInDb: number };
      validRows: { full_name: string; grade?: string | null; phone?: string | null }[];
    }>("/teacher/bulk-import/preview", formData);
  },
  bulkImportConfirm: (rows: { full_name: string; grade?: string | null; phone?: string | null }[]) => {
    return api.post<{
      created: number;
      errors: string[];
      credentials: {
        fullName: string;
        studentEmail: string;
        studentPassword: string;
        parentEmail: string;
        parentPassword: string;
      }[];
    }>("/teacher/bulk-import/confirm", { rows });
  },

  // Bulk import users (new format: fullName, grade, studentEmail, parentEmail, password)
  bulkImportUsers: (data: { file?: File; csvText?: string }) => {
    if (data.file) {
      const formData = new FormData();
      formData.append("file", data.file);
      return api.post<{
        created: number;
        skipped: number;
        errors: { row: number; field: string; message: string }[];
        credentials: { fullName: string; studentEmail: string; parentEmail: string; password: string }[];
      }>("/teacher/bulk-import/users", formData);
    }
    return api.post<{
      created: number;
      skipped: number;
      errors: { row: number; field: string; message: string }[];
      credentials: { fullName: string; studentEmail: string; parentEmail: string; password: string }[];
    }>("/teacher/bulk-import/users", { csvText: data.csvText });
  },
  getBulkImportTemplate: async () => {
    const res = await fetch(`${API_BASE_URL}/teacher/bulk-import/template-csv`, {
      credentials: "include",
      headers: { Cookie: document.cookie },
    });
    if (!res.ok) throw new Error("Template yüklənə bilmədi");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  },
  userRevealPassword: (userId: string) =>
    api.post<{ password: string; revealed: boolean; message?: string }>(
      `/teacher/users/${userId}/reveal-password`
    ),
  userResetPassword: (userId: string) =>
    api.post<{ password: string; message?: string }>(
      `/teacher/users/${userId}/reset-password`
    ),

  // Credentials registry (imported account credentials)
  getCredentials: (
    params?: { groupId?: string; search?: string; page?: number; pageSize?: number },
    signal?: AbortSignal
  ) => {
    const sp = new URLSearchParams();
    if (params?.groupId && params.groupId !== "all") sp.set("group_id", params.groupId);
    if (params?.search) sp.set("search", params.search);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.pageSize != null) sp.set("page_size", String(params.pageSize));
    const qs = sp.toString();
    return api.get<{
      count: number;
      next: string | null;
      previous: string | null;
      results: CredentialRecord[];
    }>(`/teacher/credentials${qs ? `?${qs}` : ""}`, { signal });
  },
  revealCredential: (id: number) =>
    api.post<CredentialRecord & { studentPassword?: string; parentPassword?: string }>(
      `/teacher/credentials/${id}/reveal`
    ),
  exportCredentialsCsv: async (params?: { groupId?: string; search?: string }) => {
    const sp = new URLSearchParams();
    if (params?.groupId && params.groupId !== "all") sp.set("group_id", params.groupId);
    if (params?.search) sp.set("search", params.search);
    const qs = sp.toString();
    const path = `/teacher/credentials/export.csv${qs ? `?${qs}` : ""}`;
    const blob = await api.getBlob(path);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "credentials_export.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

export interface CredentialRecord {
  id: number;
  studentFullName: string;
  grade: string | null;
  studentEmail: string;
  parentEmail: string;
  groups: string[];
  createdAt: string;
  createdByTeacher: string | null;
}

// Attendance types
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type AttendanceEntryState = "DRAFT" | "CONFIRMED";

export interface AttendanceDaily {
  date: string;
  groupId: string;
  groupName: string;
  students: { id: string; fullName: string; email: string; status: AttendanceStatus; entryState?: AttendanceEntryState }[];
}

export interface AttendanceMonthly {
  year: number;
  month: number;
  groupId: string;
  groupName: string;
  students: {
    id: string;
    fullName: string;
    email: string;
    present: number;
    absent: number;
    late: number;
    excused: number;
    attendancePercent: number;
  }[];
}

export interface AttendanceGrid {
  year: number;
  month: number;
  dates: string[];
  groups: {
    id: string;
    name: string;
    students: {
      id: string;
      fullName: string;
      email: string;
      records: Record<string, "present" | "absent" | "late" | "excused" | null>;
    }[];
  }[];
}

export interface AttendanceGridNew {
  dates: string[];
  students: { id: string; full_name: string }[];
  records: { student_id: string; date: string; status: AttendanceStatus; entry_state?: AttendanceEntryState }[];
}

export interface AttendanceMonthlyNew {
  month: string;
  dates: string[];
  students: { id: string; full_name: string }[];
  records: { student_id: string; date: string; status: AttendanceStatus; entry_state?: AttendanceEntryState }[];
  stats: {
    student_id: string;
    present: number;
    late: number;
    absent: number;
    excused: number;
    missed_count: number;
    missed_percent: number;
  }[];
}

export interface CodingTopic {
  id: number;
  name: string;
}

export interface CodingTask {
  id: string;
  topic?: number | null;
  topic_name?: string | null;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  starter_code?: string;
  points?: number | null;
  is_active?: boolean;
  order_index?: number | null;
  created_at?: string;
}

export interface CodingTestCase {
  id: number;
  input_data: string;
  expected: string;
  expected_output?: string;
  explanation?: string | null;
  order_index?: number | null;
  is_sample?: boolean;
  created_at?: string;
}

/** JSON import format: one task in the tasks array */
export interface ImportCodingTaskTestCase {
  input: string;
  expected_output: string;
  is_hidden?: boolean;
}

export interface ImportCodingTask {
  title: string;
  description?: string;
  initial_code?: string;
  difficulty?: "Easy" | "Medium" | "Hard" | "easy" | "medium" | "hard";
  test_cases: ImportCodingTaskTestCase[];
}

/** JSON export format (same shape for round-trip) */
export interface ExportCodingTask {
  title: string;
  description: string;
  initial_code: string;
  difficulty: string;
  test_cases: { input: string; expected_output: string; is_hidden: boolean }[];
}

export interface CodingSubmission {
  id: string;
  taskTitle: string;
  studentName: string;
  status: string;
  createdAt: string;
  passedCount?: number | null;
  totalCount?: number | null;
}

export interface Test {
  id: string;
  type: "quiz" | "exam";
  title: string;
  pdf_url?: string;
  is_active?: boolean;
}

export interface TestResult {
  id: string;
  testName: string;
  score: number;
  maxScore: number;
  date: string;
  groupName?: string;
}

export interface QuestionBankItem {
  id: number;
  topic: number;
  /** Teacher-only; never exposed to student exam APIs. */
  short_title: string;
  text: string;
  type: string;
  correct_answer?: unknown;
  answer_rule_type?: string | null;
  created_at?: string;
  is_active?: boolean;
  question_image_url?: string | null;
  mc_option_display?: "TEXT" | "IMAGE";
  options?: {
    id: number;
    text: string;
    label?: string;
    is_correct: boolean;
    order: number;
    image_url?: string | null;
  }[];
}

export interface QuestionBankCreate {
  topic: number;
  short_title: string;
  text: string;
  type: string;
  correct_answer?: unknown;
  answer_rule_type?: string | null;
  is_active?: boolean;
  question_image?: File | null;
  mc_option_display?: "TEXT" | "IMAGE";
  options?: {
    id?: number;
    text: string;
    label?: string;
    is_correct: boolean;
    order?: number;
  }[];
  /** Parallel to options[] when uploading new images (multipart). */
  option_image_files?: (File | null | undefined)[];
}

export interface ExamListItem {
  id: number;
  title: string;
  type: "quiz" | "exam";
  source_type?: "BANK" | "PDF" | "JSON";
  start_time?: string | null;
  status: string;
  duration_minutes?: number | null;
  needs_grading?: boolean;
  pdf_file?: string | null;
  pdf_document?: number | null;
  is_result_published?: boolean;
  is_ghost?: boolean;
  is_archived?: boolean;
  created_at?: string;
}

export interface ExamCreate {
  title: string;
  type: "quiz" | "exam";
  source_type?: "BANK" | "PDF" | "JSON";
  status?: string;
  max_score?: number;
  question_ids?: number[];
  pdf_id?: number;
  answer_key_json?: Record<string, unknown>;
  json_import?: Record<string, unknown>;
}

export interface ExamRunItem {
  id: number;
  exam: number;
  group?: number | null;
  student?: number | null;
  group_name?: string | null;
  student_name?: string | null;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  status: string;
  created_at?: string;
  attempt_count?: number;
}

export interface ActiveRunItem {
  runId: number;
  examId: number;
  examTitle: string;
  examType: "quiz" | "exam";
  group_id: number | null;
  groupName: string | null;
  student_id: number | null;
  studentName: string | null;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  status: "active" | "scheduled";
  attempt_count: number;
}

export interface FinishedRunItem {
  runId: number;
  examId: number;
  examTitle: string;
  examType: string;
  group_id: number | null;
  groupName: string | null;
  student_id: number | null;
  studentName: string | null;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  status: string;
  statusLabel: "Yoxlanılır" | "Yayımlanıb";
  attempt_count: number;
  published_count: number;
}

export interface ExamDetailQuestionRow {
  id: number;
  question: number;
  question_text: string;
  question_short_title?: string;
  question_type: string;
  order: number;
  /** Absolute URL when question has an image */
  question_image_url?: string | null;
  mc_option_display?: string | null;
  options?: {
    id: number;
    text: string;
    label?: string;
    order: number;
    image_url?: string | null;
  }[];
}

export interface ExamDetail extends ExamListItem {
  questions?: ExamDetailQuestionRow[];
  assigned_groups?: { id: number; name: string }[];
  duration_minutes?: number;
  pdf_url?: string | null;
  has_answer_key?: boolean;
  question_counts?: { closed: number; open: number; situation: number; total: number } | null;
  /** Teacher-only: Cavab vərəqi panel (PDF/JSON) */
  answer_key_preview?: { number?: number; kind: string; correct?: string; open_answer?: string }[] | null;
  runs?: ExamRunItem[];
}

export interface TeacherPDF {
  id: number;
  title: string;
  file: string;
  file_url?: string;
  original_filename?: string;
  file_size?: number;
  file_size_mb?: number;
  page_count?: number;
  tags?: string[];
  year?: number;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExamAttempt {
  id: number;
  /** Present when attempt belongs to a scheduled run (group / multi / individual session) */
  runId?: number;
  /** Wall-clock end of the run session (for hard-restart guard). */
  runEndAt?: string;
  /** For attempts without a run: exam start_time + duration. */
  examGlobalEndAt?: string | null;
  studentId: number;
  studentName: string;
  groupId?: number;
  groupName?: string;
  status?: string;
  resultReleaseStatus?: "PENDING" | "GRADED" | "PUBLISHED";
  startedAt: string;
  finishedAt?: string;
  submittedAt?: string;
  autoScore: number;
  manualScore?: number;
  finalScore: number;
  maxScore: number;
  manualPendingCount: number;
  isChecked: boolean;
  isPublished: boolean;
}

export type GradingAttemptsResponse = {
  attempts?: ExamAttempt[];
  runs?: Array<{
    runId: number;
    examId: number;
    groupId?: number | null;
    examTitle: string;
    groupName?: string | null;
    studentName?: string | null;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    status: string;
    attemptCount: number;
    attempts: ExamAttempt[];
  }>;
};

export interface ExamAttemptDetail {
  attemptId: number;
  examId: number;
  examTitle: string;
  sourceType: "BANK" | "PDF" | "JSON";
  studentId: number;
  studentName: string;
  runId?: number | null;
  runStatus?: string | null;
  isCheatingDetected?: boolean;
  pdfUrl?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  autoScore: number;
  manualScore?: number | null;
  totalScore?: number;
  maxScore: number;
  totalUnits?: number;
  unitValue?: number;
  countStandard?: number;
  countSituation?: number;
  attemptBlueprint?: Array<{ questionNumber?: number; questionId?: number; kind: string; options?: Array<{ id: string; text: string }>; correctOptionId?: string }> | null;
  /** Same sequence the student saw (BANK shuffle / JSON order); mirrors attempt_blueprint */
  shuffledQuestionOrder?: Array<{ questionId?: number; questionNumber?: number }> | null;
  answers: Array<{
    id: number;
    questionId?: number | null;
    questionNumber?: number | null;
    /** 1-based index in student presentation order (Sual 1, 2, …) */
    presentationOrder?: number | null;
    questionText: string;
    questionType: string;
    selectedOptionId?: number | null;
    selectedOptionKey?: string | null;
    textAnswer?: string | null;
    autoScore: number;
    requiresManualCheck: boolean;
    manualScore?: number | null;
  }>;
  canvases?: Array<{
    canvasId: number;
    questionId?: number | null;
    situationIndex?: number | null;
    imageUrl?: string | null;
    updatedAt: string;
  }>;
  situationScoringSet?: "SET1" | "SET2";
}
