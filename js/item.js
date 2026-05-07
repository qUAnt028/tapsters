// Tapsters — item detail page logic.
(function () {
  const $ = (s) => document.querySelector(s);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
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

  async function fetchSeller(seller_id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured || !seller_id) return null;
    const { data } = await t.client
      .from("profiles")
      .select("id, username, full_name, avatar_url, created_at")
      .eq("id", seller_id)
      .maybeSingle();
    return data;
  }

  async function fetchSellerRating(seller_id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured || !seller_id) return { avg: null, count: 0 };
    const { data } = await t.client
      .from("reviews")
      .select("rating")
      .eq("subject_id", seller_id)
      .not("rating", "is", null);
    if (!data || !data.length) return { avg: null, count: 0 };
    const avg = data.reduce((s, r) => s + r.rating, 0) / data.length;
    return { avg, count: data.length };
  }

  function paintStars(root, value) {
    root.innerHTML = "";
    const filled = Math.round(value || 0);
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement("span");
      s.className = "star" + (i <= filled ? " on" : "");
      s.textContent = "★";
      root.appendChild(s);
    }
  }

  function sellerDisplayName(profile) {
    if (!profile) return "Tapster";
    return profile.full_name || profile.username || "Tapster";
  }

  function sellerInitial(profile) {
    const name = sellerDisplayName(profile);
    return (name[0] || "T").toUpperCase();
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

    // Seller card
    const seller = await fetchSeller(item.seller_id);
    const name = sellerDisplayName(seller);
    $("#seller-link").textContent = name;
    $("#seller-avatar").textContent = sellerInitial(seller);
    const sellerHref = `seller.html?id=${encodeURIComponent(item.seller_id)}`;
    $("#seller-link").setAttribute("href", sellerHref);
    $("#seller-profile-btn").setAttribute("href", sellerHref);

    const rating = await fetchSellerRating(item.seller_id);
    if (rating.count) {
      paintStars($("#seller-stars"), rating.avg);
      const r = Math.round(rating.avg * 10) / 10;
      $("#seller-rating-text").textContent = `${r.toFixed(1)} · ${rating.count} review${rating.count === 1 ? "" : "s"}`;
    } else {
      $("#seller-stars").innerHTML = "";
      $("#seller-rating-text").textContent = "No reviews yet";
    }

    // Record recently viewed
    window.tapRecent.record(item);

    // Re-render price when display currency changes
    document.addEventListener("tap:currencychange", () => {
      $("#item-price").textContent = window.tapCurrency.formatItem(item.price, item.currency);
    });

    // Show delete button only to the seller
    const t = window.tapsters;
    const me = t && t.isConfigured ? await t.getUser() : null;
    if (me && me.id === item.seller_id) {
      const delBtn = $("#delete-btn");
      delBtn.classList.remove("hidden");
      $("#add-cart-btn").classList.add("hidden");
      $("#buy-now-btn").classList.add("hidden");

      delBtn.addEventListener("click", async () => {
        if (!confirm("Delete this listing? This can't be undone.")) return;
        delBtn.disabled = true;
        try {
          const { error } = await t.client.from("items").delete().eq("id", item.id);
          if (error) throw error;
          alert("Listing deleted.");
          location.href = "cabinet.html#listings";
        } catch (e) {
          alert(e.message || "Could not delete listing.");
          delBtn.disabled = false;
        }
      });
    }

    // Cart actions
    $("#add-cart-btn").addEventListener("click", async () => {
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
      const cartMenu = document.getElementById("cart-menu");
      if (cartMenu) cartMenu.classList.add("open");
      document.dispatchEvent(new CustomEvent("tap:cartchange"));
    });

    $("#buy-now-btn").addEventListener("click", async () => {
      const u = t && t.isConfigured ? await t.getUser() : null;
      if (!u) {
        location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + id)}`;
        return;
      }
      try { await window.tapCart.add(item, 1); } catch (e) { /* already in cart */ }
      location.href = "checkout.html";
    });
  });
})();
