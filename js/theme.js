// Tapsters — light/dark theme management.
// Loaded as the very first script on every page so the saved theme is
// applied before the page paints (preventing a flash of light theme on a
// user who has dark mode persisted).
(function () {
  var KEY = "tap.theme";

  function readSaved() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === "dark" || v === "light") return v;
    } catch (e) { /* ignore */ }
    return null;
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function resolve() {
    return readSaved() || (systemPrefersDark() ? "dark" : "light");
  }

  function apply(theme) {
    var t = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    var btn = document.querySelector(".theme-toggle");
    if (btn) {
      btn.setAttribute("aria-checked", t === "dark" ? "true" : "false");
      btn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
      btn.title = t === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }
    document.dispatchEvent(new CustomEvent("tap:themechange", { detail: { theme: t } }));
  }

  function set(theme) {
    var t = theme === "dark" ? "dark" : "light";
    try { localStorage.setItem(KEY, t); } catch (e) { /* ignore */ }
    apply(t);
  }

  function toggle() {
    var current = document.documentElement.getAttribute("data-theme") || resolve();
    set(current === "dark" ? "light" : "dark");
  }

  function current() {
    return document.documentElement.getAttribute("data-theme") || resolve();
  }

  // Apply immediately so the very first paint has the right colors. We are
  // running in <head>, so <body> may not exist yet — that's fine, we only
  // touch <html>.
  apply(resolve());

  // If the user has no explicit choice yet, follow OS dark-mode flips.
  try {
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var listener = function () { if (!readSaved()) apply(resolve()); };
      if (mq.addEventListener) mq.addEventListener("change", listener);
      else if (mq.addListener) mq.addListener(listener);
    }
  } catch (e) { /* ignore */ }

  window.tapTheme = {
    set: set,
    toggle: toggle,
    current: current,
  };
})();
