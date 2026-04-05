/**
 * Mirrors tests/answer_key.py (normalize_answer_key_json + validate_answer_key_json).
 * Use before sending answer_key_json to the API for PDF/JSON exams.
 */

export const EXAM_TOTAL = 30;
export const EXAM_CLOSED = 22;
export const EXAM_OPEN = 5;
export const EXAM_SITUATION = 3;
export const QUIZ_MIN_QUESTIONS = 1;

/** Example PDF “exam” scaffold (30 questions); optional — backend accepts any valid counts ≥ 1. */
export function buildPdfExamAnswerKeyTemplate(): {
  type: "exam";
  questions: Record<string, unknown>[];
} {
  const questions: Record<string, unknown>[] = [];
  for (let no = 1; no <= EXAM_CLOSED; no++) {
    questions.push({
      no,
      qtype: "closed",
      options: ["A", "B", "C", "D", "E"],
      correct: 0,
    });
  }
  for (let no = EXAM_CLOSED + 1; no <= EXAM_CLOSED + EXAM_OPEN; no++) {
    questions.push({
      no,
      qtype: "open",
      open_rule: "EXACT_MATCH",
      answer: "Nümunə",
    });
  }
  for (let i = 0; i < EXAM_SITUATION; i++) {
    questions.push({
      no: EXAM_CLOSED + EXAM_OPEN + 1 + i,
      qtype: "situation",
      prompt: `Situasiya ${i + 1}`,
      max_multiplier: 1.0,
    });
  }
  return { type: "exam", questions };
}

/** Pretty-printed JSON for CodeEditor “Reset to template” on PDF exams. */
export const PDF_EXAM_ANSWER_KEY_TEMPLATE = JSON.stringify(buildPdfExamAnswerKeyTemplate(), null, 2);

const OPEN_RULES = new Set([
  "EXACT_MATCH",
  "ORDERED_MATCH",
  "UNORDERED_MATCH",
  "NUMERIC_EQUAL",
  "ORDERED_DIGITS",
  "UNORDERED_DIGITS",
  "MATCHING",
  "STRICT_ORDER",
  "ANY_ORDER",
]);

const QUESTION_KINDS = new Set(["mc", "open", "situation"]);
const QTYPE_TO_KIND: Record<string, string> = {
  closed: "mc",
  open: "open",
  situation: "situation",
};

const OPTION_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export type AnswerKeyJson = Record<string, unknown> & {
  type?: string;
  questions?: unknown[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * User-facing format (no, qtype, options as strings, correct as index) → internal (number, kind, options [{key,text}], correct key).
 */
export function normalizeAnswerKeyJson(data: unknown): AnswerKeyJson | null {
  if (!isRecord(data)) return null;
  const questions = data.questions;
  if (!Array.isArray(questions)) return null;
  const examType = data.type;
  if (examType !== "quiz" && examType !== "exam") return null;

  const outQuestions: Record<string, unknown>[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!isRecord(q)) return null;
    const numRaw = q.number !== undefined && q.number !== null ? q.number : q.no;
    if (numRaw === undefined || numRaw === null) return null;

    const qtype = String(q.qtype ?? "").trim().toLowerCase();
    let kind = (q.kind as string | undefined)?.trim().toLowerCase();
    if (!kind) {
      kind = QTYPE_TO_KIND[qtype] ?? (qtype === "closed" ? "mc" : qtype === "open" ? "open" : qtype === "situation" ? "situation" : "");
    }
    if (!kind) {
      kind = qtype === "closed" ? "mc" : qtype === "open" ? "open" : "situation";
    }
    if (!QUESTION_KINDS.has(kind)) return null;

    const numCoerced = typeof numRaw === "number" && Number.isFinite(numRaw) ? numRaw : Number(numRaw);
    const item: Record<string, unknown> = {
      number: Number.isFinite(numCoerced) ? numCoerced : numRaw,
      kind,
    };

    if (kind === "mc") {
      const opts = q.options;
      if (Array.isArray(opts)) {
        const optionList: { key: string; text: string }[] = [];
        for (let j = 0; j < opts.length; j++) {
          const o = opts[j];
          if (isRecord(o)) {
            const key = String(o.key ?? OPTION_KEYS[j] ?? j).trim().toUpperCase();
            const text = o.text != null ? String(o.text) : "";
            optionList.push({ key, text });
          } else {
            const key = OPTION_KEYS[j] ?? String.fromCharCode(65 + j);
            const text = o != null ? String(o) : "";
            optionList.push({ key, text });
          }
        }
        item.options = optionList;
        const correct = q.correct;
        if (correct !== undefined && correct !== null) {
          const idx = typeof correct === "number" ? correct : Number.isFinite(Number(correct)) ? Number(correct) : null;
          if (idx !== null && idx >= 0 && idx < optionList.length) {
            item.correct = optionList[idx].key;
          } else if (typeof correct === "string" && correct.trim()) {
            item.correct = correct.trim().toUpperCase();
          }
        } else {
          item.correct = null;
        }
      } else {
        item.options = [];
        item.correct = null;
      }
    } else if (kind === "open") {
      item.options = [];
      item.open_answer = q.open_answer !== undefined && q.open_answer !== null ? q.open_answer : q.answer;
      const rule = String(q.open_rule ?? "").trim().toUpperCase();
      if (rule && OPEN_RULES.has(rule)) {
        item.open_rule = rule;
      } else {
        item.open_rule = "EXACT_MATCH";
      }
      const effectiveOpenRule = String(item.open_rule);
      if (effectiveOpenRule === "MATCHING") {
        item.matching_left = Array.isArray(q.matching_left) ? q.matching_left : ["1", "2", "3"];
        item.matching_right = Array.isArray(q.matching_right) ? q.matching_right : ["a", "b", "c", "d", "e"];
      }
    } else {
      item.options = [];
      if (q.prompt !== undefined) item.prompt = q.prompt;
      if (q.max_multiplier !== undefined) item.max_multiplier = q.max_multiplier;
    }
    outQuestions.push(item);
  }

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k !== "questions" && k !== "type") extra[k] = v;
  }
  return { type: examType, questions: outQuestions, ...extra };
}

export function validateAnswerKeyJson(data: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(data)) {
    return { ok: false, errors: ["answer_key must be an object"] };
  }

  const examType = data.type;
  if (examType !== "quiz" && examType !== "exam") {
    errors.push('"type" must be "quiz" or "exam"');
  }

  const questions = data.questions;
  if (!Array.isArray(questions)) {
    errors.push('"questions" must be an array');
    return { ok: false, errors };
  }

  const situations = data.situations;
  if (situations !== undefined && situations !== null && !Array.isArray(situations)) {
    errors.push('"situations" must be an array or omitted');
  }

  let closed = 0;
  let openCount = 0;
  let situationCount = 0;
  const seenNumbers = new Set<unknown>();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!isRecord(q)) {
      errors.push(`questions[${i}] must be an object`);
      continue;
    }
    const num = q.number;
    if (num === undefined || num === null) {
      errors.push(`questions[${i}]: "number" required`);
    } else if (seenNumbers.has(num)) {
      errors.push(`questions[${i}]: duplicate number ${num}`);
    } else {
      seenNumbers.add(num);
    }

    const kind = String(q.kind ?? "").trim().toLowerCase();
    if (!QUESTION_KINDS.has(kind)) {
      errors.push(`questions[${i}]: "kind" must be one of mc, open, situation`);
    } else if (kind === "mc") {
      closed += 1;
      const opts = q.options;
      if (!Array.isArray(opts)) {
        errors.push(`questions[${i}]: mc question must have "options" array`);
      } else {
        const keys = new Set<string>();
        const optionTextsNormalized: string[] = [];
        for (const o of opts) {
          if (isRecord(o) && o.key != null) {
            keys.add(String(o.key).trim().toUpperCase());
          }
          let t = "";
          if (isRecord(o)) {
            t = String(o.text ?? "").trim();
          } else if (o != null) {
            t = String(o).trim();
          }
          if (t) optionTextsNormalized.push(t.toLowerCase());
        }
        if (optionTextsNormalized.length !== new Set(optionTextsNormalized).size) {
          errors.push(`questions[${i}]: Sual ${num} - eyni cavab variantı təkrar ola bilməz.`);
        }
        const correct = q.correct;
        if (correct !== undefined && correct !== null && !keys.has(String(correct).trim().toUpperCase())) {
          errors.push(`questions[${i}]: "correct" must be one of option keys`);
        }
      }
    } else if (kind === "open") {
      openCount += 1;
      const rule = String(q.open_rule ?? "").trim().toUpperCase();
      if (rule && !OPEN_RULES.has(rule)) {
        errors.push(`questions[${i}]: open_rule must be one of ${[...OPEN_RULES].sort().join(", ")}`);
      }
    } else if (kind === "situation") {
      situationCount += 1;
    }
  }

  if (Array.isArray(situations)) {
    situations.forEach((s, j) => {
      if (!isRecord(s)) {
        errors.push(`situations[${j}] must be an object`);
      } else if (!("index" in s) && !("pages" in s)) {
        errors.push(`situations[${j}]: "index" or "pages" required`);
      }
    });
  }

  const total = closed + openCount + situationCount;
  if (total === 0) {
    errors.push("At least one question is required");
  }

  if (examType === "exam") {
    if (total < QUIZ_MIN_QUESTIONS) {
      errors.push(`Exam must have at least ${QUIZ_MIN_QUESTIONS} question(s) (got ${total})`);
    }
  } else if (examType === "quiz") {
    if (total < QUIZ_MIN_QUESTIONS) {
      errors.push(`Quiz must have at least ${QUIZ_MIN_QUESTIONS} question(s) (got ${total})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateAndNormalizeAnswerKeyJson(data: unknown): {
  ok: boolean;
  errors: string[];
  normalized: AnswerKeyJson | null;
} {
  if (!isRecord(data)) {
    return { ok: false, errors: ["answer_key must be an object"], normalized: null };
  }
  const normalizedTry = normalizeAnswerKeyJson(data);
  const toValidate: unknown = normalizedTry ?? data;
  const { ok, errors } = validateAnswerKeyJson(toValidate);
  if (!ok) return { ok: false, errors, normalized: null };
  const normalized = (normalizedTry ?? toValidate) as AnswerKeyJson;
  return { ok: true, errors: [], normalized };
}
