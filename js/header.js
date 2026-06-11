// Tapsters — shared header behavior (logo, search, categories dropdown,
// cart dropdown, account menu).
(function () {
  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  async function categoryList() {
    const t = window.tapsters;
    if (!t || !t.isConfigured) {
      // Fallback static categories so the UI still works without Supabase.
      return [
        { name: "Електроніка",      slug: "electronics" },
        { name: "Мода",             slug: "fashion" },
        { name: "Дім і сад",         slug: "home-garden" },
        { name: "Іграшки та хобі",  slug: "toys" },
        { name: "Спорт",            slug: "sports" },
        { name: "Книги та медіа",  slug: "books" },
        { name: "Авто",             slug: "automotive" },
        { name: "Колекції",        slug: "collectibles" },
        { name: "Краса",            slug: "beauty" },
        { name: "Інше",             slug: "other" },
      ];
    }
    const { data, error } = await t.client
      .from("categories")
      .select("name, slug")
      .order("name");
    if (error) { console.error(error); return []; }
    return data || [];
  }

  function paintCartCount(n) {
    const badge = document.querySelector('[data-cart-count]');
    if (!badge) return;
    badge.textContent = String(n || 0);
    badge.style.display = n > 0 ? "inline-block" : "none";
  }

  async function refreshCartCount() {
    if (!window.tapCart) return;
    const n = await window.tapCart.count();
    paintCartCount(n);
  }

  function buildCartLine(item, displayCurrency) {
    const fmt = window.tapCurrency.formatItem(item.price * (item.quantity || 1), item.currency);
    const wrap = el(`
      <div class="cart-line" data-id="${item.id}">
        <div class="ct">${item.image_url ? `<img src="${item.image_url}" alt="">` : ""}</div>
        <div>
          <div style="font-weight:600">${escapeHtml(item.title)}</div>
          <div class="muted">${fmt}</div>
          <div class="qty">
            <button data-act="dec" aria-label="decrease">−</button>
            <span>${item.quantity}</span>
            <button data-act="inc" aria-label="increase">+</button>
            <button data-act="rm" class="rm-btn" type="button">видалити</button>
          </div>
        </div>
        <div></div>
      </div>
    `);
    return wrap;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function paintCartPanel() {
    const panel = document.getElementById("cart-panel");
    if (!panel) return;
    const items = await window.tapCart.list();
    const display = window.tapCurrency.getDisplay();
    panel.innerHTML = "";

    if (!items.length) {
      panel.innerHTML = '<div class="empty">Ваш кошик порожній.</div>';
      return;
    }

    items.forEach((it) => {
      const line = buildCartLine(it, display);
      line.querySelector('[data-act="inc"]').addEventListener("click", async () => {
        await window.tapCart.setQty(it.id, it.quantity + 1);
        await paintCartPanel(); refreshCartCount();
      });
      line.querySelector('[data-act="dec"]').addEventListener("click", async () => {
        await window.tapCart.setQty(it.id, it.quantity - 1);
        await paintCartPanel(); refreshCartCount();
      });
      line.querySelector('[data-act="rm"]').addEventListener("click", async () => {
        await window.tapCart.remove(it.id);
        await paintCartPanel(); refreshCartCount();
      });
      panel.appendChild(line);
    });

    // Total in display currency
    let totalUSD = 0;
    items.forEach((it) => {
      totalUSD += window.tapCurrency.convert(it.price * it.quantity, it.currency, "USD");
    });
    const totalDisplay = window.tapCurrency.convert(totalUSD, "USD", display);
    const totals = el(`<div class="cart-totals"><div>Всього</div><div>${window.tapCurrency.format(totalDisplay, display)}</div></div>`);
    panel.appendChild(totals);

    const actions = el(`
      <div class="cart-actions">
        <button class="btn secondary" data-act="clear">Очистити</button>
        <button class="btn" data-act="checkout">Оформити</button>
      </div>
    `);
    actions.querySelector('[data-act="clear"]').addEventListener("click", async () => {
      await window.tapCart.clear();
      await paintCartPanel();
      refreshCartCount();
    });
    actions.querySelector('[data-act="checkout"]').addEventListener("click", async () => {
      const u = window.tapsters && window.tapsters.isConfigured
        ? await window.tapsters.getUser()
        : null;
      if (!u) {
        alert("Будь ласка, увійдіть в акаунт, щоб оформити замовлення.");
        location.href = "auth.html?next=checkout.html";
        return;
      }
      location.href = "checkout.html";
    });
    panel.appendChild(actions);
  }

  async function paintCategoriesPanel() {
    const list = document.getElementById("cat-list");
    if (!list) return;
    const cats = await categoryList();
    list.innerHTML = cats
      .map((c) => `<li data-slug="${c.slug}">${escapeHtml(c.name)}</li>`)
      .join("");
    list.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        const slug = li.getAttribute("data-slug");
        location.href = `index.html?category=${encodeURIComponent(slug)}`;
      });
    });
  }

  function wireMenu(buttonId, menuRoot) {
    const btn = document.getElementById(buttonId);
    if (!btn || !menuRoot) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // close other open menus
      document.querySelectorAll(".menu.open").forEach((m) => {
        if (m !== menuRoot) m.classList.remove("open");
      });
      menuRoot.classList.toggle("open");
      if (menuRoot.classList.contains("open")) {
        if (buttonId === "cart-btn") paintCartPanel();
        if (buttonId === "cat-btn") paintCategoriesPanel();
      }
    });
  }

  function wireGlobalClose() {
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".menu.open").forEach((m) => {
        if (!m.contains(e.target)) m.classList.remove("open");
      });
    });
  }

  function wireBrand() {
    document.querySelectorAll("[data-go-home]").forEach((node) => {
      node.addEventListener("click", () => { location.href = "index.html"; });
    });
  }

  function wireSearch() {
    const form = document.getElementById("search-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = (document.getElementById("search-input").value || "").trim();
      const url = q ? `index.html?q=${encodeURIComponent(q)}` : "index.html";
      location.href = url;
    });
  }

  async function syncRecentlyViewedScope(user) {
    if (!window.tapRecent || typeof window.tapRecent.setUser !== "function") return;
    const changed = window.tapRecent.setUser(user ? user.id : null);
    if (changed) document.dispatchEvent(new CustomEvent("tap:recentlychange"));
  }

  async function logout() {
    const t = window.tapsters;

    // Fire signOut, but never let it block the UI for more than ~1.5s.
    // This way the user always sees an immediate response when they click.
    if (t && t.isConfigured) {
      try {
        await Promise.race([
          t.signOut(),
          new Promise((res) => setTimeout(res, 1500)),
        ]);
      } catch (e) { console.error("signOut failed:", e); }
    }

    // Belt-and-suspenders: even if signOut() didn't finish (e.g. offline),
    // wipe Supabase's auth tokens from localStorage so the next page load
    // is unauthenticated.
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }

    // Wipe guest recently-viewed bucket so the next visitor on this device
    // doesn't inherit anything, and reset the active scope to "guest".
    if (window.tapRecent) {
      if (typeof window.tapRecent.clearGuest === "function") window.tapRecent.clearGuest();
      if (typeof window.tapRecent.setUser === "function") window.tapRecent.setUser(null);
    }

    // Reload if we're already on home; otherwise hard-navigate to home.
    // Using replace() so the logged-in page doesn't sit in browser history.
    const path = (location.pathname || "").toLowerCase();
    const onHome = path === "/" || path.endsWith("/") || path.endsWith("/index.html") || path === "/index.html";
    if (onHome) {
      window.location.reload();
    } else {
      window.location.replace("index.html");
    }
  }

  async function wireAccountArea() {
    const t = window.tapsters;
    const right = document.getElementById("auth-area");
    if (!right) return;

    async function paint() {
      const user = t && t.isConfigured ? await t.getUser() : null;
      await syncRecentlyViewedScope(user);
      if (user) {
        right.innerHTML = `
          <a class="icon-btn" href="create-listing.html"><span>Продати</span></a>
          <div class="menu" id="acct-menu">
            <button class="icon-btn" id="acct-btn" type="button"><span>Акаунт</span> ▾</button>
            <div class="menu-panel" style="min-width:220px">
              <ul>
                <li data-act="cabinet">Мій кабінет</li>
                <li data-act="orders">Мої замовлення</li>
                <li data-act="wishlist">Список бажань</li>
                <li data-act="listings">Мої оголошення</li>
                <li data-act="logout">Вийти</li>
              </ul>
            </div>
          </div>
        `;
        const menu = document.getElementById("acct-menu");
        wireMenu("acct-btn", menu);

        // One delegated click handler keeps things robust even if individual
        // <li>s are re-rendered by paint().
        menu.querySelector(".menu-panel").addEventListener("click", (ev) => {
          const li = ev.target.closest("[data-act]");
          if (!li) return;
          ev.stopPropagation();
          ev.preventDefault();
          const act = li.getAttribute("data-act");
          if (act === "cabinet") location.assign("cabinet.html");
          else if (act === "orders") location.assign("cabinet.html#orders");
          else if (act === "wishlist") location.assign("cabinet.html#wishlist");
          else if (act === "listings") location.assign("cabinet.html#listings");
          else if (act === "logout") logout();
        });
      } else {
        right.innerHTML = `
          <a class="icon-btn" href="auth.html"><span>Вхід</span></a>
          <a class="icon-btn" href="auth.html#register"><span>Реєстрація</span></a>
        `;
      }
    }

    await paint();
    if (t && t.isConfigured) {
      t.onAuth(async () => { await paint(); refreshCartCount(); });
    }
  }

  function buildHeader() {
    const host = document.getElementById("site-header");
    if (!host) return;
    host.innerHTML = `
      <header class="site-header">
        <div class="container">
          <div class="brand" data-go-home title="Головна Tapsters">
            <span class="brand-mark">T</span><span>Tapsters</span>
          </div>

          <div class="menu" id="cat-menu">
            <button class="icon-btn" id="cat-btn" type="button">
              <span>Категорії</span> ▾
            </button>
            <div class="menu-panel left" style="min-width:240px">
              <h4>Оглянути категорії</h4>
              <ul id="cat-list"><li class="muted">Завантаження…</li></ul>
            </div>
          </div>

          <form class="search-wrap" id="search-form" role="search">
            <input id="search-input" type="search" placeholder="Пошук в Tapsters" aria-label="Пошук" />
            <button type="submit" aria-label="Пошук">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            </button>
          </form>

          <div class="header-actions">
            <div class="menu" id="cart-menu">
              <button class="icon-btn" id="cart-btn" type="button" aria-label="Кошик">
                <span>Кошик</span>
                <span class="badge" data-cart-count style="display:none">0</span>
              </button>
              <div class="menu-panel cart-panel" id="cart-panel">
                <div class="empty">Ваш кошик порожній.</div>
              </div>
            </div>
            <div id="auth-area" class="row" style="gap:6px"></div>
            <button
              type="button"
              class="theme-toggle"
              id="theme-toggle"
              role="switch"
              aria-checked="false"
              aria-label="Перемкнути на темну тему"
              title="Перемкнути на темну тему"
            >
              <span class="tt-thumb">
                <span class="tt-icon tt-icon-sun" aria-hidden="true">☀</span>
                <span class="tt-icon tt-icon-moon" aria-hidden="true">☾</span>
              </span>
            </button>
          </div>
        </div>
      </header>
    `;

    // Pre-fill search input from URL ?q=
    const params = new URLSearchParams(location.search);
    const qIn = document.getElementById("search-input");
    if (qIn && params.get("q")) qIn.value = params.get("q");

    wireMenu("cat-btn", document.getElementById("cat-menu"));
    wireMenu("cart-btn", document.getElementById("cart-menu"));
    wireBrand();
    wireSearch();
    wireGlobalClose();
    wireAccountArea();
    wireThemeToggle();

    document.addEventListener("tap:cartchange", refreshCartCount);
    // Also re-paint the cart panel whenever the cart changes IF the
    // dropdown is currently open. This fixes the bug where adding an
    // item from a card-hover button popped open the panel but it was
    // still showing the old (empty) state from before the add.
    document.addEventListener("tap:cartchange", () => {
      var cartMenu = document.getElementById("cart-menu");
      if (cartMenu && cartMenu.classList.contains("open")) paintCartPanel();
    });
    refreshCartCount();

    // Expose paint helpers so other modules (main.js quick-add)
    // can ensure the panel is up-to-date BEFORE they open the dropdown.
    window.tapHeader = window.tapHeader || {};
    window.tapHeader.paintCartPanel = paintCartPanel;
    window.tapHeader.openCart = async function () {
      var menu = document.getElementById("cart-menu");
      if (!menu) return;
      // Paint first so the dropdown never shows the stale "empty" state.
      await paintCartPanel();
      menu.classList.add("open");
    };
  }

  function wireThemeToggle() {
    var btn = document.getElementById("theme-toggle");
    if (!btn || !window.tapTheme) return;
    // Sync aria/title to the current theme on first paint.
    var t = window.tapTheme.current();
    btn.setAttribute("aria-checked", t === "dark" ? "true" : "false");
    btn.setAttribute("aria-label", t === "dark" ? "Перемкнути на світлу тему" : "Перемкнути на темну тему");
    btn.title = t === "dark" ? "Перемкнути на світлу тему" : "Перемкнути на темну тему";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      window.tapTheme.toggle();
    });
  }

  document.addEventListener("DOMContentLoaded", buildHeader);
})();
