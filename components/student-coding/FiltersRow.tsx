"use client";

import { Search } from "lucide-react";
import type { CodingStatusFilter, CodingSort } from "@/hooks/useStudentCoding";

interface FiltersRowProps {
  topicFilter: string;
  onTopicChange: (v: string) => void;
  statusFilter: CodingStatusFilter;
  onStatusChange: (v: CodingStatusFilter) => void;
  search: string;
  onSearchChange: (v: string) => void;
  sort: CodingSort;
  onSortChange: (v: CodingSort) => void;
  topicOptions: { id: string; name: string }[];
}

export function FiltersRow(props: FiltersRowProps) {
  const {
    topicFilter,
    onTopicChange,
    statusFilter,
    onStatusChange,
    search,
    onSearchChange,
    sort,
    onSortChange,
    topicOptions,
  } = props;
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Mövzu:</label>
        <select
          className="input text-sm w-auto min-w-[120px]"
          value={topicFilter}
          onChange={(e) => onTopicChange(e.target.value)}
        >
          <option value="">Hamısı</option>
          {topicOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Status:</label>
        <select
          className="input text-sm w-auto min-w-[140px]"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value as CodingStatusFilter)}
        >
          <option value="all">Hamısı</option>
          <option value="solved">Həll edilmiş</option>
          <option value="attempted">Cəhd edilmiş</option>
          <option value="not_attempted">Cəhd edilməmiş</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Sırala:</label>
        <select
          className="input text-sm w-auto min-w-[140px]"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as CodingSort)}
        >
          <option value="newest">Ən yeni</option>
          <option value="most_solved">Ən çox həll</option>
          <option value="last_activity">Son aktivlik</option>
        </select>
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-[180px]">
        <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <input
          type="text"
          className="input text-sm flex-1"
          placeholder="Axtar..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
