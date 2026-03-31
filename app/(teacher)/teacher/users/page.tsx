"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, User, UserRole, UserStatus } from "@/lib/users";
import { Loading } from "@/components/Loading";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { teacherApi } from "@/lib/teacher";
import { Pencil, Trash2, RotateCcw, UserPlus, Search, ChevronLeft, ChevronRight, Eye, KeyRound } from "lucide-react";

const editSchema = z.object({
  fullName: z.string().min(1, "Ad Soyad tələb olunur"),
  phone: z.string().optional(),
  grade: z.string().optional(),
});

const createSchema = z.object({
  fullName: z.string().min(1, "Ad Soyad tələb olunur"),
  email: z.string().optional(),
  password: z.string().optional(),
  role: z.enum(["teacher", "student", "parent"]),
  grade: z.string().optional(),
  phone: z.string().optional(),
  parentEmail: z.string().optional(),
  parentPassword: z.string().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;
type CreateFormValues = z.infer<typeof createSchema>;

const ROLE_LABELS: Record<UserRole, string> = {
  teacher: "Müəllim",
  student: "Şagird",
  parent: "Valideyn",
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [statusFilter, setStatusFilter] = useState<UserStatus>("all");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const debouncedSearch = useDebounce(searchInput, 400);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [restoringUser, setRestoringUser] = useState<User | null>(null);
  const [passwordModal, setPasswordModal] = useState<{
    user: User;
    password: string;
    type: "reveal" | "reset";
  } | null>(null);

  const queryParams = {
    page,
    pageSize,
    role: roleFilter || undefined,
    status: statusFilter,
    search: debouncedSearch.trim() || undefined,
    ordering: "-date_joined",
  };

  const { data, isLoading } = useQuery({
    queryKey: ["users", queryParams],
    queryFn: () => usersApi.list(queryParams),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateFormValues) =>
      usersApi.create({
        fullName: data.fullName,
        email: data.email || undefined,
        password: data.password || undefined,
        role: data.role,
        grade: data.grade || undefined,
        phone: data.phone || undefined,
        parentEmail: data.parentEmail || undefined,
        parentPassword: data.parentPassword || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setAddingUser(false);
      toast.success("İstifadəçi uğurla əlavə edildi");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Əlavə edərkən xəta baş verdi");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditFormValues }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditingUser(null);
      toast.success("İstifadəçi uğurla yeniləndi");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Yeniləyərkən xəta baş verdi");
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.softDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeletingUser(null);
      toast.success("İstifadəçi silinmişlərə köçürüldü");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Silərkən xəta baş verdi");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => usersApi.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setRestoringUser(null);
      toast.success("İstifadəçi bərpa edildi");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Bərpa edərkən xəta baş verdi");
    },
  });

  const revealPasswordMutation = useMutation({
    mutationFn: async ({ userId, user }: { userId: string; user: User }) => {
      const r = await teacherApi.userRevealPassword(userId);
      return { ...r, user };
    },
    onSuccess: (data) => {
      if (data.password) {
        setPasswordModal({ user: data.user, password: data.password, type: "reveal" });
      } else if (!data.revealed && data.message) {
        toast.error(data.message);
      }
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Parol göstərilmədi");
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, user }: { userId: string; user: User }) => {
      const r = await teacherApi.userResetPassword(userId);
      return { ...r, user };
    },
    onSuccess: (data) => {
      if (data.password) {
        setPasswordModal({ user: data.user, password: data.password, type: "reset" });
        toast.success("Yeni parol yaradıldı");
      }
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Parol yenilənmədi");
    },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
  });

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: "student" },
  });

  const handleEdit = useCallback((user: User) => {
    setEditingUser(user);
    editForm.reset({
      fullName: user.fullName,
      phone: user.phone || "",
      grade: user.grade || "",
    });
  }, [editForm]);

  const onEditSubmit = (values: EditFormValues) => {
    if (!editingUser) return;
    updateMutation.mutate({ id: editingUser.id, data: values });
  };

  const onCreateSubmit = (values: CreateFormValues) => {
    createMutation.mutate(values);
  };

  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const results = data?.results ?? [];

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">İstifadəçi İdarəetməsi</h1>
          <p className="text-sm text-slate-600 mt-1">
            Müəllim, şagird və valideynlərin idarəetməsi
          </p>
        </div>
        <button
          onClick={() => {
            setAddingUser(true);
            createForm.reset({ fullName: "", role: "student", grade: "", phone: "" });
          }}
          className="btn-primary flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Yeni istifadəçi
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6 p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Email və ya adla axtar..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              className="input !pl-12 w-full"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as UserRole | "");
              setPage(1);
            }}
            className="input w-40"
          >
            <option value="">Bütün rollar</option>
            <option value="teacher">Müəllim</option>
            <option value="student">Şagird</option>
            <option value="parent">Valideyn</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as UserStatus);
              setPage(1);
            }}
            className="input w-40"
          >
            <option value="active">Aktiv</option>
            <option value="deleted">Silinmiş</option>
            <option value="all">Hamısı</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">№</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Ad Soyad</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Email</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Rol</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Sinif</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Telefon</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">
                Əməliyyatlar
              </th>
            </tr>
          </thead>
          <tbody>
            {results.length > 0 ? (
              results.map((user, idx) => (
                <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  <td className="py-3 px-4 text-sm font-medium text-slate-900">{user.fullName}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">{user.email}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {ROLE_LABELS[user.role]}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">{user.grade || "-"}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">{user.phone || "-"}</td>
                  <td className="py-3 px-4 text-sm">
                    <span
                      className={
                        user.isDeleted
                          ? "text-amber-600 font-medium"
                          : "text-green-600 font-medium"
                      }
                    >
                      {user.isDeleted ? "Silinmiş" : "Aktiv"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <div className="flex items-center justify-end gap-1">
                      {(user.role === "student" || user.role === "parent") && (
                        <>
                          <button
                            onClick={() =>
                              revealPasswordMutation.mutate({ userId: user.id, user })
                            }
                            disabled={revealPasswordMutation.isPending}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                            title="Parolu göstər (1 dəfə)"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() =>
                              resetPasswordMutation.mutate({ userId: user.id, user })
                            }
                            disabled={resetPasswordMutation.isPending}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                            title="Reset + göstər (1 dəfə)"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleEdit(user)}
                        className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                        title="Redaktə et"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {user.role === "student" &&
                        (user.isDeleted ? (
                          <button
                            onClick={() => setRestoringUser(user)}
                            className="p-2 hover:bg-green-50 rounded-lg text-green-600 transition-colors"
                            title="Bərpa et"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setDeletingUser(user)}
                            className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                            title="Sil (soft delete)"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  İstifadəçi tapılmadı
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <p className="text-sm text-slate-600">
              Cəmi {totalCount} istifadəçi
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-600">
                Səhifə {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal
        isOpen={addingUser}
        onClose={() => setAddingUser(false)}
        title="Yeni İstifadəçi Əlavə Et"
        size="lg"
      >
        <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
          <div>
            <label className="label">Ad Soyad *</label>
            <input type="text" className="input" {...createForm.register("fullName")} />
            {createForm.formState.errors.fullName && (
              <p className="mt-1 text-xs text-red-600">
                {createForm.formState.errors.fullName.message}
              </p>
            )}
          </div>
          <div>
            <label className="label">Rol *</label>
            <select className="input" {...createForm.register("role")}>
              <option value="teacher">Müəllim</option>
              <option value="student">Şagird</option>
              <option value="parent">Valideyn</option>
            </select>
          </div>
          <div>
            <label className="label">Sinif (yalnız şagird üçün)</label>
            <input type="text" className="input" {...createForm.register("grade")} />
          </div>
          <div>
            <label className="label">Telefon</label>
            <input type="text" className="input" {...createForm.register("phone")} />
          </div>
          <div>
            <label className="label">Email (boş saxlanılsa avtomatik yaradılacaq)</label>
            <input type="email" className="input" {...createForm.register("email")} />
          </div>
          <div>
            <label className="label">Şifrə (boş saxlanılsa avtomatik yaradılacaq)</label>
            <input type="password" className="input" {...createForm.register("password")} />
          </div>
          <p className="text-xs text-slate-500">
            Şagird üçün valideyn hesabı yaratmaq istəyirsinizsə, aşağıdakı sahələri doldurun.
          </p>
          <div>
            <label className="label">Valideyn Email (istəyə bağlı)</label>
            <input type="email" className="input" {...createForm.register("parentEmail")} />
          </div>
          <div>
            <label className="label">Valideyn Şifrə (istəyə bağlı)</label>
            <input type="password" className="input" {...createForm.register("parentPassword")} />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Yaradılır..." : "Əlavə et"}
            </button>
            <button
              type="button"
              onClick={() => setAddingUser(false)}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title="İstifadəçini Redaktə Et"
      >
        <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
          <div>
            <label className="label">Ad Soyad *</label>
            <input type="text" className="input" {...editForm.register("fullName")} />
            {editForm.formState.errors.fullName && (
              <p className="mt-1 text-xs text-red-600">
                {editForm.formState.errors.fullName.message}
              </p>
            )}
          </div>
          <div>
            <label className="label">Sinif {editingUser?.role === "student" && "(yalnız şagird üçün)"}</label>
            <input type="text" className="input" {...editForm.register("grade")} />
          </div>
          <div>
            <label className="label">Telefon</label>
            <input type="text" className="input" {...editForm.register("phone")} />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Yenilənir..." : "Yadda Saxla"}
            </button>
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Soft Delete Modal */}
      <Modal
        isOpen={!!deletingUser}
        onClose={() => setDeletingUser(null)}
        title="İstifadəçini Sil"
        size="sm"
      >
        <p className="text-slate-600 mb-6">
          &quot;{deletingUser?.fullName}&quot; adlı istifadəçini silmək istədiyinizə əminsiniz?
          İstifadəçi &quot;Silinmiş&quot; bölməsinə köçürüləcək və bərpa edilə bilər.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => deletingUser && softDeleteMutation.mutate(deletingUser.id)}
            className="btn-primary flex-1"
            disabled={softDeleteMutation.isPending}
          >
            {softDeleteMutation.isPending ? "Silinir..." : "Sil"}
          </button>
          <button onClick={() => setDeletingUser(null)} className="btn-outline flex-1">
            Ləğv et
          </button>
        </div>
      </Modal>

      {/* Restore Modal */}
      <Modal
        isOpen={!!restoringUser}
        onClose={() => setRestoringUser(null)}
        title="İstifadəçini Bərpa Et"
        size="sm"
      >
        <p className="text-slate-600 mb-6">
          &quot;{restoringUser?.fullName}&quot; adlı istifadəçini bərpa etmək istədiyinizə əminsiniz?
          İstifadəçi yenidən aktiv siyahıya köçürüləcək.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => restoringUser && restoreMutation.mutate(restoringUser.id)}
            className="btn-primary flex-1 bg-green-600 hover:bg-green-700"
            disabled={restoreMutation.isPending}
          >
            {restoreMutation.isPending ? "Bərpa edilir..." : "Bərpa et"}
          </button>
          <button onClick={() => setRestoringUser(null)} className="btn-outline flex-1">
            Ləğv et
          </button>
        </div>
      </Modal>

      {/* Password Modal (one-time reveal) */}
      <Modal
        isOpen={!!passwordModal}
        onClose={() => setPasswordModal(null)}
        title={
          passwordModal?.type === "reset"
            ? "Yeni parol yaradıldı"
            : "Parol (yalnız bir dəfə göstərilir)"
        }
        size="sm"
      >
        {passwordModal && (
          <div className="space-y-4">
            <p className="text-slate-600">
              <span className="font-medium">{passwordModal.user.fullName}</span>
              <span className="text-slate-500"> ({passwordModal.user.email})</span>
            </p>
            <div className="bg-slate-100 rounded-lg p-4 font-mono text-lg tracking-wider">
              {passwordModal.password}
            </div>
            <p className="text-xs text-amber-600">
              Bu parolu saxlayın. Yenidən göstərilməyəcək.
            </p>
            <button
              onClick={() => setPasswordModal(null)}
              className="btn-primary w-full"
            >
              Bağla
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
