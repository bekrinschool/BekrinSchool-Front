import { API_BASE_URL } from "./constants";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiError {
  status: number;
  message: string;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop()!.split(";").shift()!);
  return null;
}

async function request<T>(
  path: string,
  options: RequestInit & { method?: HttpMethod } = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const token = getCookie("accessToken");

  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...((options.headers as Record<string, string>) || {}),
  };

  // Token varsa Authorization header-ə əlavə et
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body,
      signal: options.signal ?? undefined,
    });
  } catch (error: any) {
    // Network error (backend not running, CORS, etc.)
    const errorMessage = String(error?.message || "Naməlum xəta");
    const isConnectionRefused =
      errorMessage.includes("ERR_CONNECTION_REFUSED") ||
      errorMessage.includes("Failed to fetch") ||
      errorMessage.includes("NetworkError") ||
      errorMessage.includes("Network request failed") ||
      errorMessage.includes("Load failed");
    if (isConnectionRefused) {
      const hint = errorMessage.includes("ERR_CONNECTION_REFUSED")
        ? "Backend server işləmir (connection refused). Backend-i işə salın: cd bekrin-back && python manage.py runserver 8001"
        : "Backend server ilə əlaqə qurula bilmədi. Zəhmət olmasa yoxlayın:\n1. Backend işləyir? (http://localhost:8001)\n2. API URL düzgündür? (" +
          url +
          ")\n3. CORS konfiqurasiyası düzgündür?";
      throw new Error(hint);
    }
    throw error;
  }

  if (res.status === 401 && typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (!path.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      window.location.href = "/login?reason=unauthorized";
    }
    throw new Error("Unauthorized");
  }

  if (res.status === 403 && typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (!path.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      const msg = encodeURIComponent("Bu səhifəyə giriş icazəniz yoxdur. Yenidən daxil olun.");
      window.location.href = `/login?reason=forbidden&message=${msg}`;
    }
    throw new Error("Forbidden");
  }

  if (!res.ok) {
    let message = "Naməlum xəta baş verdi";
    let errorData: any = null;
    try {
      const text = await res.text();
      if (text) {
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = text;
        }
      }
      // Handle Django REST Framework validation errors (dict of field errors)
      if (errorData && typeof errorData === 'object' && !errorData.detail && !errorData.error && !errorData.message) {
        const fieldErrors: string[] = [];
        for (const [field, errors] of Object.entries(errorData)) {
          if (Array.isArray(errors)) {
            fieldErrors.push(`${field}: ${errors.join(', ')}`);
          } else if (typeof errors === 'string') {
            fieldErrors.push(`${field}: ${errors}`);
          } else {
            fieldErrors.push(`${field}: ${JSON.stringify(errors)}`);
          }
        }
        message = fieldErrors.length > 0 ? fieldErrors.join('; ') : message;
      } else {
        message = (errorData?.error ?? errorData?.detail ?? errorData?.message ?? (typeof errorData === 'string' ? errorData : message)) as string;
      }
    } catch (e) {
      console.error("Error parsing response:", e);
    }
    const error: ApiError & { response?: { data: any }; data?: any } = { 
      status: res.status, 
      message, 
      response: { data: errorData },
      data: errorData
    };
    throw error;
  }

  if (res.status === 204) {
    // no content
    return {} as T;
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: { signal?: AbortSignal }) =>
    request<T>(path, { method: "GET", ...opts }),
  getBlob: async (path: string): Promise<Blob> => {
    const url = `${API_BASE_URL}${path}`;
    const token = getCookie("accessToken");
    const headers: HeadersInit = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "GET", headers, credentials: "include" });
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      window.location.href = "/login?reason=unauthorized";
      throw new Error("Unauthorized");
    }
    if (res.status === 403 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      const msg = encodeURIComponent("Bu səhifəyə giriş icazəniz yoxdur. Yenidən daxil olun.");
      window.location.href = `/login?reason=forbidden&message=${msg}`;
      throw new Error("Forbidden");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  post: <T>(path: string, body?: unknown, opts?: { headers?: HeadersInit }) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      headers: opts?.headers,
    }),
  patch: <T>(path: string, body?: unknown, opts?: { headers?: HeadersInit }) =>
    request<T>(path, {
      method: "PATCH",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      headers: opts?.headers,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

