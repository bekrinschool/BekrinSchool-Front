"use client";

import React, { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi } from "@/lib/teacher";
import { useToast } from "@/components/Toast";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Download,
  Info,
} from "lucide-react";

const CSV_FIELDS = [
  { field: "fullName", desc: "Şagirdin tam adı", sample: "Ayşən Əliyeva" },
  { field: "grade", desc: "Sinif", sample: "5A" },
  { field: "studentEmail", desc: "Şagird email (login üçün)", sample: "aysen.aliyeva@bekrin.com" },
  { field: "parentEmail", desc: "Valideyn email (login üçün)", sample: "ali.aliyev@bekrin.com" },
  { field: "password", desc: "Giriş şifrəsi (minimum 6 simvol; boş saxlanılsa avtomatik yaradılır)", sample: "Aysen123" },
];

const SAMPLE_CSV = `fullName,grade,studentEmail,parentEmail,password
Ayşən Əliyeva,5A,aysen.aliyeva@bekrin.com,ali.aliyev@bekrin.com,Aysen123
Məmməd Həsənov,6B,mammad.hasanov@bekrin.com,melik.hasanov@bekrin.com,Mammad99`;

type ImportResult = {
  created: number;
  skipped: number;
  errors: { row: number; field: string; message: string }[];
  credentials: { fullName: string; studentEmail: string; parentEmail: string; password: string }[];
};

export default function BulkImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const importMutation = useMutation({
    mutationFn: async () => {
      if (file) {
        return teacherApi.bulkImportUsers({ file });
      }
      if (csvText.trim()) {
        return teacherApi.bulkImportUsers({ csvText: csvText.trim() });
      }
      throw new Error("CSV faylı və ya mətn sahəsi tələb olunur");
    },
    onSuccess: (data: ImportResult) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(`${data.created} istifadəçi uğurla yaradıldı`);
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "İdxal zamanı xəta baş verdi");
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".csv")) {
      setFile(f);
      setResult(null);
    } else if (f) {
      toast.error("Yalnız CSV faylları qəbul olunur");
    }
  };

  const handleTemplateDownload = async () => {
    try {
      await teacherApi.getBulkImportTemplate();
      toast.success("Şablon yükləndi");
    } catch {
      toast.error("Şablon yüklənmədi");
    }
  };

  const handleSubmit = () => {
    if (!file && !csvText.trim()) {
      toast.error("CSV faylı seçin və ya məzmunu yapışdırın");
      return;
    }
    importMutation.mutate();
  };

  const downloadCredentialsCsv = () => {
    if (!result?.credentials?.length) return;
    const headers = ["fullName", "grade", "studentEmail", "parentEmail", "password"];
    const rows = result.credentials.map((c) => [
      c.fullName,
      "",
      c.studentEmail,
      c.parentEmail,
      c.password,
    ]);
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_credentials.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Hesab məlumatları endirildi");
  };

  const canSubmit = (file || csvText.trim()) && !importMutation.isPending;

  return (
    <div className="page-container min-h-screen bg-gradient-to-br from-violet-50 via-white to-slate-50">
      {/* Başlıq */}
      <div className="card rounded-2xl shadow-md border-slate-200/80 mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <Upload className="w-8 h-8 text-primary" />
          Bulk istifadəçi import
        </h1>
        <p className="text-slate-600 mt-1">
          CSV faylı ilə şagird və valideyn hesablarını toplu yaradın
        </p>
      </div>

      {/* Əsas Məlumatlar */}
      <div className="card rounded-2xl shadow-md border-slate-200/80 mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Info className="w-5 h-5 text-primary" />
          Əsas Məlumatlar
        </h2>
        <ul className="space-y-2 text-sm text-slate-600 list-disc list-inside">
          <li>CSV faylında 5 sahə olmalıdır (fullName, grade, studentEmail, parentEmail, password – password boş ola bilər, avtomatik yaradılır)</li>
          <li>Hər şagird üçün 2 hesab yaradılır (Şagird + Valideyn)</li>
          <li>Şagird və Valideyn üçün eyni şifrə istifadə olunur</li>
          <li>Əlavə məlumatlar (telefon və s.) sonra Müəllim Panelindən əlavə edilə bilər</li>
        </ul>
      </div>

      {/* CSV Sahələri cədvəli */}
      <div className="card rounded-2xl shadow-md border-slate-200/80 mb-6 overflow-hidden">
        <h2 className="text-lg font-semibold text-slate-900 p-4 pb-0">CSV Sahələri</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Saha</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Açıqlama</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Nümunə</th>
              </tr>
            </thead>
            <tbody>
              {CSV_FIELDS.map((r) => (
                <tr key={r.field} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="py-2 px-4 font-mono text-primary">{r.field}</td>
                  <td className="py-2 px-4 text-slate-600">{r.desc}</td>
                  <td className="py-2 px-4 text-slate-500">{r.sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Şablon Yüklə */}
      <div className="card rounded-2xl shadow-md border-slate-200/80 mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Şablon Yüklə</h2>
        <button
          onClick={handleTemplateDownload}
          className="btn-outline flex items-center gap-2 rounded-xl"
        >
          <Download className="w-4 h-4" />
          Template Yüklə
        </button>
      </div>

      {/* CSV Import */}
      <div className="card rounded-2xl shadow-md border-slate-200/80 mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">CSV Import</h2>
        <div className="space-y-4">
          <div>
            <label className="label">CSV faylı</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-white file:cursor-pointer"
            />
            {file && (
              <p className="mt-2 text-sm text-slate-600 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                {file.name}
              </p>
            )}
          </div>
          <div>
            <label className="label">və ya CSV məzmununu bura yapışdırın</label>
            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setResult(null);
              }}
              placeholder={SAMPLE_CSV}
              rows={6}
              className="input font-mono text-sm rounded-xl resize-y"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary flex items-center gap-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-4 h-4" />
            {importMutation.isPending ? "Yaradılır..." : "İstifadəçiləri Yarat"}
          </button>
        </div>

        {/* Nəticə summary */}
        {result && (
          <div className="mt-6 pt-6 border-t border-slate-200">
            <h3 className="font-semibold text-slate-900 mb-3">Nəticə</h3>
            <div className="flex flex-wrap gap-4 mb-4">
              <div className="bg-green-50 rounded-lg px-4 py-2">
                <span className="text-green-700 text-sm">Yaradıldı</span>
                <p className="font-bold text-green-800">{result.created}</p>
              </div>
              <div className="bg-amber-50 rounded-lg px-4 py-2">
                <span className="text-amber-700 text-sm">Keçildi</span>
                <p className="font-bold text-amber-800">{result.skipped}</p>
              </div>
              {result.credentials?.length > 0 && (
                <button
                  onClick={downloadCredentialsCsv}
                  className="btn-outline flex items-center gap-2 rounded-xl"
                >
                  <Download className="w-4 h-4" />
                  Hesab məlumatlarını endir
                </button>
              )}
            </div>
            {result.errors?.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-amber-700 mb-2">
                  <AlertCircle className="w-4 h-4" />
                  <span className="font-medium">Xətalar</span>
                </div>
                <ul className="text-sm text-slate-600 space-y-1 max-h-32 overflow-y-auto bg-slate-50 rounded-lg p-3">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      Sətir {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
