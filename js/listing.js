(function () {
  const $ = (s) => document.querySelector(s);

  function showError(msg) {
    const e = $("#form-error");
    if (e) {
      e.textContent = msg;
      e.classList.remove("hidden");
    }
  }

  function showSuccess(msg) {
    const s = $("#form-success");
    if (s) {
      s.textContent = msg;
      s.classList.remove("hidden");
    }
  }

  function clearMessages() {
    $("#form-error")?.classList.add("hidden");
    $("#form-success")?.classList.add("hidden");
  }

  async function loadCategories() {
    const t = window.tapsters;
    const sel = $("#category");
    if (!sel) return;
    sel.innerHTML = "";
    let cats = [];
    if (t && t.isConfigured) {
      const { data } = await t.client.from("categories").select("id, name").order("name");
      cats = data || [];
    }
    if (!cats.length) {
      sel.innerHTML = '<option value="">— configure Supabase —</option>';
      return;
    }
    sel.innerHTML = cats
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join("");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const t = window.tapsters;
    const gate = $("#auth-gate");
    const form = $("#listing-form");

    const user = t && t.isConfigured ? await t.getUser() : null;
    if (!user) {
      gate?.classList.remove("hidden");
      form?.classList.add("hidden");
      return;
    }
    gate?.classList.add("hidden");
    form?.classList.remove("hidden");

    await loadCategories();

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearMessages();

      const title = $("#title").value.trim();
      const description = $("#description").value.trim();
      const category_id = $("#category").value || null;
      const stock = parseInt($("#stock").value || "1", 10);
      const price = parseFloat($("#price").value);
      const currencyEl = document.querySelector('input[name="currency"]:checked');
      const image_url = $("#image_url").value.trim();

      if (!title || isNaN(price) || price < 0) {
        showError("Please fill in title and a valid price.");
        return;
      }
      if (!category_id) {
        showError("Please pick a category.");
        return;
      }

      const submit = $("#submit-btn");
      submit.disabled = true;

      try {
        // Build payload dynamically to avoid sending empty strings or nulls that might violate DB constraints
        const payload = {
          seller_id: user.id,
          category_id,
          title,
          description,
          price,
          currency: currencyEl ? currencyEl.value : "USD",
          stock,
        };

        if (image_url) {
          payload.image_url = image_url;
        }

        const { data, error } = await t.client
          .from("items")
          .insert(payload)
          .select("id")
          .single();

        if (error) throw error;

        showSuccess("Listing published! Redirecting…");
        setTimeout(() => (location.href = `item.html?id=${data.id}`), 700);
      } catch (err) {
        showError(err.message || "Could not publish listing.");
      } finally {
        submit.disabled = false;
      }
    });
  });
})();
