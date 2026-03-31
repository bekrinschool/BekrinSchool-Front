"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { useDebounce } from "@/lib/useDebounce";

export type CodingStatusFilter = "all" | "solved" | "attempted" | "not_attempted";
export type CodingSort = "newest" | "most_solved" | "last_activity";

export function useCodingTasks(filters: {
  topic: string;
  status: CodingStatusFilter;
  search: string;
  sort: CodingSort;
}) {
  const debouncedSearch = useDebounce(filters.search, 300);
  return useQuery({
    queryKey: ["student", "coding", filters.topic, filters.status, debouncedSearch, filters.sort],
    queryFn: () =>
      studentApi.getCodingExercises({
        topic: filters.topic || undefined,
        status: filters.status === "all" ? undefined : filters.status,
        search: debouncedSearch || undefined,
        sort: filters.sort,
      }),
    staleTime: 60 * 1000,
  });
}

export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: ["student", "coding", "detail", taskId],
    queryFn: () => studentApi.getCodingTaskDetail(taskId!),
    enabled: !!taskId,
    staleTime: 30 * 1000,
  });
}

export function useSubmissions(taskId: string | null, page: number) {
  return useQuery({
    queryKey: ["student", "coding", "submissions", taskId, page],
    queryFn: () => studentApi.getCodingSubmissions(taskId!, { page, page_size: 20 }),
    enabled: !!taskId,
    staleTime: 10 * 1000,
  });
}

export function useRunCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, code }: { taskId: number; code: string }) =>
      studentApi.runCoding(taskId, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student", "coding"] });
    },
  });
}

export function useSubmitCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, code }: { taskId: string; code: string }) =>
      studentApi.submitCoding(taskId, code),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["student", "coding"] });
      queryClient.invalidateQueries({ queryKey: ["student", "coding", "submissions", taskId] });
      queryClient.invalidateQueries({ queryKey: ["student", "coding", "detail", taskId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "coding-monitor"] });
    },
  });
}

export function useSubmissionDetail(taskId: string | null, submissionId: number | null) {
  return useQuery({
    queryKey: ["student", "coding", "submission", taskId, submissionId],
    queryFn: () => studentApi.getCodingSubmissionDetail(Number(taskId), submissionId!),
    enabled: !!taskId && !!submissionId,
  });
}
