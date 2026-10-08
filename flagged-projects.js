// flagged-projects.js
// Lets anyone (e.g. a franchise) flag a project that needs close
// attention, and gives managers a filterable list to work through, each
// row linking back to the full project detail modal. Firestore collection:
// "flags".

let fpTickets = [];
let fpFlags = [];
let fpSelectedTarget = null; // { key, label }
let fpStatusFilter = "open";

function fpEscapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function initFlaggedProjects() {
  loadDashboardData()
    .then((data) => {
      fpTickets = flattenIssues(data);
    })
    .catch((err) => console.error("Could not load Jira tickets:", err));

  db.collection("flags").onSnapshot(
    (snap) => {
      fpFlags = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      populateFilters();
      renderFlagsList();
    },
    (err) => console.error("Failed to load flags:", err)
  );

  document.getElementById("flag-project-search").addEventListener("input", (e) => {
    renderTargetSearchResults(e.target.value.trim());
  });
  document.getElementById("flag-form").addEventListener("submit", handleSubmitFlag);

  document.querySelectorAll("#flag-status-chips .rm-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      fpStatusFilter = chip.dataset.status;
      document.querySelectorAll("#flag-status-chips .rm-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderFlagsList();
    });
  });
  document.getElementById("flag-territory-filter").addEventListener("change", renderFlagsList);
  document.getElementById("flag-category-filter").addEventListener("change", renderFlagsList);
}

function renderTargetSearchResults(query) {
  const container = document.getElementById("flag-search-results");
  if (!query) {
    container.innerHTML = "";
    return;
  }
  const q = query.toLowerCase();
  const matches = fpTickets
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
              (t) => `<tr class="clickable-row" data-key="${fpEscapeAttr(t.key)}">
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
      const ticket = fpTickets.find((t) => t.key === row.dataset.key);
      if (!ticket) return;
      fpSelectedTarget = { key: ticket.key, label: `${ticket.key} \u2014 ${ticket.projectName}` };
      document.getElementById("flag-project-search").value = "";
      container.innerHTML = "";
      renderSelectedTarget();
    });
  });
}

function renderSelectedTarget() {
  const el = document.getElementById("flag-selected-target");
  if (!fpSelectedTarget) {
    el.textContent = "";
    return;
  }
  el.innerHTML = `Flagging: <strong>${escapeHtml(fpSelectedTarget.label)}</strong> &middot; <a href="#" id="fp-clear-target">clear</a>`;
  document.getElementById("fp-clear-target").addEventListener("click", (e) => {
    e.preventDefault();
    fpSelectedTarget = null;
    renderSelectedTarget();
  });
}

async function handleSubmitFlag(e) {
  e.preventDefault();
  const errorEl = document.getElementById("flag-form-error");
  errorEl.hidden = true;

  if (!fpSelectedTarget) {
    errorEl.textContent = "Search for and select a project first.";
    errorEl.hidden = false;
    return;
  }
  const description = document.getElementById("flag-description").value.trim();
  if (!description) return;
  const category = document.getElementById("flag-category").value;

  const ticket = fpTickets.find((t) => t.key === fpSelectedTarget.key);

  try {
    await db.collection("flags").add({
      ticketKey: fpSelectedTarget.key,
      projectName: ticket ? ticket.projectName : fpSelectedTarget.label,
      territory: ticket ? ticket.territory || "" : "",
      category,
      description,
      status: "open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    fpSelectedTarget = null;
    renderSelectedTarget();
    document.getElementById("flag-description").value = "";
  } catch (err) {
    errorEl.textContent = `Could not save flag: ${err.message}`;
    errorEl.hidden = false;
  }
}

function populateFilters() {
  const territorySelect = document.getElementById("flag-territory-filter");
  const categorySelect = document.getElementById("flag-category-filter");
  const territories = new Set(fpFlags.map((f) => f.territory).filter(Boolean));
  const categories = new Set(fpFlags.map((f) => f.category).filter(Boolean));

  const curT = territorySelect.value;
  territorySelect.innerHTML =
    '<option value="">All</option>' +
    Array.from(territories).sort().map((t) => `<option value="${fpEscapeAttr(t)}">${escapeHtml(t)}</option>`).join("");
  territorySelect.value = curT;

  const curC = categorySelect.value;
  categorySelect.innerHTML =
    '<option value="">All</option>' +
    Array.from(categories).sort().map((c) => `<option value="${fpEscapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  categorySelect.value = curC;
}

function renderFlagsList() {
  const container = document.getElementById("flags-list");
  const countEl = document.getElementById("flag-count");
  const territoryFilter = document.getElementById("flag-territory-filter").value;
  const categoryFilter = document.getElementById("flag-category-filter").value;

  let flags = [...fpFlags];
  if (fpStatusFilter) flags = flags.filter((f) => f.status === fpStatusFilter);
  if (territoryFilter) flags = flags.filter((f) => f.territory === territoryFilter);
  if (categoryFilter) flags = flags.filter((f) => f.category === categoryFilter);

  flags.sort((a, b) => {
    const at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return bt - at;
  });

  if (countEl) countEl.textContent = `(${flags.length})`;

  if (flags.length === 0) {
    container.innerHTML = `<p class="empty-state">No flags match these filters.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Project</th><th>Territory</th><th>Category</th><th>Description</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${flags
            .map(
              (f) => `
            <tr>
              <td class="clickable-row" data-openkey="${fpEscapeAttr(f.ticketKey)}"><span class="col-key">${f.ticketKey}</span><br />${escapeHtml(f.projectName || "")}</td>
              <td>${escapeHtml(f.territory || "\u2014")}</td>
              <td>${escapeHtml(f.category || "\u2014")}</td>
              <td>${escapeHtml(f.description)}</td>
              <td><span class="rm-pacepill ${f.status === "open" ? "rm-pace-under" : "rm-pace-pace"}">${f.status === "open" ? "Open" : "Resolved"}</span></td>
              <td><button type="button" class="clear-filters-btn" data-toggle="${f.id}" data-newstatus="${f.status === "open" ? "resolved" : "open"}">${f.status === "open" ? "Mark resolved" : "Reopen"}</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll("[data-openkey]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const ticket = fpTickets.find((t) => t.key === cell.dataset.openkey);
      if (ticket) openProjectModal(ticket);
      else alert("Could not find that ticket's current Jira data.");
    });
  });
  container.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await db.collection("flags").doc(btn.dataset.toggle).update({ status: btn.dataset.newstatus });
      } catch (err) {
        alert(`Could not update: ${err.message}`);
      }
    });
  });
}

initFlaggedProjects();
