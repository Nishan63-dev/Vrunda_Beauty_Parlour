-- Seed data for Beauty Parlour

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('passcode', '1234'),
    ('parlour_name', 'Glamour Beauty Parlour'),
    ('parlour_phone', '+91 9876543210'),
    ('currency', '₹');

-- Common Indian Beauty Parlour Services
INSERT INTO services (name, category, price, duration_minutes) VALUES
    ('Eyebrow & Upper Lip Threading', 'Threading', 100, 15),
    ('Full Face Threading', 'Threading', 250, 25),
    ('Basic Hair Cut & Styling', 'Hair', 350, 30),
    ('Layer Hair Cut', 'Hair', 600, 45),
    ('Hair Spa with Deep Conditioning', 'Hair', 1200, 60),
    ('Hair Straightening / Keratin (Starting)', 'Hair', 3500, 120),
    ('Fruit Cleanup', 'Skin & Facial', 500, 30),
    ('Gold Glow Facial', 'Skin & Facial', 1500, 60),
    ('Diamond Anti-Aging Facial', 'Skin & Facial', 2200, 75),
    ('Full Arms + Underarms Waxing (Honey)', 'Waxing', 400, 30),
    ('Full Legs Waxing (Honey)', 'Waxing', 500, 35),
    ('Rica Full Arms + Full Legs Waxing', 'Waxing', 1200, 60),
    ('Deluxe Manicure & Pedicure', 'Nails & Feet', 900, 50),
    ('Gel Nail Extensions & Art', 'Nails & Feet', 1500, 60),
    ('Party Makeup with Hairstyle', 'Bridal & Makeup', 2500, 90),
    ('Bridal Makeup with Draping & Jewelry Setting', 'Bridal & Makeup', 8000, 180);

-- Sample initial appointments
INSERT INTO appointments (customer_name, customer_phone, appointment_date, appointment_time, total_amount, status, payment_status, notes) VALUES
    ('Pooja Sharma', '9825123456', date('now', 'localtime'), '11:00', 1600, 'confirmed', 'paid_upi', 'Wants soft glow look for evening function'),
    ('Ananya Patel', '9978123456', date('now', 'localtime'), '14:30', 950, 'confirmed', 'pending', 'Hair cut + Eyebrow threading'),
    ('Ritu Verma', '9898123456', date('now', 'localtime'), '16:00', 350, 'pending', 'pending', 'First time visit'),
    ('Sneha Desai', '9712123456', date('now', 'localtime', '-1 day'), '15:00', 2200, 'completed', 'paid_cash', 'Diamond Facial - regular customer');

INSERT INTO appointment_services (appointment_id, service_id, service_name, price) VALUES
    (1, 8, 'Gold Glow Facial', 1500),
    (1, 1, 'Eyebrow & Upper Lip Threading', 100),
    (2, 4, 'Layer Hair Cut', 600),
    (2, 3, 'Basic Hair Cut & Styling', 350),
    (3, 3, 'Basic Hair Cut & Styling', 350),
    (4, 9, 'Diamond Anti-Aging Facial', 2200);
