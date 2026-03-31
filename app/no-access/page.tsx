export default function NoAccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-lg text-center">
        <h1 className="text-2xl font-semibold mb-2">İcazəniz yoxdur</h1>
        <p className="text-sm text-slate-600 mb-4">
          Bu səhifəyə daxil olmaq üçün uyğun rola sahib deyilsiniz. Zəhmət
          olmasa sistem administratoru ilə əlaqə saxlayın və ya başqa hesabla
          daxil olun.
        </p>
        <a href="/login" className="btn-primary">
          Giriş səhifəsinə qayıt
        </a>
      </div>
    </div>
  );
}

