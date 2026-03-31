"use client";

import { useQuery } from "@tanstack/react-query";
import { teacherApi, TeacherStats } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import Link from "next/link";
import {
  Users,
  UsersRound,
  CalendarCheck,
  Code,
  FileText,
  CreditCard,
  ClipboardList,
  Database,
  Eye,
  UserPlus,
  BarChart3,
  AlertTriangle,
} from "lucide-react";

const menuCards = [
  {
    title: "Şagirdlər",
    description: "Şagirdlərin siyahısı və idarəetməsi",
    icon: Users,
    href: "/teacher/students",
    color: "from-blue-500 to-blue-600",
  },
  {
    title: "Qruplar",
    description: "Qrupların idarəetməsi və tənzimləməsi",
    icon: UsersRound,
    href: "/teacher/groups",
    color: "from-purple-500 to-purple-600",
  },
  {
    title: "Davamiyyət",
    description: "Şagirdlərin davamiyyət qeydiyyatı",
    icon: CalendarCheck,
    href: "/teacher/attendance",
    color: "from-green-500 to-green-600",
  },
  {
    title: "Ödənişlər",
    description: "Ödənişlərin idarəetməsi və hesabatı",
    icon: CreditCard,
    href: "/teacher/payments",
    color: "from-yellow-500 to-yellow-600",
  },
  {
    title: "Testlər",
    description: "Testlərin yaradılması və qiymətləndirilməsi",
    icon: FileText,
    href: "/teacher/tests",
    color: "from-red-500 to-red-600",
  },
  {
    title: "Kodlaşdırma Tapşırıqları",
    description: "Proqramlaşdırma tapşırıqlarının idarəetməsi",
    icon: Code,
    href: "/teacher/coding",
    color: "from-indigo-500 to-indigo-600",
  },
  {
    title: "Kodlaşdırma Monitorinq",
    description: "Şagirdlərin kodlaşdırma irəliləyişi",
    icon: Eye,
    href: "/teacher/coding-monitor",
    color: "from-cyan-500 to-cyan-600",
  },
  {
    title: "Toplu İdxal",
    description: "CSV ilə toplu şagird əlavə et",
    icon: Database,
    href: "/teacher/bulk-import",
    color: "from-orange-500 to-orange-600",
  },
  {
    title: "İstifadəçi İdarəetməsi",
    description: "İstifadəçilərin yaradılması və idarəetməsi",
    icon: UserPlus,
    href: "/teacher/users",
    color: "from-pink-500 to-pink-600",
  },
];

const quickActions = [
  {
    title: "Bu Gün Davamiyyət",
    description: "Bu gün üçün davamiyyət qeydiyyatı",
    icon: CalendarCheck,
    href: "/teacher/attendance?today=true",
  },
  {
    title: "Yeni Şagird",
    description: "Yeni şagird əlavə et",
    icon: UserPlus,
    href: "/teacher/students?new=true",
  },
  {
    title: "Hesabatlar",
    description: "Statistika və hesabatlar (tezliklə)",
    icon: BarChart3,
    href: "/teacher",
  },
];

export default function TeacherDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["teacher", "stats"],
    queryFn: () => teacherApi.getStats(),
  });

  if (isLoading) {
    return (
      <div className="page-container">
        <Loading />
      </div>
    );
  }

  const statsData: TeacherStats = stats || {
    totalStudents: 0,
    activeStudents: 0,
    todayAttendance: 0,
    codingExercisesCount: 0,
    negativeBalanceStudents: 0,
  };

  return (
    <div className="page-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Müəllim Paneli
        </h1>
        <p className="text-slate-600">Sistem idarəetməsi və monitorinq</p>
      </div>

      {/* Statistika */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Cəmi Şagird</p>
              <p className="text-2xl font-bold text-slate-900">
                {statsData.totalStudents}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <UsersRound className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Aktiv Şagird</p>
              <p className="text-2xl font-bold text-slate-900">
                {statsData.activeStudents}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <CalendarCheck className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Bu Gün İştirak</p>
              <p className="text-2xl font-bold text-slate-900">
                {statsData.todayAttendance}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Code className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Kodlaşdırma Tapşırıqları</p>
              <p className="text-2xl font-bold text-slate-900">
                {statsData.codingExercisesCount}
              </p>
            </div>
          </div>
        </div>

        <div className="card border border-red-100 bg-red-50/40">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-100 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-600">Mənfi balans (borc)</p>
              <p
                className={`text-2xl font-bold ${
                  (statsData.negativeBalanceStudents ?? 0) > 0
                    ? "text-red-600"
                    : "text-slate-900"
                }`}
              >
                {statsData.negativeBalanceStudents ?? 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Əsas Bölmələr */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          Əsas Bölmələr
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {menuCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="card hover:shadow-lg transition-all hover:-translate-y-1 cursor-pointer group"
              >
                <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${card.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  {card.title}
                </h3>
                <p className="text-sm text-slate-600">{card.description}</p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Sürətli Əməliyyatlar */}
      <div>
        <h2 className="text-xl font-semibold text-slate-900 mb-4">
          Sürətli Əməliyyatlar
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="card-muted hover:bg-white hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <Icon className="w-5 h-5 text-slate-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      {action.title}
                    </h3>
                    <p className="text-sm text-slate-600">
                      {action.description}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
