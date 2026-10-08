// flagged-projects.js
// Management view for flags submitted through the public, no-login
// flag-form.html page. Each row links back to the full project detail
// modal. Firestore collection: "flags".

let fpTickets = [];
let fpFlags = [];
let fpStatusFilter = "open";
let fpEditingId = null;
const FLAG_CATEGORIES = ["Client complaint", "Missed deadline", "Quality issue", "Needs close follow-up", "Other"];

function fpEscapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function initFlaggedProjects() {
  const linkUrl = new URL("flag-form.html", window.location.href).href;
  document.getElementById("flag-form-link").textContent = linkUrl;
  document.getElementById("flag-copy-link-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(linkUrl).then(() => {
      const btn = document.getElementById("flag-copy-link-btn");
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = original; }, 1500);
    });
  });

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
          <tr><th>Project</th><th>Territory</th><th>Category</th><th>Description</th><th>Reported by</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${flags.map((f) => (f.id === fpEditingId ? renderFlagEditRow(f) : renderFlagRow(f))).join("")}
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
  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      fpEditingId = btn.dataset.edit;
      renderFlagsList();
    });
  });
  container.querySelectorAll("[data-canceledit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      fpEditingId = null;
      renderFlagsList();
    });
  });
  container.querySelectorAll("[data-saveedit]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.saveedit;
      const row = btn.closest("tr");
      const category = row.querySelector("[data-editcategory]").value;
      const description = row.querySelector("[data-editdescription]").value.trim();
      if (!description) return;
      try {
        await db.collection("flags").doc(id).update({ category, description });
        fpEditingId = null;
      } catch (err) {
        alert(`Could not save changes: ${err.message}`);
      }
    });
  });
  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this flag? This can't be undone.")) return;
      try {
        await db.collection("flags").doc(btn.dataset.delete).delete();
      } catch (err) {
        alert(`Could not delete: ${err.message}`);
      }
    });
  });
}

function renderFlagRow(f) {
  return `
    <tr>
      <td class="clickable-row" data-openkey="${fpEscapeAttr(f.ticketKey)}"><span class="col-key">${f.ticketKey}</span><br />${escapeHtml(f.projectName || "")}</td>
      <td>${escapeHtml(f.territory || "\u2014")}</td>
      <td>${escapeHtml(f.category || "\u2014")}</td>
      <td>${escapeHtml(f.description)}</td>
      <td>${escapeHtml(f.reporter || "\u2014")}</td>
      <td><span class="rm-pacepill ${f.status === "open" ? "rm-pace-under" : "rm-pace-pace"}">${f.status === "open" ? "Open" : "Resolved"}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="clear-filters-btn" data-toggle="${f.id}" data-newstatus="${f.status === "open" ? "resolved" : "open"}">${f.status === "open" ? "Mark resolved" : "Reopen"}</button>
        <button type="button" class="clear-filters-btn" data-edit="${f.id}">Edit</button>
        <button type="button" class="clear-filters-btn" data-delete="${f.id}" style="color:#8A2A17;border-color:#8A2A17;">Delete</button>
      </td>
    </tr>`;
}

function renderFlagEditRow(f) {
  return `
    <tr>
      <td class="clickable-row" data-openkey="${fpEscapeAttr(f.ticketKey)}"><span class="col-key">${f.ticketKey}</span><br />${escapeHtml(f.projectName || "")}</td>
      <td>${escapeHtml(f.territory || "\u2014")}</td>
      <td>
        <select data-editcategory style="padding:5px;border:1px solid var(--line);border-radius:3px;font-size:0.82rem;">
          ${FLAG_CATEGORIES.map((c) => `<option ${c === f.category ? "selected" : ""}>${c}</option>`).join("")}
        </select>
      </td>
      <td><textarea data-editdescription style="width:100%;min-height:50px;padding:6px;border:1px solid var(--line);border-radius:3px;font-size:0.82rem;box-sizing:border-box;">${escapeHtml(f.description)}</textarea></td>
      <td>${escapeHtml(f.reporter || "\u2014")}</td>
      <td><span class="rm-pacepill ${f.status === "open" ? "rm-pace-under" : "rm-pace-pace"}">${f.status === "open" ? "Open" : "Resolved"}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="rm-add-btn" data-saveedit="${f.id}">Save</button>
        <button type="button" class="clear-filters-btn" data-canceledit="${f.id}">Cancel</button>
      </td>
    </tr>`;
}

initFlaggedProjects();
