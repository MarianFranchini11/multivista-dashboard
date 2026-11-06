// pin-gate.js
// A second, module-specific lock in front of Resource Management (and its
// future sub-tabs). Separate from the main login in auth.js. NOTE: like the
// rest of this dashboard, this is a light deterrent, not real security.

const RM_PIN_HASH_HEX =
  "b3282a2f2a28757b3a18ab833de16a9c54518c0b0cf493e3f0a7cf09386f326a"; // sha256("1122") -- see README.md to change

const RM_PIN_SESSION_KEY = "mv-resource-pin-ok";

async function sha256HexPin(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function showRMContent() {
  document.getElementById("pin-gate").style.display = "none";
  document.getElementById("rm-content").style.display = "block";
}

async function tryPin(pin) {
  const hash = await sha256HexPin(pin);
  if (hash === RM_PIN_HASH_HEX) {
    sessionStorage.setItem(RM_PIN_SESSION_KEY, "1");
    showRMContent();
    return true;
  }
  return false;
}

if (sessionStorage.getItem(RM_PIN_SESSION_KEY) === "1") {
  showRMContent();
} else {
  document.getElementById("pin-gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("pin-input");
    const errorEl = document.getElementById("pin-error");
    const ok = await tryPin(input.value.trim());
    if (!ok) {
      errorEl.hidden = false;
      input.value = "";
      input.focus();
    }
  });
}
