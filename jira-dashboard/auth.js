// auth.js
// Simple client-side login gate. NOTE: this is a deterrent, not real
// security -- the hash below lives in a public file, so anyone technical
// could brute-force it. See README.md for how to change the credentials.

const AUTH_HASH_HEX =
  "eb462a3bf94e9336741c0dc3b37b7e4bf06c966ed3e788422a65fbb4329a0132"; // sha256("username:password") -- see README.md to change

const AUTH_SESSION_KEY = "mv-dashboard-auth-ok";

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function showApp() {
  document.getElementById("gate").style.display = "none";
  document.getElementById("app").style.display = "block";
}

function logout() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  if (typeof RM_PIN_SESSION_KEY !== "undefined") {
    sessionStorage.removeItem(RM_PIN_SESSION_KEY);
  }
  document.getElementById("gate-username").value = "";
  document.getElementById("gate-password").value = "";
  document.getElementById("gate-error").hidden = true;
  document.getElementById("app").style.display = "none";
  document.getElementById("gate").style.display = "flex";
}

async function tryLogin(username, password) {
  const hash = await sha256Hex(`${username}:${password}`);
  if (hash === AUTH_HASH_HEX) {
    sessionStorage.setItem(AUTH_SESSION_KEY, "1");
    showApp();
    return true;
  }
  return false;
}

document.getElementById("logout-btn").addEventListener("click", logout);

if (sessionStorage.getItem(AUTH_SESSION_KEY) === "1") {
  showApp();
} else {
  document.getElementById("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("gate-username").value.trim();
    const password = document.getElementById("gate-password").value;
    const errorEl = document.getElementById("gate-error");
    const ok = await tryLogin(username, password);
    if (!ok) {
      errorEl.hidden = false;
      document.getElementById("gate-password").value = "";
    }
  });
}
