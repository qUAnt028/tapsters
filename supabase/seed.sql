-- Seed default categories. Safe to run multiple times.
insert into public.categories (name, slug, icon) values
  ('Electronics',    'electronics',  'cpu'),
  ('Fashion',        'fashion',      'shirt'),
  ('Home & Garden',  'home-garden',  'home'),
  ('Toys & Hobbies', 'toys',         'gamepad'),
  ('Sports',         'sports',       'trophy'),
  ('Books & Media',  'books',        'book'),
  ('Automotive',     'automotive',   'car'),
  ('Collectibles',   'collectibles', 'gem'),
  ('Beauty',         'beauty',       'sparkles'),
  ('Other',          'other',        'package')
on conflict (slug) do nothing;
