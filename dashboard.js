// dashboard.js
// Renders the Dashboard page: KPIs + charts + a projects table, all driven
// by the filter bar (Territory / Service Type / Status).

const TERRITORY_COLORS = [
  "#005198", "#D98E3D", "#4B7A52", "#8B5FBF", "#C0555A",
  "#4A9BA8", "#B08642", "#6B7A99", "#7A9B4E", "#A8617D",
];

function territoryColor(index) {
  return TERRITORY_COLORS[index % TERRITORY_COLORS.length];
}

let allIssues = [];
let territoryChartInstance = null;
let statusChartInstance = null;
let tierChartInstance = null;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

let selectedYear = "2026";
let selectedMonths = new Set(); // "01".."12"
let selectedTier = "";
let selectedTerritories = new Set();
let dueSoonUrgencyFilter = "";

async function initDashboardPage() {
  let data;
  try {
    data = await loadDashboardData();
  } catch (err) {
    document.getElementById("sync-text").textContent = "Could not load data.";
    console.error(err);
    return;
  }

  renderSyncStatus(data);
  allIssues = flattenIssues(data);

  populateFilters(allIssues);
  document.getElementById("year-select").value = selectedYear;
  updateDueDateSummary();
  renderAll();
  renderDueSoonSection();

  document.querySelectorAll("#due-soon-chips .rm-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#due-soon-chips .rm-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      dueSoonUrgencyFilter = chip.dataset.urgency;
      renderDueSoonSection();
    });
  });

  document.getElementById("service-filter").addEventListener("change", renderAll);
  document.getElementById("status-filter").addEventListener("change", renderAll);

  document.getElementById("due-date-apply").addEventListener("click", () => {
    selectedYear = document.getElementById("year-select").value;
    selectedMonths = new Set(
      Array.from(document.querySelectorAll("#month-checkboxes input:checked")).map(
        (el) => el.value
      )
    );
    updateDueDateSummary();
    document.getElementById("due-date-details").open = false;
    renderAll();
  });

  document.getElementById("due-date-clear").addEventListener("click", () => {
    document.getElementById("year-select").value = "";
    document.querySelectorAll("#month-checkboxes input").forEach((el) => (el.checked = false));
    selectedYear = "";
    selectedMonths = new Set();
    updateDueDateSummary();
    document.getElementById("due-date-details").open = false;
    renderAll();
  });

  document.getElementById("territory-apply").addEventListener("click", () => {
    selectedTerritories = new Set(
      Array.from(document.querySelectorAll("#territory-checkboxes input:checked")).map((el) => el.value)
    );
    updateTerritorySummary();
    document.getElementById("territory-details").open = false;
    renderAll();
  });

  document.getElementById("territory-clear").addEventListener("click", () => {
    document.querySelectorAll("#territory-checkboxes input").forEach((el) => (el.checked = false));
    selectedTerritories = new Set();
    updateTerritorySummary();
    document.getElementById("territory-details").open = false;
    renderAll();
  });

  document.querySelectorAll("#tier-chips .rm-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedTier = chip.dataset.tier;
      document.querySelectorAll("#tier-chips .rm-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderAll();
    });
  });

  document.getElementById("clear-filters").addEventListener("click", () => {
    document.querySelectorAll("#territory-checkboxes input").forEach((el) => (el.checked = false));
    selectedTerritories = new Set();
    updateTerritorySummary();
    document.getElementById("service-filter").value = "";
    document.getElementById("status-filter").value = "";
    document.getElementById("year-select").value = "";
    document.querySelectorAll("#month-checkboxes input").forEach((el) => (el.checked = false));
    selectedYear = "";
    selectedMonths = new Set();
    selectedTier = "";
    document.querySelectorAll("#tier-chips .rm-chip").forEach((c) => c.classList.remove("active"));
    document.querySelector('#tier-chips .rm-chip[data-tier=""]').classList.add("active");
    updateDueDateSummary();
    renderAll();
  });

  document.addEventListener("click", (e) => {
    ["due-date-details", "territory-details"].forEach((id) => {
      const details = document.getElementById(id);
      if (details.open && !details.contains(e.target)) details.open = false;
    });
  });
}

function updateDueDateSummary() {
  const summary = document.getElementById("due-date-summary");
  const parts = [];
  if (selectedYear) parts.push(selectedYear);
  if (selectedMonths.size > 0) {
    const names = Array.from(selectedMonths)
      .sort()
      .map((m) => MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3));
    parts.push(names.join(", "));
  }
  summary.textContent = parts.length > 0 ? parts.join(" \u00b7 ") : "All";
}

function updateTerritorySummary() {
  const summary = document.getElementById("territory-summary");
  if (selectedTerritories.size === 0) {
    summary.textContent = "All";
  } else if (selectedTerritories.size <= 2) {
    summary.textContent = Array.from(selectedTerritories).sort().join(", ");
  } else {
    summary.textContent = `${selectedTerritories.size} selected`;
  }
}

function populateFilters(issues) {
  const territories = new Set();
  const services = new Set();
  for (const issue of issues) {
    territories.add(issue.territory || "Unassigned");
    if (issue.serviceType) services.add(issue.serviceType);
  }

  const territoryContainer = document.getElementById("territory-checkboxes");
  territoryContainer.innerHTML = Array.from(territories)
    .sort()
    .map((t) => `<label><input type="checkbox" value="${escapeHtml(t)}" />${escapeHtml(t)}</label>`)
    .join("");

  const serviceSelect = document.getElementById("service-filter");
  for (const s of Array.from(services).sort()) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    serviceSelect.appendChild(opt);
  }

  const years = new Set();
  for (const issue of issues) {
    if (issue.dueDate) years.add(issue.dueDate.slice(0, 4));
  }
  const yearSelect = document.getElementById("year-select");
  for (const y of Array.from(years).sort()) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearSelect.appendChild(opt);
  }

  const monthContainer = document.getElementById("month-checkboxes");
  monthContainer.innerHTML = MONTH_NAMES.map((name, i) => {
    const value = String(i + 1).padStart(2, "0");
    return `<label><input type="checkbox" value="${value}" />${name.slice(0, 3)}</label>`;
  }).join("");
}

function getFilteredIssues() {
  const service = document.getElementById("service-filter").value;
  const status = document.getElementById("status-filter").value;

  return allIssues.filter((issue) => {
    if (selectedTerritories.size > 0 && !selectedTerritories.has(issue.territory || "Unassigned")) return false;
    if (service && issue.serviceType !== service) return false;
    if (status && issue.statusCategory !== status) return false;
    if (selectedTier && priceTier(issue.price) !== selectedTier) return false;
    if (selectedYear || selectedMonths.size > 0) {
      if (!issue.dueDate) return false;
      const y = issue.dueDate.slice(0, 4);
      const m = issue.dueDate.slice(5, 7);
      if (selectedYear && y !== selectedYear) return false;
      if (selectedMonths.size > 0 && !selectedMonths.has(m)) return false;
    }
    return true;
  });
}

function renderAll() {
  const issues = getFilteredIssues();
  renderKpis(issues);
  renderTerritoryChart(issues);
  renderStatusChart(issues);
  renderTierChart(issues);
  renderTerritoryBreakdown(issues);
  renderProjectsTable(issues);
}

function groupByTerritory(issues) {
  const groups = {};
  for (const issue of issues) {
    const key = issue.territory || "Unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(issue);
  }
  return groups;
}

function formatCurrency(amount) {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function renderKpis(issues) {
  const total = issues.length;
  const inProgress = issues.filter((i) => i.statusCategory === "In Progress").length;
  const territories = new Set(issues.map((i) => i.territory || "Unassigned")).size;
  const revenue = issues.reduce((sum, i) => sum + (i.price || 0), 0);
  const totalSqft = Math.round(issues.reduce((sum, i) => sum + (i.squareFootage || 0), 0));

  const withDeliveryStatus = issues.filter((i) => i.deliveryStatus);
  const onTime = withDeliveryStatus.filter((i) => i.deliveryStatus === "On time").length;
  const late = withDeliveryStatus.filter((i) => i.deliveryStatus === "Late").length;
  const deliveryTotal = withDeliveryStatus.length;
  const onTimePct = deliveryTotal > 0 ? Math.round((onTime / deliveryTotal) * 100) : null;
  const latePct = deliveryTotal > 0 ? Math.round((late / deliveryTotal) * 100) : null;

  const kpis = [
    { label: "Total Tickets", value: total.toLocaleString("en-US") },
    { label: "Territories", value: territories.toLocaleString("en-US") },
    { label: "In Progress", value: inProgress.toLocaleString("en-US") },
    { label: "Total Revenue", value: formatCurrency(revenue) },
    { label: "Total Square Footage", value: totalSqft.toLocaleString("en-US") },
    {
      label: "% Delivered On Time",
      value: onTimePct !== null ? `${onTimePct}%` : "\u2014",
      sub: deliveryTotal > 0 ? `${onTime} of ${deliveryTotal}` : null,
    },
    {
      label: "% Late",
      value: latePct !== null ? `${latePct}%` : "\u2014",
      sub: deliveryTotal > 0 ? `${late} of ${deliveryTotal}` : null,
    },
  ];

  const grid = document.getElementById("kpi-grid");
  grid.innerHTML = kpis
    .map(
      (k) => `
      <div class="kpi-card">
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-label">${k.label}</div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ""}
      </div>`
    )
    .join("");
}

function renderTerritoryChart(issues) {
  const groups = groupByTerritory(issues);
  const entries = Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  if (territoryChartInstance) territoryChartInstance.destroy();
  const ctx = document.getElementById("territory-chart");
  territoryChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: entries.map(([territory]) => territory),
      datasets: [
        {
          label: "Tickets",
          data: entries.map(([, list]) => list.length),
          backgroundColor: entries.map((_, i) => territoryColor(i)),
          borderRadius: 4,
          maxBarThickness: 48,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Tickets: ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#DBDBDD" } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderStatusChart(issues) {
  const counts = { "To Do": 0, "In Progress": 0, Done: 0 };
  for (const issue of issues) {
    if (counts[issue.statusCategory] !== undefined) counts[issue.statusCategory] += 1;
  }

  if (statusChartInstance) statusChartInstance.destroy();
  const ctx = document.getElementById("status-chart");
  statusChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["To Do", "In Progress", "Done"],
      datasets: [
        {
          data: [counts["To Do"], counts["In Progress"], counts["Done"]],
          backgroundColor: ["#51565C", "#D98E3D", "#4B7A52"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { family: "Inter" } } },
      },
    },
  });
}

function renderTierChart(issues) {
  const byTerritory = {};
  for (const issue of issues) {
    const territory = issue.territory || "Unassigned";
    const tier = priceTier(issue.price);
    if (!byTerritory[territory]) byTerritory[territory] = { A: 0, B: 0, C: 0 };
    if (tier) byTerritory[territory][tier] += 1;
  }
  const entries = Object.entries(byTerritory)
    .sort((a, b) => b[1].A + b[1].B + b[1].C - (a[1].A + a[1].B + a[1].C))
    .slice(0, 12);

  if (tierChartInstance) tierChartInstance.destroy();
  const ctx = document.getElementById("tier-chart");
  tierChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: entries.map(([t]) => t),
      datasets: [
        { label: "Tier A", data: entries.map(([, v]) => v.A), backgroundColor: "#4B7A52", stack: "s" },
        { label: "Tier B", data: entries.map(([, v]) => v.B), backgroundColor: "#D98E3D", stack: "s" },
        { label: "Tier C", data: entries.map(([, v]) => v.C), backgroundColor: "#005198", stack: "s" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { family: "Inter" } } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#DBDBDD" } },
      },
    },
  });
}

function renderTerritoryBreakdown(issues) {
  const groups = groupByTerritory(issues);
  const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  const container = document.getElementById("territory-breakdown");
  if (entries.length === 0) {
    container.innerHTML = `<p class="empty-state">No issues match these filters.</p>`;
    return;
  }

  container.innerHTML = entries
    .map(([territory, list]) => {
      const total = Math.max(list.length, 1);
      const todo = list.filter((i) => i.statusCategory === "To Do").length;
      const inProgress = list.filter((i) => i.statusCategory === "In Progress").length;
      const done = list.filter((i) => i.statusCategory === "Done").length;
      const revenue = list.reduce((sum, i) => sum + (i.price || 0), 0);

      return `
        <div class="territory-row">
          <div class="territory-row-head">
            <span class="territory-name">${escapeHtml(territory)}</span>
            <span class="territory-total">${list.length} ticket${list.length === 1 ? "" : "s"} \u00b7 ${formatCurrency(revenue)}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-seg-todo" style="width:${(todo / total) * 100}%"></div>
            <div class="progress-seg-progress" style="width:${(inProgress / total) * 100}%"></div>
            <div class="progress-seg-done" style="width:${(done / total) * 100}%"></div>
          </div>
          <div class="progress-legend">
            <span class="legend-todo">${todo} To Do</span>
            <span class="legend-progress">${inProgress} In Progress</span>
            <span class="legend-done">${done} Done</span>
          </div>
        </div>`;
    })
    .join("");
}

function renderProjectsTable(issues) {
  const body = document.getElementById("projects-body");
  const emptyState = document.getElementById("projects-empty-state");

  const sorted = [...issues].sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  body.innerHTML = "";
  emptyState.hidden = sorted.length > 0;

  for (const issue of sorted.slice(0, 200)) {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.innerHTML = `
      <td class="col-key">${issue.key}</td>
      <td class="col-updated">${escapeHtml(issue.projectId || "\u2014")}</td>
      <td>${escapeHtml(issue.projectName)}</td>
      <td>${escapeHtml(issue.serviceType || issue.type || "\u2014")}</td>
      <td>${issue.price != null ? formatCurrency(issue.price) : "\u2014"}</td>
      <td><span class="status-pill ${statusPillClass(issue.statusCategory)}">${issue.statusCategory}</span></td>
      <td>${escapeHtml(issue.territory || "Unassigned")}</td>
      <td class="col-updated">${formatDate(issue.dueDate)}</td>
    `;
    tr.addEventListener("click", () => openProjectModal(issue));
    body.appendChild(tr);
  }
}

// ===== In Progress: Due Soon & Overdue (proactive alert section) =====
// Deliberately independent of the filter bar above -- always shows the
// true current picture of every In Progress ticket's due date, so it
// can't accidentally get hidden by someone else's filter choice.
function dueSoonDaysLeft(dueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  return Math.round((due - today) / 86400000);
}
function dueSoonUrgency(daysLeft) {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "urgent";
  if (daysLeft <= 21) return "soon";
  return "ok";
}
function dueSoonLabel(daysLeft) {
  if (daysLeft < 0) return `Overdue by ${Math.abs(daysLeft)}d`;
  if (daysLeft === 0) return "Due today";
  return `${daysLeft}d left`;
}

// Original Due Date is the field we calculate against here (it's the one
// the team actually tracks delays/urgency against); falls back to the
// native Due Date for tickets where it hasn't been set.
function dueSoonEffectiveDate(issue) {
  return issue.originalDueDate || issue.dueDate;
}

function renderDueSoonSection() {
  const inProgress = allIssues.filter((i) => i.statusCategory === "In Progress" && dueSoonEffectiveDate(i));
  const withUrgency = inProgress.map((i) => ({ issue: i, daysLeft: dueSoonDaysLeft(dueSoonEffectiveDate(i)) }));
  const overdueCount = withUrgency.filter((r) => r.daysLeft < 0).length;

  const banner = document.getElementById("overdue-alert-banner");
  if (overdueCount > 0) {
    banner.style.display = "flex";
    banner.innerHTML = `&#9888; ${overdueCount} In Progress project${overdueCount === 1 ? "" : "s"} ${overdueCount === 1 ? "is" : "are"} past its due date \u2014 action needed.`;
  } else {
    banner.style.display = "none";
  }

  let rows = withUrgency;
  if (dueSoonUrgencyFilter) rows = rows.filter((r) => dueSoonUrgency(r.daysLeft) === dueSoonUrgencyFilter);
  rows.sort((a, b) => a.daysLeft - b.daysLeft);

  const countEl = document.getElementById("due-soon-count");
  if (countEl) countEl.textContent = `(${rows.length} of ${inProgress.length})`;

  const container = document.getElementById("due-soon-list");
  if (rows.length === 0) {
    container.innerHTML = `<p class="empty-state">No In Progress tickets match this filter.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Key</th><th>Project ID</th><th>Project Name</th><th>Territory</th><th>Components</th><th>Original Due Date</th><th></th></tr>
        </thead>
        <tbody>
          ${rows
            .slice(0, 300)
            .map(({ issue, daysLeft }) => {
              const u = dueSoonUrgency(daysLeft);
              const components = issue.components && issue.components.length ? issue.components.join(", ") : "\u2014";
              return `<tr class="clickable-row" data-key="${issue.key}">
                <td class="col-key">${issue.key}</td>
                <td class="col-updated">${escapeHtml(issue.projectId || "\u2014")}</td>
                <td>${escapeHtml(issue.projectName)}</td>
                <td>${escapeHtml(issue.territory || "Unassigned")}</td>
                <td>${escapeHtml(components)}</td>
                <td class="col-updated">${formatDate(dueSoonEffectiveDate(issue))}</td>
                <td><span class="daysbadge-${u}">${dueSoonLabel(daysLeft)}</span></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-key]").forEach((row) => {
    const issue = allIssues.find((i) => i.key === row.dataset.key);
    if (issue) row.addEventListener("click", () => openProjectModal(issue));
  });
}

initDashboardPage();
