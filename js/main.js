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
    return `
      <a class="card" href="item.html?id=${encodeURIComponent(item.id)}">
        <div class="thumb">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : placeholderThumb()}</div>
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
        { name: "Electronics", slug: "electronics" },
        { name: "Fashion", slug: "fashion" },
        { name: "Home & Garden", slug: "home-garden" },
        { name: "Toys & Hobbies", slug: "toys" },
        { name: "Sports", slug: "sports" },
        { name: "Books & Media", slug: "books" },
        { name: "Automotive", slug: "automotive" },
        { name: "Collectibles", slug: "collectibles" },
        { name: "Beauty", slug: "beauty" },
        { name: "Other", slug: "other" },
      ];
    }
    chips.innerHTML =
      `<a class="chip ${!active ? "active" : ""}" href="index.html">All</a>` +
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

    const t = window.tapsters;

    let items = [];
    if (t && t.isConfigured) {
      let query = t.client
        .from("items")
        .select("id, title, price, currency, image_url, category_id, sold, created_at, categories:categories ( name, slug )")
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

    if (!items.length) {
      empty.classList.remove("hidden");
      return;
    }

    grid.innerHTML = items.map(cardHtml).join("");
  }

  function paintRecentlyViewed() {
    const grid = $("#recent-grid");
    const empty = $("#recent-empty");
    const items = window.tapRecent.list();
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
      $("#page-title").textContent = `Search results for “${q}”`;
    } else if (category) {
      $("#page-title").textContent = `Category: ${category.replace(/-/g, " ")}`;
    }

    $("#hero-cta").addEventListener("click", async () => {
      const u = window.tapsters && window.tapsters.isConfigured
        ? await window.tapsters.getUser()
        : null;
      location.href = u ? "create-listing.html" : "auth.html?next=create-listing.html";
    });

    wireCurrency();
    loadCategories(category);
    loadListings({ q, category });
    paintRecentlyViewed();
  });
})();
