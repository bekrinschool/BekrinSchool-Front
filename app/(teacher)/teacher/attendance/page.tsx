"use client";

import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  teacherApi,
  AttendanceStatus,
  AttendanceEntryState,
  LESSON_DAY_LABELS,
} from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { AttendanceTableSkeleton } from "@/components/AttendanceTableSkeleton";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  X,
} from "lucide-react";

/** Daily list filter: segmented control (Hamısı | İştirak | Qeyri-iştirak | Üzrlü) */
const DAILY_STATUS_SEGMENTS: { value: "" | AttendanceStatus; label: string }[] = [
  { value: "", label: "Hamısı" },
  { value: "present", label: "İştirak" },
  { value: "absent", label: "Qeyri-iştirak" },
  { value: "excused", label: "Üzrlü" },
];

const STATUS_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  {
    value: "present",
    label: "İştirak",
    color: "text-green-700",
    bg: "bg-green-100",
    border: "border-green-300",
  },
  {
    value: "absent",
    label: "Qeyri-iştirak",
    color: "text-red-700",
    bg: "bg-red-100",
    border: "border-red-300",
  },
  {
    value: "late",
    label: "Gecikmə",
    color: "text-amber-700",
    bg: "bg-amber-100",
    border: "border-amber-300",
  },
  {
    value: "excused",
    label: "Bəhanəli",
    color: "text-blue-700",
    bg: "bg-blue-100",
    border: "border-blue-300",
  },
];

/** Cədvəl hüceyrə pill (qısa mətn + rənglər məzmunla uyğun) */
const STATUS_PILL: Record<string, string> = {
  present: "bg-green-100 text-green-800",
  absent: "bg-red-100 text-red-800",
  late: "bg-blue-100 text-blue-800",
  excused: "bg-amber-100 text-amber-900",
};

const STATUS_SHORT: Record<string, string> = {
  present: "İşt.",
  absent: "Qay.",
  late: "Gec.",
  excused: "İcz.",
};

/** Cədvəl: 4 status — dərhal lokal yeniləmə + debounced server saxlama */
const GRID_CELL_MENU_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  itemClass: string;
}[] = [
  { value: "present", label: "İştirak (İşt.)", itemClass: "text-green-700" },
  { value: "absent", label: "Qayıb (Qay.)", itemClass: "text-red-700" },
  { value: "excused", label: "İcazəli (İcz.)", itemClass: "text-amber-700" },
  { value: "late", label: "Gecikmə (Gec.)", itemClass: "text-blue-700" },
];

const GRID_PERSIST_DEBOUNCE_MS = 450;

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getWeekdayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const js = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const our = js === 0 ? 7 : js; // our 1=Mon, 7=Sun
  return LESSON_DAY_LABELS[our] ?? "";
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type PresetKey = "last8" | "last15" | "thisMonth" | "custom";

export default function AttendancePage() {
  const ROWS_TARGET = 20; // hard requirement: 20+ visible without scroll
  const today = new Date();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view") || "daily";
  const groupParam = searchParams.get("group");
  const dateParam = searchParams.get("date") || formatDate(today);

  const [view, setView] = useState<"daily" | "grid" | "monthly">(
    () => (viewParam as "daily" | "grid" | "monthly") || "daily"
  );
  const monthFromUrl = searchParams.get("month");
  const [monthParam, setMonthParam] = useState(() => {
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) return monthFromUrl;
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  });
  const [breakdownStudent, setBreakdownStudent] = useState<{
    id: string;
    fullName: string;
    attendancePercent?: number;
    missedPercent?: number;
  } | null>(null);
  useEffect(() => {
    if (!viewParam && typeof window !== "undefined" && window.innerWidth < 768) {
      setView("daily");
    }
  }, [viewParam]);
  useEffect(() => {
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) {
      setMonthParam(monthFromUrl);
    }
  }, [monthFromUrl]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groupParam || "");
  const [selectedDate, setSelectedDate] = useState(dateParam);
  const [preset, setPreset] = useState<PresetKey>("last8");
  const [customFrom, setCustomFrom] = useState(formatDate(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(formatDate(today));
  const [dailyLocal, setDailyLocal] = useState<Record<string, AttendanceStatus>>({});
  const [gridLocal, setGridLocal] = useState<Record<string, AttendanceStatus>>({});
  const [gridClearedKeys, setGridClearedKeys] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | AttendanceStatus>("");
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>("present");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openCellMenu, setOpenCellMenu] = useState<{
    studentId: string;
    dateStr: string;
    anchorRect: { left: number; top: number; bottom: number; width: number };
  } | null>(null);
  const cellMenuRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  const [rowHeight, setRowHeight] = useState(32);

  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
  });
  const sortedGroups = useMemo(() => {
    const list = [...(groups ?? [])];
    list.sort((a, b) =>
      (a.display_name || a.name || "").localeCompare(
        b.display_name || b.name || "",
        "az",
        { sensitivity: "base", numeric: true }
      )
    );
    return list;
  }, [groups]);

  // Full-height layout: compute compact header height + dynamic row height
  useLayoutEffect(() => {
    const compute = () => {
      const h = headerRef.current?.getBoundingClientRect().height ?? 72;
      setHeaderHeight(Math.round(h));
      // Reserve a little for table header + borders; keep within a readable range
      const available = window.innerHeight - h - 8; // tighter to fit 20 rows
      const next = Math.floor(available / ROWS_TARGET);
      const clamped = Math.max(24, Math.min(40, next));
      setRowHeight(clamped);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [view, selectedGroupId]);

  const [yearParam, monthNumParam] = useMemo(() => {
    const [y, m] = monthParam.split("-").map(Number);
    return [y, m];
  }, [monthParam]);

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ["teacher", "attendance", "monthly", selectedGroupId, yearParam, monthNumParam],
    queryFn: () =>
      teacherApi.getAttendanceMonthly(
        selectedGroupId,
        yearParam,
        monthNumParam
      ),
    enabled: !!selectedGroupId && view === "monthly",
  });

  const { data: breakdownData } = useQuery({
    queryKey: [
      "teacher",
      "attendance",
      "breakdown",
      breakdownStudent?.id,
      monthParam,
    ],
    queryFn: () =>
      teacherApi.getStudentDailyBreakdown(
        selectedGroupId,
        breakdownStudent!.id,
        parseInt(monthParam.slice(0, 4), 10),
        parseInt(monthParam.slice(5, 7), 10)
      ),
    enabled: !!breakdownStudent && !!selectedGroupId,
  });

  const dateRange = useMemo((): { from: string; to: string } => {
    const t = new Date();
    const y = t.getFullYear();
    const m = t.getMonth();
    const d = t.getDate();
    if (preset === "last8" || preset === "last15") {
      const n = preset === "last8" ? 8 : 15;
      const to = formatDate(t);
      const from = formatDate(new Date(y, m, d - n * 7));
      return { from, to };
    }
    if (preset === "thisMonth") {
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      return { from: formatDate(first), to: formatDate(last) };
    }
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const { data: gridData, isLoading: gridLoading } = useQuery({
    queryKey: ["attendanceGrid", selectedGroupId, dateRange.from, dateRange.to],
    queryFn: () =>
      teacherApi.getAttendanceGridNew({
        groupId: selectedGroupId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled: !!selectedGroupId && view === "grid",
  });

  const displayedDates = useMemo(() => {
    if (!gridData?.dates?.length) return [];
    const n = preset === "last8" ? 8 : preset === "last15" ? 15 : 999;
    return gridData.dates.slice(0, n);
  }, [gridData?.dates, preset]);

  const recordMap = useMemo(() => {
    const m = new Map<string, AttendanceStatus>();
    if (!gridData?.records) return m;
    for (const r of gridData.records) {
      m.set(`${r.student_id}_${r.date}`, r.status as AttendanceStatus);
    }
    return m;
  }, [gridData?.records]);

  const bulkUpsertMutation = useMutation({
    mutationFn: (items: { studentId: string; date: string; status: AttendanceStatus }[]) =>
      teacherApi.bulkUpsertAttendance({
        groupId: selectedGroupId,
        items,
        entry_state: "CONFIRMED",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendanceGrid"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceMonthly"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "notifications", "low-balance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "payments"] });
      queryClient.invalidateQueries({ queryKey: ["student", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["parent", "children"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Xəta baş verdi");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (items: { studentId: string; date: string }[]) =>
      teacherApi.bulkDeleteAttendance({ groupId: selectedGroupId, items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendanceGrid"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceMonthly"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "notifications", "low-balance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "payments"] });
      queryClient.invalidateQueries({ queryKey: ["student", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["parent", "children"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Xəta baş verdi");
    },
  });

  const handleMarkAllPresentForGridDate = (dateStr: string) => {
    if (!gridData?.students?.length) return;
    setGridClearedKeys((prev) => {
      const next = new Set(prev);
      gridData.students.forEach((s) => next.delete(`${s.id}_${dateStr}`));
      return next;
    });
    setGridLocal((prev) => {
      const next = { ...prev };
      gridData.students.forEach((s) => {
        next[`${s.id}_${dateStr}`] = "present";
      });
      return next;
    });
  };

  const setGridCellStatus = useCallback(
    (studentId: string, dateStr: string, status: AttendanceStatus | null) => {
      const key = `${studentId}_${dateStr}`;
      if (status === null) {
        setGridLocal((prev) => {
          const n = { ...prev };
          delete n[key];
          return n;
        });
        setGridClearedKeys((prev) => new Set(prev).add(key));
        return;
      }
      setGridLocal((prev) => ({ ...prev, [key]: status }));
      setGridClearedKeys((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    },
    []
  );

  const getEffectiveGridStatus = useCallback(
    (studentId: string, dateStr: string): AttendanceStatus | null => {
      const key = `${studentId}_${dateStr}`;
      if (gridClearedKeys.has(key)) return null;
      if (gridLocal[key] !== undefined) return gridLocal[key];
      return recordMap.get(key) ?? null;
    },
    [gridClearedKeys, gridLocal, recordMap]
  );

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ["teacher", "attendance", "daily", selectedGroupId, selectedDate],
    queryFn: () => teacherApi.getAttendanceDaily(selectedGroupId, selectedDate),
    enabled: !!selectedGroupId && view === "daily",
  });

  const saveMutation = useMutation({
    mutationFn: (data: {
      date: string;
      groupId: string;
      records: { studentId: string; status: AttendanceStatus }[];
      finalize?: boolean;
      entry_state?: AttendanceEntryState;
    }) => teacherApi.saveAttendance(data),
    onSuccess: (data) => {
      
      // PART 3: Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "notifications", "low-balance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["student", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["parent", "children"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      
      // Success / already marked: no balance info in toast
      if (data.charged && data.charged_count > 0) {
        toast.success("Attendance successfully marked.", { duration: 5000 });
      } else if (data.charged === false && (data as { finalize?: boolean }).finalize !== false) {
        toast.info("Attendance was already marked for this lesson.");
      } else {
        toast.success("Attendance successfully marked.");
      }
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Davamiyyət saxlanılmadı.");
    },
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        openCellMenu &&
        cellMenuRef.current &&
        !cellMenuRef.current.contains(e.target as Node)
      ) {
        setOpenCellMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openCellMenu]);

  useEffect(() => {
    if (dailyData?.students) {
      const map: Record<string, AttendanceStatus> = {};
      dailyData.students.forEach((s) => {
        map[s.id] = s.status;
      });
      setDailyLocal(map);
      setSelectedIds(new Set());
    }
  }, [dailyData]);

  useEffect(() => {
    if (view !== "grid") return;
    setGridLocal({});
    setGridClearedKeys(new Set());
    setOpenCellMenu(null);
  }, [view, selectedGroupId, dateRange.from, dateRange.to]);

  const syncUrl = useCallback(
    (updates: Record<string, string>) => {
      const qs = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v) qs.set(k, v);
        else qs.delete(k);
      });
      router.replace(`/teacher/attendance?${qs.toString()}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  const changeView = (v: "daily" | "grid" | "monthly") => {
    setView(v);
    syncUrl({ view: v });
  };

  const changeGroup = (id: string) => {
    setSelectedGroupId(id);
    syncUrl({ group: id });
  };

  const handleConfirm = async () => {
    if (!selectedGroupId) return;
    if (view === "grid") {
      if (!gridData?.students?.length || !displayedDates.length) return;
      const upserts: { studentId: string; date: string; status: AttendanceStatus }[] = [];
      const deletes: { studentId: string; date: string }[] = [];
      for (const s of gridData.students) {
        for (const d of displayedDates) {
          const key = `${s.id}_${d}`;
          const base = recordMap.get(key) ?? null;
          let eff: AttendanceStatus | null;
          if (gridClearedKeys.has(key)) eff = null;
          else if (gridLocal[key] !== undefined) eff = gridLocal[key];
          else eff = base;
          if (eff === base) continue;
          if (eff == null && base != null) {
            deletes.push({ studentId: s.id, date: d });
          } else if (eff != null) {
            upserts.push({ studentId: s.id, date: d, status: eff });
          }
        }
      }
      if (deletes.length === 0 && upserts.length === 0) {
        toast.info("Dəyişiklik yoxdur.");
        return;
      }
      try {
        if (deletes.length) {
          await bulkDeleteMutation.mutateAsync(deletes);
        }
        if (upserts.length) {
          await bulkUpsertMutation.mutateAsync(upserts);
        }
        setGridLocal({});
        setGridClearedKeys(new Set());
        toast.success("Davamiyyət təsdiqləndi");
      } catch {
        /* onError on mutations */
      }
      return;
    }
    if (!dailyData) return;
    const records = dailyData.students.map((s) => ({
      studentId: s.id,
      status: dailyLocal[s.id] ?? s.status,
    }));
    saveMutation.mutate({
      date: selectedDate,
      groupId: selectedGroupId,
      records,
      finalize: true,
      entry_state: "CONFIRMED",
    });
  };

  const markAllPresent = () => {
    if (view === "daily" && dailyData?.students?.length) {
      const next: Record<string, AttendanceStatus> = {};
      dailyData.students.forEach((s) => {
        next[s.id] = "present";
      });
      setDailyLocal(next);
      return;
    }
    if (view === "grid" && gridData?.students?.length) {
      const todayStr = formatDate(today);
      handleMarkAllPresentForGridDate(todayStr);
    }
  };

  const applyBulk = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setDailyLocal((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => {
        next[id] = bulkStatus;
      });
      return next;
    });
    setSelectedIds(new Set());
    toast.success(`${count} şagird yeniləndi`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredDailyStudents = useMemo(() => {
    if (!dailyData?.students) return [];
    let list = dailyData.students;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((s) => s.fullName.toLowerCase().includes(q));
    }
    if (filterStatus) {
      list = list.filter(
        (s) => (dailyLocal[s.id] ?? s.status) === filterStatus
      );
    }
    return list;
  }, [dailyData, debouncedSearch, filterStatus, dailyLocal]);

  const filteredGridStudents = useMemo(() => {
    if (!gridData?.students) return [];
    let list = gridData.students;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((s) =>
        (s.full_name || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [gridData?.students, debouncedSearch]);

  const filteredMonthlyStudents = useMemo(() => {
    if (!monthlyData?.students) return [];
    let list = monthlyData.students;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((s) =>
        (s.fullName || (s as { full_name?: string }).full_name || "")
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [monthlyData?.students, debouncedSearch]);

  const monthName = useMemo(() => {
    const [y, m] = monthParam.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("az-AZ", {
      month: "long",
      year: "numeric",
    });
  }, [monthParam]);

  const serverDailyConfirmed = useMemo(() => {
    if (!dailyData?.students?.length) return false;
    return dailyData.students.every(
      (s) => (s.entryState ?? "DRAFT") === "CONFIRMED"
    );
  }, [dailyData]);

  const dailyDirty = useMemo(() => {
    if (!dailyData?.students) return false;
    return dailyData.students.some(
      (s) => (dailyLocal[s.id] ?? s.status) !== s.status
    );
  }, [dailyData, dailyLocal]);

  const dailyEntryLabel: "DRAFT" | "CONFIRMED" =
    dailyDirty || !serverDailyConfirmed ? "DRAFT" : "CONFIRMED";

  const gridServerConfirmed = useMemo(() => {
    if (!gridData?.records?.length || !displayedDates.length) return false;
    const dateSet = new Set(displayedDates);
    const studentSet = new Set(gridData.students.map((s) => s.id));
    const visible = gridData.records.filter(
      (r) => dateSet.has(r.date) && studentSet.has(r.student_id)
    );
    if (visible.length === 0) return false;
    return visible.every((r) => (r.entry_state ?? "DRAFT") === "CONFIRMED");
  }, [gridData, displayedDates]);

  const gridDirty = useMemo(() => {
    if (!gridData?.students?.length || !displayedDates.length) return false;
    for (const s of gridData.students) {
      for (const d of displayedDates) {
        const key = `${s.id}_${d}`;
        const base = recordMap.get(key) ?? null;
        let eff: AttendanceStatus | null;
        if (gridClearedKeys.has(key)) eff = null;
        else if (gridLocal[key] !== undefined) eff = gridLocal[key];
        else eff = base;
        if (eff !== base) return true;
      }
    }
    return false;
  }, [gridData, displayedDates, recordMap, gridLocal, gridClearedKeys]);

  const gridEntryLabel: "DRAFT" | "CONFIRMED" =
    gridDirty || !gridServerConfirmed ? "DRAFT" : "CONFIRMED";

  const isSaving =
    bulkUpsertMutation.isPending ||
    bulkDeleteMutation.isPending ||
    saveMutation.isPending;

  const confirmDisabled =
    view === "daily"
      ? isSaving || (!dailyDirty && serverDailyConfirmed)
      : view === "grid"
        ? isSaving || (!gridDirty && gridServerConfirmed)
        : true;


  /** Row density vs. base `rowHeight` (Aylıq uses 100%). */
  const dailyRowHeight = useMemo(
    () => Math.max(20, Math.round(rowHeight * 0.9)),
    [rowHeight]
  );
  const gridRowHeight = useMemo(
    () => Math.max(14, Math.round(rowHeight * 0.7)),
    [rowHeight]
  );

  return (
    <div
      className="attendance-page h-screen flex flex-col overflow-hidden"
      style={
        {
          /* Aylıq + default; Gündəlik/Cədvəl override --attendance-row-h on their <table>. */
          ["--attendance-row-h" as any]: `${rowHeight}px`,
        } as React.CSSProperties
      }
    >
      <div
        ref={headerRef}
        className="attendance-header w-full shrink-0 border-b border-slate-200/80 bg-[var(--attendance-bg)]"
      >
        {/* Row 1: left filters + right search */}
        <div className="precision-toolbar flex flex-wrap items-center justify-between gap-4 px-4 pt-2 pb-0 max-w-[1600px] mt-2">
          <div className="flex flex-wrap items-center gap-4 min-w-0 flex-1">
            <h1 className="text-[14px] font-bold text-slate-900 leading-none mr-1 whitespace-nowrap">
              Davamiyyət
            </h1>

            <div className="precision-tabs" role="tablist" aria-label="Davamiyyət görünüşü">
            <button
              type="button"
              role="tab"
              aria-selected={view === "daily"}
              onClick={() => changeView("daily")}
              className={`precision-tab ${view === "daily" ? "precision-tab-active" : ""}`}
            >
              Gündəlik
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "grid"}
              onClick={() => changeView("grid")}
              className={`precision-tab ${view === "grid" ? "precision-tab-active" : ""}`}
            >
              Cədvəl
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "monthly"}
              onClick={() => changeView("monthly")}
              className={`precision-tab ${view === "monthly" ? "precision-tab-active" : ""}`}
            >
              Aylıq
            </button>
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <label className="label whitespace-nowrap">Qrup *</label>
              <select
                className="input no-touch-target py-0 max-w-[min(280px,100%)] min-w-[170px]"
                value={selectedGroupId}
                onChange={(e) => changeGroup(e.target.value)}
              >
                <option value="">—</option>
                {sortedGroups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.display_name || g.name}
                  </option>
                ))}
              </select>
            </div>

            {view === "grid" && selectedGroupId && (
              <>
                <div className="flex items-center gap-2">
                <label className="label whitespace-nowrap">Aralıq</label>
                <select
                  className="input no-touch-target py-0 max-w-[180px]"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as PresetKey)}
                >
                  <option value="last8">Son 8 dərs</option>
                  <option value="last15">Son 15 dərs</option>
                  <option value="thisMonth">Bu ay</option>
                  <option value="custom">Seçilmiş aralıq</option>
                </select>
                </div>
                {preset === "custom" && (
                  <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <label className="label whitespace-nowrap">Başlanğıc</label>
                    <input
                      type="date"
                      className="input no-touch-target py-0 max-w-[140px]"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="label whitespace-nowrap">Son</label>
                    <input
                      type="date"
                      className="input no-touch-target py-0 max-w-[140px]"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                    />
                  </div>
                  </div>
                )}
              </>
            )}

            {view === "daily" && selectedGroupId && (
              <div className="flex items-center gap-2">
              <label className="label whitespace-nowrap">Tarix</label>
              <input
                type="date"
                className="input no-touch-target py-0 max-w-[180px]"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  syncUrl({ date: e.target.value });
                }}
              />
              </div>
            )}

            {view === "monthly" && selectedGroupId && (
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const [y, m] = monthParam.split("-").map(Number);
                  const d = new Date(y, m - 2, 1);
                  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  setMonthParam(next);
                  syncUrl({ month: next });
                }}
                className="no-touch-target h-[32px] w-[32px] flex items-center justify-center rounded-md hover:bg-slate-100"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-[12px] min-w-[150px] text-center">
                {monthName}
              </span>
              <button
                type="button"
                onClick={() => {
                  const [y, m] = monthParam.split("-").map(Number);
                  const d = new Date(y, m, 1);
                  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  setMonthParam(next);
                  syncUrl({ month: next });
                }}
                className="no-touch-target h-[32px] w-[32px] flex items-center justify-center rounded-md hover:bg-slate-100"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              </div>
            )}
          </div>

          {selectedGroupId && (
            <div className="flex items-center justify-end flex-shrink-0 min-w-[240px]">
              <input
                type="text"
                placeholder="Şagird axtar..."
                className="input no-touch-target py-0 w-[300px] max-w-[300px]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Row 2: search, status filter (daily), draft badge, actions — mb-6 separates from table area */}
        {selectedGroupId && (
          <div className="px-4 pb-2 mb-3 max-w-[1600px] w-full">
            {(view === "daily" && dailyData?.students?.length) ||
            (view === "grid" && gridData?.students?.length) ||
            (view === "monthly" && monthlyData?.students?.length) ? (
              <div className="flex flex-wrap items-center justify-between gap-4 gap-y-3 w-full min-w-0 mt-4">
                {view === "daily" && (
                  <div
                    className="inline-flex rounded-lg border border-slate-200 bg-slate-100/95 p-1 shadow-sm shrink-0"
                    role="group"
                    aria-label="Status filtri"
                  >
                    {DAILY_STATUS_SEGMENTS.map((seg) => (
                      <button
                        key={seg.value || "all"}
                        type="button"
                        onClick={() => setFilterStatus(seg.value)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                          filterStatus === seg.value
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {seg.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
                  {(view === "daily" || view === "grid") && (
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold shrink-0 ${
                        (view === "daily" ? dailyEntryLabel : gridEntryLabel) === "CONFIRMED"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-amber-300 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {view === "daily" ? dailyEntryLabel : gridEntryLabel}
                    </span>
                  )}

                  {(view === "daily" || view === "grid") && (
                    <button
                      type="button"
                      onClick={() => void handleConfirm()}
                      disabled={confirmDisabled}
                      className="no-touch-target btn-primary h-[32px] px-4 text-[12px] rounded-md inline-flex items-center gap-1.5 font-semibold shadow-sm disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Təsdiqlə
                    </button>
                  )}

                  {view === "daily" && selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <select
                        className="input no-touch-target py-0 w-36"
                        value={bulkStatus}
                        onChange={(e) => setBulkStatus(e.target.value as AttendanceStatus)}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={applyBulk}
                        className="no-touch-target btn-primary h-[32px] px-2.5 text-[12px] rounded-md"
                      >
                        {selectedIds.size} nəfərə tətbiq et
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        className="no-touch-target h-[32px] w-[32px] flex items-center justify-center hover:bg-slate-100 rounded-md"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="attendance-body flex-1 overflow-hidden min-h-0 flex">
        <div className="mx-auto w-full max-w-6xl px-4 flex-1 overflow-hidden min-h-0">
          {/* GRID VIEW */}
          {view === "grid" && (
            <div className="h-full flex flex-col overflow-hidden">
              {!selectedGroupId ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                  Davamiyyət üçün qrup seçin
                </div>
              ) : gridLoading ? (
                <AttendanceTableSkeleton rows={12} />
              ) : !displayedDates.length ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                  Bu aralıqda dərs yoxdur
                </div>
              ) : !filteredGridStudents.length ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                  Bu qrupda şagird tapılmadı
                </div>
              ) : (
                <div className="h-full flex flex-col overflow-hidden border border-slate-200/80 rounded-lg bg-white">
                  <div className="flex justify-end items-center gap-2 px-2 min-h-[24px] py-0.5 border-b border-slate-100">
                    {isSaving ? (
                      <span className="text-[11px] text-amber-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Təsdiqlənir...
                      </span>
                    ) : gridDirty ? (
                      <span className="text-[11px] text-amber-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Yadda saxlanmayıb dəyişikliklər
                      </span>
                    ) : (
                      <span className="text-[11px] text-emerald-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Server ilə sinxron
                      </span>
                    )}
                  </div>

                  <div className="table-wrapper flex-1 overflow-hidden">
                    <div className={`h-full ${filteredGridStudents.length > 30 ? "overflow-auto" : "overflow-hidden"}`}>
                      <table
                        className="attendance-table attendance-table--grid w-full border-collapse text-[12px] leading-[1.15] min-w-[560px]"
                        style={
                          {
                            ["--attendance-row-h" as any]: `${gridRowHeight}px`,
                          } as React.CSSProperties
                        }
                      >
                        <thead className="sticky top-0 bg-white z-10 shadow-sm">
                          <tr className="border-b border-slate-200">
                            <th className="text-left px-[4px] py-[1px] font-semibold text-slate-700 sticky left-0 bg-white z-20 min-w-[160px] h-[22px]">
                              Şagird
                            </th>
                            {displayedDates.map((dateStr) => {
                              const isToday = dateStr === formatDate(today);
                              return (
                                <th
                                  key={dateStr}
                                  title="Bu tarix üçün bütün şagirdlər: lokal olaraq İştirak"
                                  className={`group/date-col px-1 py-[1px] text-center min-w-[54px] align-top transition-colors border-l border-slate-100 ${
                                    isToday
                                      ? "bg-primary/10 font-semibold text-primary"
                                      : "text-slate-600"
                                  }`}
                                >
                                  <div className="flex flex-col items-center gap-0.5 w-full">
                                    <div className="text-[10px] font-semibold leading-none text-center">
                                      {dateStr.slice(8, 10)}/{dateStr.slice(5, 7)} {getWeekdayLabel(dateStr)}
                                    </div>
                                    <button
                                      type="button"
                                      aria-label={`Bu tarix üçün hamısını iştirak: ${dateStr}`}
                                      title="Hamısı İştirak"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleMarkAllPresentForGridDate(dateStr);
                                      }}
                                      className="h-[28px] w-[28px] shrink-0 rounded-md border border-slate-200/80 bg-slate-50 text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 inline-flex items-center justify-center"
                                    >
                                      <Check className="h-[14px] w-[14px]" />
                                    </button>
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredGridStudents.map((student, idx) => (
                            <tr
                              key={student.id}
                              style={{ height: gridRowHeight }}
                              className={`border-b border-slate-100 hover:bg-slate-50/80 ${
                                idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                              }`}
                            >
                              <td className="px-[4px] py-0 font-medium text-slate-900 sticky left-0 bg-inherit z-10 align-middle">
                                {student.full_name}
                              </td>
                              {displayedDates.map((dateStr) => {
                                const status = getEffectiveGridStatus(
                                  student.id,
                                  dateStr
                                );
                                const isToday = dateStr === formatDate(today);
                                const isMenuOpen =
                                  openCellMenu?.studentId === student.id &&
                                  openCellMenu?.dateStr === dateStr;
                                return (
                                  <td
                                    key={dateStr}
                                    className={`px-[2px] py-0 text-center align-middle select-none cursor-pointer ${
                                      isToday ? "bg-primary/5" : ""
                                    }`}
                                  >
                                    <div
                                      ref={isMenuOpen ? cellMenuRef : undefined}
                                      className="relative flex h-full min-h-[calc(var(--attendance-row-h,28px)-2px)] w-full items-center justify-center"
                                    >
                                      <button
                                        type="button"
                                        aria-expanded={isMenuOpen}
                                        aria-haspopup="listbox"
                                        aria-label={`Davamiyyət: ${student.full_name}, ${dateStr}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                          setOpenCellMenu(
                                            isMenuOpen
                                              ? null
                                              : {
                                                  studentId: student.id,
                                                  dateStr,
                                                  anchorRect: {
                                                    left: rect.left,
                                                    top: rect.top,
                                                    bottom: rect.bottom,
                                                    width: rect.width,
                                                  },
                                                }
                                          );
                                        }}
                                        className={`flex min-h-[22px] w-full max-w-[56px] items-center justify-center rounded px-1 text-[10px] font-medium transition-colors hover:ring-1 hover:ring-primary/25 focus-visible:outline focus-visible:ring-2 focus-visible:ring-primary/40 ${
                                          status
                                            ? `${STATUS_PILL[status] ?? "bg-slate-100"}`
                                            : "bg-slate-50/90 text-slate-400 hover:bg-slate-100"
                                        }`}
                                      >
                                        {status ? STATUS_SHORT[status] ?? status : "—"}
                                      </button>
                                      {isMenuOpen &&
                                        typeof document !== "undefined" &&
                                        createPortal(
                                          <div
                                            ref={cellMenuRef}
                                            role="listbox"
                                            className="fixed z-[120] min-w-[170px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                                            style={{
                                              left: openCellMenu.anchorRect.left + openCellMenu.anchorRect.width / 2,
                                              top: openCellMenu.anchorRect.bottom + 6,
                                              transform: "translateX(-50%)",
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseDown={(e) => e.stopPropagation()}
                                          >
                                            {GRID_CELL_MENU_OPTIONS.map((opt) => (
                                              <button
                                                key={opt.label}
                                                type="button"
                                                role="option"
                                                onClick={() => {
                                                  setGridCellStatus(student.id, dateStr, opt.value);
                                                  setOpenCellMenu(null);
                                                }}
                                                className={`w-full px-3 py-1.5 text-left text-xs font-medium hover:bg-slate-50 ${opt.itemClass}`}
                                              >
                                                {opt.label}
                                              </button>
                                            ))}
                                          </div>,
                                          document.body
                                        )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MONTHLY VIEW — dense table */}
          {view === "monthly" && (
            <div className="h-full flex flex-col overflow-hidden">
              {!selectedGroupId ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                  Davamiyyət üçün qrup seçin
                </div>
              ) : monthlyLoading ? (
                <AttendanceTableSkeleton rows={12} />
              ) : !monthlyData?.students?.length ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                  Bu qrupda şagird tapılmadı
                </div>
              ) : (
                <div className="h-full flex flex-col overflow-hidden border border-slate-200/80 rounded-lg bg-white">
                  <div className="table-wrapper flex-1 overflow-hidden">
                    <div className={`h-full ${filteredMonthlyStudents.length > 30 ? "overflow-auto" : "overflow-hidden"}`}>
                      <table className="attendance-table w-full border-collapse text-[11px] leading-[1.15] min-w-[460px]">
                        <thead className="sticky top-0 bg-white z-10 shadow-sm">
                          <tr className="border-b border-slate-200">
                            <th className="text-left px-[4px] py-[1px] font-semibold text-slate-700 sticky left-0 bg-white z-20 min-w-[160px] h-[24px]">
                              Şagird
                            </th>
                            <th className="text-center px-[3px] py-[1px] font-semibold text-slate-600 min-w-[54px] h-[24px]">
                              İştirak
                            </th>
                            <th className="text-center px-[3px] py-[1px] font-semibold text-slate-600 min-w-[54px] h-[24px]">
                              Qey
                            </th>
                            <th className="text-center px-[3px] py-[1px] font-semibold text-slate-600 min-w-[48px] h-[24px]">
                              Gec
                            </th>
                            <th className="text-center px-[3px] py-[1px] font-semibold text-slate-600 min-w-[48px] h-[24px]">
                              Bəh
                            </th>
                            <th className="text-center px-[3px] py-[1px] font-semibold text-slate-600 min-w-[44px] h-[24px]">
                              %
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMonthlyStudents.map((student, idx) => {
                            const s = student as {
                              id: string;
                              fullName: string;
                              present: number;
                              absent: number;
                              late: number;
                              excused: number;
                              attendancePercent: number;
                            };
                            const pct = s.attendancePercent ?? 0;
                            return (
                              <tr
                                key={s.id}
                                style={{ height: rowHeight }}
                                className={`border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer ${
                                  idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                                } ${pct < 75 ? "bg-red-50/40" : ""}`}
                                onClick={() =>
                                  setBreakdownStudent({
                                    id: s.id,
                                    fullName: s.fullName,
                                    attendancePercent: pct,
                                  })
                                }
                              >
                                <td className="px-[4px] py-[1px] font-medium text-slate-900 sticky left-0 bg-inherit z-10">
                                  {s.fullName}
                                </td>
                                <td className="px-[3px] py-[1px] text-center text-slate-700">
                                  {s.present ?? 0}
                                </td>
                                <td className="px-[3px] py-[1px] text-center text-slate-700">
                                  {s.absent ?? 0}
                                </td>
                                <td className="px-[3px] py-[1px] text-center text-slate-700">
                                  {s.late ?? 0}
                                </td>
                                <td className="px-[3px] py-[1px] text-center text-slate-700">
                                  {s.excused ?? 0}
                                </td>
                                <td
                                  className={`px-[3px] py-[1px] text-center font-semibold ${
                                    pct < 75 ? "text-red-600" : "text-slate-700"
                                  }`}
                                >
                                  {pct}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DAILY VIEW — true datagrid */}
          {view === "daily" && (
            <div className="h-full flex flex-col overflow-hidden">
              {!selectedGroupId ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                  Davamiyyət üçün qrup seçin
                </div>
              ) : dailyLoading ? (
                <AttendanceTableSkeleton rows={15} />
              ) : dailyData?.students?.length ? (
                <div className="h-full flex flex-col overflow-hidden border border-slate-200/80 rounded-lg bg-white">
                  <div ref={tableWrapperRef} className="table-wrapper flex-1 overflow-hidden min-h-0">
                    <div className={`h-full ${filteredDailyStudents.length > 30 ? "overflow-y-auto" : "overflow-hidden"}`}>
                      <table
                        ref={tableRef}
                        className="attendance-table attendance-table--daily w-full border-collapse text-sm leading-snug"
                        style={
                          {
                            ["--attendance-row-h" as any]: `${dailyRowHeight}px`,
                          } as React.CSSProperties
                        }
                      >
                        <thead className="sticky top-0 bg-white z-10 shadow-sm">
                          <tr
                            className="border-b border-slate-200"
                            style={{ height: Math.max(26, dailyRowHeight) }}
                          >
                            <th className="text-left px-[6px] py-[2px] font-semibold text-slate-600 w-10">
                              #
                            </th>
                            <th className="text-left px-[6px] py-[2px] font-semibold text-slate-600 w-10">
                              <input
                                type="checkbox"
                                checked={
                                  filteredDailyStudents.length > 0 &&
                                  filteredDailyStudents.every((s) =>
                                    selectedIds.has(s.id)
                                  )
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedIds(
                                      new Set(filteredDailyStudents.map((s) => s.id))
                                    );
                                  } else {
                                    setSelectedIds(new Set());
                                  }
                                }}
                                className="rounded"
                              />
                            </th>
                            <th className="text-left px-[6px] py-[2px] font-semibold text-slate-700">
                              Şagird
                            </th>
                            <th className="text-left px-[6px] py-[2px] font-semibold text-slate-700 w-44">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDailyStudents.length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="py-12 text-center text-slate-500"
                              >
                                Axtarış nəticəsi tapılmadı
                              </td>
                            </tr>
                          ) : (
                            filteredDailyStudents.map((student, idx) => {
                              const status =
                                dailyLocal[student.id] ?? student.status;
                              return (
                                <tr
                                  key={student.id}
                                  style={{ height: dailyRowHeight }}
                                  onClick={() => toggleSelect(student.id)}
                                  className={`border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer ${
                                    idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                                  }`}
                                >
                                  <td className="px-[4px] py-0 text-slate-500 align-middle">
                                    {idx + 1}
                                  </td>
                                  <td
                                    className="px-[4px] py-0 align-middle"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(student.id)}
                                      onChange={() => toggleSelect(student.id)}
                                      className="rounded"
                                    />
                                  </td>
                                  <td className="px-[4px] py-0 font-medium text-slate-900 col-name align-middle">
                                    {student.fullName}
                                  </td>
                                  <td
                                    className="px-[4px] py-0 col-status align-middle"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <select
                                      value={status}
                                      onChange={(e) => {
                                        const val = e.target
                                          .value as AttendanceStatus;
                                        setDailyLocal((prev) => ({
                                          ...prev,
                                          [student.id]: val,
                                        }));
                                      }}
                                      data-status={
                                        status === "present"
                                          ? "present"
                                          : status === "absent"
                                            ? "absent"
                                            : status === "late"
                                              ? "late"
                                              : status === "excused"
                                                ? "excused"
                                                : undefined
                                      }
                                      className="status-select no-touch-target"
                                    >
                                      {STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                  Bu qrupda şagird tapılmadı
                </div>
              )}
            </div>
          )}

          {/* info: measured header/row heights for debugging */}
          <div className="sr-only" aria-hidden="true">
            headerHeight:{headerHeight};rowHeight:{rowHeight}
          </div>
        </div>
      </div>

        {/* Monthly breakdown modal */}
        <Modal
          isOpen={!!breakdownStudent}
          onClose={() => setBreakdownStudent(null)}
          title={
            breakdownStudent
              ? `${breakdownStudent.fullName} — Gündəlik davamiyyət (${monthName})`
              : ""
          }
          size="lg"
        >
          {breakdownStudent && breakdownData && (() => {
            const [y, m] = [breakdownData.year, breakdownData.month];
            const first = new Date(y, m - 1, 1);
            const last = new Date(y, m, 0);
            const lastDay = last.getDate();
            const startCol = (first.getDay() + 6) % 7;
            const recordMap = new Map(
              breakdownData.records.map((r) => [r.date, r.status])
            );
            const cells: (number | null)[] = [];
            for (let i = 0; i < startCol; i++) cells.push(null);
            for (let d = 1; d <= lastDay; d++) {
              const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              cells.push(d);
            }
            return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Davamiyyət: {breakdownStudent.attendancePercent ?? 0}%
                {breakdownStudent.missedPercent != null &&
                  ` (Qaçırılan: ${breakdownStudent.missedPercent}%)`}
              </p>
              <div className="grid grid-cols-7 gap-1">
                {["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"].map((d) => (
                  <div
                    key={d}
                    className="text-center py-1.5 text-xs font-semibold text-slate-600"
                  >
                    {d}
                  </div>
                ))}
                {cells.map((day, idx) => {
                  if (day === null) {
                    return <div key={`empty-${idx}`} className="aspect-square" />;
                  }
                  const ds = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const status = recordMap.get(ds);
                  return (
                    <div
                      key={ds}
                      className="flex flex-col items-center justify-center rounded-lg border border-slate-100 p-2 aspect-square min-h-[44px]"
                      title={`${ds}: ${status || "-"}`}
                    >
                      <span className="text-slate-700 text-sm font-medium">
                        {day}
                      </span>
                      <span
                        className={`w-2.5 h-2.5 rounded-full mt-1 ${
                          status === "present"
                            ? "bg-green-500"
                            : status === "absent"
                            ? "bg-red-500"
                            : status === "late"
                            ? "bg-amber-500"
                            : status === "excused"
                            ? "bg-blue-500"
                            : "bg-slate-200"
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" /> İştirak
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />{" "}
                  Qeyri-iştirak
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Gecikmə
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> Bəhanəli
                </span>
              </div>
            </div>
            );
          })()}
        </Modal>
    </div>
  );
}
