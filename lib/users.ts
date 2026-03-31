import { api } from "./api";

export type UserRole = "teacher" | "student" | "parent";
export type UserStatus = "active" | "deleted" | "all";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  grade: string | null;
  phone: string | null;
  isDeleted: boolean;
  createdAt: string;
}

export interface UsersListParams {
  page?: number;
  pageSize?: number;
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  ordering?: string;
}

export interface UsersListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: User[];
}

export interface CreateUserPayload {
  email?: string;
  password?: string;
  fullName: string;
  role: UserRole;
  grade?: string;
  phone?: string;
  parentEmail?: string;
  parentPassword?: string;
}

export const usersApi = {
  list: (params?: UsersListParams) => {
    const sp = new URLSearchParams();
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.pageSize != null) sp.set("page_size", String(params.pageSize));
    if (params?.role) sp.set("role", params.role);
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.search) sp.set("search", params.search);
    if (params?.ordering) sp.set("ordering", params.ordering);
    const qs = sp.toString();
    return api.get<UsersListResponse>(`/users/${qs ? `?${qs}` : ""}`);
  },

  create: (data: CreateUserPayload) =>
    api.post<User>("/users/", {
      ...data,
      fullName: data.fullName,
      role: data.role,
      grade: data.grade,
      phone: data.phone,
      email: data.email,
      password: data.password,
      parentEmail: data.parentEmail,
      parentPassword: data.parentPassword,
    }),

  update: (id: string, data: Partial<Pick<User, "fullName" | "phone" | "grade">>) =>
    api.patch<User>(`/users/${id}/`, data),

  softDelete: (id: string) =>
    api.post<User>(`/users/${id}/soft_delete/`),

  restore: (id: string) =>
    api.post<User>(`/users/${id}/restore/`),
};
