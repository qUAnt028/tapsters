// Tapsters — auth page logic.
(function () {
  const $ = (s) => document.querySelector(s);

  let mode = "login";

  function setMode(next) {
    mode = next;
    document.querySelectorAll(".auth-tabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.mode === mode)
    );
    document.querySelectorAll(".register-only").forEach((el) =>
      el.classList.toggle("hidden", mode !== "register")
    );
    $("#form-title").textContent = mode === "register" ? "Створити акаунт" : "Увійти в Tapsters";
    $("#form-sub").textContent =
      mode === "register"
        ? "Приєднайтесь за кілька секунд і почніть купувати або продавати."
        : "З поверненням. Введіть свої дані.";
    $("#submit-btn").textContent = mode === "register" ? "Зареєструватися" : "Увійти";
    document.getElementById("password").setAttribute("autocomplete", mode === "register" ? "new-password" : "current-password");
    clearMessages();
  }

  function clearMessages() {
    const e = $("#form-error");
    const s = $("#form-success");
    e.classList.add("hidden"); e.textContent = "";
    s.classList.add("hidden"); s.textContent = "";
  }

  function showError(msg) {
    const e = $("#form-error");
    e.textContent = msg;
    e.classList.remove("hidden");
  }
  function showSuccess(msg) {
    const s = $("#form-success");
    s.textContent = msg;
    s.classList.remove("hidden");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (location.hash === "#register") setMode("register");

    document.querySelectorAll(".auth-tabs .tab").forEach((t) =>
      t.addEventListener("click", () => setMode(t.dataset.mode))
    );

    $("#auth-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearMessages();

      const t = window.tapsters;
      if (!t || !t.isConfigured) {
        showError("Supabase ще не налаштовано — дивіться docs/SETUP.md.");
        return;
      }

      const email = $("#email").value.trim();
      const password = $("#password").value;
      const username = $("#username").value.trim();
      const full_name = $("#full_name").value.trim();

      if (!email || !password) { showError("Email і пароль обов'язкові."); return; }
      if (mode === "register" && password.length < 6) {
        showError("Пароль повинен містити не менше 6 символів.");
        return;
      }

      const submitBtn = $("#submit-btn");
      submitBtn.disabled = true;

      try {
        if (mode === "register") {
          const { user, session } = await t.signUp({ email, password, username, full_name });
          if (session) {
            // signed up + auto-confirmed
            await window.tapCart.mergeGuestCart();
            redirectAfterAuth();
          } else {
            showSuccess("Акаунт створено. Перевірте email для підтвердження перед входом.");
            setMode("login");
          }
        } else {
          await t.signIn({ email, password });
          await window.tapCart.mergeGuestCart();
          redirectAfterAuth();
        }
      } catch (err) {
        showError(window.tapsters.authErrorMessage(err));
      } finally {
        submitBtn.disabled = false;
      }
    });
  });

  function redirectAfterAuth() {
    const params = new URLSearchParams(location.search);
    const next = params.get("next");
    location.href = next ? next : "index.html";
  }
})();
