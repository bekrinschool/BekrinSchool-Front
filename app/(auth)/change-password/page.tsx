"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useMe, changePassword } from "@/lib/auth";
import { Loading } from "@/components/Loading";
import { useState } from "react";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Cari şifrə tələb olunur"),
    newPassword: z.string().min(8, "Yeni şifrə ən az 8 simvol olmalıdır"),
    confirmPassword: z.string().min(1, "Təsdiq tələb olunur"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Şifrələr uyğun gəlmir",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user, isLoading: meLoading } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!meLoading && !user) {
      router.replace("/login");
      return;
    }
    if (user && !user.mustChangePassword) {
      const role = user.role;
      if (role === "teacher") router.replace("/teacher");
      else if (role === "student") router.replace("/student");
      else if (role === "parent") router.replace("/parent");
    }
  }, [user, meLoading, router]);

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      setSuccess(true);
      // Refetch /auth/me so cache has mustChangePassword: false before redirect (avoids redirect loop)
      await queryClient.refetchQueries({ queryKey: ["auth", "me"] });
      const role = user?.role || "teacher";
      setTimeout(() => {
        if (role === "teacher") router.replace("/teacher");
        else if (role === "student") router.replace("/student");
        else if (role === "parent") router.replace("/parent");
      }, 1500);
    } catch (err: { message?: string } | unknown) {
      setError((err as { message?: string })?.message || "Xəta baş verdi");
    }
  };

  if (meLoading || (!user && !meLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-700 px-4">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-semibold mb-2 text-slate-900">
            Şifrəni dəyiş
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            İlk daxil olanda şifrəni dəyişmək mütləqdir.
          </p>

          {success && (
            <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
              Şifrə uğurla dəyişdirildi. Yönləndirilir...
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="label">Cari şifrə</label>
                <input
                  type="password"
                  className="input"
                  {...register("currentPassword")}
                />
                {errors.currentPassword && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.currentPassword.message}
                  </p>
                )}
              </div>
              <div>
                <label className="label">Yeni şifrə</label>
                <input
                  type="password"
                  className="input"
                  {...register("newPassword")}
                />
                {errors.newPassword && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.newPassword.message}
                  </p>
                )}
              </div>
              <div>
                <label className="label">Yeni şifrə (təsdiq)</label>
                <input
                  type="password"
                  className="input"
                  {...register("confirmPassword")}
                />
                {errors.confirmPassword && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>
              <button type="submit" className="btn-primary w-full">
                Şifrəni dəyiş
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
