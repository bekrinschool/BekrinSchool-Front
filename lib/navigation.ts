import {
  Users,
  UsersRound,
  CalendarCheck,
  Code,
  FileText,
  CreditCard,
  Database,
  Eye,
  UserPlus,
  LayoutDashboard,
  Key,
  Library,
  Archive,
  LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const teacherNav: NavItem[] = [
  { href: "/teacher", label: "Panel", icon: LayoutDashboard },
  { href: "/teacher/students", label: "Şagirdlər", icon: Users },
  { href: "/teacher/groups", label: "Qruplar", icon: UsersRound },
  { href: "/teacher/attendance", label: "Davamiyyət", icon: CalendarCheck },
  { href: "/teacher/payments", label: "Ödənişlər", icon: CreditCard },
  { href: "/teacher/tests", label: "Testlər", icon: FileText },
  { href: "/teacher/tests?tab=archive", label: "Arxiv", icon: Archive },
  { href: "/teacher/question-bank", label: "Sual bankı", icon: Library },
  { href: "/teacher/coding", label: "Kodlaşdırma", icon: Code },
  { href: "/teacher/coding-monitor", label: "Monitorinq", icon: Eye },
  { href: "/teacher/bulk-import", label: "Toplu İdxal", icon: Database },
  { href: "/teacher/credentials", label: "Hesab məlumatları", icon: Key },
  { href: "/teacher/users", label: "İstifadəçilər", icon: UserPlus },
];

export const studentNav: NavItem[] = [
  { href: "/student", label: "Panel", icon: LayoutDashboard },
  { href: "/student/attendance", label: "Davamiyyətim", icon: CalendarCheck },
  { href: "/student/exams", label: "İmtahanlar", icon: FileText },
  { href: "/student/results", label: "Nəticələr", icon: FileText },
  { href: "/student/coding", label: "Kodlaşdırma", icon: Code },
];

export const parentNav: NavItem[] = [
  { href: "/parent", label: "Panel", icon: LayoutDashboard },
  { href: "/parent/attendance", label: "Davamiyyət", icon: CalendarCheck },
  { href: "/parent/results", label: "İmtahanlar", icon: FileText },
];
