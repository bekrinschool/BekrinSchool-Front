"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin } from "@/lib/auth";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const FORBIDDEN_MSG = "Bu səhifəyə giriş icazəniz yoxdur. Yenidən daxil olun.";

const loginSchema = z.object({
  email: z.string().email("Düzgün email daxil edin"),
  password: z.string().min(6, "Şifrə ən az 6 simvol olmalıdır"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginForm() {
  const searchParams = useSearchParams();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });
  const loginMutation = useLogin();
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    const reason = searchParams.get("reason");
    const message = searchParams.get("message");
    if (reason === "forbidden") {
      setGeneralError(message ? decodeURIComponent(message) : FORBIDDEN_MSG);
    }
    // reason=unauthorized: do NOT show "Sessiya bitib" - treat as normal logged-out state.
    // Me check 401 is expected when no token; no need to scare user with error banner.
  }, [searchParams]);

  const onSubmit = (values: LoginFormValues) => {
    setGeneralError(null);
    loginMutation.mutate(values, {
      onError: (err: any) => {
        let errorMessage = err?.message || "Giriş zamanı xəta baş verdi";
        
        // Network error handling
        if (errorMessage.includes("Failed to fetch") || errorMessage.includes("Backend server")) {
          errorMessage = 
            "Backend server ilə əlaqə qurula bilmədi.\n\n" +
            "Zəhmət olmasa yoxlayın:\n" +
            "1. Backend server işləyir? (http://localhost:8001)\n" +
            "2. Terminal-də 'python manage.py runserver 8001' işləyir?\n" +
            "3. Browser console-da xəta var?";
        }
        
        setGeneralError(errorMessage);
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-700 px-4">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-semibold mb-2 text-slate-900">
            Bekrin School Panelə Giriş
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            Zəhmət olmasa email və şifrənizi daxil edin. Qeydiyyat yalnız
            sistem administratoru tərəfindən aparılır.
          </p>

          {generalError && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-line">
              {generalError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="example@bekrinschool.az"
                {...register("email")}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="password">
                Şifrə
              </label>
              <input
                id="password"
                type="password"
                className="input"
                placeholder="Şifrənizi daxil edin"
                {...register("password")}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Giriş edilir..." : "Daxil ol"}
            </button>
          </form>

          <p className="mt-4 text-xs text-slate-400">
            Qeyd: Sistemdə qeydiyyat (signup) aktiv deyil. İstifadəçi hesabları
            yalnız müəllim və ya administrator tərəfindən yaradılır.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-100">Yüklənir...</div>}>
      <LoginForm />
    </Suspense>
  );
}
