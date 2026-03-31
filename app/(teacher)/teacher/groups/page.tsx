"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, Group, LESSON_DAY_LABELS, deriveDisplayNameFromDays } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Edit2, Trash2, Users, Key } from "lucide-react";

function GroupDetailContent({
  groupId,
  groupName,
  studentCount,
  onUpdate,
}: {
  groupId: string;
  groupName: string;
  studentCount: number;
  onUpdate: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: groupStudents, isLoading } = useQuery({
    queryKey: ["teacher", "group-students", groupId],
    queryFn: () => teacherApi.getGroupStudents(groupId),
    enabled: !!groupId,
  });
  const { data: allStudents } = useQuery({
    queryKey: ["teacher", "students", "active"],
    queryFn: () => teacherApi.getStudents("active"),
  });
  const [search, setSearch] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const addMutation = useMutation({
    mutationFn: (studentIds: string[]) =>
      teacherApi.addStudentsToGroup(groupId, studentIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "group-students", groupId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      setSelectedStudents([]);
      setSearch("");
      onUpdate();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (studentId: string) =>
      teacherApi.removeStudentFromGroup(groupId, studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "group-students", groupId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      onUpdate();
    },
  });
  const inGroupIds = new Set((groupStudents || []).map((s) => s.id));
  const availableStudents = useMemo(() => {
    const list = (allStudents || []).filter((s) => !inGroupIds.has(s.id));
    return list.sort((a, b) =>
      (a.fullName || "").localeCompare(b.fullName || "", "az", {
        sensitivity: "base",
        numeric: true,
      })
    );
  }, [allStudents, inGroupIds]);

  const filteredAvailableStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableStudents;
    return availableStudents.filter((s) => {
      const hay = `${s.fullName ?? ""} ${s.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [availableStudents, search]);

  const selectedSet = useMemo(() => new Set(selectedStudents), [selectedStudents]);
  const filteredIds = useMemo(
    () => filteredAvailableStudents.map((s) => s.id),
    [filteredAvailableStudents]
  );
  const allFilteredSelected = useMemo(() => {
    if (filteredIds.length === 0) return false;
    return filteredIds.every((id) => selectedSet.has(id));
  }, [filteredIds, selectedSet]);

  const toggleStudent = useCallback((id: string) => {
    setSelectedStudents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedStudents((prev) => {
      const set = new Set(prev);
      const shouldSelectAll = !filteredIds.every((id) => set.has(id));
      if (shouldSelectAll) {
        filteredIds.forEach((id) => set.add(id));
      } else {
        filteredIds.forEach((id) => set.delete(id));
      }
      return Array.from(set);
    });
  }, [filteredIds]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-600 mb-2">Qrup adı</p>
        <p className="font-medium text-slate-900">{groupName}</p>
      </div>
      <div>
        <p className="text-sm text-slate-600 mb-2">Şagird sayı</p>
        <p className="font-medium text-slate-900">{studentCount}</p>
      </div>
      <Link
        href={`/teacher/credentials?group_id=${groupId}`}
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <Key className="w-4 h-4" />
        Bu qrup üçün hesab məlumatları
      </Link>
      <div className="pt-4 border-t border-slate-200">
        <p className="text-sm font-medium text-slate-700 mb-3">Şagirdlər</p>
        {isLoading ? (
          <Loading />
        ) : (
          <>
            <div className="mb-4 space-y-2">
              <input
                className="input w-full"
                placeholder="Şagird axtar (ad/email)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    disabled={filteredAvailableStudents.length === 0}
                  />
                  Hamısını seç (filter)
                </label>

                <button
                  className="btn-primary"
                  disabled={selectedStudents.length === 0 || addMutation.isPending}
                  onClick={() => addMutation.mutate(selectedStudents)}
                >
                  Seçilənləri əlavə et ({selectedStudents.length})
                </button>
              </div>

              <div className="max-h-[320px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {filteredAvailableStudents.length === 0 ? (
                  <div className="p-3 text-sm text-slate-500">
                    Əlavə ediləcək şagird tapılmadı
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filteredAvailableStudents.map((s) => {
                      const checked = selectedSet.has(s.id);
                      return (
                        <li key={s.id}>
                          <label className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={checked}
                              onChange={() => toggleStudent(s.id)}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900 truncate">
                                {s.fullName}
                              </div>
                              <div className="text-xs text-slate-500 truncate">
                                {s.email}
                              </div>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            {groupStudents && groupStudents.length > 0 ? (
              <ul className="space-y-2">
                {groupStudents.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between py-2 border-b border-slate-100"
                  >
                    <span className="text-sm text-slate-900">
                      {s.fullName} ({s.email})
                    </span>
                    <button
                      onClick={() => {
                        if (confirm(`"${s.fullName}" şagirdini qrupdan çıxarmaq?`)) {
                          removeMutation.mutate(s.id);
                        }
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Çıxar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Bu qrupda şagird yoxdur</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const groupSchema = z
  .object({
    name: z.string().min(1, "Qrup adı tələb olunur"),
    lesson_days: z.array(z.number().min(1).max(7)).optional(),
    start_time: z.string().optional(),
    display_name: z.string().optional(),
    display_name_is_manual: z.boolean().optional(),
    monthly_fee: z.number().min(0).optional().nullable(),
    monthly_lessons_count: z.number().int().min(1).optional(),
  })
  .refine(
    (data) => !data.lesson_days || data.lesson_days.length >= 1,
    { message: "Ən azı bir dərs günü seçilməlidir", path: ["lesson_days"] }
  );

type GroupFormValues = z.infer<typeof groupSchema>;

const WEEKDAY_KEYS = [1, 2, 3, 4, 5, 6, 7] as const;

export default function GroupsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupIdParam = searchParams.get("group");
  const [editMode, setEditMode] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() => searchParams.get("group"));
  const openingGroupIdRef = useRef<string | null>(null);
  const openedGroupRef = useRef<Group | null>(null);
  const queryClient = useQueryClient();

  const { data: groups, isLoading } = useQuery({
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

  const createMutation = useMutation({
    mutationFn: (data: { name: string; lesson_days?: number[]; start_time?: string | null; display_name?: string | null; display_name_is_manual?: boolean; monthly_fee?: number | null; monthly_lessons_count?: number }) =>
      teacherApi.createGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      setEditingGroup(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Group> }) =>
      teacherApi.updateGroup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      setEditingGroup(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: "",
      lesson_days: [2, 4],
      start_time: "11:00",
      display_name: "",
      display_name_is_manual: false,
      monthly_fee: null,
      monthly_lessons_count: 8,
    },
  });

  const watchedLessonDays = watch("lesson_days") ?? [];
  const watchedDisplayNameIsManual = watch("display_name_is_manual") ?? false;
  const watchedStartTime = watch("start_time");

  useEffect(() => {
    if (!watchedDisplayNameIsManual && Array.isArray(watchedLessonDays) && watchedLessonDays.length > 0) {
      const derived = deriveDisplayNameFromDays(watchedLessonDays, watchedStartTime);
      setValue("display_name", derived, { shouldDirty: false });
    }
  }, [watchedDisplayNameIsManual, watchedLessonDays, watchedStartTime, setValue]);

  // Sync URL from state when user opens detail (runs after commit)
  useEffect(() => {
    if (!selectedGroupId) return;
    if (groupIdParam === selectedGroupId) return;
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("group", selectedGroupId);
    router.replace(`/teacher/groups?${qs.toString()}`, { scroll: false });
  }, [selectedGroupId, groupIdParam, router, searchParams]);

  // Sync state from URL: deep link (param set) or clear when param is missing (and we didn't just open)
  useEffect(() => {
    if (!groupIdParam) {
      if (openingGroupIdRef.current != null) return;
      setSelectedGroupId(null);
      openedGroupRef.current = null;
      return;
    }
    openingGroupIdRef.current = null;
    setSelectedGroupId(groupIdParam);
    if (groups && groups.length > 0) {
      const g = groups.find((gr) => gr.id === groupIdParam);
      if (g) openedGroupRef.current = g;
    }
  }, [groupIdParam, groups]);

  const openGroupDetail = (group: Group) => {
    openingGroupIdRef.current = group.id;
    openedGroupRef.current = group;
    setSelectedGroupId(group.id);
  };

  const closeGroupDetail = () => {
    openingGroupIdRef.current = null;
    openedGroupRef.current = null;
    setSelectedGroupId(null);
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("group");
    const qs = sp.toString();
    router.replace(qs ? `/teacher/groups?${qs}` : "/teacher/groups", {
      scroll: false,
    });
  };

  const displayGroup =
    (sortedGroups && selectedGroupId ? sortedGroups.find((g) => g.id === selectedGroupId) : null) ??
    openedGroupRef.current ?? null;

  const handleEdit = (group: Group) => {
    setEditingGroup(group);
    const st = group.start_time;
    const timeVal = st && /^\d{2}:\d{2}/.test(st) ? st.slice(0, 5) : "11:00";
    reset({
      name: group.name,
      lesson_days: group.lesson_days?.length ? group.lesson_days : [2, 4],
      start_time: timeVal,
      display_name: group.display_name ?? "",
      display_name_is_manual: group.display_name_is_manual ?? false,
      monthly_fee: (group as any).monthly_fee ?? null,
      monthly_lessons_count: (group as any).monthly_lessons_count ?? 8,
    });
  };

  const toggleLessonDay = (day: number) => {
    const current = watch("lesson_days") ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setValue("lesson_days", next, { shouldValidate: true });
  };

  const onSubmit = (values: GroupFormValues) => {
    if (editingGroup?.id) {
      updateMutation.mutate({
        id: editingGroup.id,
        data: {
          name: values.name,
          lesson_days: values.lesson_days?.length ? values.lesson_days : undefined,
          start_time: values.start_time ? `${values.start_time}:00` : undefined,
          display_name: values.display_name || undefined,
          display_name_is_manual: values.display_name_is_manual ?? false,
          monthly_fee: values.monthly_fee ?? undefined,
          monthly_lessons_count: values.monthly_lessons_count ?? undefined,
        },
      });
    } else {
      createMutation.mutate({
        name: values.name,
        lesson_days: values.lesson_days?.length ? values.lesson_days : [2, 4],
        start_time: values.start_time ? `${values.start_time}:00` : undefined,
        display_name: values.display_name || undefined,
        display_name_is_manual: values.display_name_is_manual ?? false,
        monthly_fee: values.monthly_fee ?? undefined,
        monthly_lessons_count: values.monthly_lessons_count ?? undefined,
      });
      reset();
    }
  };

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Qruplar</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editMode}
              onChange={(e) => setEditMode(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-slate-700">Düzəliş rejimi</span>
          </label>
          <button
            onClick={() => {
              setEditingGroup({ id: "", name: "", studentCount: 0 } as Group);
              reset({
                name: "",
                lesson_days: [2, 4],
                start_time: "11:00",
                display_name: deriveDisplayNameFromDays([2, 4], "11:00"),
                display_name_is_manual: false,
                monthly_fee: null,
                monthly_lessons_count: 8,
              });
            }}
            className="btn-primary"
          >
            Yeni Qrup
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex justify-center py-12">
            <Loading />
          </div>
        ) : sortedGroups && sortedGroups.length > 0 ? (
          sortedGroups.map((group) => (
            <div
              key={group.id}
              className="card hover:shadow-lg transition-all cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                if (!editMode) openGroupDetail(group);
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    {group.display_name || group.name}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users className="w-4 h-4" />
                    <span>{group.studentCount || 0} şagird</span>
                    {(!group.lesson_days || group.lesson_days.length === 0) && (
                      <span className="text-amber-600 text-xs" title="Dərs günləri təyin edilməyib. Qrup ayarlarından seçin.">
                        ⚠ Dərs günü yoxdur
                      </span>
                    )}
                  </div>
                </div>
                {editMode && (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(group);
                      }}
                      className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          confirm(
                            `"${group.name}" qrupunu silmək istədiyinizə əminsiniz?`
                          )
                        ) {
                          deleteMutation.mutate(group.id);
                        }
                      }}
                      className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {!editMode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openGroupDetail(group);
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  Ətraflı bax →
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-500">
            Qrup tapılmadı
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={!!editingGroup}
        onClose={() => setEditingGroup(null)}
        title={editingGroup?.id ? "Qrup Redaktə Et" : "Yeni Qrup"}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Qrup Adı *</label>
            <input
              type="text"
              className="input"
              placeholder="Məs: 9A, 10B"
              {...register("name")}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="label">Başlama vaxtı</label>
            <input
              type="time"
              className="input w-32"
              {...register("start_time")}
            />
          </div>

          <div>
            <label className="label">Dərs günləri</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {WEEKDAY_KEYS.map((day) => {
                const selected = Array.isArray(watchedLessonDays) && watchedLessonDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleLessonDay(day)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out ${
                      selected
                        ? "bg-primary text-white shadow-sm"
                        : "bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/80"
                    }`}
                  >
                    {LESSON_DAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
            {errors.lesson_days && (
              <p className="mt-1 text-xs text-red-600">{errors.lesson_days.message}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!watchedDisplayNameIsManual}
                onChange={(e) => setValue("display_name_is_manual", !e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Adı avtomatik yarat</span>
            </label>
            <span className="text-xs text-slate-500">
              {watchedDisplayNameIsManual ? "Adı əl ilə yazın" : "Dərs günlərinə görə avtomatik"}
            </span>
          </div>

          <div>
            <label className="label">Qrup göstərici adı</label>
            <input
              type="text"
              className="input"
              placeholder="Məs: 1-4 11:00"
              {...register("display_name")}
              readOnly={!watchedDisplayNameIsManual}
              disabled={!watchedDisplayNameIsManual}
              style={{ opacity: watchedDisplayNameIsManual ? 1 : 0.7 }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200">
            <div>
              <label className="label">Aylıq haqq (AZN)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                placeholder="Məs: 100"
                {...register("monthly_fee", { valueAsNumber: true })}
              />
              <p className="mt-1 text-xs text-slate-500">
                Real ödəniş məbləği (parent view)
              </p>
            </div>
            <div>
              <label className="label">Ayda dərs sayı</label>
              <input
                type="number"
                min="1"
                className="input"
                placeholder="8"
                {...register("monthly_lessons_count", { valueAsNumber: true })}
              />
              <p className="mt-1 text-xs text-slate-500">
                Hər dərs üçün: aylıq haqq / dərs sayı
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Yadda saxlanılır..."
                : "Yadda Saxla"}
            </button>
            <button
              type="button"
              onClick={() => setEditingGroup(null)}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Group Detail Modal - visibility from selectedGroupId so it does not flicker */}
      <Modal
        isOpen={selectedGroupId != null}
        onClose={closeGroupDetail}
        title={displayGroup ? `${displayGroup.display_name || displayGroup.name} - Ətraflı Məlumat` : ""}
        size="lg"
      >
        {displayGroup ? (
          <GroupDetailContent
            groupId={displayGroup.id}
            groupName={displayGroup.name}
            studentCount={displayGroup.studentCount || 0}
            onUpdate={() => {
              queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
              queryClient.invalidateQueries({ queryKey: ["teacher", "group-students", displayGroup.id] });
            }}
          />
        ) : selectedGroupId ? (
          <Loading />
        ) : null}
      </Modal>
    </div>
  );
}
