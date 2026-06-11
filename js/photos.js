// Tapsters — device photo upload with cropping.
// Exposes window.tapPhotos:
//   cropImage(file)              -> Promise<Blob|null>  (null = cancelled)
//   uploadItemImages(uid, blobs) -> Promise<string[]>   (public URLs)
(function () {
  const ASPECTS = [
    { label: "1:1",  value: 1 },
    { label: "4:3",  value: 4 / 3 },
    { label: "3:4",  value: 3 / 4 },
    { label: "16:9", value: 16 / 9 },
  ];
  const MAX_OUTPUT = 1600; // px, longest cropped side

  function buildModal() {
    const wrap = document.createElement("div");
    wrap.className = "crop-modal";
    wrap.innerHTML = `
      <div class="crop-dialog" role="dialog" aria-modal="true" aria-label="Обрізати фото">
        <h3>Обрізати фото</h3>
        <div class="crop-aspects">
          ${ASPECTS.map((a, i) =>
            `<button type="button" data-ar="${a.value}" class="${i === 0 ? "active" : ""}">${a.label}</button>`
          ).join("")}
        </div>
        <div class="crop-stage">
          <img alt="" draggable="false" />
          <div class="crop-box"><span class="crop-handle"></span></div>
        </div>
        <div class="crop-actions">
          <button type="button" class="btn secondary" data-act="cancel">Скасувати</button>
          <button type="button" class="btn" data-act="ok">Обрізати та додати</button>
        </div>
      </div>
    `;
    return wrap;
  }

  // Opens the crop modal for a File/Blob; resolves with a cropped JPEG Blob,
  // or null if the user cancels.
  function cropImage(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const modal = buildModal();
      const img = modal.querySelector("img");
      const stage = modal.querySelector(".crop-stage");
      const box = modal.querySelector(".crop-box");
      const handle = modal.querySelector(".crop-handle");

      let aspect = ASPECTS[0].value;
      // Crop box in displayed-image coordinates.
      let rect = { x: 0, y: 0, w: 0, h: 0 };
      let imgW = 0, imgH = 0; // displayed size

      function paintBox() {
        box.style.left = rect.x + "px";
        box.style.top = rect.y + "px";
        box.style.width = rect.w + "px";
        box.style.height = rect.h + "px";
      }

      function resetBox() {
        // Largest rect with the chosen aspect, centered.
        let w = imgW, h = w / aspect;
        if (h > imgH) { h = imgH; w = h * aspect; }
        rect = { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
        paintBox();
      }

      function clampMove() {
        rect.x = Math.min(Math.max(rect.x, 0), imgW - rect.w);
        rect.y = Math.min(Math.max(rect.y, 0), imgH - rect.h);
      }

      img.onload = () => {
        imgW = img.clientWidth;
        imgH = img.clientHeight;
        resetBox();
      };
      img.src = url;

      modal.querySelectorAll(".crop-aspects button").forEach((b) => {
        b.addEventListener("click", () => {
          modal.querySelectorAll(".crop-aspects button").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          aspect = parseFloat(b.getAttribute("data-ar"));
          resetBox();
        });
      });

      // Drag to move; drag the corner handle to resize (aspect locked).
      let mode = null, start = null;
      function onDown(ev) {
        ev.preventDefault();
        mode = ev.target === handle ? "resize" : "move";
        start = { px: ev.clientX, py: ev.clientY, ...rect };
        box.setPointerCapture(ev.pointerId);
      }
      function onMove(ev) {
        if (!mode) return;
        const dx = ev.clientX - start.px;
        const dy = ev.clientY - start.py;
        if (mode === "move") {
          rect.x = start.x + dx;
          rect.y = start.y + dy;
          clampMove();
        } else {
          let w = Math.max(40, start.w + Math.max(dx, dy * aspect));
          w = Math.min(w, imgW - start.x, (imgH - start.y) * aspect);
          rect.w = w;
          rect.h = w / aspect;
        }
        paintBox();
      }
      function onUp() { mode = null; }
      box.addEventListener("pointerdown", onDown);
      box.addEventListener("pointermove", onMove);
      box.addEventListener("pointerup", onUp);

      function close(result) {
        URL.revokeObjectURL(url);
        modal.remove();
        resolve(result);
      }

      modal.querySelector('[data-act="cancel"]').addEventListener("click", () => close(null));
      modal.addEventListener("click", (ev) => { if (ev.target === modal) close(null); });

      modal.querySelector('[data-act="ok"]').addEventListener("click", () => {
        const scaleX = img.naturalWidth / imgW;
        const scaleY = img.naturalHeight / imgH;
        let outW = Math.round(rect.w * scaleX);
        let outH = Math.round(rect.h * scaleY);
        const k = Math.min(1, MAX_OUTPUT / Math.max(outW, outH));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(outW * k);
        canvas.height = Math.round(outH * k);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(
          img,
          rect.x * scaleX, rect.y * scaleY, outW, outH,
          0, 0, canvas.width, canvas.height
        );
        canvas.toBlob((blob) => close(blob), "image/jpeg", 0.85);
      });

      document.body.appendChild(modal);
    });
  }

  // Uploads cropped blobs to the public "item-images" Supabase Storage bucket
  // and returns their public URLs (in the same order).
  async function uploadItemImages(userId, blobs) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) throw new Error("Supabase не налаштовано.");
    const urls = [];
    const stamp = Date.now();
    for (let i = 0; i < blobs.length; i++) {
      const path = `${userId}/${stamp}-${i}.jpg`;
      const { error } = await t.client.storage
        .from("item-images")
        .upload(path, blobs[i], { contentType: "image/jpeg" });
      if (error) {
        if (/bucket/i.test(error.message || "")) {
          throw new Error("Сховище фото не налаштовано. Виконайте supabase/schema.sql ще раз, щоб створити bucket «item-images».");
        }
        throw error;
      }
      const { data } = t.client.storage.from("item-images").getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  window.tapPhotos = { cropImage, uploadItemImages };
})();
