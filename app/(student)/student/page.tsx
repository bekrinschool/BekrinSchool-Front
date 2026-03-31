"use client";

import { useEffect } from "react";
import { useMe } from "@/lib/auth";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { Loading } from "@/components/Loading";
import { useToast } from "@/components/Toast";
import Link from "next/link";
import { CalendarCheck, FileText, Code } from "lucide-react";

const cards = [
  {
    title: "Davamiyyətim",
    description: "Dərsə gəlmə tarixçəni və davamiyyət faizini görə bilərsən",
    icon: CalendarCheck,
    href: "/student/attendance",
    color: "from-blue-500 to-purple-600",
  },
  {
    title: "Quiz Nəticələrim",
    description: "Verdiyim testlərin nəticələrini və qiymətlərimi yoxla",
    icon: FileText,
    href: "/student/results",
    color: "from-pink-500 to-red-600",
  },
  {
    title: "Kodlaşdırma Məşqlərim",
    description: "Python proqramlaşdırma tapşırıqlarını həll et və xal qazan",
    icon: Code,
    href: "/student/coding",
    color: "from-cyan-500 to-blue-600",
  },
];

export default function StudentDashboard() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const { data: user, isLoading } = useMe();
  const { data: stats } = useQuery({
    queryKey: ["student", "stats"],
    queryFn: () => studentApi.getStats(),
  });
  useEffect(() => {
    const msg = searchParams.get("msg");
    if (msg === "exam-finished") {
      toast.info("Bu imtahan artıq başa çatıb.");
    }
  }, [searchParams, toast]);

  if (isLoading) {
    return (
      <div className="page-container">
        <Loading />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Şagird Paneli
        </h1>
        {user && (
          <p className="text-slate-600">
            Xoş gəlmisiniz, <span className="font-semibold">{user.fullName}</span>
          </p>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="card">
            <p className="text-sm text-slate-600">Bu ay qeyri-iştirak</p>
            <p className="text-2xl font-bold text-slate-900">{stats.missedCount}</p>
          </div>
          <div className="card">
            <p className="text-sm text-slate-600">Davamiyyət faizi</p>
            <p className="text-2xl font-bold text-slate-900">{stats.attendancePercent}%</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className={`card bg-gradient-to-br ${card.color} text-white hover:shadow-xl transition-all hover:-translate-y-2 cursor-pointer`}
            >
              <div className="mb-4">
                <Icon className="w-12 h-12" />
              </div>
              <h2 className="text-xl font-semibold mb-2">{card.title}</h2>
              <p className="text-sm opacity-90">{card.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
