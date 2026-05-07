# Setting up Tapsters

Tapsters is a static site (HTML / CSS / vanilla JS) that talks to a
[Supabase](https://supabase.com) project for authentication and data storage.

## 1. Create a Supabase project

1. Sign in at <https://supabase.com> and create a new project.
2. Once the project is ready, open **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** API key

## 2. Configure the front-end

Edit [`js/config.js`](../js/config.js) and replace the placeholders:

```js
window.TAPSTERS_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi…",
};
```

> The anon key is intended to be public — security is enforced server-side via
> Row Level Security policies (see `supabase/schema.sql`).

## 3. Apply the database schema

In your Supabase project, open the **SQL Editor** and run the contents of:

1. [`supabase/schema.sql`](../supabase/schema.sql) — creates tables, indexes,
   row-level-security policies, and the new-user trigger.
2. [`supabase/seed.sql`](../supabase/seed.sql) — inserts the default category
   list (Electronics, Fashion, Home & Garden, …).

Both scripts are idempotent and safe to re-run.

## 4. Configure auth

In **Authentication → Providers**, make sure **Email** is enabled.

For local development you can disable "Confirm email" in
**Authentication → Email** so that signing up logs the user in immediately.
For production, leave email confirmation on.

## 5. Run the site

The site is a plain set of static files. Any static file server works:

```sh
# From the repo root:
python3 -m http.server 5500
# then open http://localhost:5500/
```

…or use the VS Code "Live Server" extension, `npx http-server`, GitHub Pages,
Netlify, Vercel, or any other static host.

## What's where

| Page                 | File                  |
|----------------------|-----------------------|
| Marketplace home     | `index.html`          |
| Sign in / sign up    | `auth.html`           |
| Create a listing     | `create-listing.html` |
| Item detail (lot)    | `item.html?id=…`      |
| Seller profile       | `seller.html?id=…`    |
| Checkout             | `checkout.html`       |
| Personal cabinet     | `cabinet.html`        |

## Reviews & deletion

- **Reviews live on seller accounts**, not items. From any item page click the
  seller card → *View profile* to leave a 5-star + comment review for that
  seller. Each user may only post a single review per seller (which they can
  edit later).
- **Sellers can delete their own listings** from the item detail page or from
  *Cabinet → My listings*. Row-Level-Security forbids anyone else.
- **After a successful checkout** the purchased lots are removed from the
  marketplace automatically (marked `sold = true` and deleted by the buyer's
  client where allowed; sold items are filtered from listings everywhere).

If you previously ran an older version of the schema that had a `comments`
table, re-running `supabase/schema.sql` will drop it and create the new
`reviews` table in its place.

JavaScript modules live under `js/` and are intentionally framework-free so
they're easy to read and tweak.

## Currency

Prices are stored in the seller-selected native currency (`USD`, `EUR`, `GBP`,
`UAH`). The currency selector on the home page chooses the *display*
currency; conversion uses the static rates in `js/config.js` —
update them whenever you want different reference rates.
