"use client";

import { Modal } from "@/components/Modal";
import type { CodingSubmissionItem } from "@/lib/student";

interface SubmissionHistoryProps {
  submissions: CodingSubmissionItem[];
  isLoading: boolean;
  page: number;
  totalCount: number;
  hasNext: boolean;
  hasPrev: boolean;
  onPageChange: (page: number) => void;
  onViewCode: (submissionId: number) => void;
  codeModalOpen: boolean;
  codeModalContent: string | null;
  codeModalLoading: boolean;
  onCloseCodeModal: () => void;
}

export function SubmissionHistory({
  submissions,
  isLoading,
  page,
  totalCount,
  hasNext,
  hasPrev,
  onPageChange,
  onViewCode,
  codeModalOpen,
  codeModalContent,
  codeModalLoading,
  onCloseCodeModal,
}: SubmissionHistoryProps) {

  const statusLabel: Record<string, string> = {
    passed: "Keçdi",
    failed: "Səhv",
    error: "Xəta",
    timeout: "Vaxt bitdi",
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700">Göndəriş tarixçəsi</h3>
      {isLoading ? (
        <p className="text-slate-500 text-sm">Yüklənir...</p>
      ) : submissions.length === 0 ? (
        <p className="text-slate-500 text-sm">Göndəriş yoxdur</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left py-2 px-3">Cəhd</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Vaxt (ms)</th>
                  <th className="text-left py-2 px-3">Tarix</th>
                  <th className="text-right py-2 px-3">Əməliyyat</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="py-2 px-3">#{s.attemptNo ?? s.id}</td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          s.status === "passed"
                            ? "text-green-600 font-medium"
                            : "text-amber-600"
                        }
                      >
                        {statusLabel[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="py-2 px-3">{s.runtimeMs ?? "—"}</td>
                    <td className="py-2 px-3">
                      {new Date(s.createdAt).toLocaleString("az-AZ")}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onViewCode(s.id)}
                        className="text-primary-600 hover:underline text-xs"
                      >
                        Kodu göstər
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {hasPrev && (
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                className="btn-outline text-sm"
              >
                Əvvəlki
              </button>
            )}
            {hasNext && (
              <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                className="btn-outline text-sm"
              >
                Növbəti
              </button>
            )}
            <span className="text-slate-500 text-sm">Cəmi: {totalCount}</span>
          </div>
        </>
      )}

      <Modal
        isOpen={codeModalOpen}
        onClose={onCloseCodeModal}
        title="Göndərilmiş kod"
        size="lg"
      >
        {codeModalLoading ? (
          <p className="text-slate-500">Yüklənir...</p>
        ) : (
          <pre className="p-4 bg-slate-900 text-slate-100 text-xs rounded overflow-x-auto max-h-96 overflow-y-auto font-mono whitespace-pre">
            {codeModalContent ?? ""}
          </pre>
        )}
      </Modal>
    </div>
  );
}
