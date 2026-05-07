// Tapsters — item detail page logic.
(function () {
  const $ = (s) => document.querySelector(s);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function buildStars(value, { interactive = false, onPick } = {}) {
    const wrap = document.createElement("span");
    wrap.className = "stars";
    if (!interactive) wrap.setAttribute("data-readonly", "true");
    let current = value || 0;
    function paint(v) {
      wrap.innerHTML = "";
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement("span");
        s.className = "star" + (i <= v ? " on" : "");
        s.textContent = "★";
        if (interactive) {
          s.addEventListener("click", () => { current = i; paint(i); onPick && onPick(i); });
          s.addEventListener("mouseenter", () => paint(i));
          s.addEventListener("mouseleave", () => paint(current));
        }
        wrap.appendChild(s);
      }
    }
    paint(current);
    return wrap;
  }

  async function fetchItem(id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return null;
    const { data } = await t.client
      .from("items")
      .select(`
        id, title, description, price, currency, image_url, sold, stock, seller_id, created_at,
        categories:categories ( name, slug )
      `)
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function fetchSellerName(seller_id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured || !seller_id) return "—";
    const { data } = await t.client
      .from("profiles")
      .select("username, full_name")
      .eq("id", seller_id)
      .maybeSingle();
    if (!data) return "—";
    return data.full_name || data.username || "Tapster";
  }

  async function fetchComments(id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return [];
    const { data } = await t.client
      .from("comments")
      .select("id, content, rating, user_id, created_at, profiles:profiles ( username, full_name )")
      .eq("item_id", id)
      .order("created_at", { ascending: false });
    return data || [];
  }

  let chosenRating = 0;

  async function paintComments(id) {
    const list = await fetchComments(id);
    const root = $("#comments-list");
    if (!list.length) {
      root.innerHTML = '<div class="empty">No reviews yet — be the first.</div>';
    } else {
      root.innerHTML = list.map((c) => `
        <div class="comment">
          <div class="who">
            <strong>${escapeHtml((c.profiles && (c.profiles.full_name || c.profiles.username)) || "Tapster")}</strong>
            <span>${new Date(c.created_at).toLocaleDateString()}</span>
          </div>
          ${c.rating ? `<div class="stars" data-readonly="true">${"★".repeat(c.rating)}<span style="color:var(--gray-300)">${"★".repeat(5 - c.rating)}</span></div>` : ""}
          <div class="body">${escapeHtml(c.content)}</div>
        </div>
      `).join("");
    }

    // average rating display
    const rated = list.filter((c) => c.rating);
    if (rated.length) {
      const avg = rated.reduce((sum, c) => sum + c.rating, 0) / rated.length;
      const avgRounded = Math.round(avg * 10) / 10;
      const wrap = $("#item-avg-stars");
      wrap.innerHTML = "";
      const filled = Math.round(avg);
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement("span");
        s.className = "star" + (i <= filled ? " on" : "");
        s.textContent = "★";
        wrap.appendChild(s);
      }
      $("#item-avg-text").textContent = `${avgRounded.toFixed(1)} · ${rated.length} review${rated.length === 1 ? "" : "s"}`;
    } else {
      $("#item-avg-stars").innerHTML = "";
      $("#item-avg-text").textContent = "No ratings yet";
    }
  }

  async function setupCommentForm(id) {
    const t = window.tapsters;
    const gate = $("#comment-gate");
    const form = $("#comment-form");
    const user = t && t.isConfigured ? await t.getUser() : null;
    if (!user) {
      gate.classList.remove("hidden");
      form.classList.add("hidden");
      return;
    }
    gate.classList.add("hidden");
    form.classList.remove("hidden");

    const ratingInput = $("#rating-input");
    ratingInput.innerHTML = "";
    const starsEl = buildStars(0, { interactive: true, onPick: (v) => { chosenRating = v; } });
    ratingInput.replaceWith(starsEl);
    starsEl.id = "rating-input";

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const content = $("#comment-content").value.trim();
      if (!content) return;
      try {
        const { error } = await t.client
          .from("comments")
          .insert({ item_id: id, user_id: user.id, content, rating: chosenRating || null });
        if (error) throw error;
        $("#comment-content").value = "";
        chosenRating = 0;
        // reset stars
        const fresh = buildStars(0, { interactive: true, onPick: (v) => { chosenRating = v; } });
        fresh.id = "rating-input";
        document.getElementById("rating-input").replaceWith(fresh);
        await paintComments(id);
      } catch (e) {
        alert(e.message || "Could not post comment.");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) {
      $("#not-found").classList.remove("hidden");
      return;
    }

    const item = await fetchItem(id);
    if (!item) {
      $("#not-found").classList.remove("hidden");
      return;
    }

    $("#item-root").classList.remove("hidden");
    $("#item-title").textContent = item.title;
    $("#item-desc").textContent = item.description || "";
    $("#item-currency").textContent = item.currency;
    $("#item-category").textContent = item.categories ? item.categories.name : "";
    $("#item-price").textContent = window.tapCurrency.formatItem(item.price, item.currency);
    document.title = `${item.title} — Tapsters`;

    if (item.image_url) {
      $("#item-image").innerHTML = `<img src="${escapeHtml(item.image_url)}" alt="">`;
    }

    $("#item-seller").textContent = await fetchSellerName(item.seller_id);

    // record recently viewed
    window.tapRecent.record(item);

    // currency change should re-render price
    document.addEventListener("tap:currencychange", () => {
      $("#item-price").textContent = window.tapCurrency.formatItem(item.price, item.currency);
    });

    // cart actions
    $("#add-cart-btn").addEventListener("click", async () => {
      const t = window.tapsters;
      const u = t && t.isConfigured ? await t.getUser() : null;
      if (!u) {
        alert("Please log in or sign up to add items to your cart.");
        location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + id)}`;
        return;
      }
      try {
        await window.tapCart.add(item, 1);
      } catch (e) {
        const err = $("#add-error");
        err.textContent = e.message || "Could not add to cart.";
        err.classList.remove("hidden");
        return;
      }
      // open the cart dropdown
      document.getElementById("cart-menu").classList.add("open");
      document.dispatchEvent(new CustomEvent("tap:cartchange"));
    });

    $("#buy-now-btn").addEventListener("click", async () => {
      const t = window.tapsters;
      const u = t && t.isConfigured ? await t.getUser() : null;
      if (!u) {
        location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + id)}`;
        return;
      }
      try { await window.tapCart.add(item, 1); } catch (e) { /* already in cart */ }
      location.href = "checkout.html";
    });

    setupCommentForm(id);
    paintComments(id);
  });
})();
