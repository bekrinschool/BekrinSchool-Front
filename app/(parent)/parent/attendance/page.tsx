"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { parentApi } from "@/lib/parent";
import { Loading } from "@/components/Loading";
import { ChevronLeft, ChevronRight, Calendar, BarChart3 } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  present: "İştirak",
  absent: "Qeyri-iştirak",
  late: "Gecikmə",
  excused: "Bəhanəli",
};

const STATUS_STYLES: Record<string, string> = {
  present: "bg-green-100 text-green-700",
  absent: "bg-red-100 text-red-700",
  late: "bg-yellow-100 text-yellow-700",
  excused: "bg-gray-100 text-gray-700",
};

function ParentAttendanceContent() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId");
  const today = new Date();
  const [view, setView] = useState<"calendar" | "list" | "summary">("calendar");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const { data: attendance, isLoading } = useQuery({
    queryKey: ["parent", "attendance", studentId],
    queryFn: () => parentApi.getChildAttendance(studentId!),
    enabled: !!studentId,
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ["parent", "attendance", "monthly", studentId, year, month],
    queryFn: () => parentApi.getChildAttendanceMonthly(studentId!, year, month),
    enabled: !!studentId,
  });

  const attendanceByDate = useMemo(() => {
    if (!attendance) return new Map<string, string>();
    const m = new Map<string, string>();
    attendance.forEach((a) => m.set(a.date.slice(0, 10), a.status));
    return m;
  }, [attendance]);

  const monthRecordsForCalendar = useMemo(() => {
    if (!attendance) return new Map<string, string>();
    const m = new Map<string, string>();
    attendance.forEach((a) => {
      const d = new Date(a.date);
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        m.set(a.date.slice(0, 10), a.status);
      }
    });
    return m;
  }, [attendance, year, month]);

  if (!studentId) {
    return (
      <div className="page-container">
        <div className="card text-center py-16">
          <Calendar className="w-12 h-12 mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">Şagird seçilməyib</p>
          <p className="text-sm text-slate-400 mt-1">
            Panel səhifəsindən uşağınızı seçin
          </p>
        </div>
      </div>
    );
  }

  const monthName = new Date(year, month - 1, 1).toLocaleDateString("az-AZ", {
    month: "long",
    year: "numeric",
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Davamiyyət</h1>
        <p className="text-sm text-slate-600 mt-2">
          Uşağınızın davamiyyət tarixçəsi — oxumaq üçün
        </p>
      </div>

      {/* View tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setView("calendar")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out ${
            view === "calendar"
              ? "bg-primary text-white shadow-sm"
              : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
          }`}
        >
          <Calendar className="w-4 h-4" />
          Təqvim
        </button>
        <button
          onClick={() => setView("list")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out ${
            view === "list"
              ? "bg-primary text-white shadow-sm"
              : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
          }`}
        >
          Siyahı
        </button>
        <button
          onClick={() => setView("summary")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out ${
            view === "summary"
              ? "bg-primary text-white shadow-sm"
              : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Aylıq xülasə
        </button>
      </div>

      {/* Monthly summary bar (always visible when we have data) */}
      {monthlyData && (
        <div className="card mb-6 bg-gradient-to-r from-slate-50 to-white border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-slate-700">
              {monthName} — Davamiyyət
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  if (month === 1) {
                    setYear((y) => y - 1);
                    setMonth(12);
                  } else setMonth((m) => m - 1);
                }}
                className="p-1 rounded hover:bg-slate-200"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (month === 12) {
                    setYear((y) => y + 1);
                    setMonth(1);
                  } else setMonth((m) => m + 1);
                }}
                className="p-1 rounded hover:bg-slate-200"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-2 h-3 rounded-full overflow-hidden bg-slate-200">
            {monthlyData.present > 0 && (
              <div
                className="bg-green-500 h-full transition-all"
                style={{
                  width: `${
                    (monthlyData.present /
                      (monthlyData.present +
                        monthlyData.absent +
                        monthlyData.late +
                        monthlyData.excused)) *
                    100
                  }%`,
                }}
                title="İştirak"
              />
            )}
            {monthlyData.excused > 0 && (
              <div
                className="bg-blue-400 h-full"
                style={{
                  width: `${
                    (monthlyData.excused /
                      (monthlyData.present +
                        monthlyData.absent +
                        monthlyData.late +
                        monthlyData.excused)) *
                    100
                  }%`,
                }}
                title="Bəhanəli"
              />
            )}
            {monthlyData.late > 0 && (
              <div
                className="bg-orange-400 h-full"
                style={{
                  width: `${
                    (monthlyData.late /
                      (monthlyData.present +
                        monthlyData.absent +
                        monthlyData.late +
                        monthlyData.excused)) *
                    100
                  }%`,
                }}
                title="Gecikmə"
              />
            )}
            {monthlyData.absent > 0 && (
              <div
                className="bg-red-500 h-full"
                style={{
                  width: `${
                    (monthlyData.absent /
                      (monthlyData.present +
                        monthlyData.absent +
                        monthlyData.late +
                        monthlyData.excused)) *
                    100
                  }%`,
                }}
                title="Qeyri-iştirak"
              />
            )}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {monthlyData.attendancePercent}% davamiyyət
          </p>
        </div>
      )}

      {/* Calendar view */}
      {view === "calendar" && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => {
                if (month === 1) {
                  setYear((y) => y - 1);
                  setMonth(12);
                } else {
                  setMonth((m) => m - 1);
                }
              }}
              className="p-2 rounded-lg hover:bg-slate-100"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="font-semibold text-slate-800">{monthName}</span>
            <button
              onClick={() => {
                if (month === 12) {
                  setYear((y) => y + 1);
                  setMonth(1);
                } else {
                  setMonth((m) => m + 1);
                }
              }}
              className="p-2 rounded-lg hover:bg-slate-100"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {isLoading ? (
            <Loading />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-xs font-medium text-slate-600 mb-2">
                {["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"].map((d) => (
                  <div key={d} className="text-center py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((d, i) => {
                  if (d === null) {
                    return <div key={`empty-${i}`} className="aspect-square" />;
                  }
                  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  const status = monthRecordsForCalendar.get(dateStr);
                  return (
                    <div
                      key={d}
                      className="aspect-square flex flex-col items-center justify-center rounded-lg border border-slate-100"
                      title={status ? `${dateStr}: ${STATUS_LABELS[status] || status}` : dateStr}
                    >
                      <span className="text-slate-600">{d}</span>
                      {status && (
                        <span
                          className={`w-2 h-2 rounded-full mt-0.5 ${
                            status === "present"
                              ? "bg-green-500"
                              : status === "absent"
                              ? "bg-red-500"
                              : status === "late"
                              ? "bg-orange-500"
                              : "bg-blue-500"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 mt-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" /> İştirak
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" /> Qeyri-iştirak
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-orange-500" /> Gecikmə
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> Bəhanəli
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* List view */}
      {view === "list" && (
        <div className="card">
          {isLoading ? (
            <Loading />
          ) : attendance && attendance.length > 0 ? (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                      Tarix
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((item, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="py-3 px-4 text-sm text-slate-600">
                        {new Date(item.date).toLocaleDateString("az-AZ", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                            STATUS_STYLES[item.status] || "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
              Davamiyyət məlumatı tapılmadı
            </div>
          )}
        </div>
      )}

      {/* Summary view */}
      {view === "summary" && (
        <div className="card">
          {monthlyLoading ? (
            <Loading />
          ) : monthlyData ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold text-slate-800">{monthName}</h3>
                <button
                  onClick={() => {
                    if (month === 1) {
                      setYear((y) => y - 1);
                      setMonth(12);
                    } else {
                      setMonth((m) => m - 1);
                    }
                  }}
                  className="p-1.5 rounded hover:bg-slate-100"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    if (month === 12) {
                      setYear((y) => y + 1);
                      setMonth(1);
                    } else {
                      setMonth((m) => m + 1);
                    }
                  }}
                  className="p-1.5 rounded hover:bg-slate-100"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                  <p className="text-xs text-slate-600 mb-1">İştirak</p>
                  <p className="text-2xl font-bold text-green-700">
                    {monthlyData.present}
                  </p>
                </div>
                <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                  <p className="text-xs text-slate-600 mb-1">Qeyri-iştirak</p>
                  <p className="text-2xl font-bold text-red-700">
                    {monthlyData.absent}
                  </p>
                </div>
                <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
                  <p className="text-xs text-slate-600 mb-1">Gecikmə</p>
                  <p className="text-2xl font-bold text-orange-700">
                    {monthlyData.late}
                  </p>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                  <p className="text-xs text-slate-600 mb-1">Bəhanəli</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {monthlyData.excused}
                  </p>
                </div>
                <div className="bg-primary/10 rounded-xl p-4 border border-primary/20 col-span-2 md:col-span-1">
                  <p className="text-xs text-slate-600 mb-1">Davamiyyət %</p>
                  <p className="text-2xl font-bold text-primary">
                    {monthlyData.attendancePercent}%
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-slate-500">
              Aylıq məlumat tapılmadı
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ParentAttendancePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ParentAttendanceContent />
    </Suspense>
  );
}
