import { api } from "./api";

export interface Child {
  id: string;
  email: string;
  fullName: string;
  class?: string;
  attendancePercent?: number;
  balance: number;
  lastTest?: {
    name: string;
    score: number;
    maxScore: number;
    date: string;
  };
  codingPercent?: number;
  codingSolvedCount?: number;
  codingTotalTasks?: number;
  codingLastActivity?: string | null;
}

export interface ChildAttendance {
  date: string;
  status: "present" | "absent" | "late" | "excused";
  groupName?: string;
}

export interface ChildAttendanceMonthly {
  year: number;
  month: number;
  studentId: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendancePercent: number;
}

export interface ChildPayment {
  id: string;
  amount: number;
  date: string;
  method: "cash" | "card" | "bank";
  status: "paid" | "pending";
  note?: string;
  paymentNumber?: string;
}

export interface ChildTestResult {
  id: string;
  testName: string;
  score: number;
  maxScore: number;
  date: string;
  groupName?: string;
}

export const parentApi = {
  getChildren: () => api.get<Child[]>("/parent/children"),
  
  getChildAttendance: (studentId: string) =>
    api.get<ChildAttendance[]>(`/parent/attendance?studentId=${studentId}`),
  getChildAttendanceMonthly: (
    studentId: string,
    year: number,
    month: number
  ) =>
    api.get<ChildAttendanceMonthly>(
      `/parent/attendance/monthly?studentId=${studentId}&year=${year}&month=${month}`
    ),
  
  getChildPayments: (studentId: string) =>
    api.get<ChildPayment[]>(`/parent/payments?studentId=${studentId}`),
  
  getChildTestResults: (studentId: string) =>
    api.get<ChildTestResult[]>(`/parent/test-results?studentId=${studentId}`),

  getChildExamResults: (studentId: string) =>
    api.get<ChildExamResult[]>(`/parent/exam-results?studentId=${studentId}`),
  getChildExamAttemptDetail: (examId: number, attemptId: number, studentId: string) =>
    api.get<ChildExamAttemptDetail>(`/parent/exams/${examId}/attempts/${attemptId}/detail?studentId=${studentId}`),
};

export interface ChildExamAttemptDetail {
  attemptId: number;
  examId: number;
  title: string;
  status: string;
  autoScore: number;
  manualScore?: number | null;
  totalScore?: number;
  score: number;
  maxScore: number;
  finishedAt: string | null;
  canvases: { canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string; canvasJson?: object; canvasSnapshot?: string | null }[];
  questions?: Array<{
    questionNumber?: number;
    presentationOrder?: number;
    questionText?: string;
    yourAnswer?: string;
    correctAnswer?: string;
    points?: number;
  }>;
  pdfUrl?: string | null;
  /** Optional pre-rendered PDF pages as images for scribble viewer */
  pages?: string[];
  pdfScribbles?: { pageIndex: number; drawingData: Record<string, unknown> }[];
  contentLocked?: boolean;
}

export interface ChildExamResult {
  attemptId: number;
  examId: number;
  title: string;
  examType?: string;
  status?: string;
  is_result_published?: boolean;
  score?: number | null;
  maxScore?: number;
  finishedAt: string | null;
}
