(function () {
  const $ = (s) => document.querySelector(s);

  // Returns a cleaned URL string, "" for empty input, or false if it isn't a URL.
  // Also tolerates pasted links without a scheme by prepending "https://".
  function normalizeImageUrl(raw) {
    let v = (raw || "").trim();
    if (!v) return "";
    // strip wrapping quotes / angle brackets that some users paste
    v = v.replace(/^[<"'\s]+|[>"'\s]+$/g, "");
    if (!v) return "";
    if (!/^https?:\/\//i.test(v) && !/^data:image\//i.test(v)) {
      v = "https://" + v.replace(/^\/+/, "");
    }
    try {
      const u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "data:") return false;
      return u.toString();
    } catch (_) {
      return false;
    }
  }

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
      sel.innerHTML = '<option value="">— налаштуйте Supabase —</option>';
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
      const image_url = normalizeImageUrl($("#image_url").value);

      if (!title || isNaN(price) || price < 0) {
        showError("Будь ласка, вкажіть назву та коректну ціну.");
        return;
      }
      if (!category_id) {
        showError("Будь ласка, оберіть категорію.");
        return;
      }
      if (image_url === false) {
        showError("Це посилання на фото виглядає неправильно. Вставте пряме посилання наприклад https://example.com/photo.jpg.");
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

        showSuccess("Оголошення опубліковано! Перенаправляємо…");
        setTimeout(() => (location.href = `item.html?id=${data.id}`), 700);
      } catch (err) {
        showError(err.message || "Не вдалося опублікувати оголошення.");
      } finally {
        submit.disabled = false;
      }
    });
  });
})();
