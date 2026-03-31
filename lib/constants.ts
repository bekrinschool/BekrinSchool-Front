/**
 * API base URL (e.g. http://localhost:8001/api). Single source of truth for backend connectivity.
 * Normalized to end with /api so paths like /student/runs/23/pages resolve to /api/student/runs/23/pages.
 * Prefer NEXT_PUBLIC_API_BASE_URL; NEXT_PUBLIC_API_URL is an alias for deployment templates.
 */
const raw = (
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8001/api"
).replace(/\/+$/, "");
export const API_BASE_URL = raw.endsWith("/api") ? raw : `${raw}/api`;

export const ACCESS_TOKEN_COOKIE = "accessToken";
export const USER_ROLE_COOKIE = "userRole";

export type UserRole = "teacher" | "student" | "parent";
