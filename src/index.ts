import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

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
  const currentPin = await getSetting(db, 'passcode', '1234');

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

  // Today metrics
  const todayStats = await db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN payment_status != 'pending' THEN total_amount ELSE 0 END), 0) as collected,
      COALESCE(SUM(total_amount), 0) as expected
    FROM appointments 
    WHERE appointment_date = ? AND status != 'cancelled'
  `).bind(today).first<{ count: number; collected: number; expected: number }>();

  // Month metrics
  const monthStats = await db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN payment_status != 'pending' THEN total_amount ELSE 0 END), 0) as revenue
    FROM appointments 
    WHERE appointment_date LIKE ? AND status != 'cancelled'
  `).bind(`${currentMonth}%`).first<{ count: number; revenue: number }>();

  // Pending payments count
  const pendingPayments = await db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as pending_amount
    FROM appointments
    WHERE payment_status = 'pending' AND status != 'cancelled'
  `).first<{ count: number; pending_amount: number }>();

  // Today's appointments
  const todayAppointments = await db.prepare(`
    SELECT * FROM appointments 
    WHERE appointment_date = ? 
    ORDER BY appointment_time ASC
  `).bind(today).all();

  return c.json({
    today,
    todayCount: todayStats?.count ?? 0,
    todayCollected: todayStats?.collected ?? 0,
    todayExpected: todayStats?.expected ?? 0,
    monthRevenue: monthStats?.revenue ?? 0,
    monthCount: monthStats?.count ?? 0,
    pendingPaymentsCount: pendingPayments?.count ?? 0,
    pendingPaymentsAmount: pendingPayments?.pending_amount ?? 0,
    todayAppointments: todayAppointments.results ?? []
  });
});

// ─────────────────────────────────────────────
// 3. APPOINTMENTS LIST & FILTERS
// ─────────────────────────────────────────────
app.get('/api/appointments', async (c) => {
  const db = c.env.DB;
  const filter = c.req.query('filter') || 'all';
  const search = c.req.query('search') || '';
  const today = new Date().toISOString().slice(0, 10);

  let query = 'SELECT * FROM appointments WHERE 1=1';
  const params: any[] = [];

  if (filter === 'today') {
    query += ' AND appointment_date = ?';
    params.push(today);
  } else if (filter === 'upcoming') {
    query += ' AND appointment_date >= ? AND status != "completed" AND status != "cancelled"';
    params.push(today);
  } else if (filter === 'completed') {
    query += ' AND status = "completed"';
  } else if (filter === 'pending_payment') {
    query += ' AND payment_status = "pending" AND status != "cancelled"';
  }

  if (search) {
    query += ' AND (customer_name LIKE ? OR customer_phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY appointment_date DESC, appointment_time DESC LIMIT 100';

  const stmt = db.prepare(query);
  const { results } = await stmt.bind(...params).all();

  return c.json(results || []);
});

// ─────────────────────────────────────────────
// 4. CREATE APPOINTMENT
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
    status?: string;
    payment_status?: string;
    notes?: string;
  }>();

  if (!data.customer_name || !data.customer_phone || !data.appointment_date || !data.appointment_time) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const status = data.status || 'confirmed';
  const payment_status = data.payment_status || 'pending';
  const notes = data.notes || '';
  const total = Number(data.total_amount) || 0;

  const result = await db.prepare(`
    INSERT INTO appointments (customer_name, customer_phone, appointment_date, appointment_time, total_amount, status, payment_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.customer_name,
    data.customer_phone,
    data.appointment_date,
    data.appointment_time,
    total,
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

  return c.json({ success: true, id: appointmentId }, 201);
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
  const parlourName = await getSetting(db, 'parlour_name', 'Glamour Beauty Parlour');
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

export default app;
