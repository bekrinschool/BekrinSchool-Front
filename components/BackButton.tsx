"use client";

import { useRouter, usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const ROLE_ROOTS = ["/teacher", "/student", "/parent"];

export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  const isAtRoleRoot = ROLE_ROOTS.some(
    (root) => pathname === root || pathname === root + "/"
  );
  const canGoBack = !isAtRoleRoot;

  const handleBack = () => {
    if (canGoBack) {
      router.back();
    }
  };

  return (
    <button
      onClick={handleBack}
      disabled={!canGoBack}
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      title={canGoBack ? "Geri" : "Geri getmək mümkün deyil"}
      aria-label="Geri"
    >
      <ArrowLeft className="w-4 h-4" />
      <span className="hidden sm:inline">Geri</span>
    </button>
  );
}
