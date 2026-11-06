// laser-support.js
// Summary of tickets flagged with the "Point Cloud Orientation Issue" or
// "Registration Error" components.

const TARGET_COMPONENTS = ["Point Cloud Orientation Issue", "Registration Error"];
const MIN_TICKETS_FOR_RATE = 10;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

let allLaserIssues = [];
let allIssuesFull = [];
let registrationRateChart = null;
let orientationRateChart = null;
let laserSelectedYear = "";
let laserSelectedMonths = new Set();

async function initLaserSupportPage() {
  let data;
  try {
    data = await loadDashboardData();
  } catch (err) {
    document.getElementById("sync-text").textContent = "Could not load data.";
    console.error(err);
    return;
  }

  renderSyncStatus(data);

  allIssuesFull = flattenIssues(data);
  allLaserIssues = allIssuesFull.filter(
    (issue) =>
      issue.components &&
      issue.components.some((c) => TARGET_COMPONENTS.includes(c))
  );

  populateLaserFilters(allLaserIssues);
  renderLaserAll();

  document.getElementById("filter-orientation").addEventListener("change", renderLaserAll);
  document.getElementById("filter-registration").addEventListener("change", renderLaserAll);
  document.getElementById("laser-territory-filter").addEventListener("change", renderLaserAll);
  document.getElementById("laser-status-filter").addEventListener("change", renderLaserAll);
  document.getElementById("laser-search").addEventListener("input", renderLaserAll);

  document.getElementById("due-date-apply").addEventListener("click", () => {
    laserSelectedYear = document.getElementById("year-select").value;
    laserSelectedMonths = new Set(
      Array.from(document.querySelectorAll(".month-checkbox-grid input:checked")).map((el) => el.value)
    );
    updateLaserDueDateSummary();
    document.getElementById("due-date-details").open = false;
    renderLaserAll();
  });

  document.getElementById("due-date-clear").addEventListener("click", () => {
    document.getElementById("year-select").value = "";
    document.querySelectorAll(".month-checkbox-grid input").forEach((el) => (el.checked = false));
    laserSelectedYear = "";
    laserSelectedMonths = new Set();
    updateLaserDueDateSummary();
    document.getElementById("due-date-details").open = false;
    renderLaserAll();
  });

  document.addEventListener("click", (e) => {
    const details = document.getElementById("due-date-details");
    if (details.open && !details.contains(e.target)) details.open = false;
  });
}

function updateLaserDueDateSummary() {
  const summary = document.getElementById("due-date-summary");
  const parts = [];
  if (laserSelectedYear) parts.push(laserSelectedYear);
  if (laserSelectedMonths.size > 0) {
    const names = Array.from(laserSelectedMonths)
      .sort()
      .map((m) => MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3));
    parts.push(names.join(", "));
  }
  summary.textContent = parts.length > 0 ? parts.join(" \u00b7 ") : "All";
}

function populateLaserFilters(issues) {
  const territories = new Set();
  for (const issue of issues) {
    territories.add(issue.territory || "Unassigned");
  }
  const select = document.getElementById("laser-territory-filter");
  for (const t of Array.from(territories).sort()) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  }

  const years = new Set();
  for (const issue of allIssuesFull) {
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

function getFilteredLaserIssues() {
  const wantOrientation = document.getElementById("filter-orientation").checked;
  const wantRegistration = document.getElementById("filter-registration").checked;
  const territory = document.getElementById("laser-territory-filter").value;
  const status = document.getElementById("laser-status-filter").value;
  const search = document.getElementById("laser-search").value.trim().toLowerCase();

  return allLaserIssues.filter((issue) => {
    const hasOrientation = issue.components.includes("Point Cloud Orientation Issue");
    const hasRegistration = issue.components.includes("Registration Error");
    const matchesComponent =
      (wantOrientation && hasOrientation) || (wantRegistration && hasRegistration);
    if (!matchesComponent) return false;
    if (territory && (issue.territory || "Unassigned") !== territory) return false;
    if (status && issue.statusCategory !== status) return false;
    if (search) {
      const matchesSearch =
        issue.key.toLowerCase().includes(search) ||
        (issue.projectId || "").toLowerCase().includes(search) ||
        (issue.projectName || "").toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }
    if (laserSelectedYear || laserSelectedMonths.size > 0) {
      if (!issue.dueDate) return false;
      const y = issue.dueDate.slice(0, 4);
      const m = issue.dueDate.slice(5, 7);
      if (laserSelectedYear && y !== laserSelectedYear) return false;
      if (laserSelectedMonths.size > 0 && !laserSelectedMonths.has(m)) return false;
    }
    return true;
  });
}

function formatCurrencyLaser(amount) {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function renderLaserAll() {
  const issues = getFilteredLaserIssues();
  renderLaserKpis(issues);
  renderLaserTable(issues);
  renderRateCharts();
}

// Rate-by-territory charts use the FULL ticket set (respecting only the
// Status filter, not the territory filter or the component checkboxes --
// the point is to compare territories against each other).
function computeRateByTerritory(componentName) {
  const status = document.getElementById("laser-status-filter").value;
  const base = status
    ? allIssuesFull.filter((i) => i.statusCategory === status)
    : allIssuesFull;

  const totals = {};
  const flagged = {};
  for (const issue of base) {
    const territory = issue.territory || "Unassigned";
    totals[territory] = (totals[territory] || 0) + 1;
    if (issue.components && issue.components.includes(componentName)) {
      flagged[territory] = (flagged[territory] || 0) + 1;
    }
  }

  return Object.entries(totals)
    .filter(([, total]) => total >= MIN_TICKETS_FOR_RATE)
    .map(([territory, total]) => ({
      territory,
      total,
      flagged: flagged[territory] || 0,
      pct: ((flagged[territory] || 0) / total) * 100,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);
}

function renderRateChart(canvasId, chartInstance, rows, color) {
  const ctx = document.getElementById(canvasId);
  if (chartInstance) chartInstance.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.territory),
      datasets: [
        {
          label: "% of tickets",
          data: rows.map((r) => r.pct),
          backgroundColor: color,
          borderRadius: 4,
          maxBarThickness: 40,
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
            label: (ctx) => {
              const row = rows[ctx.dataIndex];
              return `${row.pct.toFixed(1)}% (${row.flagged} of ${row.total} tickets)`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => `${v}%` },
          grid: { color: "#DBDBDD" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderRateCharts() {
  const registrationRows = computeRateByTerritory("Registration Error");
  const orientationRows = computeRateByTerritory("Point Cloud Orientation Issue");
  registrationRateChart = renderRateChart(
    "registration-rate-chart",
    registrationRateChart,
    registrationRows,
    "#005198"
  );
  orientationRateChart = renderRateChart(
    "orientation-rate-chart",
    orientationRateChart,
    orientationRows,
    "#D98E3D"
  );
}

function renderLaserKpis(issues) {
  const total = issues.length;
  const orientationCount = issues.filter((i) =>
    i.components.includes("Point Cloud Orientation Issue")
  ).length;
  const registrationCount = issues.filter((i) =>
    i.components.includes("Registration Error")
  ).length;
  const revenue = issues.reduce((sum, i) => sum + (i.price || 0), 0);

  const kpis = [
    { label: "Total Flagged Tickets", value: total.toLocaleString("en-US") },
    { label: "Point Cloud Orientation Issue", value: orientationCount.toLocaleString("en-US") },
    { label: "Registration Error", value: registrationCount.toLocaleString("en-US") },
    { label: "Total Revenue Affected", value: formatCurrencyLaser(revenue) },
  ];

  const grid = document.getElementById("kpi-grid");
  grid.innerHTML = kpis
    .map(
      (k) => `
      <div class="kpi-card">
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-label">${k.label}</div>
      </div>`
    )
    .join("");
}

function renderLaserTable(issues) {
  const body = document.getElementById("laser-body");
  const emptyState = document.getElementById("laser-empty-state");

  const sorted = [...issues].sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  body.innerHTML = "";
  emptyState.hidden = sorted.length > 0;

  for (const issue of sorted.slice(0, 500)) {
    const relevantComponents = issue.components.filter((c) => TARGET_COMPONENTS.includes(c));
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.innerHTML = `
      <td class="col-key">${issue.key}</td>
      <td class="col-updated">${escapeHtml(issue.projectId || "\u2014")}</td>
      <td>${escapeHtml(issue.projectName)}</td>
      <td>${escapeHtml(relevantComponents.join(", "))}</td>
      <td><span class="status-pill ${statusPillClass(issue.statusCategory)}">${issue.statusCategory}</span></td>
      <td>${escapeHtml(issue.territory || "Unassigned")}</td>
      <td>${issue.price != null ? formatCurrencyLaser(issue.price) : "\u2014"}</td>
      <td class="col-updated">${formatDate(issue.dueDate)}</td>
    `;
    tr.addEventListener("click", () => openProjectModal(issue));
    body.appendChild(tr);
  }
}

initLaserSupportPage();
