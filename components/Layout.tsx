"use client";

import { useEffect, useState } from "react";
import { useMe, useLogout, useStopImpersonation } from "@/lib/auth";
import { LogOut, User, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { teacherNav, studentNav, parentNav } from "@/lib/navigation";
import { BackButton } from "@/components/BackButton";
import { NotificationsBell } from "@/components/NotificationsBell";
import { useExamRun } from "@/lib/exam-run-context";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useMe();
  const logout = useLogout();
  const stopImpersonation = useStopImpersonation();
  const pathname = usePathname();
  const router = useRouter();
  const { isExamRunning } = useExamRun();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const hideSidebar = isExamRunning && pathname?.startsWith("/student/exams");
  const compactSidebar = pathname?.startsWith("/teacher/attendance") || pathname?.startsWith("/student/attendance") || pathname?.startsWith("/parent/attendance");

  useEffect(() => {
    if (user?.mustChangePassword) {
      router.replace("/change-password");
    }
  }, [user?.mustChangePassword, router]);

  useEffect(() => {
    if (hideSidebar) {
      document.documentElement.classList.add("body-exam-lock");
    } else {
      document.documentElement.classList.remove("body-exam-lock");
    }
    return () => document.documentElement.classList.remove("body-exam-lock");
  }, [hideSidebar]);

  // Only use role from /api/auth/me - never infer from pathname
  const role = user?.role;
  const roleLabels: Record<string, string> = {
    teacher: "Müəllim",
    student: "Şagird",
    parent: "Valideyn",
  };

  // Determine nav based on role (fallback to empty if role not loaded yet)
  const nav =
    role === "teacher"
      ? teacherNav
      : role === "student"
      ? studentNav
      : role === "parent"
      ? parentNav
      : [];

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);

  return (
    <div className={`flex bg-slate-50 ${hideSidebar ? "h-screen min-h-0 overflow-hidden" : "min-h-screen"}`}>
      {/* Mobile overlay when sidebar is open on small screens */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar: hidden during exam run to maximize space; collapsible otherwise */}
      {!hideSidebar && (
      <aside
        className={`fixed md:static inset-y-0 left-0 w-56 bg-white border-r border-slate-200 flex-shrink-0 z-50 transform transition-all duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${
          isSidebarOpen ? "md:translate-x-0 md:w-56" : "md:-translate-x-full md:w-0 md:overflow-hidden"
        }`}
      >
        <div className={`sticky top-0 h-full overflow-y-auto w-56 ${compactSidebar ? "py-2" : "py-4"}`}>
          <div className={`px-4 flex items-center justify-between ${compactSidebar ? "mb-2" : "mb-4"}`}>
            <div>
              <Link href={role === "teacher" ? "/teacher" : role === "student" ? "/student" : role === "parent" ? "/parent" : "/login"} className={`${compactSidebar ? "text-base" : "text-lg"} font-semibold text-slate-900`}>
                Bekrin School
              </Link>
              {role && <p className="text-xs text-slate-500 mt-0.5">{roleLabels[role]} Paneli</p>}
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1 hover:bg-slate-100 rounded"
              aria-label="Sidebarı bağla"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {role && (
            <nav className="space-y-0.5 px-2">
              {nav.map((item) => {
                const Icon = item.icon;
                const roleRoot = `/${role}`;
                const isExactMatch = pathname === item.href;
                const isNestedMatch =
                  item.href !== roleRoot &&
                  pathname.startsWith(item.href + "/");
                const isActive = isExactMatch || isNestedMatch;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-2 rounded-lg px-3 ${compactSidebar ? "py-1.5 text-[13px]" : "py-2 text-sm"} font-medium transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              }          )}
        </nav>
      )}
        </div>
      </aside>
      )}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${hideSidebar ? "min-h-0 overflow-hidden" : ""}`}>
        <header className="bg-white border-b border-slate-200 px-4 flex-shrink-0 min-h-14 flex items-center">
          <div className="flex w-full items-center justify-between gap-4 pt-3 pb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => (window.innerWidth >= 768 ? toggleSidebar() : setSidebarOpen(!sidebarOpen))}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label={isSidebarOpen ? "Sidebarı gizlət" : "Sidebarı göstər"}
              >
                <Menu className="w-5 h-5 text-slate-700" />
              </button>
              {!hideSidebar && <BackButton />}
              <h1 className="text-lg font-semibold text-slate-900 md:hidden">Bekrin School</h1>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <User className="w-4 h-4" />
                  <span>{user.fullName}</span>
                </div>
              )}
              {role === "teacher" && <NotificationsBell />}
              <button
                onClick={() => logout.mutate()}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Çıxış
              </button>
            </div>
          </div>
        </header>
        {user?.is_impersonating && (
          <div
            className="impersonation-banner flex-shrink-0"
            style={{
              background: "#ffcc00",
              padding: "8px",
              textAlign: "center",
              fontWeight: 700,
            }}
          >
            You are viewing as student.{" "}
            <button
              type="button"
              onClick={() => stopImpersonation.mutate()}
              disabled={stopImpersonation.isPending}
              className="underline font-bold"
            >
              Return to Teacher
            </button>
          </div>
        )}
        <main className={hideSidebar ? "flex-1 min-h-0 overflow-hidden flex flex-col" : "flex-1"}>{children}</main>
      </div>
    </div>
  );
}
