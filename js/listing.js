// Tapsters — create-listing page logic.
(function () {
  const $ = (s) => document.querySelector(s);

  function showError(msg) {
    const e = $("#form-error"); e.textContent = msg; e.classList.remove("hidden");
  }
  function showSuccess(msg) {
    const s = $("#form-success"); s.textContent = msg; s.classList.remove("hidden");
  }
  function clearMessages() {
    $("#form-error").classList.add("hidden");
    $("#form-success").classList.add("hidden");
  }

  async function loadCategories() {
    const t = window.tapsters;
    const sel = $("#category");
    sel.innerHTML = "";
    let cats = [];
    if (t && t.isConfigured) {
      const { data } = await t.client.from("categories").select("id, name, slug").order("name");
      cats = data || [];
    }
    if (!cats.length) {
      sel.innerHTML = '<option value="">— configure Supabase to load categories —</option>';
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
      gate.classList.remove("hidden");
      form.classList.add("hidden");
      return;
    }
    gate.classList.add("hidden");
    form.classList.remove("hidden");

    await loadCategories();

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearMessages();

      const title = $("#title").value.trim();
      const description = $("#description").value.trim();
      const category_id = $("#category").value || null;
      const stock = parseInt($("#stock").value || "1", 10);
      const price = parseFloat($("#price").value);
      const currency = document.querySelector('input[name="currency"]:checked').value;
      const image_url = $("#image_url").value.trim() || null;

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
        const { data, error } = await t.client
          .from("items")
          .insert({
            seller_id: user.id,
            category_id,
            title,
            description,
            price,
            currency,
            stock,
            image_url,
          })
          .select("id")
          .single();
        if (error) throw error;
        showSuccess("Listing published! Redirecting…");
        setTimeout(() => location.href = `item.html?id=${data.id}`, 700);
      } catch (err) {
        showError(err.message || "Could not publish listing.");
      } finally {
        submit.disabled = false;
      }
    });
  });
})();
