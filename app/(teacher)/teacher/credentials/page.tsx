"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  teacherApi,
  CredentialRecord,
  Group,
} from "@/lib/teacher";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { useDebounce } from "@/lib/useDebounce";
import { Eye, Download, Search, Copy } from "lucide-react";

export default function CredentialsPage() {
  const searchParams = useSearchParams();
  const groupFromUrl = searchParams.get("group_id") || "";
  const [groupFilter, setGroupFilter] = useState<string>(groupFromUrl);

  useEffect(() => {
    if (groupFromUrl) setGroupFilter(groupFromUrl);
  }, [groupFromUrl]);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 400);
  const [page, setPage] = useState(1);
  const [revealModal, setRevealModal] = useState<{
    record: CredentialRecord;
    studentPassword?: string;
    parentPassword?: string;
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["teacher", "credentials", groupFilter, debouncedSearch, page],
    queryFn: ({ signal }) =>
      teacherApi.getCredentials(
        {
          groupId: groupFilter || undefined,
          search: debouncedSearch.trim() || undefined,
          page,
          pageSize: 50,
        },
        signal
      ),
  });

  const revealMutation = useMutation({
    mutationFn: (id: number) => teacherApi.revealCredential(id),
    onSuccess: (res) => {
      setRevealModal({
        record: res,
        studentPassword: res.studentPassword,
        parentPassword: res.parentPassword,
      });
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Şifrə açılmadı");
    },
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      await teacherApi.exportCredentialsCsv({
        groupId: groupFilter || undefined,
        search: debouncedSearch.trim() || undefined,
      });
      toast.success("CSV export edildi");
    } catch (err: { message?: string } | unknown) {
      toast.error((err as { message?: string })?.message || "Export xətası");
    } finally {
      setExporting(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} kopyalandı`);
  };

  const results = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / 50) || 1;

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hesab məlumatları</h1>
          <p className="text-sm text-slate-600 mt-1">
            Toplu idxal edilmiş şagird və valideyn hesabları
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-primary flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          {exporting ? "Export edilir..." : "CSV Export"}
        </button>
      </div>

      <div className="card mb-6 p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Ad və ya email ilə axtar..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              className="input !pl-12 w-full"
            />
          </div>
          <select
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setPage(1);
            }}
            className="input w-48"
          >
            <option value="">Hamısı</option>
            {(groups ?? []).map((g: Group) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Ad Soyad</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Sinif</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Şagird Email</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Valideyn Email</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Qruplar</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Yaradılma</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Əməliyyatlar</th>
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
            ) : results.length > 0 ? (
              results.map((rec) => (
                <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 text-sm font-medium text-slate-900">{rec.studentFullName}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">{rec.grade || "-"}</td>
                  <td className="py-3 px-4 text-sm text-slate-600 font-mono">{rec.studentEmail}</td>
                  <td className="py-3 px-4 text-sm text-slate-600 font-mono">{rec.parentEmail || "-"}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {(rec.groups ?? []).join(", ") || "-"}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {rec.createdAt ? new Date(rec.createdAt).toLocaleDateString("az-AZ") : "-"}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <button
                      onClick={() => revealMutation.mutate(rec.id)}
                      disabled={revealMutation.isPending}
                      className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                      title="Şifrəni göstər"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  Toplu idxal edilmiş hesab tapılmadı
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <p className="text-sm text-slate-600">Cəmi {totalCount} qeyd</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-outline text-sm py-1 px-2"
              >
                Əvvəlki
              </button>
              <span className="text-sm text-slate-600">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn-outline text-sm py-1 px-2"
              >
                Növbəti
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!revealModal}
        onClose={() => setRevealModal(null)}
        title="Hesab məlumatları"
        size="sm"
      >
        {revealModal && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Bu məlumatları saxlayın. Şifrələr təhlükəsiz şəkildə saxlanılır.
            </p>
            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Şagird Email</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm">{revealModal.record.studentEmail}</p>
                  <button
                    onClick={() => copyToClipboard(revealModal.record.studentEmail, "Email")}
                    className="p-1 hover:bg-slate-200 rounded"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {revealModal.studentPassword && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Şagird şifrə</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm">{revealModal.studentPassword}</p>
                    <button
                      onClick={() => copyToClipboard(revealModal.studentPassword!, "Şifrə")}
                      className="p-1 hover:bg-slate-200 rounded"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-slate-500">Valideyn Email</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm">{revealModal.record.parentEmail || "-"}</p>
                  {revealModal.record.parentEmail && (
                    <button
                      onClick={() => copyToClipboard(revealModal.record.parentEmail, "Valideyn email")}
                      className="p-1 hover:bg-slate-200 rounded"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              {revealModal.parentPassword && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Valideyn şifrə</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm">{revealModal.parentPassword}</p>
                    <button
                      onClick={() => copyToClipboard(revealModal.parentPassword!, "Valideyn şifrə")}
                      className="p-1 hover:bg-slate-200 rounded"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setRevealModal(null)} className="btn-primary w-full">
              Bağla
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
