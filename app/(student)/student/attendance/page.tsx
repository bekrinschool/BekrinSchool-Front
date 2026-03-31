"use client";

import { useQuery } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { Loading } from "@/components/Loading";

export default function StudentAttendancePage() {
  const { data: attendance, isLoading } = useQuery({
    queryKey: ["student", "attendance"],
    queryFn: () => studentApi.getAttendance(),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Davamiyyətim</h1>
        <p className="text-sm text-slate-600 mt-2">
          Dərsə gəlmə tarixçəniz və davamiyyət faiziniz
        </p>
      </div>

      <div className="card">
        {attendance && attendance.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Tarix
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Qrup
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
                      {new Date(item.date).toLocaleDateString("az-AZ")}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                          item.status === "present"
                            ? "bg-green-100 text-green-700"
                            : item.status === "late"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {item.status === "present"
                          ? "İştirak"
                          : item.status === "late"
                          ? "Gecikmə"
                          : "Qeyri-iştirak"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {item.groupName || "-"}
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
    </div>
  );
}
