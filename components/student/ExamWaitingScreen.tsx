"use client";

type ExamWaitingScreenProps = {
  onBack?: () => void;
};

export function ExamWaitingScreen({ onBack }: ExamWaitingScreenProps) {
  return (
    <div className="page-container">
      <div className="card max-w-md mx-auto text-center">
        <h1 className="text-xl font-bold text-slate-900 mb-3">İmtahan bitdi</h1>
        <p className="text-sm text-slate-700">
          İmtahan bitdi. Nəticəniz müəllim tərəfindən yoxlanıldıqdan sonra &apos;Nəticələr&apos; bölməsində görünəcək.
        </p>
        {onBack && (
          <button onClick={onBack} className="btn-primary mt-4">
            Dashboard-a qayıt
          </button>
        )}
      </div>
    </div>
  );
}

