// Tapsters — Supabase configuration.
// Replace the placeholder values below with your project's URL and anon key
// from the Supabase dashboard (Project Settings → API).
//
// You can also set these by editing this file in production or by overriding
// `window.TAPSTERS_CONFIG` before the rest of the app loads.

window.TAPSTERS_CONFIG = window.TAPSTERS_CONFIG || {
  SUPABASE_URL: "https://yhlekrpymdglzqwitofi.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_JS7YBBTbzAwuC2m6bTrO6g_dFOfzl3x",
};

// Currency display options (1 unit of base currency = these multipliers).
// Used only for converting display prices on the listing pages and cart;
// items are always stored in the seller-selected native currency.
window.TAPSTERS_RATES = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  UAH: 41.5,
};

window.TAPSTERS_CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  UAH: "₴",
};
