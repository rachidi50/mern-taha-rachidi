// Configuration publique : aucune clé ni URI MongoDB ne doit figurer dans le frontend.
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const CONFIG = {
  BACKENDS: isLocal
    ? ["http://localhost:3000"]
    : [
        "https://VOTRE_BACKEND.vercel.app",
        "https://VOTRE_WORKER.workers.dev",
      ],
  TIMEOUT_MS: 4000,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASS_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function currentUser() {
  try {
    return JSON.parse(sessionStorage.getItem("user"));
  } catch {
    return null;
  }
}

/* ---------- Navigation entre les vues ---------- */
function route() {
  const hash = location.hash;
  const user = currentUser();
  const view = hash === "#register" ? "register" : hash === "#app" || (!hash && user) ? "app" : "login";

  if (view === "app" && !user) {
    location.hash = "#login";
    return;
  }

  document.querySelectorAll("[data-view]").forEach((element) => {
    element.hidden = element.dataset.view !== view;
  });
  document.title = view === "register" ? "Créer un compte" : view === "app" ? "Mes éléments" : "Connexion";

  if (view === "app") {
    document.getElementById("user-first-name").textContent = user.firstName || "";
    loadItems();
  } else {
    document.querySelector("#form-" + view + " input")?.focus();
  }
}

window.addEventListener("hashchange", route);

/* ---------- Validation ---------- */
function validateRegister(data) {
  const errors = {};
  if (!data.firstName.trim()) errors.firstName = "Entrez votre prénom.";
  if (!data.lastName.trim()) errors.lastName = "Entrez votre nom.";
  if (!EMAIL_RE.test(data.email)) errors.email = "Entrez une adresse e-mail valide.";
  if (!PASS_RE.test(data.password)) errors.password = "8 caractères minimum, avec une lettre et un chiffre.";
  else if (new TextEncoder().encode(data.password).length > 72) errors.password = "Le mot de passe ne doit pas dépasser 72 octets.";
  if (data.confirm !== data.password) errors.confirm = "Les mots de passe ne correspondent pas.";
  return errors;
}

function validateLogin(data) {
  const errors = {};
  if (!EMAIL_RE.test(data.email)) errors.email = "Entrez une adresse e-mail valide.";
  if (!data.password) errors.password = "Entrez votre mot de passe.";
  return errors;
}

/* ---------- Affichage des erreurs ---------- */
function showErrors(prefix, errors) {
  const form = document.getElementById("form-" + prefix);
  form.querySelectorAll(".err").forEach((paragraph) => (paragraph.textContent = ""));
  form.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
  const keys = Object.keys(errors);
  keys.forEach((key) => {
    const error = document.getElementById("e-" + prefix + "-" + key);
    const input = document.getElementById(prefix + "-" + key);
    if (error) error.textContent = errors[key];
    if (input) input.setAttribute("aria-invalid", "true");
  });
  if (keys.length) document.getElementById(prefix + "-" + keys[0])?.focus();
  return keys.length > 0;
}

function showAlert(prefix, type, message) {
  const alert = document.getElementById("alert-" + prefix);
  alert.className = "alert " + type;
  alert.textContent = message;
  alert.hidden = false;
}

function hideAlert(prefix) {
  const alert = document.getElementById("alert-" + prefix);
  alert.hidden = true;
  alert.textContent = "";
}

/* ---------- Requêtes et bascule ---------- */
function backendUrls() {
  const urls = (typeof CONFIG !== "undefined" && CONFIG.BACKENDS) || ["http://localhost:3000"];
  return urls.map((url) => url.replace(/\/$/, ""));
}

async function requestApi(path, options = {}) {
  const timeout = (typeof CONFIG !== "undefined" && CONFIG.TIMEOUT_MS) || 4000;
  const failures = [];

  for (const baseUrl of backendUrls()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(baseUrl + path, { ...options, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return { ok: true, data, baseUrl };
      // Toute réponse non réussie déclenche l'essai du backend suivant.
      failures.push({ error: data.error || `Erreur HTTP ${response.status}`, fields: data.fields });
    } catch (error) {
      console.warn("Échec du backend", baseUrl, error.name);
    } finally {
      clearTimeout(timer);
    }
  }

  const firstFailure = failures[0];
  return {
    ok: false,
    error: firstFailure?.error || "Serveurs indisponibles. Réessayez dans un instant.",
    fields: firstFailure?.fields,
  };
}

async function sendAuth(path, body, button) {
  button.disabled = true;
  try {
    return await requestApi(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    button.disabled = false;
  }
}

/* ---------- Inscription ---------- */
document.getElementById("form-register").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert("register");
  const form = new FormData(event.target);
  const data = {
    firstName: form.get("firstName"), lastName: form.get("lastName"), email: form.get("email"),
    password: form.get("password"), confirm: form.get("confirm"),
  };
  if (showErrors("register", validateRegister(data))) return;

  const result = await sendAuth("/api/auth/register", data, document.getElementById("submit-register"));
  if (result.ok) {
    event.target.reset();
    showAlert("register", "success", "Compte créé. Redirection vers la connexion…");
    setTimeout(() => { location.hash = "#login"; }, 1000);
  } else {
    if (result.fields) showErrors("register", result.fields);
    showAlert("register", "error", result.error);
  }
});

/* ---------- Connexion ---------- */
document.getElementById("form-login").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert("login");
  const form = new FormData(event.target);
  const data = { email: form.get("email"), password: form.get("password") };
  if (showErrors("login", validateLogin(data))) return;

  const result = await sendAuth("/api/auth/login", data, document.getElementById("submit-login"));
  if (result.ok) {
    sessionStorage.setItem("token", result.data.token);
    sessionStorage.setItem("user", JSON.stringify(result.data.user));
    event.target.reset();
    location.hash = "#app";
  } else {
    if (result.fields) showErrors("login", result.fields);
    showAlert("login", "error", result.error);
  }
});

/* ---------- Éléments MongoDB ---------- */
function renderItems(items) {
  const list = document.getElementById("items");
  list.replaceChildren();
  if (!items.length) {
    const item = document.createElement("li");
    item.className = "empty-item";
    item.textContent = "Aucun élément pour le moment.";
    list.append(item);
    return;
  }
  items.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry.name;
    list.append(item);
  });
}

async function loadItems() {
  const status = document.getElementById("items-status");
  status.textContent = "Chargement…";
  const result = await requestApi("/api/items");
  if (result.ok) {
    renderItems(result.data);
    status.textContent = result.data.length ? `${result.data.length} élément(s) chargé(s).` : "";
  } else {
    document.getElementById("items").replaceChildren();
    status.textContent = "";
    showAlert("app", "error", result.error);
  }
}

function requestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let pendingItemClientId;

document.getElementById("form-item").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideAlert("app");
  const input = document.getElementById("item-name");
  const error = document.getElementById("e-item-name");
  const name = input.value.trim();
  error.textContent = "";
  input.removeAttribute("aria-invalid");
  if (!name) {
    error.textContent = "Entrez le nom de l’élément.";
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }

  const button = document.getElementById("submit-item");
  button.disabled = true;
  const result = await requestApi("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, clientId: pendingItemClientId || (pendingItemClientId = requestId()) }),
  });
  button.disabled = false;

  if (result.ok) {
    event.target.reset();
    pendingItemClientId = undefined;
    showAlert("app", "success", "Élément enregistré.");
    loadItems();
  } else {
    showAlert("app", "error", result.error);
  }
});

// Un texte modifié correspond à une nouvelle intention : une nouvelle clé est alors créée.
document.getElementById("item-name").addEventListener("input", () => {
  pendingItemClientId = undefined;
});

document.getElementById("reload-items").addEventListener("click", loadItems);
document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  location.hash = "#login";
});

route();
