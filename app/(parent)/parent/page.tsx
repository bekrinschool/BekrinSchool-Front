"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parentApi, Child } from "@/lib/parent";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { formatPaymentDisplay } from "@/lib/formatPayment";
import { CalendarCheck, CreditCard, FileText } from "lucide-react";
import { ImageScribbleViewer } from "@/components/exam/ImageScribbleViewer";

export default function ParentDashboard() {
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [showExamsModal, setShowExamsModal] = useState(false);
  const [paymentsChildId, setPaymentsChildId] = useState<string | null>(null);
  const [examsChildId, setExamsChildId] = useState<string | null>(null);
  const [selectedExamAttempt, setSelectedExamAttempt] = useState<{ examId: number; attemptId: number } | null>(null);

  const { data: children, isLoading } = useQuery({
    queryKey: ["parent", "children"],
    queryFn: () => parentApi.getChildren(),
  });

  const { data: payments } = useQuery({
    queryKey: ["parent", "payments", paymentsChildId],
    queryFn: () => parentApi.getChildPayments(paymentsChildId!),
    enabled: !!paymentsChildId && showPaymentsModal,
  });

  const { data: examResults = [] } = useQuery({
    queryKey: ["parent", "exam-results", examsChildId],
    queryFn: () => parentApi.getChildExamResults(examsChildId!),
    enabled: !!examsChildId && showExamsModal,
  });
  const { data: examAttemptDetail } = useQuery({
    queryKey: ["parent", "exam-attempt", selectedExamAttempt?.examId, selectedExamAttempt?.attemptId, examsChildId],
    queryFn: () => parentApi.getChildExamAttemptDetail(selectedExamAttempt!.examId, selectedExamAttempt!.attemptId, examsChildId!),
    enabled: !!selectedExamAttempt && !!examsChildId,
  });

  if (isLoading) {
    return (
      <div className="page-container">
        <Loading />
      </div>
    );
  }

  const handlePaymentsClick = (child: Child) => {
    setPaymentsChildId(child.id);
    setShowPaymentsModal(true);
  };

  return (
    <div className="page-container w-full min-w-0 overflow-x-hidden">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Valideyn Paneli
        </h1>
        <p className="text-slate-600">
          Uşaqlarınızın təhsil prosesini izləyin
        </p>
      </div>

      {children && children.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full min-w-0">
          {children.map((child) => (
            <div key={child.id} className="card hover:shadow-lg transition-all min-w-0 flex flex-col">
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-slate-200 min-w-0">
                <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-lg sm:text-xl font-semibold">
                  {child.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h3
                    className="text-lg font-semibold text-slate-900 truncate"
                    title={child.fullName}
                  >
                    {child.fullName}
                  </h3>
                  <p
                    className="text-sm text-slate-600 truncate"
                    title={child.class ? `Sinif: ${child.class}` : "-"}
                  >
                    {child.class ? `Sinif: ${child.class}` : "-"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Davamiyyət %</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {child.attendancePercent !== undefined
                      ? `${child.attendancePercent}%`
                      : "-"}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Balans</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {formatPaymentDisplay(child.balance, "parent")} ₼
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Son Test</p>
                  <p className="text-sm font-medium text-slate-900">
                    {child.lastTest
                      ? `${child.lastTest.score}/${child.lastTest.maxScore}`
                      : "-"}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">
                    Kodlaşdırma
                  </p>
                  <p className="text-2xl font-bold text-slate-900">
                    {child.codingSolvedCount != null && child.codingTotalTasks != null
                      ? `${child.codingSolvedCount} / ${child.codingTotalTasks}`
                      : "-"}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {child.codingPercent != null ? `${child.codingPercent}%` : child.codingLastActivity ? `Son: ${new Date(child.codingLastActivity).toLocaleDateString("az-AZ")}` : ""}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-auto">
                <a
                  href={`/parent/attendance?studentId=${child.id}`}
                  className="btn-outline text-center text-sm py-2 px-3 min-w-0 overflow-hidden"
                >
                  <CalendarCheck className="w-4 h-4 inline mr-1.5 sm:mr-2 shrink-0" />
                  <span className="truncate">Davamiyyət</span>
                </a>
                <button
                  onClick={() => handlePaymentsClick(child)}
                  className="btn-outline text-center text-sm py-2 px-3 min-w-0 overflow-hidden"
                >
                  <CreditCard className="w-4 h-4 inline mr-1.5 sm:mr-2 shrink-0" />
                  <span className="truncate">Ödənişlər</span>
                </button>
                <a
                  href={`/parent/results?studentId=${child.id}`}
                  className="btn-outline text-center text-sm py-2 px-3 min-w-0 overflow-hidden"
                >
                  <FileText className="w-4 h-4 inline mr-1.5 sm:mr-2 shrink-0" />
                  <span className="truncate">İmtahanlar</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <p className="text-slate-500 mb-2">Hələ şagird əlavə edilməyib</p>
          <p className="text-sm text-slate-400">
            Məktəb administrasiyası ilə əlaqə saxlayın
          </p>
        </div>
      )}

      {/* Exams Modal */}
      <Modal
        isOpen={showExamsModal}
        onClose={() => {
          setShowExamsModal(false);
          setExamsChildId(null);
          setSelectedExamAttempt(null);
        }}
        title={selectedExamAttempt && examAttemptDetail ? examAttemptDetail.title : "İmtahan Nəticələri"}
        size="lg"
      >
        {selectedExamAttempt && examAttemptDetail ? (
          <div className="space-y-4">
            <p className="text-lg font-semibold text-green-700">Yekun: {examAttemptDetail.score}</p>
            {examAttemptDetail.pages?.length && examAttemptDetail.pdfScribbles && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Şagirdin PDF qaralamaları</h4>
                <ImageScribbleViewer
                  pages={examAttemptDetail.pages}
                  pdfScribbles={examAttemptDetail.pdfScribbles}
                  maxHeight={400}
                />
              </div>
            )}
            {examAttemptDetail.canvases && examAttemptDetail.canvases.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Situasiya qaralamaları</h4>
                <div className="space-y-3">
                  {examAttemptDetail.canvases.map((c) => c.imageUrl && (
                    <div key={c.canvasId}>
                      <img
                        src={c.imageUrl}
                        alt={`Sual ${c.questionId} qaralama`}
                        className="max-w-full max-h-64 rounded border border-slate-200"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSelectedExamAttempt(null)}
              className="btn-outline"
            >
              Geri
            </button>
          </div>
        ) : examResults.length > 0 ? (
          <ul className="space-y-2">
            {examResults.map((r) => (
              <li key={r.attemptId} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <span className="font-medium text-slate-900">{r.title}</span>
                <div className="flex items-center gap-3">
                  {r.is_result_published && r.score != null ? (
                    <span className="text-sm text-slate-600">{r.score} / {r.maxScore ?? "—"}</span>
                  ) : (
                    <span className="text-sm text-amber-600">Yoxlanılır / Nəticə yayımda deyil</span>
                  )}
                  {r.is_result_published && (
                    <button
                      type="button"
                      onClick={() => setSelectedExamAttempt({ examId: r.examId, attemptId: r.attemptId })}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Nəticəyə bax
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-12 text-slate-500">İmtahan nəticəsi tapılmadı</div>
        )}
      </Modal>

      {/* Payments Modal */}
      <Modal
        isOpen={showPaymentsModal}
        onClose={() => {
          setShowPaymentsModal(false);
          setPaymentsChildId(null);
        }}
        title="Ödənişlər"
        size="lg"
      >
        {payments && payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Ödəniş
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Tarix
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Məbləğ
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Üsul
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...payments]
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map((payment, i) => {
                    const n = i + 1;
                    const suf: Record<number, string> = { 1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cu", 0: "cu" };
                    const ord = `${n}-${suf[n % 10] ?? "ci"} ödəniş`;
                    return (
                  <tr
                    key={payment.id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">
                      {ord}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(payment.date).toLocaleDateString("az-AZ")}
                    </td>
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">
                      {formatPaymentDisplay(payment.amount, "parent")} ₼
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {payment.method === "cash"
                        ? "Nəğd"
                        : payment.method === "card"
                        ? "Kart"
                        : "Bank köçürməsi"}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                          payment.status === "paid"
                            ? "bg-green-100 text-green-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {payment.status === "paid" ? "Ödənilib" : "Gözləyir"}
                      </span>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500">
            Ödəniş tapılmadı
          </div>
        )}
      </Modal>
    </div>
  );
}
