// Tapsters — seller profile page (account info + listings + reviews about the account).
(function () {
  const $ = (s) => document.querySelector(s);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function sellerDisplayName(p) {
    if (!p) return "Tapster";
    return p.full_name || p.username || "Tapster";
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

  function paintStars(root, value) {
    const filled = Math.round(value || 0);
    root.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement("span");
      s.className = "star" + (i <= filled ? " on" : "");
      s.textContent = "★";
      root.appendChild(s);
    }
  }

  async function fetchProfile(id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return null;
    const { data } = await t.client
      .from("profiles")
      .select("id, username, full_name, avatar_url, created_at")
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function fetchListings(seller_id) {
    const t = window.tapsters;
    const { data } = await t.client
      .from("items")
      .select("id, title, price, currency, image_url, sold, created_at")
      .eq("seller_id", seller_id)
      .eq("sold", false)
      .order("created_at", { ascending: false });
    return data || [];
  }

  async function fetchReviews(subject_id) {
    const t = window.tapsters;
    const { data } = await t.client
      .from("reviews")
      .select("id, content, rating, user_id, created_at, profiles:profiles!reviews_user_id_fkey ( username, full_name )")
      .eq("subject_id", subject_id)
      .order("created_at", { ascending: false });
    return data || [];
  }

  function listingCard(item) {
    const priceStr = window.tapCurrency.formatItem(item.price, item.currency);
    return `
      <a class="card" href="item.html?id=${encodeURIComponent(item.id)}">
        <div class="thumb">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : '<div style="font-size:42px">📦</div>'}</div>
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

  let chosenRating = 0;

  async function paintReviews(subject_id) {
    const list = await fetchReviews(subject_id);
    const root = $("#reviews-list");
    if (!list.length) {
      root.innerHTML = '<div class="empty">No reviews yet for this seller.</div>';
    } else {
      root.innerHTML = list.map((r) => `
        <div class="comment">
          <div class="who">
            <strong>${escapeHtml((r.profiles && (r.profiles.full_name || r.profiles.username)) || "Tapster")}</strong>
            <span>${new Date(r.created_at).toLocaleDateString()}</span>
          </div>
          ${r.rating ? `<div class="stars" data-readonly="true">${"★".repeat(r.rating)}<span style="color:var(--gray-300)">${"★".repeat(5 - r.rating)}</span></div>` : ""}
          <div class="body">${escapeHtml(r.content)}</div>
        </div>
      `).join("");
    }

    const rated = list.filter((r) => r.rating);
    const stars = $("#seller-stars");
    const txt = $("#seller-rating-text");
    if (rated.length) {
      const avg = rated.reduce((s, r) => s + r.rating, 0) / rated.length;
      paintStars(stars, avg);
      const r = Math.round(avg * 10) / 10;
      txt.textContent = `${r.toFixed(1)} · ${rated.length} review${rated.length === 1 ? "" : "s"}`;
    } else {
      stars.innerHTML = "";
      txt.textContent = "No reviews yet";
    }
  }

  async function setupReviewForm(subject_id) {
    const t = window.tapsters;
    const me = t && t.isConfigured ? await t.getUser() : null;
    const form = $("#review-form");
    const gate = $("#review-gate");
    const selfNotice = $("#review-self-notice");

    if (!me) {
      gate.classList.remove("hidden");
      form.classList.add("hidden");
      selfNotice.classList.add("hidden");
      return;
    }
    if (me.id === subject_id) {
      selfNotice.classList.remove("hidden");
      gate.classList.add("hidden");
      form.classList.add("hidden");
      return;
    }
    selfNotice.classList.add("hidden");
    gate.classList.add("hidden");
    form.classList.remove("hidden");

    const ratingInput = $("#rating-input");
    const starsEl = buildStars(0, { interactive: true, onPick: (v) => { chosenRating = v; } });
    starsEl.id = "rating-input";
    ratingInput.replaceWith(starsEl);

    // If user already left a review, prefill
    const { data: existing } = await t.client
      .from("reviews")
      .select("id, content, rating")
      .eq("subject_id", subject_id)
      .eq("user_id", me.id)
      .maybeSingle();

    if (existing) {
      $("#review-content").value = existing.content || "";
      chosenRating = existing.rating || 0;
      const refilled = buildStars(chosenRating, { interactive: true, onPick: (v) => { chosenRating = v; } });
      refilled.id = "rating-input";
      document.getElementById("rating-input").replaceWith(refilled);
      $("#review-submit").textContent = "Update review";
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("#review-error").classList.add("hidden");
      const content = $("#review-content").value.trim();
      if (!content) {
        const e = $("#review-error");
        e.textContent = "Please write a short review.";
        e.classList.remove("hidden");
        return;
      }
      try {
        const payload = {
          subject_id,
          user_id: me.id,
          content,
          rating: chosenRating || null,
        };
        // upsert keeps it to "one review per (seller, reviewer)"
        const { error } = await t.client
          .from("reviews")
          .upsert(payload, { onConflict: "subject_id,user_id" });
        if (error) throw error;
        await paintReviews(subject_id);
        $("#review-submit").textContent = "Update review";
      } catch (e) {
        const er = $("#review-error");
        er.textContent = e.message || "Could not post review.";
        er.classList.remove("hidden");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const t = window.tapsters;
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) { $("#not-found").classList.remove("hidden"); return; }

    if (!t || !t.isConfigured) {
      $("#not-found").classList.remove("hidden");
      return;
    }

    const profile = await fetchProfile(id);
    if (!profile) { $("#not-found").classList.remove("hidden"); return; }

    $("#seller-root").classList.remove("hidden");

    const name = sellerDisplayName(profile);
    $("#seller-name").textContent = name;
    $("#hero-avatar").textContent = (name[0] || "T").toUpperCase();
    $("#seller-username").textContent = profile.username ? "@" + profile.username : "";
    if (profile.created_at) {
      $("#seller-joined").textContent = "Joined " + new Date(profile.created_at).toLocaleDateString();
    }
    document.title = `${name} — Tapsters`;

    // listings
    const items = await fetchListings(id);
    const grid = $("#seller-listings");
    const emptyMsg = $("#seller-listings-empty");
    if (!items.length) {
      grid.innerHTML = "";
      emptyMsg.classList.remove("hidden");
    } else {
      grid.innerHTML = items.map(listingCard).join("");
      emptyMsg.classList.add("hidden");
    }
    document.addEventListener("tap:currencychange", async () => {
      const fresh = await fetchListings(id);
      grid.innerHTML = fresh.length ? fresh.map(listingCard).join("") : "";
    });

    await paintReviews(id);
    await setupReviewForm(id);
  });
})();
