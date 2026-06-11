-- Tapsters database schema for Supabase
-- Run this once on a fresh Supabase project (SQL editor or `supabase db push`).

-- ----- profiles (extends auth.users) -----
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique,
  full_name   text,
  avatar_url  text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Make schema.sql safe to re-run on an existing project that doesn't yet
-- have the is_admin column. (No-op when the column already exists.)
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ----- admin helper -----
-- A SECURITY DEFINER helper used by RLS policies and a few admin-only RPCs.
-- Returns true when the *currently authenticated user* is flagged as admin
-- in their profile row. Wrapped as a function (instead of inlined into each
-- policy) so a single source of truth governs who is privileged.
create or replace function public.is_admin() returns boolean as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$ language sql security definer stable;

-- The function reads from public.profiles which has RLS. Mark the function
-- as security definer (above) so it runs with the table owner's permissions
-- and is therefore not blocked by the caller's RLS visibility.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ----- admin: cascade-delete an account -----
-- Auth row deletion requires the service_role and is therefore not safe to
-- expose to the browser. Instead this RPC removes every row owned by
-- target_user across our tables (items, reviews, chats, messages, cart,
-- orders, profile). The orphaned auth.users row remains but the account
-- can no longer participate in the app: there's no profile, no listings,
-- no cart, etc., so signing in just lands on an empty session.
create or replace function public.admin_delete_account(target_user uuid)
returns void as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete accounts';
  end if;
  if target_user is null then
    raise exception 'target_user is required';
  end if;

  delete from public.cart_items     where user_id = target_user;
  delete from public.wishlist_items where user_id = target_user;
  delete from public.order_items  where order_id in (
    select id from public.orders where user_id = target_user
  );
  delete from public.orders       where user_id = target_user;
  delete from public.messages     where sender_id = target_user;
  delete from public.chats        where buyer_id = target_user
                                     or seller_id = target_user;
  delete from public.reviews      where user_id = target_user
                                     or subject_id = target_user;
  delete from public.items        where seller_id = target_user;
  delete from public.profiles     where id = target_user;
end;
$$ language plpgsql security definer;

revoke all on function public.admin_delete_account(uuid) from public;
grant execute on function public.admin_delete_account(uuid) to authenticated;

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
  images      text[],
  stock       int not null default 1 check (stock >= 0),
  sold        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- For projects created from an older schema version.
alter table public.items add column if not exists images text[];

create index if not exists items_category_idx on public.items(category_id);
create index if not exists items_seller_idx   on public.items(seller_id);
create index if not exists items_title_trgm   on public.items using gin (to_tsvector('simple', title));

-- ----- storage bucket for item photos (uploaded from the device) -----
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do nothing;

drop policy if exists "item images read"       on storage.objects;
drop policy if exists "item images insert own" on storage.objects;
drop policy if exists "item images delete own" on storage.objects;
create policy "item images read" on storage.objects
  for select using (bucket_id = 'item-images');
create policy "item images insert own" on storage.objects
  for insert with check (
    bucket_id = 'item-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "item images delete own" on storage.objects
  for delete using (
    bucket_id = 'item-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

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

-- ----- wishlist -----
create table if not exists public.wishlist_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create index if not exists wishlist_user_idx on public.wishlist_items(user_id);

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

-- Optional metadata so a single chat thread can mix plain text messages
-- and order-notification cards. kind = 'text' (default) or 'order'.
-- order_id is set on 'order' notifications so the recipient can drill
-- into the full receipt. We use add-if-missing for these columns so the
-- migration is safe to re-run on a project that already has the older
-- two-column schema.
alter table public.messages
  add column if not exists kind     text not null default 'text',
  add column if not exists order_id uuid references public.orders(id) on delete set null;

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
alter table public.wishlist_items enable row level security;
alter table public.chats       enable row level security;
alter table public.messages    enable row level security;

-- profiles
drop policy if exists "profiles read all"          on public.profiles;
drop policy if exists "profiles insert self"       on public.profiles;
drop policy if exists "profiles update self"       on public.profiles;
drop policy if exists "profiles update self admin" on public.profiles;
drop policy if exists "profiles delete admin"      on public.profiles;
create policy "profiles read all"          on public.profiles for select using (true);
create policy "profiles insert self"       on public.profiles for insert with check (auth.uid() = id);
-- A user can edit their own profile; an admin can edit any profile.
create policy "profiles update self admin" on public.profiles for update
  using (auth.uid() = id or public.is_admin());
-- Only admins can wipe a profile row. Regular users disable their account
-- via Supabase auth APIs (which cascade-delete the profile via the FK).
create policy "profiles delete admin"      on public.profiles for delete using (public.is_admin());

-- categories (read-only on the client)
drop policy if exists "categories read all" on public.categories;
create policy "categories read all" on public.categories for select using (true);

-- items
drop policy if exists "items read all"            on public.items;
drop policy if exists "items insert seller"       on public.items;
drop policy if exists "items update seller"       on public.items;
drop policy if exists "items delete seller"       on public.items;
drop policy if exists "items update seller admin" on public.items;
drop policy if exists "items delete seller admin" on public.items;
create policy "items read all"            on public.items for select using (true);
create policy "items insert seller"       on public.items for insert with check (auth.uid() = seller_id);
-- Either the seller (own listing) or any admin can update/delete a listing.
create policy "items update seller admin" on public.items for update
  using (auth.uid() = seller_id or public.is_admin());
create policy "items delete seller admin" on public.items for delete
  using (auth.uid() = seller_id or public.is_admin());

-- reviews (about a seller account; not items)
drop policy if exists "reviews read all"            on public.reviews;
drop policy if exists "reviews insert auth"         on public.reviews;
drop policy if exists "reviews update author"       on public.reviews;
drop policy if exists "reviews delete author"       on public.reviews;
drop policy if exists "reviews delete author admin" on public.reviews;
create policy "reviews read all"            on public.reviews for select using (true);
-- a logged-in user can only review somebody else, never themselves
create policy "reviews insert auth"         on public.reviews for insert
  with check (auth.uid() = user_id and auth.uid() <> subject_id);
create policy "reviews update author"       on public.reviews for update using (auth.uid() = user_id);
-- Either the author of the review or an admin can wipe a review.
create policy "reviews delete author admin" on public.reviews for delete
  using (auth.uid() = user_id or public.is_admin());

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

-- wishlist
drop policy if exists "wishlist read self"   on public.wishlist_items;
drop policy if exists "wishlist insert self" on public.wishlist_items;
drop policy if exists "wishlist delete self" on public.wishlist_items;
create policy "wishlist read self"   on public.wishlist_items for select using (auth.uid() = user_id);
create policy "wishlist insert self" on public.wishlist_items for insert with check (auth.uid() = user_id);
create policy "wishlist delete self" on public.wishlist_items for delete using (auth.uid() = user_id);

-- chats (only the two participants can see / change the thread)
drop policy if exists "chats read participant"         on public.chats;
drop policy if exists "chats insert buyer"             on public.chats;
drop policy if exists "chats update participant"       on public.chats;
drop policy if exists "chats delete participant"       on public.chats;
drop policy if exists "chats read participant admin"   on public.chats;
drop policy if exists "chats update participant admin" on public.chats;
drop policy if exists "chats delete participant admin" on public.chats;
create policy "chats read participant admin" on public.chats for select using (
  auth.uid() = buyer_id or auth.uid() = seller_id or public.is_admin()
);
create policy "chats insert buyer" on public.chats for insert with check (
  -- The viewer must be the buyer (you can't open a chat on behalf of
  -- somebody else) and must NOT be the seller of the same item.
  auth.uid() = buyer_id and auth.uid() <> seller_id
);
create policy "chats update participant admin" on public.chats for update using (
  auth.uid() = buyer_id or auth.uid() = seller_id or public.is_admin()
);
-- Either participant or any admin can wipe the thread; cascades to its
-- messages thanks to messages.chat_id's ON DELETE CASCADE FK.
create policy "chats delete participant admin" on public.chats for delete using (
  auth.uid() = buyer_id or auth.uid() = seller_id or public.is_admin()
);

-- messages (read/write only if the viewer is one of the two participants
-- in the parent chat row, or any admin)
drop policy if exists "messages read participant"        on public.messages;
drop policy if exists "messages insert participant"      on public.messages;
drop policy if exists "messages read participant admin"  on public.messages;
drop policy if exists "messages delete participant admin" on public.messages;
create policy "messages read participant admin" on public.messages for select using (
  public.is_admin()
  or exists (
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
create policy "messages delete participant admin" on public.messages for delete using (
  public.is_admin()
  or auth.uid() = sender_id
  or exists (
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

-- ----- Promoting a user to admin -----
-- There is intentionally NO UI flow for granting admin: bootstrap your
-- admin account by signing up like any other user, then run ONE of:
--
--   update public.profiles set is_admin = true
--    where username = 'your-username';
--
--   update public.profiles set is_admin = true
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- Once flagged, the account sees an extra "Адмін" tab in the cabinet and
-- gets "Видалити (адмін)" buttons on every listing and seller profile.
