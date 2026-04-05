"use client";

import type { QuestionBankCreate } from "@/lib/teacher";
import { normalizeAnswer, subTypeFromRule } from "@/lib/answer-normalizer";

/** Exact default shown in the bank JSON import modal (Reset to template). */
export const QUESTION_BANK_JSON_IMPORT_TEMPLATE = `[
  {
    "qtype": "closed",
    "options": ["Variant A", "Variant B", "Variant C", "Variant D", "Variant E"],
    "correct": 0
  },
  {
    "qtype": "open",
    "open_rule": "EXACT_MATCH",
    "answer": "Bakı"
  },
  {
    "qtype": "situation",
    "prompt": "Situasiya mətnini bura yazın",
    "max_multiplier": 1.5
  }
]`;

function mapOpenRule(rule: string): { type: string; answer_rule_type: string } {
  const r = (rule || "EXACT_MATCH").trim().toUpperCase();
  if (r === "MATCHING") return { type: "OPEN_UNORDERED", answer_rule_type: "MATCHING" };
  if (r === "ORDERED_MATCH" || r === "STRICT_ORDER" || r === "ORDERED_DIGITS") {
    return { type: "OPEN_ORDERED", answer_rule_type: r };
  }
  if (r === "UNORDERED_MATCH" || r === "UNORDERED_DIGITS") {
    return { type: "OPEN_UNORDERED", answer_rule_type: r };
  }
  if (r === "ANY_ORDER") return { type: "OPEN_PERMUTATION", answer_rule_type: "ANY_ORDER" };
  if (r === "NUMERIC_EQUAL") return { type: "OPEN_SINGLE_VALUE", answer_rule_type: "NUMERIC_EQUAL" };
  const allowed = new Set([
    "EXACT_MATCH",
    "ORDERED_MATCH",
    "UNORDERED_MATCH",
    "NUMERIC_EQUAL",
    "ORDERED_DIGITS",
    "UNORDERED_DIGITS",
    "STRICT_ORDER",
    "ANY_ORDER",
  ]);
  return {
    type: "OPEN_SINGLE_VALUE",
    answer_rule_type: allowed.has(r) ? r : "EXACT_MATCH",
  };
}

function trimTitle(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function parseCorrectIndex(correct: unknown, optionCount: number): { ok: true; index: number } | { ok: false; message: string } {
  if (typeof correct === "number" && Number.isFinite(correct)) {
    const i = Math.floor(correct);
    if (i < 0 || i >= optionCount) return { ok: false, message: `"correct" indeksi 0–${optionCount - 1} aralığında olmalıdır` };
    return { ok: true, index: i };
  }
  if (typeof correct === "string") {
    const c = correct.trim().toUpperCase();
    if (/^[A-E]$/.test(c)) {
      const i = c.charCodeAt(0) - 65;
      if (i >= optionCount) return { ok: false, message: `"correct" hərfi variant sayına uyğun deyil` };
      return { ok: true, index: i };
    }
  }
  return { ok: false, message: `"correct" düzgün indeks (0,1,…) və ya A–E hərfi olmalıdır` };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Maps import rows (qtype closed/open/situation) to payloads identical to manual bank creation.
 * Import-only keys (qtype, open_rule, answer, prompt, max_multiplier, correct, options as strings) are not sent to the API.
 */
export function buildQuestionBankCreatesFromImportArray(
  topicId: number,
  rows: unknown
): { ok: true; items: QuestionBankCreate[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(rows)) {
    return { ok: false, errors: ["JSON kökü sual massivi ([...]) olmalıdır."] };
  }
  const items: QuestionBankCreate[] = [];
  const errors: string[] = [];

  rows.forEach((raw, idx) => {
    const n = idx + 1;
    if (!isRecord(raw)) {
      errors.push(`Sual ${n}: obyekt gözlənilir.`);
      return;
    }
    const qt = String(raw.qtype ?? "").trim().toLowerCase();
    const closedLike = qt === "closed" || qt === "mc" || qt === "multiple_choice" || qt === "qapalı";

    if (closedLike) {
      const optsRaw = raw.options;
      if (!Array.isArray(optsRaw) || optsRaw.length < 2) {
        errors.push(`Sual ${n} (qapalı): "options" massivi ən azı 2 mətn tələb edir.`);
        return;
      }
      const texts: string[] = [];
      for (let j = 0; j < optsRaw.length; j++) {
        const o = optsRaw[j];
        const t = typeof o === "string" ? o.trim() : isRecord(o) && typeof o.text === "string" ? o.text.trim() : "";
        if (!t) {
          errors.push(`Sual ${n} (qapalı): variant ${j + 1} üçün mətn boş ola bilməz.`);
          return;
        }
        texts.push(t);
      }
      const lower = texts.map((t) => t.toLowerCase());
      if (new Set(lower).size !== texts.length) {
        errors.push(`Sual ${n} (qapalı): təkrarlanan variant mətnləri qəbul olunmur.`);
        return;
      }
      const ci = parseCorrectIndex(raw.correct, texts.length);
      if (!ci.ok) {
        errors.push(`Sual ${n} (qapalı): ${ci.message}`);
        return;
      }
      const stem =
        typeof raw.text === "string" && raw.text.trim()
          ? raw.text.trim()
          : typeof raw.question === "string" && raw.question.trim()
            ? raw.question.trim()
            : "Variantlardan birini seçin.";
      const shortTitle =
        typeof raw.short_title === "string" && raw.short_title.trim()
          ? trimTitle(raw.short_title.trim(), 255)
          : trimTitle(`İdxal ${n}`, 255);

      items.push({
        topic: topicId,
        short_title: shortTitle,
        text: stem,
        type: "MULTIPLE_CHOICE",
        is_active: true,
        mc_option_display: "TEXT",
        options: texts.map((text, order) => ({
          text,
          label: "",
          is_correct: order === ci.index,
          order,
        })),
      });
      return;
    }

    if (qt === "open" || qt === "açıq" || qt === "aciq") {
      const ans = raw.answer ?? raw.open_answer;
      if (ans === undefined || ans === null || String(ans).trim() === "") {
        errors.push(`Sual ${n} (açıq): "answer" tələb olunur.`);
        return;
      }
      const answerStr = typeof ans === "string" ? ans : JSON.stringify(ans);
      const ruleRaw = typeof raw.open_rule === "string" ? raw.open_rule : "EXACT_MATCH";
      const { type, answer_rule_type } = mapOpenRule(ruleRaw);
      const sub = subTypeFromRule(answer_rule_type);
      const normalizedCorrect = normalizeAnswer(answerStr, sub);
      if (!normalizedCorrect.trim()) {
        errors.push(`Sual ${n} (açıq): cavab boş ola bilməz.`);
        return;
      }
      const stem =
        typeof raw.text === "string" && raw.text.trim()
          ? raw.text.trim()
          : typeof raw.question === "string" && raw.question.trim()
            ? raw.question.trim()
            : "Açıq sual.";
      const shortTitle =
        typeof raw.short_title === "string" && raw.short_title.trim()
          ? trimTitle(raw.short_title.trim(), 255)
          : trimTitle(`İdxal ${n}`, 255);

      items.push({
        topic: topicId,
        short_title: shortTitle,
        text: stem,
        type,
        is_active: true,
        correct_answer: normalizedCorrect,
        answer_rule_type,
      });
      return;
    }

    if (qt === "situation" || qt === "situasiya") {
      const prompt =
        typeof raw.prompt === "string" && raw.prompt.trim()
          ? raw.prompt.trim()
          : typeof raw.text === "string" && raw.text.trim()
            ? raw.text.trim()
            : "";
      if (!prompt) {
        errors.push(`Sual ${n} (situasiya): "prompt" və ya "text" tələb olunur.`);
        return;
      }
      const shortTitle =
        typeof raw.short_title === "string" && raw.short_title.trim()
          ? trimTitle(raw.short_title.trim(), 255)
          : trimTitle(`İdxal ${n}: ${prompt}`, 255);

      items.push({
        topic: topicId,
        short_title: shortTitle,
        text: prompt,
        type: "SITUATION",
        is_active: true,
        correct_answer: {},
        answer_rule_type: "EXACT_MATCH",
      });
      return;
    }

    errors.push(`Sual ${n}: naməlum "qtype" (${qt || "boş"}). Gözlənilir: closed, open, situation.`);
  });

  if (errors.length) return { ok: false, errors };
  if (!items.length) return { ok: false, errors: ["Heç bir etibarlı sual yoxdur."] };
  return { ok: true, items };
}

export function parseQuestionBankImportJson(
  topicId: number,
  jsonText: string
): { ok: true; items: QuestionBankCreate[] } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return { ok: false, errors: ["JSON sintaksisi səhvdir."] };
  }
  return buildQuestionBankCreatesFromImportArray(topicId, parsed);
}
