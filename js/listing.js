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

    // ----- photo picking + cropping -----
    const MAX_PHOTOS = 8;
    const photos = []; // { blob, previewUrl }
    const thumbsEl = $("#photo-thumbs");
    const photoInput = $("#photo-input");
    const addPhotoBtn = $("#add-photo-btn");

    function paintThumbs() {
      thumbsEl.innerHTML = photos.map((p, i) => `
        <div class="photo-thumb">
          <img src="${p.previewUrl}" alt="" />
          ${i === 0 ? '<span class="photo-main-badge">Головне</span>' : ""}
          <button type="button" data-remove="${i}" aria-label="Видалити фото">×</button>
        </div>
      `).join("");
      addPhotoBtn.disabled = photos.length >= MAX_PHOTOS;
    }

    thumbsEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-remove]");
      if (!btn) return;
      const i = parseInt(btn.getAttribute("data-remove"), 10);
      URL.revokeObjectURL(photos[i].previewUrl);
      photos.splice(i, 1);
      paintThumbs();
    });

    addPhotoBtn.addEventListener("click", () => photoInput.click());

    photoInput.addEventListener("change", async () => {
      const files = Array.from(photoInput.files || []);
      photoInput.value = "";
      for (const file of files) {
        if (photos.length >= MAX_PHOTOS) {
          showError(`Можна додати не більше ${MAX_PHOTOS} фото.`);
          break;
        }
        if (!/^image\//.test(file.type)) continue;
        const blob = await window.tapPhotos.cropImage(file);
        if (blob) {
          photos.push({ blob, previewUrl: URL.createObjectURL(blob) });
          paintThumbs();
        }
      }
    });

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearMessages();

      const title = $("#title").value.trim();
      const description = $("#description").value.trim();
      const category_id = $("#category").value || null;
      const price = parseFloat($("#price").value);
      const currencyEl = document.querySelector('input[name="currency"]:checked');

      if (!title || isNaN(price) || price < 0) {
        showError("Будь ласка, вкажіть назву та коректну ціну.");
        return;
      }
      if (!category_id) {
        showError("Будь ласка, оберіть категорію.");
        return;
      }

      const submit = $("#submit-btn");
      submit.disabled = true;
      const prevLabel = submit.textContent;

      try {
        let imageUrls = [];
        if (photos.length) {
          submit.textContent = "Завантажуємо фото…";
          imageUrls = await window.tapPhotos.uploadItemImages(user.id, photos.map((p) => p.blob));
        }

        // Build payload dynamically to avoid sending empty strings or nulls that might violate DB constraints
        const payload = {
          seller_id: user.id,
          category_id,
          title,
          description,
          price,
          currency: currencyEl ? currencyEl.value : "USD",
        };

        if (imageUrls.length) {
          payload.image_url = imageUrls[0];
          payload.images = imageUrls;
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
        submit.textContent = prevLabel;
      }
    });
  });
})();
