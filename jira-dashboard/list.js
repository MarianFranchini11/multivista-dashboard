// list.js
// Renders the Issues List page: a filterable table of every Jira issue.

let allData = null;
let activeProjectKey = null;
let selectedTerritoriesTickets = new Set();

async function initListPage() {
  try {
    allData = await loadDashboardData();
  } catch (err) {
    document.getElementById("sync-text").textContent = "Could not load data.";
    console.error(err);
    return;
  }

  renderSyncStatus(allData);
  renderProjectFilter();
  renderTerritoryFilter();
  renderServiceFilter();

  const urlTerritory = new URLSearchParams(window.location.search).get("territory");
  if (urlTerritory) {
    selectedTerritoriesTickets = new Set([urlTerritory]);
    const cb = document.querySelector(`#territory-checkboxes input[value="${CSS.escape(urlTerritory)}"]`);
    if (cb) cb.checked = true;
    updateTicketsTerritorySummary();
  }

  renderTable();

  document.getElementById("project-filter").addEventListener("change", () => {
    activeProjectKey = document.getElementById("project-filter").value || null;
    renderTable();
  });
  document.getElementById("status-filter").addEventListener("change", renderTable);
  document.getElementById("service-filter").addEventListener("change", renderTable);
  document.getElementById("search-filter").addEventListener("input", renderTable);

  document.getElementById("territory-apply").addEventListener("click", () => {
    selectedTerritoriesTickets = new Set(
      Array.from(document.querySelectorAll("#territory-checkboxes input:checked")).map((el) => el.value)
    );
    updateTicketsTerritorySummary();
    document.getElementById("territory-details").open = false;
    renderTable();
  });
  document.getElementById("territory-clear").addEventListener("click", () => {
    document.querySelectorAll("#territory-checkboxes input").forEach((el) => (el.checked = false));
    selectedTerritoriesTickets = new Set();
    updateTicketsTerritorySummary();
    document.getElementById("territory-details").open = false;
    renderTable();
  });
  document.addEventListener("click", (e) => {
    const details = document.getElementById("territory-details");
    if (details.open && !details.contains(e.target)) details.open = false;
  });
}

function updateTicketsTerritorySummary() {
  const summary = document.getElementById("territory-summary");
  if (selectedTerritoriesTickets.size === 0) {
    summary.textContent = "All";
  } else if (selectedTerritoriesTickets.size <= 2) {
    summary.textContent = Array.from(selectedTerritoriesTickets).sort().join(", ");
  } else {
    summary.textContent = `${selectedTerritoriesTickets.size} selected`;
  }
}

function renderProjectFilter() {
  const select = document.getElementById("project-filter");
  for (const project of allData.projects) {
    const opt = document.createElement("option");
    opt.value = project.key;
    opt.textContent = `${project.key} \u2014 ${project.name}`;
    select.appendChild(opt);
  }
}

function renderTerritoryFilter() {
  const container = document.getElementById("territory-checkboxes");
  const territories = new Set();
  for (const project of allData.projects) {
    for (const issue of project.issues) {
      territories.add(issue.territory || "Unassigned");
    }
  }
  container.innerHTML = Array.from(territories)
    .sort()
    .map((t) => `<label><input type="checkbox" value="${escapeHtml(t)}" />${escapeHtml(t)}</label>`)
    .join("");
}

function renderServiceFilter() {
  const select = document.getElementById("service-filter");
  const services = new Set();
  for (const project of allData.projects) {
    for (const issue of project.issues) {
      if (issue.serviceType) services.add(issue.serviceType);
    }
  }
  for (const s of Array.from(services).sort()) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  }
}

function statusLabel(statusCategory, originalStatus) {
  const map = { "To Do": "To Do", "In Progress": "In Progress", Done: "Done" };
  return map[statusCategory] || originalStatus;
}

function renderTable() {
  const body = document.getElementById("issues-body");
  const emptyState = document.getElementById("empty-state");
  const statusFilter = document.getElementById("status-filter").value;
  const serviceFilter = document.getElementById("service-filter").value;
  const searchTerm = document.getElementById("search-filter").value.trim().toLowerCase();

  let issues = [];
  for (const project of allData.projects) {
    if (activeProjectKey && project.key !== activeProjectKey) continue;
    issues.push(...project.issues);
  }

  if (statusFilter) issues = issues.filter((i) => i.statusCategory === statusFilter);
  if (selectedTerritoriesTickets.size > 0) {
    issues = issues.filter((i) => selectedTerritoriesTickets.has(i.territory || "Unassigned"));
  }
  if (serviceFilter) issues = issues.filter((i) => i.serviceType === serviceFilter);
  if (searchTerm) {
    issues = issues.filter(
      (i) =>
        i.key.toLowerCase().includes(searchTerm) ||
        (i.projectId || "").toLowerCase().includes(searchTerm) ||
        (i.summary || "").toLowerCase().includes(searchTerm)
    );
  }

  issues.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  body.innerHTML = "";
  emptyState.hidden = issues.length > 0;

  for (const issue of issues.slice(0, 1000)) {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.innerHTML = `
      <td class="col-key">${issue.key}</td>
      <td class="col-updated">${escapeHtml(issue.projectId || "\u2014")}</td>
      <td>${escapeHtml(issue.summary)}</td>
      <td><span class="status-pill ${statusPillClass(issue.statusCategory)}">${statusLabel(issue.statusCategory, issue.status)}</span></td>
      <td>${escapeHtml(issue.priority || "\u2014")}</td>
      <td>${escapeHtml(issue.assignee || "Unassigned")}</td>
      <td>${escapeHtml(issue.territory || "\u2014")}</td>
      <td>${escapeHtml(issue.serviceType || "\u2014")}</td>
      <td class="col-updated">${formatDate(issue.dueDate)}</td>
    `;
    tr.addEventListener("click", () => openProjectModal(issue));
    body.appendChild(tr);
  }
}

initListPage();
