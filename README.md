# Tapsters

A friendly, eBay-style marketplace built with **vanilla HTML / CSS / JavaScript**
and powered by **Supabase** for authentication, database, and row-level
security. Modern purple-and-white design.

![tapsters](https://img.shields.io/badge/style-purple%20%26%20white-9333ea)
![stack](https://img.shields.io/badge/stack-html%20css%20js%20%2B%20supabase-7e22ce)

## Features

- **Account system** — email + password sign-up / sign-in via Supabase Auth.
  - Logging into a non-existent account is impossible (Supabase returns a
    generic "invalid credentials" error, preventing user enumeration).
- **Item creation** — sellers list items with title, description, price,
  currency (USD / EUR / GBP / UAH), category, stock and image URL. Sales are
  available only to registered users.
- **Categories** — header **Categories** button opens a dropdown of every
  category; chips on the home page filter the grid. Default categories are
  seeded by `supabase/seed.sql`.
- **Search** — the header search box filters listings by title and links to
  `index.html?q=…`.
- **Header logo** — clicking the **Tapsters** title returns to the home page
  with the **Recently viewed** section pinned underneath the listings.
- **Recently viewed items** — tracked in `localStorage`, surfaced on the home
  page.
- **Wishlist** — logged-in users can save items via the heart button on home
  page cards or the item page; saved items live in the cabinet's
  **Список бажань** tab.
- **Drop-down cart** — clicking the cart button in the header opens an
  in-place cart panel with quantity controls and a checkout shortcut.
- **Currency selector** — switch the display currency on the listing page;
  prices are converted on the fly while items keep their native currency.
- **Checkout page** — separate page (`checkout.html`) with:
  - Delivery method: **Nova Poshta**, **Ukrposhta**, or **Meest**.
  - Branch / office and delivery address fields.
  - Payment method: **Cash on delivery** or **Prepayment**.
  - Card fields (number / name / expiry / CVV) appear only when prepayment is
    chosen; cash on delivery doesn't require any card info.
- **Personal cabinet** — `cabinet.html` with three tabs:
  - **Orders** with status badges (pending / paid / shipped / delivered /
    cancelled), delivery details, and item lines.
  - **My listings** — every item the user has put up for sale.
  - **Account info** — change username and full name, log out.
- **Expanded lot page** — `item.html?id=…` shows the full description,
  image, seller, price (in your chosen currency), comments and 5-star ratings.

## Stack

- **Frontend:** plain HTML, CSS, JavaScript (no framework, no bundler).
- **Backend / database / auth:** Supabase (Postgres + RLS + Auth).
- **Drop-in CDN:** `@supabase/supabase-js@2`.

## Quick start

1. Create a Supabase project and copy the **Project URL** and **anon** key.
2. Run [`supabase/schema.sql`](supabase/schema.sql) and
   [`supabase/seed.sql`](supabase/seed.sql) in the SQL editor.
3. Edit [`js/config.js`](js/config.js) and paste the URL and key.
4. Serve the static files:

```sh
python3 -m http.server 5500
# open http://localhost:5500/
```

See [`docs/SETUP.md`](docs/SETUP.md) for the long version, including auth
configuration tips.

## Project layout

```
tapsters/
├── index.html              Marketplace home + recently viewed
├── auth.html               Sign in / sign up
├── create-listing.html     Sellers — create an item
├── item.html               Lot detail with comments + ratings
├── checkout.html           Checkout (separate page)
├── cabinet.html            Personal cabinet
├── css/styles.css          Design system (purple & white)
├── js/
│   ├── config.js           Supabase URL / anon key
│   ├── supabase.js         Client + auth helpers
│   ├── header.js           Shared header (cart + categories dropdowns)
│   ├── currency.js         Currency conversion + formatting
│   ├── recently.js         Recently-viewed (localStorage)
│   ├── cart.js             Cart (localStorage + DB sync)
│   ├── main.js             index.html
│   ├── auth.js             auth.html
│   ├── listing.js          create-listing.html
│   ├── item.js             item.html
│   ├── checkout.js         checkout.html
│   └── cabinet.js          cabinet.html
├── supabase/
│   ├── schema.sql          Tables, indexes, RLS, triggers
│   └── seed.sql            Default categories
└── docs/SETUP.md           Setup walkthrough
```

## Notes on the cart and currency

- Guests can browse and tentatively add items to a cart; the cart is kept in
  `localStorage` and merged into the user's server cart on login.
- **Sales are inaccessible to unregistered users** — `Add to cart`, `Buy now`
  and `Sell` route to the auth page when the user isn't logged in. The
  checkout page is auth-gated as well.
- Prices are stored in the listing's native currency. Conversion uses static
  rates in `js/config.js` (USD baseline). Update them with a live source if
  you want.

## Security

All write access to Supabase is governed by RLS policies. Users may only:
- read public data (listings, categories, comments);
- write their own profile, listings, comments, cart and orders;
- read their own orders.

The anon key is intentionally public — Postgres enforces who can do what.
