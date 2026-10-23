# 🌸 Beauty Parlour Order & Appointment Manager

A 100% serverless, private management application for beauty parlour owners, built to run **lifelong free** on **Cloudflare Workers** with **Cloudflare D1 (Serverless SQLite)**.

---

## ✨ Features

- **🔐 Owner Only Security**: 4-digit PIN lock screen (default PIN: `1234`, changeable in Settings).
- **📊 Real-time Dashboard**:
  - Today's appointment count and expected earnings.
  - Today's collected revenue (Cash & UPI).
  - This month's total sales.
  - Pending unpaid orders tracker.
  - Live today's schedule with time slots.
- **📅 Order / Appointment Management**:
  - Create new appointments with customer name, phone number, date, and time.
  - Select one or multiple services with automatic price calculation.
  - Track order status (`Pending`, `Confirmed`, `Completed`, `Cancelled`).
  - Track payment status (`Cash`, `UPI / GPay`, `Card`, `Unpaid`).
  - **1-Click WhatsApp Reminder**: Direct link to send instant appointment confirmations or bills to the customer's phone.
  - Filter orders by: Today, Upcoming, Completed, and Pending Payment.
- **💇 Services Menu**:
  - Add, view, and delete parlour services and treatments.
  - Pre-seeded with popular services (Haircuts, Facials, Threading, Waxing, Bridal Makeup, Manicure).
- **⚙️ Settings**:
  - Update Parlour name and contact phone number.
  - Update the security PIN.

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Initialize Local D1 Database
```bash
npm run db:init:local
npm run db:seed:local
```

### 3. Start Local Dev Server
```bash
npm run dev
```

Open `http://localhost:8787` in your browser. Enter PIN `1234` to unlock!

---

## ☁️ Deploying to Cloudflare (100% Free Forever)

### Step 1: Login to Cloudflare via CLI
```bash
npx wrangler login
```

### Step 2: Create your Remote Cloudflare D1 Database
Run:
```bash
npx wrangler d1 create beauty-parlour-db
```
Wrangler will output something like:
```json
[[d1_databases]]
binding = "DB"
database_name = "beauty-parlour-db"
database_id = "your-actual-database-id-here"
```

Copy the generated `database_id` and paste it into `wrangler.jsonc`:
```json
"database_id": "your-actual-database-id-here"
```

### Step 3: Run Migrations on Cloudflare
```bash
npm run db:init:remote
npm run db:seed:remote
```

### Step 4: Deploy to Cloudflare Workers
```bash
npm run deploy
```

Wrangler will give you a live production URL, such as:
`https://beauty-parlour.<your-subdomain>.workers.dev`

---

## 📱 Mobile Friendly
You can open your live URL on your mobile phone (iPhone or Android) and tap **"Add to Home Screen"** in your browser to use it like a native mobile app!
