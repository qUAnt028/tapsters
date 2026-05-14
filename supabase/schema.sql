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

-- ----- reviews about sellers (5-star ratings + comments) -----
-- Note: an earlier version of this schema had a `comments` table tied to
-- items. Reviews now belong to *accounts* (sellers), not individual items.
drop table if exists public.comments cascade;

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references auth.users(id) on delete cascade, -- the seller being reviewed
  user_id     uuid not null references auth.users(id) on delete cascade, -- the reviewer
  content     text not null,
  rating      int check (rating between 1 and 5),
  created_at  timestamptz not null default now(),
  unique (subject_id, user_id)
);

create index if not exists reviews_subject_idx on public.reviews(subject_id);
create index if not exists reviews_user_idx    on public.reviews(user_id);

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

-- ----- chats (one thread per buyer<->seller<->item triple) -----
create table if not exists public.chats (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid references public.items(id) on delete set null,
  -- The title is denormalised so the chat list survives the item being
  -- deleted (e.g. after a successful checkout). Saved at chat creation time.
  item_title      text,
  buyer_id        uuid not null references auth.users(id) on delete cascade,
  seller_id       uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check (buyer_id <> seller_id),
  unique (item_id, buyer_id)
);

create index if not exists chats_buyer_idx  on public.chats(buyer_id);
create index if not exists chats_seller_idx on public.chats(seller_id);
create index if not exists chats_last_idx   on public.chats(last_message_at desc);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  content    text not null check (length(content) > 0),
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages(chat_id, created_at);

-- Bump the chat's last_message_at whenever a new message arrives so the
-- cabinet "Messages" list can sort by most-recent activity cheaply.
create or replace function public.handle_new_message() returns trigger as $$
begin
  update public.chats
     set last_message_at = new.created_at
   where id = new.chat_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_message_inserted on public.messages;
create trigger on_message_inserted
  after insert on public.messages
  for each row execute procedure public.handle_new_message();

-- ----- Row Level Security -----
alter table public.profiles    enable row level security;
alter table public.categories  enable row level security;
alter table public.items       enable row level security;
alter table public.reviews     enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.cart_items  enable row level security;
alter table public.chats       enable row level security;
alter table public.messages    enable row level security;

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

-- reviews (about a seller account; not items)
drop policy if exists "reviews read all"      on public.reviews;
drop policy if exists "reviews insert auth"   on public.reviews;
drop policy if exists "reviews update author" on public.reviews;
drop policy if exists "reviews delete author" on public.reviews;
create policy "reviews read all"      on public.reviews for select using (true);
-- a logged-in user can only review somebody else, never themselves
create policy "reviews insert auth"   on public.reviews for insert
  with check (auth.uid() = user_id and auth.uid() <> subject_id);
create policy "reviews update author" on public.reviews for update using (auth.uid() = user_id);
create policy "reviews delete author" on public.reviews for delete using (auth.uid() = user_id);

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

-- chats (only the two participants can see / change the thread)
drop policy if exists "chats read participant"   on public.chats;
drop policy if exists "chats insert buyer"       on public.chats;
drop policy if exists "chats update participant" on public.chats;
create policy "chats read participant" on public.chats for select using (
  auth.uid() = buyer_id or auth.uid() = seller_id
);
create policy "chats insert buyer" on public.chats for insert with check (
  -- The viewer must be the buyer (you can't open a chat on behalf of
  -- somebody else) and must NOT be the seller of the same item.
  auth.uid() = buyer_id and auth.uid() <> seller_id
);
create policy "chats update participant" on public.chats for update using (
  auth.uid() = buyer_id or auth.uid() = seller_id
);

-- messages (read/write only if the viewer is one of the two participants
-- in the parent chat row)
drop policy if exists "messages read participant"   on public.messages;
drop policy if exists "messages insert participant" on public.messages;
create policy "messages read participant" on public.messages for select using (
  exists (
    select 1 from public.chats c
    where c.id = messages.chat_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
);
create policy "messages insert participant" on public.messages for insert with check (
  auth.uid() = sender_id
  and exists (
    select 1 from public.chats c
    where c.id = messages.chat_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
);

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
