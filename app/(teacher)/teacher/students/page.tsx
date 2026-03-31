"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, Student } from "@/lib/teacher";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { formatPaymentDisplay } from "@/lib/formatPayment";
import { Pencil, Trash2, RotateCcw, X, UserPlus, Key, Search, LogIn } from "lucide-react";
import { useDebounce } from "@/lib/useDebounce";
import { setAuthCookies } from "@/lib/auth";
import { api } from "@/lib/api";

const studentSchema = z.object({
  fullName: z.string().min(1, "Ad Soyad tələb olunur"),
  class: z.string().optional(),
  phone: z.string().optional(),
  balance: z.number(),
});

type StudentFormValues = z.infer<typeof studentSchema>;

export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab =
    tabParam === "active" || tabParam === "deleted" ? tabParam : "active";
  const [activeTab, setActiveTab] = useState<"active" | "deleted">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const changeTab = (tab: "active" | "deleted") => {
    setActiveTab(tab);
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", tab);
    router.replace(`/teacher/students?${qs.toString()}`, { scroll: false });
  };
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [addingStudent, setAddingStudent] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState<{
    studentEmail: string;
    studentPassword: string;
    parentEmail: string;
    parentPassword: string;
  } | null>(null);
  const [deletingStudent, setDeletingStudent] = useState<Student | null>(null);
  const [restoringStudent, setRestoringStudent] = useState<Student | null>(null);
  const [hardDeletingStudent, setHardDeletingStudent] = useState<Student | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 400);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: students, isLoading } = useQuery({
    queryKey: ["teacher", "students", activeTab, debouncedSearch],
    queryFn: ({ signal }) =>
      teacherApi.getStudents(activeTab, debouncedSearch || undefined, signal),
  });

  const createMutation = useMutation({
    mutationFn: (data: { fullName: string; class?: string; phone?: string; balance?: number }) =>
      teacherApi.createStudent(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      setAddingStudent(false);
      reset({ fullName: "", class: "", phone: "", balance: 0 });
      if (data.credentials) {
        setCredentialsModal(data.credentials);
      }
      toast.success("Şagird uğurla əlavə edildi");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Əlavə edərkən xəta baş verdi");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Student> }) =>
      teacherApi.updateStudent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      setEditingStudent(null);
      toast.success("Şagird uğurla yeniləndi");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteStudent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      setDeletingStudent(null);
      toast.success("Şagird silinmişlərə köçürüldü");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => teacherApi.restoreStudent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      setRestoringStudent(null);
      toast.success("Şagird bərpa edildi");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Bərpa edərkən xəta baş verdi");
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.hardDeleteStudent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      setHardDeletingStudent(null);
      toast.success("Şagird həmişəlik silindi");
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async (student: Student) => {
      const studentUserId = student.userId ?? Number(student.id);
      const data = await teacherApi.impersonateStudent(studentUserId);
      setAuthCookies(data.accessToken, data.user.role as any);
      try {
        const me = await api.get<any>("/auth/me");
        // eslint-disable-next-line no-console
        console.log("ME AFTER IMPERSONATION:", me);
      } catch {
        // ignore
      }
      return data;
    },
    onSuccess: (data) => {
      // Immediately update auth state so RoleGuard/Layout react instantly
      queryClient.setQueryData(["auth", "me"], {
        ...data.user,
        is_impersonating: true,
      });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      queryClient.clear(); // ensure no stale role-guarded queries stick around

      // Hard redirect avoids stale router state / cached role edge-cases
      window.location.href = "/student";
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Impersonate xətası");
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
  });

  const handleEdit = (student: Student) => {
    setEditingStudent(student);
    reset({
      fullName: student.fullName,
      class: student.class || "",
      phone: student.phone || "",
      balance: student.balance,
    });
  };

  const onSubmit = (values: StudentFormValues) => {
    if (editingStudent) {
      updateMutation.mutate({
        id: editingStudent.id,
        data: values,
      });
    } else if (addingStudent) {
      createMutation.mutate({
        fullName: values.fullName,
        class: values.class,
        phone: values.phone,
        balance: values.balance ?? 0,
      });
    }
  };

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Şagirdlər</h1>
        <div className="flex gap-2">
          <Link
            href="/teacher/credentials"
            className="btn-outline flex items-center gap-2"
          >
            <Key className="w-4 h-4" />
            Hesab məlumatları
          </Link>
          <button
          onClick={() => {
            setAddingStudent(true);
            reset({ fullName: "", class: "", phone: "", balance: 0 });
          }}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Yeni şagird
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-slate-200">
        <button
          onClick={() => changeTab("active")}
          className={`px-4 py-2 font-medium text-sm ${
            activeTab === "active"
              ? "text-primary border-b-2 border-primary"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Aktiv
        </button>
        <button
          onClick={() => changeTab("deleted")}
          className={`px-4 py-2 font-medium text-sm ${
            activeTab === "deleted"
              ? "text-primary border-b-2 border-primary"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Silinmiş
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <label htmlFor="student-search" className="sr-only">
          Şagird axtar
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            id="student-search"
            type="text"
            placeholder="Ad soyad ilə axtar..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input w-full max-w-md !pl-12"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                №
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Ad Soyad
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Sinif
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Email
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Telefon
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Balans
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">
                Əməliyyatlar
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="ml-2">Yüklənir...</span>
                </td>
              </tr>
            ) : students && students.length > 0 ? (
              students.map((student, idx) => (
                <tr
                  key={student.id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="py-3 px-4 text-sm text-slate-600">{idx + 1}</td>
                  <td className="py-3 px-4 text-sm font-medium text-slate-900">
                    {student.fullName}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {student.class || "-"}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {student.email}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {student.phone || "-"}
                  </td>
                  <td
                    className={`py-3 px-4 text-sm ${
                      student.balance < 0
                        ? "font-bold text-red-600"
                        : "font-medium text-slate-900"
                    }`}
                  >
                    {formatPaymentDisplay(student.balance, "teacher")} ₼
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <div className="flex items-center justify-end gap-2">
                      {activeTab === "active" && (
                        <button
                          onClick={() => impersonateMutation.mutate(student)}
                          className="p-2 hover:bg-amber-50 rounded-lg text-amber-700 transition-colors"
                          title="Şagird kimi daxil ol"
                        >
                          <LogIn className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(student)}
                        className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {activeTab === "active" ? (
                        <button
                          onClick={() => setDeletingStudent(student)}
                          className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                          title="Sil (soft delete)"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setRestoringStudent(student)}
                            className="p-2 hover:bg-green-50 rounded-lg text-green-600 transition-colors"
                            title="Bərpa et"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setHardDeletingStudent(student)}
                            className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                            title="Həmişəlik sil"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  Şagird tapılmadı
                  <div className="mt-2 text-xs text-slate-400">
                    (Yeni şagird əlavə etmisinizsə, onun təşkilat/rol məlumatını yoxlayın)
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Student Modal */}
      <Modal
        isOpen={addingStudent}
        onClose={() => setAddingStudent(false)}
        title="Yeni Şagird Əlavə Et"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Ad Soyad *</label>
            <input type="text" className="input" {...register("fullName")} />
            {errors.fullName && (
              <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>
            )}
          </div>
          <div>
            <label className="label">Sinif</label>
            <input type="text" className="input" {...register("class")} />
          </div>
          <div>
            <label className="label">Telefon</label>
            <input type="text" className="input" {...register("phone")} />
          </div>
          <div>
            <label className="label">Balans</label>
            <input
              type="number"
              step="0.01"
              className="input"
              {...register("balance", { valueAsNumber: true })}
            />
            {errors.balance && (
              <p className="mt-1 text-xs text-red-600">{errors.balance.message}</p>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Email və şifrələr avtomatik yaradılacaq. Yaradıldıqdan sonra göstəriləcək.
          </p>
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
              onClick={() => setAddingStudent(false)}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Credentials Modal (after create) */}
      <Modal
        isOpen={!!credentialsModal}
        onClose={() => setCredentialsModal(null)}
        title="Hesab Məlumatları"
        size="sm"
      >
        {credentialsModal && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Bu məlumatları saxlayın. Şifrələr yalnız bir dəfə göstərilir.
            </p>
            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Şagird Email</p>
                <p className="font-mono text-sm">{credentialsModal.studentEmail}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Şagird Şifrə</p>
                <p className="font-mono text-sm">{credentialsModal.studentPassword}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Valideyn Email</p>
                <p className="font-mono text-sm">{credentialsModal.parentEmail}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Valideyn Şifrə</p>
                <p className="font-mono text-sm">{credentialsModal.parentPassword}</p>
              </div>
            </div>
            <p className="text-xs text-amber-600">
              İlk daxil olanda şifrəni dəyişmək mütləqdir.
            </p>
            <button
              onClick={() => setCredentialsModal(null)}
              className="btn-primary w-full"
            >
              Bağla
            </button>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingStudent}
        onClose={() => setEditingStudent(null)}
        title="Şagird Redaktə Et"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Ad Soyad *</label>
            <input
              type="text"
              className="input"
              {...register("fullName")}
            />
            {errors.fullName && (
              <p className="mt-1 text-xs text-red-600">
                {errors.fullName.message}
              </p>
            )}
          </div>

          <div>
            <label className="label">Sinif</label>
            <input type="text" className="input" {...register("class")} />
          </div>

          <div>
            <label className="label">Telefon</label>
            <input type="text" className="input" {...register("phone")} />
          </div>

          <div>
            <label className="label">Balans</label>
            <input
              type="number"
              step="0.01"
              className="input"
              {...register("balance", { valueAsNumber: true })}
            />
            {errors.balance && (
              <p className="mt-1 text-xs text-red-600">
                {errors.balance.message}
              </p>
            )}
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
              onClick={() => setEditingStudent(null)}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingStudent}
        onClose={() => setDeletingStudent(null)}
        title="Şagirdi Sil"
        size="sm"
      >
        <p className="text-slate-600 mb-6">
          "{deletingStudent?.fullName}" adlı şagirdi silmək istədiyinizə
          əminsiniz? Şagird "Silinmiş" bölməsinə köçürüləcək və bərpa edilə bilər.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (deletingStudent) {
                deleteMutation.mutate(deletingStudent.id);
              }
            }}
            className="btn-primary flex-1"
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Silinir..." : "Sil"}
          </button>
          <button
            onClick={() => setDeletingStudent(null)}
            className="btn-outline flex-1"
          >
            Ləğv et
          </button>
        </div>
      </Modal>

      {/* Hard Delete Confirmation Modal */}
      <Modal
        isOpen={!!hardDeletingStudent}
        onClose={() => setHardDeletingStudent(null)}
        title="Şagirdi Həmişəlik Sil"
        size="sm"
      >
        <p className="text-slate-600 mb-6">
          "{hardDeletingStudent?.fullName}" adlı şagirdi həmişəlik silmək istədiyinizə əminsiniz?
          Bu əməliyyat geri alına bilməz və bütün məlumatlar itiriləcək.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (hardDeletingStudent) {
                hardDeleteMutation.mutate(hardDeletingStudent.id);
              }
            }}
            className="flex-1 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 transition-colors disabled:opacity-60"
            disabled={hardDeleteMutation.isPending}
          >
            {hardDeleteMutation.isPending ? "Silinir..." : "Həmişəlik sil"}
          </button>
          <button
            onClick={() => setHardDeletingStudent(null)}
            className="btn-outline flex-1"
          >
            Ləğv et
          </button>
        </div>
      </Modal>

      {/* Restore Confirmation Modal */}
      <Modal
        isOpen={!!restoringStudent}
        onClose={() => setRestoringStudent(null)}
        title="Şagirdi Bərpa Et"
        size="sm"
      >
        <p className="text-slate-600 mb-6">
          "{restoringStudent?.fullName}" adlı şagirdi bərpa etmək istədiyinizə
          əminsiniz? Şagird yenidən aktiv siyahıya köçürüləcək.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (restoringStudent) {
                restoreMutation.mutate(restoringStudent.id);
              }
            }}
            className="btn-primary flex-1 bg-green-600 hover:bg-green-700"
            disabled={restoreMutation.isPending}
          >
            {restoreMutation.isPending ? "Bərpa edilir..." : "Bərpa et"}
          </button>
          <button
            onClick={() => setRestoringStudent(null)}
            className="btn-outline flex-1"
          >
            Ləğv et
          </button>
        </div>
      </Modal>
    </div>
  );
}
