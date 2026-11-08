-- Sample data from the design canvas so every screen has something to show locally.
-- `supabase db reset` runs this after the migrations.

insert into public.events (type, title, description, length_label, when_label, location, capacity, published, sort_order) values
  ('WEBINAR', 'Live demo: ask your numbers anything', 'Watch Fremwork answer real finance questions, from cash runway to overdue invoices. Bring your own.', '45 min', '[DATE] · [TIME]', 'Online', 200, true, 1),
  ('WORKSHOP', 'Close the month faster', 'A hands-on session for controllers and accountants on reconciling, accruals and the month-end checklist.', '60 min', '[DATE] · [TIME]', 'Online', 60, true, 2),
  ('MEETUP', 'Finance teams breakfast', 'Coffee and honest talk about budgets, tools and what keeps finance leads up at night.', '90 min', '[DATE] · [TIME]', 'In person · [CITY]', 30, true, 3),
  ('WEBINAR', 'Budget vs actual, explained', 'For managers who own a budget but not a finance degree. Plain language, real examples.', '30 min', '[DATE] · [TIME]', 'Online', 150, true, 4),
  ('OFFICE HOURS', 'Fremwork office hours', 'Drop in with questions about the product, the waitlist or your setup. No slides.', 'Weekly', '[DAY] · [TIME]', 'Online', 25, true, 5),
  ('WORKSHOP', 'Cash runway for founders', 'Work out how many months you have, what moves the number and what to do next.', '60 min', '[DATE] · [TIME]', 'Online', 60, false, 6);

insert into public.waitlist_entries (name, email, company, role, status, created_at) values
  ('Maya Torres', 'maya@northlane.co', 'Northlane', 'Business owner', 'waiting', now() - interval '2 days'),
  ('Daniel Okafor', 'daniel@brightpay.io', 'BrightPay', 'Finance officer', 'waiting', now() - interval '3 days'),
  ('Lena Fischer', 'lena@koda.studio', 'Koda Studio', 'Accountant', 'invited', now() - interval '3 days'),
  ('Samir Haddad', 'samir@palmgrove.com', 'Palmgrove', 'Manager', 'waiting', now() - interval '4 days'),
  ('Grace Lin', 'grace@ledgerly.app', 'Ledgerly', 'Analyst', 'active', now() - interval '5 days'),
  ('Tom Becker', 'tom@harbourfoods.com', 'Harbour Foods', 'Business owner', 'invited', now() - interval '6 days'),
  ('Ana Silva', 'ana@vertex.dev', 'Vertex', 'Finance officer', 'waiting', now() - interval '7 days'),
  ('Kofi Mensah', 'kofi@sunbird.co', 'Sunbird', 'Accountant', 'active', now() - interval '8 days'),
  ('Priya Nair', 'priya@fieldwork.io', 'Fieldwork', 'Analyst', 'waiting', now() - interval '9 days'),
  ('Jonas Berg', 'jonas@oakandiron.com', 'Oak & Iron', 'Manager', 'waiting', now() - interval '10 days'),
  ('Chloe Martin', 'chloe@petalco.shop', 'Petal Co', 'Business owner', 'invited', now() - interval '11 days'),
  ('Yusuf Kaya', 'yusuf@relaylabs.ai', 'Relay Labs', 'Other', 'waiting', now() - interval '12 days');

insert into public.event_registrations (event_id, name, email, company, role, company_size, heard_from, checked_in)
select e.id, r.name, r.email, r.company, r.role, r.size, r.heard, r.inn
from (values
  (1, 'Maya Torres', 'maya@northlane.co', 'Northlane', 'Business owner', '11–50', 'LinkedIn', true),
  (1, 'Grace Lin', 'grace@ledgerly.app', 'Ledgerly', 'Analyst', '2–10', 'Newsletter', false),
  (2, 'Lena Fischer', 'lena@koda.studio', 'Koda Studio', 'Accountant', '2–10', 'Friend or colleague', true),
  (2, 'Kofi Mensah', 'kofi@sunbird.co', 'Sunbird', 'Accountant', '51–200', 'Search', false),
  (3, 'Tom Becker', 'tom@harbourfoods.com', 'Harbour Foods', 'Business owner', '11–50', 'X (Twitter)', false),
  (4, 'Samir Haddad', 'samir@palmgrove.com', 'Palmgrove', 'Manager', '200+', 'LinkedIn', false),
  (1, 'Priya Nair', 'priya@fieldwork.io', 'Fieldwork', 'Analyst', 'Just me', 'Other', false),
  (5, 'Daniel Okafor', 'daniel@brightpay.io', 'BrightPay', 'Finance officer', '11–50', 'Newsletter', true)
) as r(sort, name, email, company, role, size, heard, inn)
join public.events e on e.sort_order = r.sort;

insert into public.team_invites (email, role, accepted_at)
values ('edomiyastesfaye321@gmail.com', 'owner', now())
on conflict (lower(email)) do update set role = 'owner';

