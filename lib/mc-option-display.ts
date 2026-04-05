/** A–Z labels for MC options (PDF/JSON blueprint uses opt_1, opt_2, … or OPT_0-style ids). */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function tokensLooselyEqual(a: unknown, b: unknown): boolean {
  const sa = String(a ?? "").trim();
  const sb = String(b ?? "").trim();
  if (sa === "" || sb === "") return false;
  if (sa === sb) return true;
  if (sa.toLowerCase() === sb.toLowerCase()) return true;
  const na = Number(sa);
  const nb = Number(sb);
  if (Number.isFinite(na) && Number.isFinite(nb) && na === nb) return true;
  return false;
}

/**
 * Map internal MC ids (opt_1, OPT_0, etc.) to A, B, C… when we don't have blueprint rows.
 * opt_1 / OPT_1 → A (1-based index); opt_0 / OPT_0 → A (0-based index).
 */
export function formatOptStyleKeyAsLetter(raw: string | null | undefined): string {
  if (raw == null) return "—";
  const s = String(raw).trim();
  if (s === "") return "—";
  const m = /^(?:opt_|OPT_)(\d+)$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) {
      const idx = n >= 1 ? n - 1 : n;
      if (idx >= 0 && idx < LETTERS.length) return LETTERS[idx] ?? s;
    }
  }
  if (/^[A-Za-z]$/.test(s)) return s.toUpperCase();
  return s;
}

/**
 * Human-readable MC label: prefer option text from blueprint; else map opt_N → letter.
 */
export function formatMcSelectionForDisplay(
  raw: string | number | null | undefined,
  blueprintOptions?: Array<{ id?: string | number | null; text?: string | null }> | null
): string {
  if (raw == null) return "—";
  const token = String(raw).trim();
  if (token === "") return "—";
  const opts = blueprintOptions ?? [];
  if (opts.length > 0) {
    const hit = opts.find((o) => tokensLooselyEqual(o.id, token));
    if (hit?.text != null && String(hit.text).trim() !== "") {
      const letterIdx = opts.indexOf(hit);
      const letter = letterIdx >= 0 ? LETTERS[letterIdx] : null;
      return letter ? `${letter}) ${hit.text}` : String(hit.text);
    }
    const idx = opts.findIndex((o) => tokensLooselyEqual(o.id, token));
    if (idx >= 0) return LETTERS[idx] ?? token;
  }
  return formatOptStyleKeyAsLetter(token);
}
