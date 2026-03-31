"use client";

import { useMe } from "./auth";
import { UserRole } from "./constants";
import { useMemo } from "react";

export interface AuthState {
  isAuthenticated: boolean;
  role: UserRole | null;
  userId: string | null;
  fullName: string | null;
  mustChangePassword: boolean;
  loading: boolean;
}

/**
 * Central auth source for RBAC.
 * Role comes from /auth/me (backend) — never trust client cookies for authorization.
 */
export function useAuth(): AuthState {
  const { data: user, isLoading, isError } = useMe();

  return useMemo(() => {
    if (isLoading) {
      return {
        isAuthenticated: false,
        role: null,
        userId: null,
        fullName: null,
        mustChangePassword: false,
        loading: true,
      };
    }
    if (isError || !user) {
      return {
        isAuthenticated: false,
        role: null,
        userId: null,
        fullName: null,
        mustChangePassword: false,
        loading: false,
      };
    }
    return {
      isAuthenticated: true,
      role: user.role as UserRole,
      userId: user.email, // use email as stable identifier
      fullName: user.fullName ?? null,
      mustChangePassword: user.mustChangePassword ?? false,
      loading: false,
    };
  }, [user, isLoading, isError]);
}
