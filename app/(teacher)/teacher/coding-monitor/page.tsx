"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { teacherApi } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useDebounce } from "@/lib/useDebounce";
import { Trophy, FileCode, Eye, Search } from "lucide-react";

export default function CodingMonitorPage() {
  const [groupId, setGroupId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [sort, setSort] = useState("last_activity");
  const [page, setPage] = useState(1);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [showSubmissionsModal, setShowSubmissionsModal] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [includeRun, setIncludeRun] = useState(false);

  const debouncedStudentSearch = useDebounce(studentSearch, 300);

  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
    staleTime: 60 * 1000, // Cache groups for 1 minute
  });
  const { data: topics } = useQuery({
    queryKey: ["teacher", "coding", "topics"],
    queryFn: () => teacherApi.getCodingTopics(),
    staleTime: 60 * 1000, // Cache topics for 1 minute
  });
  const { data, isLoading } = useQuery({
    queryKey: ["teacher", "coding-monitor", groupId, topicId, debouncedStudentSearch, sort, page, includeRun],
    queryFn: () =>
      teacherApi.getCodingMonitor({
        groupId: groupId || undefined,
        topic: topicId || undefined,
        search: debouncedStudentSearch || undefined,
        sort,
        page,
        page_size: 20,
        include_run: includeRun,
      }),
  });
  const { data: studentSubmissionsData, isLoading: submissionsLoading } = useQuery({
    queryKey: ["teacher", "student-submissions", selectedStudentId, includeRun],
    queryFn: () => teacherApi.getStudentSubmissions(selectedStudentId!, { include_run: includeRun }),
    enabled: selectedStudentId != null && showSubmissionsModal,
  });
  const { data: submissionDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["teacher", "coding-submission-detail", selectedSubmissionId],
    queryFn: () => teacherApi.getCodingSubmissionDetail(selectedSubmissionId!),
    enabled: selectedSubmissionId != null,
  });

  const ranking = data?.ranking ?? [];
  const submissions = data?.submissions;
  const results = submissions?.results ?? [];
  const totalSubs = submissions?.count ?? 0;
  const hasNext = submissions?.next != null;
  const hasPrev = submissions?.previous != null;

  // Group by student so each student appears once; keep the row with best performance (max tasks solved, then max attempts). Use that row's totalAttempts as-is (do not sum — each row already carries the total count per student).
  const uniqueRanking = useMemo(() => {
    type Row = (typeof ranking)[number];
    const byStudent = ranking.reduce<Record<string, Row>>((acc, curr) => {
      const sid = String(curr.student?.userId ?? curr.student?.id ?? "");
      if (!sid) return acc;
      const existing = acc[sid];
      if (!existing) {
        acc[sid] = curr;
        return acc;
      }
      const better =
        (curr.totalTasksSolved ?? 0) > (existing.totalTasksSolved ?? 0) ||
        ((curr.totalTasksSolved ?? 0) === (existing.totalTasksSolved ?? 0) &&
          (curr.totalAttempts ?? 0) >= (existing.totalAttempts ?? 0));
      if (better) acc[sid] = curr;
      return acc;
    }, {});
    const list = Object.values(byStudent);
    // Sort: most_solved (default), most_attempts, or last_activity
    if (sort === "most_attempts" || sort === "most_submissions") {
      list.sort(
        (a, b) =>
          (b.totalAttempts ?? 0) - (a.totalAttempts ?? 0) ||
          (b.totalTasksSolved ?? 0) - (a.totalTasksSolved ?? 0)
      );
    } else if (sort === "last_activity") {
      list.sort((a, b) => {
        const la = (a as Row & { lastActivity?: string | null }).lastActivity;
        const lb = (b as Row & { lastActivity?: string | null }).lastActivity;
        if (!la && !lb) return 0;
        if (!la) return 1;
        if (!lb) return -1;
        return new Date(lb).getTime() - new Date(la).getTime();
      });
    } else {
      list.sort(
        (a, b) =>
          (b.totalTasksSolved ?? 0) - (a.totalTasksSolved ?? 0) ||
          (b.totalAttempts ?? 0) - (a.totalAttempts ?? 0)
      );
    }
    return list;
  }, [ranking, sort]);

  const filteredRanking = useMemo(() => {
    if (!debouncedStudentSearch.trim()) return uniqueRanking;
    const q = debouncedStudentSearch.toLowerCase();
    return uniqueRanking.filter((r) =>
      (r.student?.fullName ?? "").toLowerCase().includes(q)
    );
  }, [uniqueRanking, debouncedStudentSearch]);

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Kodlaşdırma Monitorinq
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          Şagirdlərin irəliləyişi və göndərişlər
        </p>
      </div>

      {/* Compact Filter Row */}
      <div className="card mb-6">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Qrup:</label>
            <select
              className="input text-sm w-auto min-w-[120px]"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Hamısı</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Mövzu:</label>
            <select
              className="input text-sm w-auto min-w-[120px]"
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
            >
              <option value="">Hamısı</option>
              {topics?.map((t) => (
                <option key={t.id} value={String(t.id)}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Sırala:</label>
            <select
              className="input text-sm w-auto min-w-[150px]"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="most_solved">Ən çox həll edən</option>
              <option value="most_attempts">Ən çox cəhd edən</option>
              <option value="last_activity">Son aktivlik</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRun}
                onChange={(e) => setIncludeRun(e.target.checked)}
                className="rounded"
              />
              RUN-ləri göstər
            </label>
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              className="input !pl-12 w-full text-sm"
              placeholder="Şagird adı ilə axtar..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            Reytinq
          </h2>
          {filteredRanking.length > 0 ? (
            <ul className="space-y-3">
              {filteredRanking.map((r, idx) => (
                <li
                  key={String(r.student?.userId ?? r.student?.id ?? idx)}
                  className="flex items-center justify-between py-2 border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => {
                    setSelectedStudentId(String(r.student.userId ?? r.student.id));
                    setShowSubmissionsModal(true);
                  }}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-slate-400 w-6">
                        #{idx + 1}
                      </span>
                      <span className="font-medium text-slate-900">
                        {r.student.fullName}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedStudentId(String(r.student.userId ?? r.student.id));
                          setShowSubmissionsModal(true);
                        }}
                        className="text-blue-600 hover:text-blue-800 ml-auto"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                    {r.groupName && (
                      <p className="text-xs text-slate-500 ml-9">{r.groupName}</p>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                      {r.totalTasksSolved} tapşırıq
                    </span>
                    <span className="block text-slate-500 mt-0.5">
                      {r.totalAttempts} cəhd
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500 py-8 text-center">
              Bu filtrlərə uyğun nəticə yoxdur
            </p>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <FileCode className="w-5 h-5 text-blue-500" />
            Kod göndərişləri (səhifə {page})
          </h2>
          {results.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Şagird</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Tapşırıq</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Status</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Tarix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => setSelectedSubmissionId(String(s.id))}
                      >
                        <td className="py-2 text-sm text-slate-900">{s.studentName}</td>
                        <td className="py-2 text-sm text-slate-600">{s.taskTitle}</td>
                        <td className="py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs ${
                              s.status === "passed"
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {s.status === "passed" ? "Keçdi" : s.status}
                          </span>
                          {s.passedCount != null && s.totalCount != null && s.totalCount > 0 && (
                            <span className="ml-1 text-xs text-slate-500">
                              {s.passedCount}/{s.totalCount}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-sm text-slate-600">
                          {new Date(s.createdAt).toLocaleDateString("az-AZ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <span className="text-sm text-slate-500">Cəmi: {totalSubs}</span>
                <div className="flex gap-2">
                  {hasPrev && (
                    <button
                      type="button"
                      onClick={() => setPage((p) => p - 1)}
                      className="btn-outline text-sm"
                    >
                      Əvvəlki
                    </button>
                  )}
                  {hasNext && (
                    <button
                      type="button"
                      onClick={() => setPage((p) => p + 1)}
                      className="btn-outline text-sm"
                    >
                      Növbəti
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-slate-500 py-8 text-center">
              Göndəriş tapılmadı
            </p>
          )}
        </div>
      </div>

      {/* Student Submissions Modal */}
      <Modal
        isOpen={showSubmissionsModal}
        onClose={() => {
          setShowSubmissionsModal(false);
          setSelectedStudentId(null);
        }}
        title={studentSubmissionsData ? `${studentSubmissionsData.studentName} - Göndərişlər` : "Göndərişlər"}
        size="lg"
      >
        {submissionsLoading ? (
          <p className="text-slate-500 py-4">Yüklənir...</p>
        ) : studentSubmissionsData && studentSubmissionsData.submissions.length > 0 ? (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {studentSubmissionsData.submissions.map((sub) => (
              <div key={sub.id} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-slate-900">{sub.taskTitle}</p>
                    {sub.topicName && (
                      <p className="text-xs text-slate-500">{sub.topicName}</p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      sub.status === "passed"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {sub.status === "passed" ? "Keçdi" : sub.status}
                  </span>
                </div>
                <div className="text-xs text-slate-600 mb-2">
                  <span>Cəhd #{sub.attemptNo || "-"}</span>
                  {sub.runType === "RUN" && (
                    <span className="ml-2 px-1 py-0.5 bg-slate-100 rounded text-slate-600">Run</span>
                  )}
                  {(sub.passedCount != null || sub.totalCount != null) && (
                    <span className="ml-2">
                      Keçdi: {sub.passedCount ?? 0}/{sub.totalCount ?? (sub.passedCount ?? 0) + (sub.failedCount ?? 0)}
                    </span>
                  )}
                  {sub.runtimeMs && <span className="ml-2">Vaxt: {sub.runtimeMs}ms</span>}
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  {new Date(sub.createdAt).toLocaleString("az-AZ")}
                </p>
                <details className="mt-2">
                  <summary className="text-sm text-blue-600 cursor-pointer hover:underline">
                    Kodu göstər
                  </summary>
                  <pre className="mt-2 p-2 bg-slate-50 rounded text-xs overflow-x-auto max-h-48 overflow-y-auto">
                    {sub.submittedCode}
                  </pre>
                </details>
                {sub.errorMessage && (
                  <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-700">
                    <strong>Xəta:</strong> {sub.errorMessage}
                  </div>
                )}
                {sub.detailsJson && sub.detailsJson.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-sm text-blue-600 cursor-pointer hover:underline">
                      Test nəticələri ({sub.detailsJson.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {sub.detailsJson.map((t: { test_case_id?: number; is_sample?: boolean; passed?: boolean; output?: string; expected?: string; input?: string }, i: number) => (
                        <div key={i} className="p-2 bg-slate-50 rounded text-xs">
                          <span className={t.passed ? "text-green-700" : "text-red-700"}>
                            Test #{i + 1}: {t.passed ? "Keçdi" : "Uğursuz"}
                            {!t.is_sample && " (gizli)"}
                          </span>
                          {t.input != null && t.input !== "" && (
                            <pre className="mt-1 text-slate-500 overflow-x-auto">Input: {t.input}</pre>
                          )}
                          {t.output != null && (
                            <pre className="mt-1 text-slate-600 overflow-x-auto">Çıxış: {t.output}</pre>
                          )}
                          {t.expected != null && !t.passed && (
                            <pre className="mt-1 text-slate-500">Gözlənilən: {t.expected}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 py-4">Göndəriş tapılmadı</p>
        )}
      </Modal>

      {/* Submission Detail Modal (click row) */}
      <Modal
        isOpen={selectedSubmissionId != null}
        onClose={() => setSelectedSubmissionId(null)}
        title={submissionDetail ? `${submissionDetail.studentName} - ${submissionDetail.taskTitle}` : "Göndəriş təfərrüatı"}
        size="lg"
      >
        {detailLoading ? (
          <p className="text-slate-500 py-4">Yüklənir...</p>
        ) : submissionDetail ? (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <span>Status: <strong>{submissionDetail.status}</strong></span>
              <span>Keçdi: {submissionDetail.passedCount}/{(submissionDetail.passedCount ?? 0) + (submissionDetail.failedCount ?? 0)}</span>
              <span>Vaxt: {submissionDetail.runtimeMs ?? "-"}ms</span>
              <span>{new Date(submissionDetail.createdAt).toLocaleString("az-AZ")}</span>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Kod</h4>
              <pre className="p-4 bg-slate-50 rounded text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                {submissionDetail.submittedCode}
              </pre>
            </div>
            {submissionDetail.errorMessage && (
              <div className="p-3 bg-red-50 rounded text-sm text-red-700">
                <strong>Xəta:</strong> {submissionDetail.errorMessage}
              </div>
            )}
            {submissionDetail.detailsJson && submissionDetail.detailsJson.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Test nəticələri ({submissionDetail.detailsJson.length})</h4>
                <div className="space-y-3">
                  {submissionDetail.detailsJson.map((t: { test_case_id?: number; is_sample?: boolean; passed?: boolean; output?: string; expected?: string; input?: string }, i: number) => (
                    <div key={i} className="p-3 bg-slate-50 rounded border border-slate-200">
                      <span className={`font-medium ${t.passed ? "text-green-700" : "text-red-700"}`}>
                        Test #{i + 1}: {t.passed ? "Keçdi" : "Uğursuz"}
                        {!t.is_sample && " (gizli)"}
                      </span>
                      {t.input != null && t.input !== "" && (
                        <div className="mt-2">
                          <span className="text-xs text-slate-500">Input:</span>
                          <pre className="p-2 bg-white rounded text-xs font-mono overflow-x-auto">{t.input}</pre>
                        </div>
                      )}
                      {t.output != null && (
                        <div className="mt-2">
                          <span className="text-xs text-slate-500">Çıxış:</span>
                          <pre className="p-2 bg-white rounded text-xs font-mono overflow-x-auto">{t.output}</pre>
                        </div>
                      )}
                      {t.expected != null && (
                        <div className="mt-2">
                          <span className="text-xs text-slate-500">Gözlənilən:</span>
                          <pre className="p-2 bg-white rounded text-xs font-mono overflow-x-auto">{t.expected}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-slate-500 py-4">Göndəriş tapılmadı</p>
        )}
      </Modal>
    </div>
  );
}
