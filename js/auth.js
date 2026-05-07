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
    $("#form-title").textContent = mode === "register" ? "Create your account" : "Log in to Tapsters";
    $("#form-sub").textContent =
      mode === "register"
        ? "Join in seconds and start buying or selling."
        : "Welcome back. Enter your credentials.";
    $("#submit-btn").textContent = mode === "register" ? "Sign up" : "Log in";
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
        showError("Supabase isn't configured yet — see docs/SETUP.md.");
        return;
      }

      const email = $("#email").value.trim();
      const password = $("#password").value;
      const username = $("#username").value.trim();
      const full_name = $("#full_name").value.trim();

      if (!email || !password) { showError("Email and password are required."); return; }
      if (mode === "register" && password.length < 6) {
        showError("Password must be at least 6 characters.");
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
            showSuccess("Account created. Check your email to confirm before logging in.");
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
