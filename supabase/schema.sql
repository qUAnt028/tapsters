-- Tapsters database schema for Supabase
-- Run this once on a fresh Supabase project (SQL editor or `supabase db push`).

-- ----- profiles (extends auth.users) -----
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- ----- categories -----
create table if not exists public.categories (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  slug  text not null unique,
  icon  text
);

-- ----- items (listings) -----
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title       text not null,
  description text,
  price       numeric(12,2) not null check (price >= 0),
  currency    text not null default 'USD' check (currency in ('USD','EUR','GBP','UAH')),
  image_url   text,
  stock       int not null default 1 check (stock >= 0),
  sold        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists items_category_idx on public.items(category_id);
create index if not exists items_seller_idx   on public.items(seller_id);
create index if not exists items_title_trgm   on public.items using gin (to_tsvector('simple', title));

-- ----- comments + ratings -----
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  rating     int check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists comments_item_idx on public.comments(item_id);

-- ----- orders -----
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  total           numeric(12,2) not null,
  currency        text not null default 'USD',
  status          text not null default 'pending'
                  check (status in ('pending','paid','shipped','delivered','cancelled')),
  delivery_method text not null check (delivery_method in ('nova_poshta','ukrposhta','meest')),
  delivery_branch text,
  delivery_address text,
  payment_method  text not null check (payment_method in ('cod','prepay')),
  card_last4      text,
  created_at      timestamptz not null default now()
);

create table if not exists public.order_items (
  id        uuid primary key default gen_random_uuid(),
  order_id  uuid not null references public.orders(id) on delete cascade,
  item_id   uuid references public.items(id) on delete set null,
  title     text not null,
  price     numeric(12,2) not null,
  currency  text not null,
  quantity  int not null default 1
);

-- ----- cart -----
create table if not exists public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  quantity   int not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, item_id)
);

-- ----- Row Level Security -----
alter table public.profiles    enable row level security;
alter table public.categories  enable row level security;
alter table public.items       enable row level security;
alter table public.comments    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.cart_items  enable row level security;

-- profiles
drop policy if exists "profiles read all"    on public.profiles;
drop policy if exists "profiles insert self" on public.profiles;
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles read all"    on public.profiles for select using (true);
create policy "profiles insert self" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update self" on public.profiles for update using (auth.uid() = id);

-- categories (read-only on the client)
drop policy if exists "categories read all" on public.categories;
create policy "categories read all" on public.categories for select using (true);

-- items
drop policy if exists "items read all"      on public.items;
drop policy if exists "items insert seller" on public.items;
drop policy if exists "items update seller" on public.items;
drop policy if exists "items delete seller" on public.items;
create policy "items read all"      on public.items for select using (true);
create policy "items insert seller" on public.items for insert with check (auth.uid() = seller_id);
create policy "items update seller" on public.items for update using (auth.uid() = seller_id);
create policy "items delete seller" on public.items for delete using (auth.uid() = seller_id);

-- comments
drop policy if exists "comments read all"      on public.comments;
drop policy if exists "comments insert auth"   on public.comments;
drop policy if exists "comments update author" on public.comments;
drop policy if exists "comments delete author" on public.comments;
create policy "comments read all"      on public.comments for select using (true);
create policy "comments insert auth"   on public.comments for insert with check (auth.uid() = user_id);
create policy "comments update author" on public.comments for update using (auth.uid() = user_id);
create policy "comments delete author" on public.comments for delete using (auth.uid() = user_id);

-- orders
drop policy if exists "orders read self"   on public.orders;
drop policy if exists "orders insert self" on public.orders;
drop policy if exists "orders update self" on public.orders;
create policy "orders read self"   on public.orders for select using (auth.uid() = user_id);
create policy "orders insert self" on public.orders for insert with check (auth.uid() = user_id);
create policy "orders update self" on public.orders for update using (auth.uid() = user_id);

-- order_items
drop policy if exists "order_items read self"   on public.order_items;
drop policy if exists "order_items insert self" on public.order_items;
create policy "order_items read self" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_items.order_id and o.user_id = auth.uid())
);
create policy "order_items insert self" on public.order_items for insert with check (
  exists (select 1 from public.orders o where o.id = order_items.order_id and o.user_id = auth.uid())
);

-- cart
drop policy if exists "cart read self"   on public.cart_items;
drop policy if exists "cart insert self" on public.cart_items;
drop policy if exists "cart update self" on public.cart_items;
drop policy if exists "cart delete self" on public.cart_items;
create policy "cart read self"   on public.cart_items for select using (auth.uid() = user_id);
create policy "cart insert self" on public.cart_items for insert with check (auth.uid() = user_id);
create policy "cart update self" on public.cart_items for update using (auth.uid() = user_id);
create policy "cart delete self" on public.cart_items for delete using (auth.uid() = user_id);

-- ----- Auto-create profile on user signup -----
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
