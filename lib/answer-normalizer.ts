"use client";

export type OpenAnswerSubType = "STANDARD" | "MATCHING" | "SEQUENTIAL" | "PERMUTATION";

export const normalizeMatchingAnswer = (rawInput: string): string => {
  const raw = String(rawInput ?? "").toLowerCase();
  if (!raw.trim()) return "";

  // Normalize separators and remove noisy punctuation while preserving digits/letters.
  const normalized = raw
    .replace(/[–—−:]/g, "-")
    .replace(/[;|]/g, ",")
    .replace(/\./g, ",")
    .replace(/\s+/g, " ")
    .trim();

  // Capture all forms:
  // - 1-a / 1 - a / 1a
  // - 1-ab / 1 ab / 1ab
  // - with commas/spaces/mixed separators
  const tokenRe = /(\d+)\s*-?\s*([a-z]+)/g;
  const pairs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(normalized)) !== null) {
    const left = m[1];
    const right = m[2];
    if (!left || !right) continue;
    pairs.push(`${left}-${right}`);
  }
  return pairs.join("");
};

function normalizeSequential(raw: string): string {
  return (raw || "").replace(/[,\s]+/g, "").replace(/\D+/g, "");
}

function normalizePermutation(raw: string): string {
  return (raw || "").replace(/[,\s]+/g, "");
}

function normalizeStandard(raw: string): string {
  return (raw || "").replace(/[\s,]+/g, "");
}

export function normalizeAnswer(rawText: string, subType: OpenAnswerSubType): string {
  if (subType === "MATCHING") return normalizeMatchingAnswer(rawText);
  if (subType === "SEQUENTIAL") return normalizeSequential(rawText);
  if (subType === "PERMUTATION") return normalizePermutation(rawText);
  return normalizeStandard(rawText);
}

export function subTypeFromRule(ruleLike?: string | null): OpenAnswerSubType {
  const rule = (ruleLike || "").toUpperCase();
  if (rule === "MATCHING" || rule === "UNORDERED_MATCH") return "MATCHING";
  if (rule === "STRICT_ORDER" || rule === "ORDERED_DIGITS" || rule === "ORDERED_MATCH") return "SEQUENTIAL";
  if (rule === "ANY_ORDER" || rule === "UNORDERED_DIGITS") return "PERMUTATION";
  return "STANDARD";
}

