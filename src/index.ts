import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

// Auto-initialize DB schema & default seeds if tables are not yet present in D1
async function ensureDbInitialized(db: D1Database) {
  try {
    await db.prepare('SELECT 1 FROM appointments LIMIT 1').first();
  } catch {
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL, duration_minutes INTEGER DEFAULT 30, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now', 'localtime')));
        CREATE TABLE IF NOT EXISTS appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, appointment_date TEXT NOT NULL, appointment_time TEXT NOT NULL, total_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'confirmed', payment_status TEXT NOT NULL DEFAULT 'pending', notes TEXT, created_at TEXT DEFAULT (datetime('now', 'localtime')), updated_at TEXT DEFAULT (datetime('now', 'localtime')));
        CREATE TABLE IF NOT EXISTS appointment_services (id INTEGER PRIMARY KEY AUTOINCREMENT, appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE, service_id INTEGER, service_name TEXT NOT NULL, price REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE, amount REAL NOT NULL, payment_method TEXT NOT NULL, payment_date TEXT DEFAULT (datetime('now', 'localtime')), note TEXT, created_at TEXT DEFAULT (datetime('now', 'localtime')));
        CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
        CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
        CREATE INDEX IF NOT EXISTS idx_appointment_services_appt ON appointment_services(appointment_id);
        CREATE INDEX IF NOT EXISTS idx_payments_appt ON payments(appointment_id);

        INSERT OR IGNORE INTO settings (key, value) VALUES ('passcode', '4050'), ('parlour_name', 'Vrunda Beauty Parlour'), ('parlour_phone', '+91 9876543210'), ('currency', '₹');
        INSERT OR IGNORE INTO services (id, name, category, price, duration_minutes) VALUES
          (1, 'Eyebrow & Upper Lip Threading', 'Threading', 100, 15),
          (2, 'Full Face Threading', 'Threading', 250, 25),
          (3, 'Basic Hair Cut & Styling', 'Hair', 350, 30),
          (4, 'Layer Hair Cut', 'Hair', 600, 45),
          (5, 'Hair Spa with Deep Conditioning', 'Hair', 1200, 60),
          (6, 'Hair Straightening / Keratin', 'Hair', 3500, 120),
          (7, 'Fruit Cleanup', 'Skin & Facial', 500, 30),
          (8, 'Gold Glow Facial', 'Skin & Facial', 1500, 60),
          (9, 'Diamond Anti-Aging Facial', 'Skin & Facial', 2200, 75),
          (10, 'Full Arms + Underarms Waxing', 'Waxing', 400, 30),
          (11, 'Full Legs Waxing', 'Waxing', 500, 35),
          (12, 'Rica Waxing Package', 'Waxing', 1200, 60),
          (13, 'Deluxe Manicure & Pedicure', 'Nails & Feet', 900, 50),
          (14, 'Gel Nail Art & Extensions', 'Nails & Feet', 1500, 60),
          (15, 'Party Makeup with Hairstyle', 'Bridal & Makeup', 2500, 90),
          (16, 'Bridal Makeup with Draping', 'Bridal & Makeup', 8000, 180);

        INSERT OR IGNORE INTO appointments (id, customer_name, customer_phone, appointment_date, appointment_time, total_amount, paid_amount, status, payment_status, notes) VALUES
          (1, 'Pooja Sharma', '9825123456', date('now', 'localtime'), '11:00', 8000, 3000, 'confirmed', 'partial', 'Bridal Makeup package'),
          (2, 'Ananya Patel', '9978123456', date('now', 'localtime'), '14:30', 950, 950, 'confirmed', 'paid', 'Hair Cut + Threading');

        INSERT OR IGNORE INTO appointment_services (id, appointment_id, service_id, service_name, price) VALUES
          (1, 1, 16, 'Bridal Makeup with Draping', 8000),
          (2, 2, 4, 'Layer Hair Cut', 600),
          (3, 2, 3, 'Basic Hair Cut & Styling', 350);

        INSERT OR IGNORE INTO payments (id, appointment_id, amount, payment_method, note) VALUES
          (1, 1, 3000, 'upi', 'Advance booking deposit'),
          (2, 2, 950, 'cash', 'Full payment at counter');
      `);
    } catch (e) {
      console.error('Auto DB init failed', e);
    }
  }

  // Ensure payments table exists in existing database
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        payment_date TEXT DEFAULT (datetime('now', 'localtime')),
        note TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_payments_appt ON payments(appointment_id);
    `);
  } catch {}

  // Ensure paid_amount column exists in appointments
  try {
    await db.exec("ALTER TABLE appointments ADD COLUMN paid_amount REAL DEFAULT 0;");
  } catch {}

  // Backfill paid_amount for older paid appointments if 0
  try {
    await db.exec("UPDATE appointments SET paid_amount = total_amount WHERE (payment_status = 'paid' OR payment_status LIKE 'paid_%') AND (paid_amount IS NULL OR paid_amount = 0);");
  } catch {}
}

app.use('/api/*', async (c, next) => {
  if (c.env?.DB) {
    await ensureDbInitialized(c.env.DB);
  }
  await next();
});

// Helper: Get setting value
async function getSetting(db: D1Database, key: string, defaultValue: string = ''): Promise<string> {
  try {
    const res = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    return res?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

// ─────────────────────────────────────────────
// 1. AUTH: VERIFY PIN
// ─────────────────────────────────────────────
app.post('/api/auth/login', async (c) => {
  const { pin } = await c.req.json<{ pin: string }>();
  const db = c.env.DB;
  const currentPin = await getSetting(db, 'passcode', '4050');

  if (pin === currentPin) {
    return c.json({ success: true, token: 'auth_' + Date.now() });
  }
  return c.json({ success: false, message: 'Invalid PIN' }, 401);
});

// ─────────────────────────────────────────────
// 2. DASHBOARD METRICS
// ─────────────────────────────────────────────
app.get('/api/dashboard', async (c) => {
  const db = c.env.DB;
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  // Today metrics: Payments collected today from payments table OR appointments
  let todayCollected = 0;
  try {
    const pToday = await db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE payment_date LIKE ?`).bind(`${today}%`).first<{ s: number }>();
    const aToday = await db.prepare(`SELECT COALESCE(SUM(paid_amount), 0) as s FROM appointments WHERE appointment_date = ? AND status != 'cancelled'`).bind(today).first<{ s: number }>();
    todayCollected = Math.max(pToday?.s ?? 0, aToday?.s ?? 0);
  } catch {}

  const todayStats = await db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(total_amount), 0) as expected
    FROM appointments 
    WHERE appointment_date = ? AND status != 'cancelled'
  `).bind(today).first<{ count: number; expected: number }>();

  // Month metrics
  let monthRevenue = 0;
  try {
    const pMonth = await db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE payment_date LIKE ?`).bind(`${currentMonth}%`).first<{ s: number }>();
    const aMonth = await db.prepare(`SELECT COALESCE(SUM(paid_amount), 0) as s FROM appointments WHERE appointment_date LIKE ? AND status != 'cancelled'`).bind(`${currentMonth}%`).first<{ s: number }>();
    monthRevenue = Math.max(pMonth?.s ?? 0, aMonth?.s ?? 0);
  } catch {}

  const monthCount = await db.prepare(`
    SELECT COUNT(*) as count FROM appointments WHERE appointment_date LIKE ? AND status != 'cancelled'
  `).bind(`${currentMonth}%`).first<{ count: number }>();

  // Pending payments count & amount
  const pendingPayments = await db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(MAX(0, total_amount - COALESCE(paid_amount, 0))), 0) as pending_amount
    FROM appointments
    WHERE (payment_status = 'pending' OR payment_status = 'partial' OR COALESCE(paid_amount, 0) < total_amount) AND status != 'cancelled'
  `).first<{ count: number; pending_amount: number }>();

  // Today's appointments with payment details
  const todayAppointments = await db.prepare(`
    SELECT 
      a.id,
      a.customer_name,
      a.customer_phone,
      a.appointment_date,
      a.appointment_time,
      a.total_amount,
      COALESCE(a.paid_amount, 0) as paid_amount,
      MAX(0, a.total_amount - COALESCE(a.paid_amount, 0)) as due_amount,
      a.status,
      a.payment_status,
      a.notes,
      COALESCE(GROUP_CONCAT(s.service_name, ', '), '') as services_list
    FROM appointments a
    LEFT JOIN appointment_services s ON a.id = s.appointment_id
    WHERE a.appointment_date = ? 
    GROUP BY a.id
    ORDER BY a.appointment_time ASC
  `).bind(today).all();

  return c.json({
    today,
    todayCount: todayStats?.count ?? 0,
    todayCollected,
    todayExpected: todayStats?.expected ?? 0,
    monthRevenue,
    monthCount: monthCount?.count ?? 0,
    pendingPaymentsCount: pendingPayments?.count ?? 0,
    pendingPaymentsAmount: pendingPayments?.pending_amount ?? 0,
    todayAppointments: todayAppointments.results ?? []
  });
});

// ─────────────────────────────────────────────
// 3. APPOINTMENTS LIST & FILTERS
// ─────────────────────────────────────────────
app.get('/api/appointments', async (c) => {
  try {
    const db = c.env.DB;
    const filter = c.req.query('filter') || 'all';
    const search = c.req.query('search') || '';
    const today = new Date().toISOString().slice(0, 10);

    let query = `
      SELECT 
        a.id,
        a.customer_name,
        a.customer_phone,
        a.appointment_date,
        a.appointment_time,
        a.total_amount,
        COALESCE(a.paid_amount, 0) as paid_amount,
        MAX(0, a.total_amount - COALESCE(a.paid_amount, 0)) as due_amount,
        a.status,
        a.payment_status,
        a.notes,
        COALESCE(GROUP_CONCAT(s.service_name, ', '), '') as services_list
      FROM appointments a
      LEFT JOIN appointment_services s ON a.id = s.appointment_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filter === 'today') {
      query += ' AND a.appointment_date = ?';
      params.push(today);
    } else if (filter === 'upcoming') {
      query += ' AND a.appointment_date >= ? AND a.status != "completed" AND a.status != "cancelled"';
      params.push(today);
    } else if (filter === 'completed') {
      query += ' AND a.status = "completed"';
    } else if (filter === 'partial') {
      query += ' AND (a.payment_status = "partial" OR (a.paid_amount > 0 AND a.paid_amount < a.total_amount))';
    } else if (filter === 'unpaid') {
      query += ' AND (a.payment_status = "pending" OR a.paid_amount = 0)';
    } else if (filter === 'paid') {
      query += ' AND (a.payment_status = "paid" OR a.paid_amount >= a.total_amount)';
    } else if (filter === 'pending_payment') {
      query += ' AND (a.payment_status = "pending" OR a.payment_status = "partial" OR a.paid_amount < a.total_amount) AND a.status != "cancelled"';
    }

    if (search) {
      query += ' AND (a.customer_name LIKE ? OR a.customer_phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' GROUP BY a.id ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT 100';

    const stmt = db.prepare(query);
    const { results } = await stmt.bind(...params).all();

    return c.json(results || []);
  } catch (err: any) {
    console.error('Failed to fetch appointments', err);
    return c.json([]);
  }
});

// ─────────────────────────────────────────────
// 4. CREATE APPOINTMENT (WITH OPTIONAL ADVANCE / EMI)
// ─────────────────────────────────────────────
app.post('/api/appointments', async (c) => {
  const db = c.env.DB;
  const data = await c.req.json<{
    customer_name: string;
    customer_phone: string;
    appointment_date: string;
    appointment_time: string;
    services: { id?: number; name: string; price: number }[];
    total_amount: number;
    advance_amount?: number;
    payment_method?: string;
    payment_note?: string;
    status?: string;
    payment_status?: string;
    notes?: string;
  }>();

  if (!data.customer_name || !data.customer_phone || !data.appointment_date || !data.appointment_time) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const status = data.status || 'confirmed';
  const notes = data.notes || '';
  const total = Number(data.total_amount) || 0;
  const advance = Number(data.advance_amount) || 0;

  let paid_amount = 0;
  let payment_status = 'pending';

  if (advance > 0) {
    paid_amount = advance;
    payment_status = (advance >= total) ? 'paid' : 'partial';
  } else if (data.payment_status === 'paid' || data.payment_status?.startsWith('paid_')) {
    paid_amount = total;
    payment_status = 'paid';
  }

  const result = await db.prepare(`
    INSERT INTO appointments (customer_name, customer_phone, appointment_date, appointment_time, total_amount, paid_amount, status, payment_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.customer_name,
    data.customer_phone,
    data.appointment_date,
    data.appointment_time,
    total,
    paid_amount,
    status,
    payment_status,
    notes
  ).run();

  const appointmentId = result.meta.last_row_id;

  if (data.services && data.services.length > 0 && appointmentId) {
    for (const s of data.services) {
      await db.prepare(`
        INSERT INTO appointment_services (appointment_id, service_id, service_name, price)
        VALUES (?, ?, ?, ?)
      `).bind(appointmentId, s.id || null, s.name, s.price).run();
    }
  }

  // Record initial payment installment if advance was paid
  if (appointmentId && paid_amount > 0) {
    const pMethod = data.payment_method || (data.payment_status === 'paid_upi' ? 'upi' : (data.payment_status === 'paid_card' ? 'card' : 'cash'));
    const pNote = data.payment_note || (paid_amount < total ? 'Advance booking deposit' : 'Full payment on booking');
    await db.prepare(`
      INSERT INTO payments (appointment_id, amount, payment_method, note, payment_date)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `).bind(appointmentId, paid_amount, pMethod, pNote).run();
  }

  return c.json({
    success: true,
    id: appointmentId,
    paid_amount,
    due_amount: Math.max(0, total - paid_amount),
    payment_status
  }, 201);
});

// ─────────────────────────────────────────────
// 5. PAYMENT HISTORY & INSTALLMENTS (ADVANCE / EMI)
// ─────────────────────────────────────────────
app.get('/api/appointments/:id/payments', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  const appt = await db.prepare(`
    SELECT id, customer_name, customer_phone, appointment_date, appointment_time, total_amount, COALESCE(paid_amount, 0) as paid_amount, payment_status
    FROM appointments WHERE id = ?
  `).bind(id).first<{
    id: number;
    customer_name: string;
    customer_phone: string;
    appointment_date: string;
    appointment_time: string;
    total_amount: number;
    paid_amount: number;
    payment_status: string;
  }>();

  if (!appt) return c.json({ error: 'Appointment not found' }, 404);

  const { results: payments } = await db.prepare(`
    SELECT * FROM payments WHERE appointment_id = ? ORDER BY payment_date ASC, id ASC
  `).bind(id).all();

  const total = Number(appt.total_amount) || 0;
  const paid = Number(appt.paid_amount) || 0;
  const balanceDue = Math.max(0, total - paid);

  return c.json({
    appointment: appt,
    payments: payments || [],
    total,
    paid,
    balanceDue
  });
});

app.post('/api/appointments/:id/payments', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const body = await c.req.json<{
    amount: number;
    payment_method: string;
    note?: string;
  }>();

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return c.json({ error: 'Valid payment amount is required' }, 400);
  }

  const appt = await db.prepare('SELECT total_amount, paid_amount FROM appointments WHERE id = ?').bind(id).first<{ total_amount: number; paid_amount: number }>();
  if (!appt) return c.json({ error: 'Appointment not found' }, 404);

  const method = body.payment_method || 'cash';
  const totalBill = Number(appt.total_amount);
  const currentPaid = Number(appt.paid_amount || 0);
  const remainingBefore = Math.max(0, totalBill - currentPaid);

  const note = body.note || (amount >= remainingBefore ? 'Final balance settlement' : 'Installment payment');

  // Insert payment record
  await db.prepare(`
    INSERT INTO payments (appointment_id, amount, payment_method, note, payment_date)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
  `).bind(id, amount, method, note).run();

  // Recalculate total paid
  const sumRes = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE appointment_id = ?
  `).bind(id).first<{ total_paid: number }>();

  const newTotalPaid = sumRes?.total_paid ?? (currentPaid + amount);
  const newStatus = (newTotalPaid >= totalBill) ? 'paid' : (newTotalPaid > 0 ? 'partial' : 'pending');

  await db.prepare(`
    UPDATE appointments 
    SET paid_amount = ?, payment_status = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).bind(newTotalPaid, newStatus, id).run();

  return c.json({
    success: true,
    totalPaid: newTotalPaid,
    balanceDue: Math.max(0, totalBill - newTotalPaid),
    paymentStatus: newStatus
  });
});

app.delete('/api/payments/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  const payment = await db.prepare('SELECT appointment_id FROM payments WHERE id = ?').bind(id).first<{ appointment_id: number }>();
  if (!payment) return c.json({ error: 'Payment not found' }, 404);

  await db.prepare('DELETE FROM payments WHERE id = ?').bind(id).run();

  // Recalculate total paid on appointment
  const sumRes = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE appointment_id = ?
  `).bind(payment.appointment_id).first<{ total_paid: number }>();

  const appt = await db.prepare('SELECT total_amount FROM appointments WHERE id = ?').bind(payment.appointment_id).first<{ total_amount: number }>();
  const newTotalPaid = sumRes?.total_paid ?? 0;
  const totalBill = Number(appt?.total_amount || 0);
  const newStatus = (newTotalPaid >= totalBill) ? 'paid' : (newTotalPaid > 0 ? 'partial' : 'pending');

  await db.prepare(`
    UPDATE appointments SET paid_amount = ?, payment_status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
  `).bind(newTotalPaid, newStatus, payment.appointment_id).run();

  return c.json({ success: true, newTotalPaid, balanceDue: Math.max(0, totalBill - newTotalPaid), paymentStatus: newStatus });
});

// ─────────────────────────────────────────────
// 5. UPDATE APPOINTMENT
// ─────────────────────────────────────────────
app.patch('/api/appointments/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const data = await c.req.json<{
    status?: string;
    payment_status?: string;
    notes?: string;
  }>();

  const updates: string[] = [];
  const params: any[] = [];

  if (data.status) {
    updates.push('status = ?');
    params.push(data.status);
  }
  if (data.payment_status) {
    updates.push('payment_status = ?');
    params.push(data.payment_status);
  }
  if (data.notes !== undefined) {
    updates.push('notes = ?');
    params.push(data.notes);
  }

  if (updates.length === 0) {
    return c.json({ success: true });
  }

  updates.push("updated_at = datetime('now', 'localtime')");
  params.push(id);

  await db.prepare(`UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  return c.json({ success: true });
});

// ─────────────────────────────────────────────
// 6. DELETE APPOINTMENT
// ─────────────────────────────────────────────
app.delete('/api/appointments/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─────────────────────────────────────────────
// 7. SERVICES LIST & CRUD
// ─────────────────────────────────────────────
app.get('/api/services', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM services WHERE is_active = 1 ORDER BY category, name').all();
  return c.json(results || []);
});

app.post('/api/services', async (c) => {
  const db = c.env.DB;
  const { name, category, price, duration_minutes } = await c.req.json();
  if (!name || !price) {
    return c.json({ error: 'Name and price required' }, 400);
  }
  await db.prepare(`
    INSERT INTO services (name, category, price, duration_minutes)
    VALUES (?, ?, ?, ?)
  `).bind(name, category || 'General', Number(price), Number(duration_minutes) || 30).run();

  return c.json({ success: true }, 201);
});

app.delete('/api/services/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('UPDATE services SET is_active = 0 WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─────────────────────────────────────────────
// 8. SETTINGS
// ─────────────────────────────────────────────
app.get('/api/settings', async (c) => {
  const db = c.env.DB;
  const parlourName = await getSetting(db, 'parlour_name', 'Vrunda Beauty Parlour');
  const parlourPhone = await getSetting(db, 'parlour_phone', '+91 9876543210');
  const currency = await getSetting(db, 'currency', '₹');
  return c.json({ parlourName, parlourPhone, currency });
});

app.post('/api/settings', async (c) => {
  const db = c.env.DB;
  const { parlourName, parlourPhone, passcode } = await c.req.json();
  if (parlourName) {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('parlour_name', parlourName).run();
  }
  if (parlourPhone) {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('parlour_phone', parlourPhone).run();
  }
  if (passcode) {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('passcode', passcode).run();
  }
  return c.json({ success: true });
});

// ─────────────────────────────────────────────
// 9. REPORTS API (WEEKLY, MONTHLY, YEARLY, CUSTOM)
// ─────────────────────────────────────────────
app.get('/api/reports', async (c) => {
  const db = c.env.DB;
  const type = c.req.query('type') || 'weekly';
  let startDate = c.req.query('startDate');
  let endDate = c.req.query('endDate');
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  if (type === 'weekly') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    startDate = startDate || d.toISOString().slice(0, 10);
    endDate = endDate || todayStr;
  } else if (type === 'monthly') {
    const month = c.req.query('month') || todayStr.slice(0, 7);
    startDate = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
  } else if (type === 'yearly') {
    const year = c.req.query('year') || String(now.getFullYear());
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  } else if (type === 'custom') {
    startDate = startDate || todayStr;
    endDate = endDate || todayStr;
  }

  // Summary aggregation
  const summary = await db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(total_amount), 0) as total_expected,
      COALESCE(SUM(paid_amount), 0) as total_collected,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN MAX(0, total_amount - COALESCE(paid_amount, 0)) ELSE 0 END), 0) as total_pending,
      COALESCE(SUM(CASE WHEN payment_status = 'partial' OR (paid_amount > 0 AND paid_amount < total_amount) THEN 1 ELSE 0 END), 0) as partial_count,
      COALESCE(SUM(CASE WHEN paid_amount >= total_amount AND total_amount > 0 THEN 1 ELSE 0 END), 0) as fully_paid_count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_count,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) as confirmed_count,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count
    FROM appointments
    WHERE appointment_date >= ? AND appointment_date <= ?
  `).bind(startDate, endDate).first();

  // Method breakdown from payments table
  const payByMethod = await db.prepare(`
    SELECT 
      LOWER(payment_method) as method,
      COALESCE(SUM(amount), 0) as total
    FROM payments p
    JOIN appointments a ON p.appointment_id = a.id
    WHERE a.appointment_date >= ? AND a.appointment_date <= ?
    GROUP BY LOWER(payment_method)
  `).bind(startDate, endDate).all();

  let paid_cash = 0;
  let paid_upi = 0;
  let paid_card = 0;
  for (const row of (payByMethod.results || []) as any[]) {
    if (row.method === 'cash') paid_cash += Number(row.total || 0);
    else if (row.method === 'upi') paid_upi += Number(row.total || 0);
    else if (row.method === 'card') paid_card += Number(row.total || 0);
  }

  // Fallback if no individual payment rows found
  if (paid_cash === 0 && paid_upi === 0 && paid_card === 0) {
    const legacy = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN payment_status = 'paid_cash' THEN paid_amount ELSE 0 END), 0) as l_cash,
        COALESCE(SUM(CASE WHEN payment_status = 'paid_upi' THEN paid_amount ELSE 0 END), 0) as l_upi,
        COALESCE(SUM(CASE WHEN payment_status = 'paid_card' THEN paid_amount ELSE 0 END), 0) as l_card
      FROM appointments
      WHERE appointment_date >= ? AND appointment_date <= ?
    `).bind(startDate, endDate).first<any>();
    if (legacy) {
      paid_cash = Number(legacy.l_cash || 0);
      paid_upi = Number(legacy.l_upi || 0);
      paid_card = Number(legacy.l_card || 0);
    }
  }

  // List of all appointments in the range with service details
  const { results: appointments } = await db.prepare(`
    SELECT 
      a.id,
      a.customer_name,
      a.customer_phone,
      a.appointment_date,
      a.appointment_time,
      a.total_amount,
      COALESCE(a.paid_amount, 0) as paid_amount,
      MAX(0, a.total_amount - COALESCE(a.paid_amount, 0)) as due_amount,
      a.status,
      a.payment_status,
      a.notes,
      COALESCE(GROUP_CONCAT(s.service_name, ', '), '') as services_list
    FROM appointments a
    LEFT JOIN appointment_services s ON a.id = s.appointment_id
    WHERE a.appointment_date >= ? AND a.appointment_date <= ?
    GROUP BY a.id
    ORDER BY a.appointment_date ASC, a.appointment_time ASC
  `).bind(startDate, endDate).all();

  const parlourName = await getSetting(db, 'parlour_name', 'Vrunda Beauty Parlour');
  const parlourPhone = await getSetting(db, 'parlour_phone', '+91 9876543210');
  const currency = await getSetting(db, 'currency', '₹');

  return c.json({
    type,
    startDate,
    endDate,
    parlourName,
    parlourPhone,
    currency,
    summary: {
      ...(summary || {}),
      paid_cash,
      paid_upi,
      paid_card
    },
    appointments: appointments || []
  });
});

export default app;
