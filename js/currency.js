// Tapsters — currency conversion + formatting.
(function () {
  const CURRENCIES = ["USD", "EUR", "GBP", "UAH"];
  const STORAGE_KEY = "tapsters.displayCurrency";

  function rates() { return window.TAPSTERS_RATES || { USD: 1, EUR: 1, GBP: 1, UAH: 1 }; }
  function symbols() { return window.TAPSTERS_CURRENCY_SYMBOLS || { USD: "$", EUR: "€", GBP: "£", UAH: "₴" }; }

  function getDisplay() {
    return localStorage.getItem(STORAGE_KEY) || "USD";
  }
  function setDisplay(c) {
    if (CURRENCIES.includes(c)) {
      localStorage.setItem(STORAGE_KEY, c);
      document.dispatchEvent(new CustomEvent("tap:currencychange", { detail: { currency: c } }));
    }
  }

  // Convert from `from` currency into `to` currency using rates relative to USD.
  function convert(amount, from, to) {
    const r = rates();
    const fromRate = r[from] || 1;
    const toRate = r[to] || 1;
    // amount in USD: amount / fromRate
    const usd = Number(amount) / fromRate;
    return usd * toRate;
  }

  function format(amount, currency) {
    const sym = symbols()[currency] || "";
    const num = Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${sym}${num}`;
  }

  // Format an item's price in the user's chosen display currency.
  function formatItem(price, itemCurrency) {
    const target = getDisplay();
    const converted = convert(price, itemCurrency, target);
    return format(converted, target);
  }

  window.tapCurrency = { CURRENCIES, getDisplay, setDisplay, convert, format, formatItem };
})();
