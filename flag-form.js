// flag-form.js
// Public, no-login form: search a real Jira project and submit a flag.
// Writes to the same Firestore "flags" collection the in-platform
// "Flagged Projects" page reads from.

let ffTickets = [];
let ffSelectedTarget = null; // { key, label }

function ffEscapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function initFlagForm() {
  loadDashboardData()
    .then((data) => {
      ffTickets = flattenIssues(data);
    })
    .catch((err) => {
      console.error("Could not load Jira tickets:", err);
      const el = document.getElementById("flag-form-error");
      el.textContent = "Could not load the project list. Try reloading the page.";
      el.hidden = false;
    });

  document.getElementById("flag-project-search").addEventListener("input", (e) => {
    renderSearchResults(e.target.value.trim());
  });
  document.getElementById("flag-form").addEventListener("submit", handleSubmit);
  document.getElementById("flag-another-btn").addEventListener("click", () => {
    document.getElementById("flagform-success").style.display = "none";
    document.getElementById("flagform-card").style.display = "block";
  });
}

function renderSearchResults(query) {
  const container = document.getElementById("flag-search-results");
  if (!query) {
    container.innerHTML = "";
    return;
  }
  const q = query.toLowerCase();
  const matches = ffTickets
    .filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        (t.projectId || "").toLowerCase().includes(q) ||
        (t.projectName || "").toLowerCase().includes(q)
    )
    .slice(0, 10);

  if (matches.length === 0) {
    container.innerHTML = `<p class="empty-state">No matches.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap" style="margin-top:6px;">
      <table>
        <tbody>
          ${matches
            .map(
              (t) => `<tr class="clickable-row" data-key="${ffEscapeAttr(t.key)}">
              <td class="col-key">${t.key}</td>
              <td class="col-updated">${escapeHtml(t.projectId || "\u2014")}</td>
              <td>${escapeHtml(t.projectName)}</td>
              <td>${escapeHtml(t.territory || "\u2014")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const ticket = ffTickets.find((t) => t.key === row.dataset.key);
      if (!ticket) return;
      ffSelectedTarget = { key: ticket.key, label: `${ticket.key} \u2014 ${ticket.projectName}` };
      document.getElementById("flag-project-search").value = "";
      container.innerHTML = "";
      renderSelectedTarget();
    });
  });
}

function renderSelectedTarget() {
  const el = document.getElementById("flag-selected-target");
  if (!ffSelectedTarget) {
    el.textContent = "";
    return;
  }
  el.innerHTML = `Flagging: <strong>${escapeHtml(ffSelectedTarget.label)}</strong> &middot; <a href="#" id="ff-clear-target">clear</a>`;
  document.getElementById("ff-clear-target").addEventListener("click", (e) => {
    e.preventDefault();
    ffSelectedTarget = null;
    renderSelectedTarget();
  });
}

async function handleSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("flag-form-error");
  errorEl.hidden = true;

  if (!ffSelectedTarget) {
    errorEl.textContent = "Search for and select a project first.";
    errorEl.hidden = false;
    return;
  }
  const description = document.getElementById("flag-description").value.trim();
  if (!description) return;
  const category = document.getElementById("flag-category").value;
  const reporter = document.getElementById("flag-reporter").value.trim();

  const ticket = ffTickets.find((t) => t.key === ffSelectedTarget.key);

  try {
    await db.collection("flags").add({
      ticketKey: ffSelectedTarget.key,
      projectName: ticket ? ticket.projectName : ffSelectedTarget.label,
      territory: ticket ? ticket.territory || "" : "",
      category,
      description,
      reporter,
      status: "open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    document.getElementById("flagform-card").style.display = "none";
    document.getElementById("flagform-success").style.display = "block";
    ffSelectedTarget = null;
    document.getElementById("flag-description").value = "";
    document.getElementById("flag-reporter").value = "";
    renderSelectedTarget();
  } catch (err) {
    errorEl.textContent = `Could not submit: ${err.message}`;
    errorEl.hidden = false;
  }
}

initFlagForm();
