# Bekrin School Frontend

DIM imtahanına hazırlaşan şagirdlər, müəllimlər və valideynlər üçün kurs idarəetmə sisteminin frontend hissəsi.

## Texniki Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **React Query (TanStack Query)**
- **React Hook Form + Zod**
- **Lucide React** (icons)

## Quraşdırma

1. Dependencies quraşdırın:
```bash
npm install
```

2. Environment dəyişənlərini təyin edin:
`.env.local` faylı yaradın və aşağıdakı dəyişənləri əlavə edin:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api
```

3. Development server-i işə salın:
```bash
npm run dev
```

4. Browser-də açın:
```
http://localhost:3000
```

## Struktur

```
app/
├── (auth)/
│   └── login/          # Login səhifəsi
├── (teacher)/
│   └── teacher/        # Müəllim paneli
│       ├── students/   # Şagirdlər idarəetməsi
│       ├── groups/      # Qruplar idarəetməsi
│       ├── payments/    # Ödənişlər
│       ├── attendance/  # Davamiyyət
│       ├── tests/       # Testlər
│       ├── coding/      # Kodlaşdırma tapşırıqları
│       └── ...
├── (student)/
│   └── student/        # Şagird paneli
│       ├── attendance/  # Davamiyyət
│       ├── results/     # Test nəticələri
│       └── coding/      # Kodlaşdırma məşqləri
└── (parent)/
    └── parent/         # Valideyn paneli
        └── attendance/  # Uşağın davamiyyəti

components/              # Ümumi komponentlər
lib/                     # API və utility funksiyaları
  ├── api.ts            # API client
  ├── auth.ts           # Auth hook-ları
  ├── teacher.ts        # Teacher API
  ├── student.ts        # Student API
  └── parent.ts         # Parent API
```

## Əsas Xüsusiyyətlər

### Authentication
- Login səhifəsi (yalnız email + şifrə)
- Signup yoxdur - istifadəçilər yalnız sistem daxilində yaradılır
- Token-based authentication (JWT)
- Role-based routing və qoruma

### Müəllim Paneli
- Dashboard (statistika və sürətli əməliyyatlar)
- Şagirdlər idarəetməsi (CRUD)
- Qruplar idarəetməsi
- Ödənişlər idarəetməsi
- Davamiyyət qeydiyyatı (skeleton)
- Testlər (skeleton)
- Kodlaşdırma modulları (skeleton)

### Şagird Paneli
- Dashboard (3 kart: Davamiyyət, Quiz Nəticələri, Kodlaşdırma)
- Davamiyyət görüntüləmə
- Test nəticələri
- Kodlaşdırma məşqləri

### Valideyn Paneli
- Uşaqlar siyahısı
- Hər uşaq üçün statistika (Davamiyyət %, Balans, Son Test, Proqramlaşdırma %)
- Ödənişlər modal
- Davamiyyət görüntüləmə

## API İnteqrasiya

Bütün API çağırışları `lib/api.ts` vasitəsilə mərkəzləşdirilmişdir. Backend API hazır olduqdan sonra endpoint URL-ləri `.env.local` faylında təyin edilməlidir.

### API Endpoint-ləri (nümunə)

- `POST /auth/login` - Giriş
- `GET /auth/me` - Cari istifadəçi məlumatı
- `GET /teacher/stats` - Müəllim statistika
- `GET /teacher/students` - Şagirdlər siyahısı
- `GET /teacher/groups` - Qruplar siyahısı
- `GET /teacher/payments` - Ödənişlər
- və s.

## Qeydlər

- Bütün UI mətnləri Azərbaycan dilindədir
- Responsive dizayn (mobile-friendly)
- Loading və error state-ləri hər səhifədə mövcuddur
- Modal-larda keyboard support (ESC ilə bağlanma)
- Table-larda empty state-lər

## Build

Production build üçün:

```bash
npm run build
npm start
```

## Lint

```bash
npm run lint
```
