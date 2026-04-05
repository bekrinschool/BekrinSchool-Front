/**
 * PDF-only grading: compare student letter answers to answer-key letters (1…N order, no shuffle).
 */

export type PdfExamQuestionSpec = {
  number: number;
  options?: string[];
  correct: string;
};

export type PdfExamKeyJson = {
  questions: PdfExamQuestionSpec[];
};

export type PdfGradeRow = {
  number: number;
  studentLetter: string | null;
  correctLetter: string | null;
  isCorrect: boolean;
  isBlank: boolean;
};

function normLetter(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toUpperCase();
  return s.length ? s : null;
}

/**
 * @param submissionAnswers map questionNumber -> selected option letter (e.g. "B")
 * @param examJson simplified key: `{ questions: [{ number, options, correct }] }`
 */
export function gradePdfSubmission(
  submissionAnswers: Record<number, string | null | undefined> | Record<string, string | null | undefined>,
  examJson: PdfExamKeyJson
): { score: number; maxScore: number; rows: PdfGradeRow[] } {
  const questions = [...(examJson.questions ?? [])].sort((a, b) => Number(a.number) - Number(b.number));
  let score = 0;
  const rows: PdfGradeRow[] = questions.map((q) => {
    const num = Number(q.number);
    const raw =
      submissionAnswers[num as keyof typeof submissionAnswers] ??
      submissionAnswers[String(num) as keyof typeof submissionAnswers];
    const studentLetter = normLetter(raw);
    const correctLetter = normLetter(q.correct);
    const isBlank = studentLetter == null;
    const isCorrect = !isBlank && correctLetter != null && studentLetter === correctLetter;
    if (isCorrect) score += 1;
    return {
      number: num,
      studentLetter,
      correctLetter,
      isCorrect,
      isBlank,
    };
  });
  return { score, maxScore: questions.length, rows };
}
