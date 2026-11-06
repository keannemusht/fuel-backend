# ⛽ Batara Fuel Monitoring System (FMS-Core)

[![Next.js](https://img.shields.io/badge/Next.js-15.1.7-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-4.21-lightgrey?style=flat-square&logo=express)](https://expressjs.com/)
[![Prisma ORM](https://img.shields.io/badge/Prisma-6.4-1B222D?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-336791?style=flat-square&logo=postgresql)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)

> **Industrial-grade, mission-critical Fuel Dispensing & Telemetry Monitoring System** designed specifically for heavy equipment operations, multi-site mining fleets, bulk storage fuel tanks, and automated corporate ERP integrations.

---

## 📑 Daftar Isi (Table of Contents)
- [Arsitektur & Gambaran Sistem](#-arsitektur--gambaran-sistem)
- [Fitur Utama Sistem](#-fitur-utama-sistem)
  - [1. Validasi Telemetri Cerdas (HM, KM, KWH)](#1-validasi-telemetri-cerdas-hm-km-kwh)
  - [2. Multi-Site Management (Senyiur & Muara Pahu)](#2-multi-site-management-senyiur--muara-pahu)
  - [3. Terminal Dispenser Kiosk & Backdate Input](#3-terminal-dispenser-kiosk--backdate-input)
  - [4. Integrasi ERP Perusahaan & Export Data](#4-integrasi-erp-perusahaan--export-data)
  - [5. Sinkronisasi Google Sheets v4 & Batch Excel](#5-sinkronisasi-google-sheets-v4--batch-excel)
  - [6. Manajemen Tangki & Transfer Stok Antar Tangki](#6-manajemen-tangki--transfer-stok-antar-tangki)
  - [7. Keamanan, RBAC, dan Audit Trail](#7-keamanan-rbac-dan-audit-trail)
- [Struktur Data Armada Resmi (Senyiur Fleet)](#-struktur-data-armada-resmi-senyiur-fleet)
- [Struktur Direktori Proyek](#-struktur-direktori-proyek)
- [Panduan Instalasi & Menjalankan Sistem](#-panduan-instalasi--menjalankan-sistem)
  - [Prasyarat](#prasyarat)
  - [1. Konfigurasi Backend](#1-konfigurasi-backend)
  - [2. Konfigurasi Frontend](#2-konfigurasi-frontend)
- [Variabel Lingkungan (Environment Variables)](#-variabel-lingkungan-environment-variables)
- [Akun Default & Role Akses](#-akun-default--role-akses)
- [Alur Kerja & Diagram Operasional](#-alur-kerja--diagram-operasional)

---

## 🏗️ Arsitektur & Gambaran Sistem

Sistem Batara FMS-Core mengintegrasikan operasi lapangan (Fuelman di terminal atau mobil Fuel Truck) dengan manajemen site dan sistem ERP kantor pusat secara real-time.

```
       +-------------------------------------------------------------+
       |                  DISPENSER TERMINAL / LAPTOP                |
       |               (Next.js 15 Client - Responsive)              |
       +------------------------------+------------------------------+
                                      |
                         REST API (JWT Bearer Token)
                                      |
                                      v
       +-------------------------------------------------------------+
       |               BATARA BACKEND CORE (Express.js)              |
       |  - Validation Engine (KM/HM/KWH delta rules)                |
       |  - Rate Limiter, Helmet Security & RBAC Middleware          |
       |  - ERP Formatter (Excel & CSV)                              |
       |  - Background Async Queue Worker (Google Sheets v4)         |
       +--------------+------------------------------+---------------+
                      |                              |
             Prisma Client ORM             Google APIs (JWT Service)
                      |                              |
                      v                              v
       +------------------------------+   +--------------------------+
       |    PostgreSQL (Supabase)     |   |   Live Google Sheets     |
       |  - 25,500+ Operational Logs  |   |  (Monthly Sheets Sync)   |
       |  - 83 Active Master Units    |   +--------------------------+
       |  - Tanks & Stock Ledgers     |
       |  - Immutable Audit Trails    |
       +------------------------------+
```

---

## ✨ Fitur Utama Sistem

### 1. Validasi Telemetri Cerdas (HM, KM, KWH)
Sistem memiliki mesin validasi adaptif yang memeriksa kemampuan pencatatan tiap unit secara otomatis:
- **Unit Produksi (Double Trailer)**: Wajib validasi HM & KM.
  - $\text{KM Sekarang} \ge \text{KM Terakhir}$ dan $(\text{KM Sekarang} - \text{KM Terakhir}) \le 1.000\text{ KM/shift}$.
  - $\text{HM Sekarang} > \text{HM Terakhir}$ dan $(\text{HM Sekarang} - \text{HM Terakhir}) \le 24\text{ Jam/shift}$.
- **Unit Light Vehicle (LV) & Ambulance**: Hanya mewajibkan input Odometer KM (HM otomatis non-aktif).
- **Unit Genset**: Mewajibkan Hour Meter (HM) dan Daya Genset (KWH).
- **Unit Non-Meter / Pengisian Khusus (`Other Consumption`)**: Langsung mencatat volume liter tanpa memblokir input meter.
- **Admin Validation Bypass**: Administrator dapat membypass validasi meter untuk kasus penggantian speedometer/hour meter fisik yang rusak dengan menyertakan alasan tertulis untuk audit trail.

### 2. Multi-Site Management (Senyiur & Muara Pahu)
- **Global Header Switcher**: Pemilihan site aktif (**Site Senyiur** atau **Site Muara Pahu**) tersedia di header navigasi utama berdampingan dengan jam operasional WITA.
- **Site-Aware Filtering**: Seluruh statistik dashboard, riwayat bulanan, kapasitas tangki, dan export otomatis difilter berdasarkan site terpilih.
- **Pemetaan ERP Otomatis**:
  - **Site Senyiur**: Storage Location code `MTK001`, Project Area `SNY`.
  - **Site Muara Pahu**: Storage Location code `MTK003`, Project Area `MPH`.

### 3. Terminal Dispenser Kiosk & Backdate Input
- **Dispenser Terminal (`/dispenser`)**:
  - Antarmuka layar sentuh ramah operator di lapangan dengan preset volume cepat (`+50L`, `+100L`, `+200L`, `+500L`).
  - Dukungan dua moda sumber: **Stationary Dispenser (Main Tank)** dan **Mobile Fuel Truck (FT 101 / FT 102)** dengan kalkulator flow meter otomatis (`Flow Akhir - Flow Awal`).
  - Dropdown target armada pintar (*Searchable Fleet Select*) yang menampilkan telemetri terakhir secara adaptif.
- **Backdate Input (`/backdate`)**:
  - Fitur pencatatan transaksi terlewat yang memeriksa konteks log kronologis (*preceding log* & *subsequent log*).
  - Menjaga keabsahan riwayat meteran di antara dua waktu transaksi yang sudah ada.

### 4. Integrasi ERP Perusahaan & Export Data
Pusat ekspor data serbaguna di halaman Riwayat Bulanan (`/history`):
- **Export ERP Perusahaan (.xlsx & .csv)**:
  - Format 15-kolom khusus siap unggah ke sistem ERP internal / SAP.
  - Menyertakan kolom Sloc (`MTK001` / `MTK003`), Site/Plant code, nomor unit, dan rincian transaksi lengkap.
- **Export Excel Standar (16-Kolom)**:
  - Laporan komprehensif lengkap dengan ringkasan shift, format tanggal, nomor lambung, nama fuelman, dan status sync.
- **Import Data Excel Batch**:
  - Membaca sheet bulanan berformat standar lapangan, mencocokkan kode unit, dan mencegah duplikasi data transaksi.
  - Unit yang tidak terdaftar di master data otomatis disimpan sebagai unit historis (`isActive: false`) agar tidak merusak daftar aktif.

### 5. Sinkronisasi Google Sheets v4 & Batch Excel
- **Bi-Directional Background Sync**: Setiap transaksi baru otomatis dimasukkan ke antrean sinkronisasi (`SyncQueue`) dan dikirim ke tab Google Sheets yang sesuai dengan bulan transaksi (misal: `NOVEMBER 2026`).
- **Resilient Retry Mechanism**: Kegagalan jaringan di site terpencil akan ditangani dengan exponential backoff retry tanpa menghambat pencatatan transaksi lokal.

### 6. Manajemen Tangki & Transfer Stok Antar Tangki
- **Pemantauan Stok Real-Time**: Visualisasi kapasitas tangki, stok aktual, sisa *ullage*, dan indikator peringatan level kritis (*Critical Low Alert*).
- **Inbound Refill (DO BBM Masuk)**: Form penerimaan BBM dari supplier / transportir dengan validasi kapasitas maksimal tangki penerima.
- **Stock Transfer**: Pencatatan transfer bahan bakar antar tangki (misal: Main Tank Senyiur ke Fuel Truck FT 101/102) dengan pelacakan nomor lambung dan driver.

### 7. Keamanan, RBAC, dan Audit Trail
- **Role-Based Access Control (RBAC)**:
  - `ADMIN`: Akses penuh konfigurasi master unit, manajemen tangki, bypass meter, pendaftaran user, dan audit trail.
  - `MANAGEMENT`: Akses monitoring dashboard, analisis laporan, ekspor ERP, dan audit trail (read-only pada operasional).
  - `FUELMAN`: Akses khusus pencatatan dispenser, input backdate, dan melihat log shift aktif.
- **Keamanan Data**:
  - JWT token dengan durasi pendek + refresh token flow.
  - Password di-hash menggunakan `bcryptjs`.
  - Rate limiting & Helmet security headers.
  - **Prisma Seed Safety Guard**: Mencegah penghapusan atau penimpaan data produksi secara tidak sengaja.
- **Dukungan Dua Bahasa & Tema**:
  - Bahasa Indonesia & English.
  - Industrial Dark Mode & Clean Slate Light Mode.

---

## �️ Tech Stack

- **Backend**: Node.js, Express.js, TypeScript, Prisma ORM, SQLite / PostgreSQL, Zod, ExcelJS, googleapis.
- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, Framer Motion, TanStack Query, Axios.

---

## 📂 Struktur Direktori Proyek

```
batarafuel-monitoring/
├── backend/
│   ├── excel/                     # File referensi & master template Excel
│   │   ├── Improvement Refuelling new.xlsx
│   │   ├── Format Upload Fuel.xls
│   │   └── Format Upload & Sloc.Fuel.xls
│   ├── prisma/
│   │   ├── schema.prisma          # PostgreSQL schema & relation models
│   │   └── seed.ts                # Idempotent seed with safety guard
│   ├── scripts/
│   │   └── sync_senyiur_units.ts  # Master sync script untuk unit armada
│   ├── src/
│   │   ├── config/                # Database pooler & runtime config
│   │   ├── controllers/           # Auth, Fuel, Tank, Unit, Sync controllers
│   │   ├── middleware/            # JWT Auth, RBAC, Error & Audit handlers
│   │   ├── services/              # Business logic (ERP, Fuel, Excel, Sheets)
│   │   │   ├── batchImport.service.ts
│   │   │   ├── fuel.service.ts
│   │   │   ├── googleSheets.service.ts
│   │   │   ├── tank.service.ts
│   │   │   └── unit.service.ts
│   │   ├── types/                 # Express & DTO type definitions
│   │   └── server.ts              # Entry point Express backend (Port 8000)
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/                   # Next.js 15 App Router
│   │   │   ├── (auth)/login/      # Secure credentials login page
│   │   │   └── (dashboard)/
│   │   │       ├── layout.tsx     # Shell layout with Global Site Switcher
│   │   │       ├── page.tsx       # KPI Analytics & Fleet Health Dashboard
│   │   │       ├── dispenser/     # Real-time Dispensing Kiosk Terminal
│   │   │       ├── backdate/      # Chronological Audit Backdate Entry
│   │   │       ├── history/       # Monthly Ledger, Batch Import & ERP Export
│   │   │       ├── units/         # Fleet Equipment Master Management
│   │   │       ├── tanks/         # Storage Tank & Stock Inventory
│   │   │       ├── users/         # User & Personnel Access Control
│   │   │       └── audit/         # Immutable Security Audit Trail
│   │   ├── components/            # Reusable UI widgets & modals
│   │   │   ├── providers/         # Auth, Theme, Site & Language Contexts
│   │   │   └── shared/            # SearchableFleetSelect, Modals, Navbar
│   │   ├── hooks/                 # TanStack Query custom hooks
│   │   └── lib/                   # Axios client, utils, unit visual configs
│   └── package.json
│
└── README.md
```

---

## 🚀 Panduan Instalasi & Menjalankan Sistem

### Prasyarat
- **Node.js**: Versi `20.x` atau lebih baru
- **NPM**: Versi `10.x` atau lebih baru
- **Database**: PostgreSQL (direkomendasikan Supabase Pooler)

---

### 1. Konfigurasi Backend

Masuk ke folder `backend`:
```bash
cd backend
npm install
```

Siapkan file `.env` di dalam folder `backend/` (lihat bagian [Environment Variables](#-variabel-lingkungan-environment-variables)).

Generate Prisma Client:
```bash
npx prisma generate
```

Jalankan server backend (Mode Development):
```bash
npm run dev
```
> Server backend berjalan di: `http://localhost:8000`  
> Health check endpoint: `http://localhost:8000/api/health`

---

### 2. Konfigurasi Frontend

Buka terminal baru, masuk ke folder `frontend`:
```bash
cd frontend
npm install
```

Siapkan file `.env.local` di dalam folder `frontend/`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

Jalankan server frontend:
```bash
npm run dev
```
> Aplikasi web Next.js berjalan di: `http://localhost:3000`

---

## 🔐 Variabel Lingkungan (Environment Variables)

### Backend (`backend/.env`)
```env
# Server Port & Mode
PORT=8000
NODE_ENV=development

# Database Connection (Supabase PostgreSQL)
DATABASE_URL="postgresql://user:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://user:password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"

# JWT Authentication Secrets
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_SECRET="your-super-secret-refresh-key"
REFRESH_TOKEN_EXPIRES_IN="7d"

# Google Sheets v4 API Integration
GOOGLE_SERVICE_ACCOUNT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID="your-google-spreadsheet-id"
GOOGLE_SHEET_NAME="LOG FUEL MONITORING"

# CORS Origin
CORS_ORIGIN="http://localhost:3000"
```

---

## 👥 Akun Default & Role Akses

| Username | Role | Akses Utama |
| :--- | :--- | :--- |
| **`admin`** | `ADMIN` | Akses penuh: Master unit, tangki, bypass validasi meter, audit trail, user management |
| **`management`**| `MANAGEMENT`| Akses pengawasan: Dashboard analitik, ekspor laporan ERP, audit trail |
| **`fuelman`** | `FUELMAN` | Akses operasional lapangan: Dispenser terminal, backdate input, log shift |
| **`nabawi`** / **`leman`** | `FUELMAN` | Petugas fuelman operasional shift |

> [!TIP]
> Semua password default akun pengujian lokal dikonfigurasi melalui sistem otentikasi aman (`admin123` / `fuelman123`). Anda dapat mengelola dan mengganti password pengguna kapan saja melalui menu **User Management** (`/users`).

---

## 🔄 Alur Kerja & Diagram Operasional

### Alur Pencatatan Transaksi Lapangan (Dispensing Flow)

```mermaid
sequenceDiagram
    autonumber
    actor F as Fuelman (Petugas)
    participant UI as Dispenser Terminal UI
    participant API as Backend (Express.js)
    participant DB as PostgreSQL (Supabase)
    participant GS as Google Sheets v4 API

    F->>UI: Pilih Site (Senyiur/Muara Pahu) & Moda Tangki
    F->>UI: Pilih Unit Target (misal: PM 401)
    UI->>UI: Tampilkan Telemetri Terakhir (KM & HM)
    F->>UI: Input Odometer KM, Hour Meter HM, dan Qty Liter
    UI->>UI: Live Validator Cek Delta KM (<=1000) & Delta HM (<=24 Jam)
    F->>UI: Tekan "Konfirmasi Pengisian"
    UI->>API: POST /api/fuel/dispense (Payload + Bearer Token)
    API->>API: Verifikasi Hak Akses & Validasi Strict Meteran
    API->>DB: Simpan FuelLog & Potong Stok StorageTank
    API->>DB: Perbarui baseline lastKm & lastHm pada Unit
    API->>DB: Buat antrean sync di SyncQueue (PENDING)
    API-->>UI: 201 Created (Log Number & Saldo Stok Terkini)
    UI-->>F: Tampilkan Konfirmasi Sukses & Siap Transaksi Baru
    Note over API,GS: Background Worker Asinkron
    API->>GS: Append Row ke Tab Bulanan Google Sheets
    API->>DB: Update SyncQueue status -> SYNCED
```

---

## 📄 Lisensi
Sistem ini dikembangkan secara eksklusif untuk operasional **PT Batara Energi / Mining Fleet Operations**. Seluruh hak cipta dan kekayaan intelektual dilindungi.
