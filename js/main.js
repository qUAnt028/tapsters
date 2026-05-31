// Tapsters — main page (index.html) logic.
(function () {
  const $ = (s) => document.querySelector(s);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function placeholderThumb() {
    return '<div style="font-size:42px">📦</div>';
  }

  function cardHtml(item) {
    const priceStr = window.tapCurrency.formatItem(item.price, item.currency);
    const id = encodeURIComponent(item.id);
    return `
      <a class="card" href="item.html?id=${id}" data-card-id="${escapeHtml(item.id)}">
        <div class="thumb">
          ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : placeholderThumb()}
          <div class="quick-actions">
            <button type="button" class="btn secondary" data-quick="cart" data-id="${escapeHtml(item.id)}">Додати у кошик</button>
            <button type="button" class="btn" data-quick="buy" data-id="${escapeHtml(item.id)}">Замовити</button>
          </div>
        </div>
        <div class="body">
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="meta">
            <div class="price">${priceStr}</div>
            <div class="muted">${escapeHtml(item.currency)}</div>
          </div>
        </div>
      </a>
    `;
  }

  // Cache the loaded items for the home grid so the quick-action handler
  // can build a cart payload (title/price/etc) without an extra fetch.
  const itemsCache = new Map();
  let recentCache = [];

  async function quickAddToCart(itemId) {
    const item = itemsCache.get(itemId) || recentCache.find((r) => r.id === itemId);
    if (!item) return;
    const t = window.tapsters;
    const u = t && t.isConfigured ? await t.getUser() : null;
    if (!u) {
      location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + itemId)}`;
      return;
    }
    if (item.seller_id && item.seller_id === u.id) {
      alert("Ви не можете додати власне оголошення до кошика.");
      return;
    }
    try {
      await window.tapCart.add(item, 1);
      // Paint the dropdown contents first, THEN open it. Opening the
      // panel before paint finishes briefly shows the "Your cart is
      // empty" placeholder which used to look like a bug.
      if (window.tapHeader && typeof window.tapHeader.openCart === "function") {
        await window.tapHeader.openCart();
      } else {
        const cartMenu = document.getElementById("cart-menu");
        if (cartMenu) cartMenu.classList.add("open");
      }
    } catch (e) {
      alert(e.message || "Не вдалося додати у кошик.");
    }
  }

  async function quickBuyNow(itemId) {
    const item = itemsCache.get(itemId) || recentCache.find((r) => r.id === itemId);
    if (!item) return;
    const t = window.tapsters;
    const u = t && t.isConfigured ? await t.getUser() : null;
    if (!u) {
      location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + itemId)}`;
      return;
    }
    if (item.seller_id && item.seller_id === u.id) {
      alert("Ви не можете купити власне оголошення.");
      return;
    }
    try { await window.tapCart.add(item, 1); } catch (e) { /* may already be in cart */ }
    location.href = "checkout.html";
  }

  function wireQuickActionsOnce() {
    if (wireQuickActionsOnce.done) return;
    wireQuickActionsOnce.done = true;
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-quick]");
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const action = btn.getAttribute("data-quick");
      const id = btn.getAttribute("data-id");
      if (!id) return;
      if (action === "cart") quickAddToCart(id);
      else if (action === "buy") quickBuyNow(id);
    });
  }

  async function loadCategories(active) {
    const t = window.tapsters;
    const chips = $("#cat-chips");
    if (!chips) return;
    let cats = [];
    if (t && t.isConfigured) {
      const { data } = await t.client.from("categories").select("name, slug").order("name");
      cats = data || [];
    }
    if (!cats.length) {
      cats = [
        { name: "Електроніка", slug: "electronics" },
        { name: "Мода", slug: "fashion" },
        { name: "Дім і сад", slug: "home-garden" },
        { name: "Іграшки та хобі", slug: "toys" },
        { name: "Спорт", slug: "sports" },
        { name: "Книги та медіа", slug: "books" },
        { name: "Авто", slug: "automotive" },
        { name: "Колекції", slug: "collectibles" },
        { name: "Краса", slug: "beauty" },
        { name: "Інше", slug: "other" },
      ];
    }
    chips.innerHTML =
      `<a class="chip ${!active ? "active" : ""}" href="index.html">Всі</a>` +
      cats
        .map(
          (c) =>
            `<a class="chip ${active === c.slug ? "active" : ""}" href="index.html?category=${encodeURIComponent(c.slug)}">${escapeHtml(c.name)}</a>`
        )
        .join("");
  }

  async function loadListings({ q, category }) {
    const grid = $("#listing-grid");
    const empty = $("#listing-empty");
    grid.innerHTML = "";
    empty.classList.add("hidden");
    itemsCache.clear();

    const t = window.tapsters;

    let items = [];
    if (t && t.isConfigured) {
      let query = t.client
        .from("items")
        .select("id, title, price, currency, image_url, seller_id, category_id, sold, created_at, categories:categories ( name, slug )")
        .eq("sold", false)
        .order("created_at", { ascending: false })
        .limit(60);

      if (q) query = query.ilike("title", `%${q}%`);

      if (category) {
        const { data: cat } = await t.client.from("categories").select("id").eq("slug", category).maybeSingle();
        if (cat && cat.id) query = query.eq("category_id", cat.id);
      }

      const { data, error } = await query;
      if (error) {
        console.error(error);
      } else {
        items = data || [];
      }
    }

    items.forEach((it) => itemsCache.set(it.id, it));

    if (!items.length) {
      empty.classList.remove("hidden");
      return;
    }

    grid.innerHTML = items.map(cardHtml).join("");
  }

  function paintRecentlyViewed() {
    const grid = $("#recent-grid");
    const empty = $("#recent-empty");
    if (!grid || !empty) return;
    const items = window.tapRecent.list();
    recentCache = items;
    if (!items.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    grid.innerHTML = items.map(cardHtml).join("");
  }

  function wireCurrency() {
    const sel = $("#currency-select");
    if (!sel) return;
    sel.value = window.tapCurrency.getDisplay();
    sel.addEventListener("change", () => {
      window.tapCurrency.setDisplay(sel.value);
      // re-render with new currency
      const params = new URLSearchParams(location.search);
      loadListings({ q: params.get("q") || "", category: params.get("category") || "" });
      paintRecentlyViewed();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    const q = (params.get("q") || "").trim();
    const category = params.get("category") || "";
    if (q) {
      $("#page-title").textContent = `Результати пошуку: «${q}»`;
    } else if (category) {
      $("#page-title").textContent = `Категорія: ${category.replace(/-/g, " ")}`;
    }

    $("#hero-cta").addEventListener("click", async () => {
      const u = window.tapsters && window.tapsters.isConfigured
        ? await window.tapsters.getUser()
        : null;
      location.href = u ? "create-listing.html" : "auth.html?next=create-listing.html";
    });

    wireCurrency();
    wireQuickActionsOnce();
    loadCategories(category);
    loadListings({ q, category });
    paintRecentlyViewed();

    // Re-paint Recently Viewed whenever the active user (and therefore the
    // localStorage bucket) changes — e.g. on login, logout, or account switch.
    document.addEventListener("tap:recentlychange", paintRecentlyViewed);
  });
})();
