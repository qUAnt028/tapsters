// Tapsters — seller profile page (account info + listings + reviews about the account).
(function () {
  const $ = (s) => document.querySelector(s);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function sellerDisplayName(p) {
    if (!p) return "Користувач";
    return p.full_name || p.username || "Користувач";
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
          s.addEventListener("click", () => {
            // Click the same star you already had selected to clear the
            // rating (post a comment-only review).
            const next = current === i ? 0 : i;
            current = next;
            paint(next);
            onPick && onPick(next);
          });
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
    // Fetch reviews and reviewer profiles in two passes. We deliberately do
    // NOT use a PostgREST embed (e.g. `profiles!reviews_user_id_fkey`) because
    // `reviews.user_id` references `auth.users(id)`, not `public.profiles(id)`,
    // so PostgREST cannot resolve a direct relationship from reviews to
    // profiles and the embed returns 400 Bad Request.
    const { data: reviews, error } = await t.client
      .from("reviews")
      .select("id, content, rating, user_id, created_at")
      .eq("subject_id", subject_id)
      .order("created_at", { ascending: false });
    if (error) { console.error("fetchReviews:", error); return []; }
    if (!reviews || !reviews.length) return [];

    const userIds = [...new Set(reviews.map((r) => r.user_id).filter(Boolean))];
    let byId = new Map();
    if (userIds.length) {
      const { data: profiles } = await t.client
        .from("profiles")
        .select("id, username, full_name")
        .in("id", userIds);
      byId = new Map((profiles || []).map((p) => [p.id, p]));
    }
    return reviews.map((r) => ({ ...r, profiles: byId.get(r.user_id) || null }));
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

  // Default a fresh review to 5 stars so most reviews carry a rating; the user
  // can click any star to lower the rating, or click the same star again to
  // clear it (see buildStars onPick handling below).
  let chosenRating = 5;

  // Cache of the last fetched review list. We use this so an optimistic update
  // after a post can re-render with the just-saved row even before the
  // server-side fetch completes (or in case the fetch hits a transient issue).
  let lastReviewsCache = [];

  function reviewItemHtml(r) {
    const reviewerName =
      (r.profiles && (r.profiles.full_name || r.profiles.username)) || "Користувач";
    const ratingHtml = r.rating
      ? `<div class="stars" data-readonly="true">${"★".repeat(r.rating)}<span style="color:var(--gray-300)">${"★".repeat(5 - r.rating)}</span></div>`
      : `<div class="muted" style="font-size:.8rem">Без оцінки</div>`;
    return `
      <div class="comment" data-review-id="${escapeHtml(r.id || "")}">
        <div class="who">
          <strong>${escapeHtml(reviewerName)}</strong>
          <span>${new Date(r.created_at).toLocaleDateString()}</span>
        </div>
        ${ratingHtml}
        <div class="body">${escapeHtml(r.content)}</div>
      </div>
    `;
  }

  function renderReviewsList(list) {
    const root = $("#reviews-list");
    if (!list || !list.length) {
      root.innerHTML = '<div class="empty">Поки немає відгуків про цього продавця.</div>';
    } else {
      root.innerHTML = list.map(reviewItemHtml).join("");
    }
    const rated = (list || []).filter((r) => r.rating);
    const stars = $("#seller-stars");
    const txt = $("#seller-rating-text");
    if (rated.length) {
      const avg = rated.reduce((s, r) => s + r.rating, 0) / rated.length;
      paintStars(stars, avg);
      const r = Math.round(avg * 10) / 10;
      txt.textContent = `${r.toFixed(1)} · ${rated.length} відгук${rated.length === 1 ? "" : "ів"}`;
    } else if (list && list.length) {
      // Reviews exist but none carry a rating — say so explicitly instead
      // of "No reviews yet", which used to be misleading.
      stars.innerHTML = "";
      txt.textContent = `${list.length} відгук${list.length === 1 ? "" : "ів"} · без оцінки`;
    } else {
      stars.innerHTML = "";
      txt.textContent = "Поки немає відгуків";
    }
  }

  async function paintReviews(subject_id) {
    const list = await fetchReviews(subject_id);
    lastReviewsCache = list;
    renderReviewsList(list);
  }

  function flashSuccess(msg) {
    const note = $("#review-success");
    if (!note) return;
    note.textContent = msg;
    note.classList.remove("hidden");
    clearTimeout(flashSuccess._t);
    flashSuccess._t = setTimeout(() => note.classList.add("hidden"), 4000);
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

    // Reviewer profile (used for optimistic rendering of just-posted reviews
    // before the round-trip fetch returns).
    const myProfile = await fetchProfile(me.id);

    // Build rating input pre-filled with the default (5 stars for a new
    // review, the user's existing rating when editing — handled below).
    const ratingInput = $("#rating-input");
    const starsEl = buildStars(chosenRating, { interactive: true, onPick: (v) => { chosenRating = v; } });
    starsEl.id = "rating-input";
    ratingInput.replaceWith(starsEl);

    // If user already left a review, prefill the form with it.
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
      $("#review-submit").textContent = "Оновити відгук";
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("#review-error").classList.add("hidden");
      const submitBtn = $("#review-submit");
      const content = $("#review-content").value.trim();
      if (!content) {
        const e = $("#review-error");
        e.textContent = "Будь ласка, напишіть короткий відгук.";
        e.classList.remove("hidden");
        return;
      }
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Публікуємо…";
      try {
        const payload = {
          subject_id,
          user_id: me.id,
          content,
          rating: chosenRating || null,
        };
        // upsert keeps it to "one review per (seller, reviewer)"; chain
        // .select().single() so we get the saved row back even when the
        // client-side cache fetch is stale or blocked.
        const { data: saved, error } = await t.client
          .from("reviews")
          .upsert(payload, { onConflict: "subject_id,user_id" })
          .select("id, content, rating, user_id, created_at")
          .single();
        if (error) throw error;

        // Optimistic update: drop the user's previous review (if any) from
        // the cached list, prepend the just-saved one, and re-render. This
        // guarantees the user sees their review immediately even if the
        // refetch below races or fails.
        const myRow = {
          ...saved,
          profiles: myProfile
            ? { full_name: myProfile.full_name, username: myProfile.username }
            : null,
        };
        const filtered = (lastReviewsCache || []).filter((r) => r.user_id !== me.id);
        lastReviewsCache = [myRow, ...filtered];
        renderReviewsList(lastReviewsCache);

        // Best-effort refetch to reconcile with anything else that changed.
        paintReviews(subject_id).catch((err) => console.error("refetch reviews:", err));

        submitBtn.textContent = "Оновити відгук";
        flashSuccess(existing ? "Відгук оновлено." : "Відгук опубліковано.");
      } catch (e) {
        submitBtn.textContent = originalLabel;
        const er = $("#review-error");
        const msg = (e && e.message) || "";
        // PostgREST returns this when a table referenced by the client
        // doesn't exist in the project yet (e.g. schema.sql wasn't re-run
        // after the comments → reviews refactor).
        if (/public\.reviews/i.test(msg) || /schema cache/i.test(msg)) {
          er.innerHTML = 'Таблиця reviews відсутня у вашому проєкті Supabase. ' +
            'Повторно виконайте <code>supabase/schema.sql</code> в SQL-редакторі і оновіть сторінку.';
        } else {
          er.textContent = msg || "Не вдалося опублікувати відгук.";
        }
        er.classList.remove("hidden");
      } finally {
        submitBtn.disabled = false;
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
    $("#hero-avatar").textContent = (name[0] || "К").toUpperCase();
    $("#seller-username").textContent = profile.username ? "@" + profile.username : "";
    if (profile.created_at) {
      $("#seller-joined").textContent = "Дата реєстрації: " + new Date(profile.created_at).toLocaleDateString();
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
