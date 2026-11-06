// scan2serv-pipeline.js
// Scan2Serv Pipeline page: Salesforce quote pipeline for Scan2Serv,
// ported from a live Claude Dashboard artifact (per-opportunity best-quote,
// probability-weighted value, currency conversion -- same logic, pre-computed
// server-side into data/salesforce-data.json).

let S2S_ROWS = [];
let selectedFranchises = new Set();
let selectedOwners = new Set();
let selectedStatuses = new Set();
let selectedStage = "";
let sortKey = "usd";
let sortDir = "desc";

let monthChart, statusChart, franchiseChart, topChart;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const data = await loadSalesforceData();
    S2S_ROWS = data.rows || [];
    renderSyncStatus(data);
    const seedDateEl = document.getElementById("s2s-seed-date");
    if (seedDateEl && data.generatedAt) {
      seedDateEl.textContent = new Date(data.generatedAt).toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
    populateS2SFilters(S2S_ROWS);
    wireS2SControls();
    renderAll();
  } catch (err) {
    console.error("Failed to load Salesforce pipeline data:", err);
    const body = document.getElementById("s2s-body");
    if (body) {
      body.innerHTML = `<tr><td colspan="11" class="empty-state">Could not load Salesforce pipeline data.</td></tr>`;
    }
  }
}

function populateS2SFilters(rows) {
  const franchises = new Set();
  const owners = new Set();
  const statuses = new Set();
  for (const r of rows) {
    if (r.franchise) franchises.add(r.franchise);
    if (r.owner) owners.add(r.owner);
    if (r.status) statuses.add(r.status);
  }

  document.getElementById("s2s-franchise-checkboxes").innerHTML = Array.from(franchises)
    .sort()
    .map((f) => `<label><input type="checkbox" value="${escapeHtml(f)}" />${escapeHtml(f)}</label>`)
    .join("");

  document.getElementById("s2s-owner-checkboxes").innerHTML = Array.from(owners)
    .sort()
    .map((o) => `<label><input type="checkbox" value="${escapeHtml(o)}" />${escapeHtml(o)}</label>`)
    .join("");

  // Fixed, known order for quote status rather than alpha
  const statusOrder = ["Approved", "Submitted for Approval", "Draft"];
  document.getElementById("s2s-status-checkboxes").innerHTML = statusOrder
    .filter((s) => statuses.has(s))
    .map((s) => `<label><input type="checkbox" value="${escapeHtml(s)}" />${escapeHtml(s)}</label>`)
    .join("");
}

function wireS2SControls() {
  document.getElementById("s2s-search").addEventListener("input", renderAll);
  document.getElementById("s2s-min-value").addEventListener("input", renderAll);
  document.getElementById("s2s-max-value").addEventListener("input", renderAll);
  document.getElementById("s2s-close-from").addEventListener("change", renderAll);
  document.getElementById("s2s-close-to").addEventListener("change", renderAll);
  document.getElementById("s2s-hide-overdue").addEventListener("change", renderAll);
  document.getElementById("s2s-weight-prob").addEventListener("change", renderAll);

  document.getElementById("s2s-franchise-apply").addEventListener("click", () => {
    selectedFranchises = new Set(
      Array.from(document.querySelectorAll("#s2s-franchise-checkboxes input:checked")).map((el) => el.value)
    );
    updateChipSummary("s2s-franchise-summary", selectedFranchises);
    document.getElementById("s2s-franchise-details").open = false;
    renderAll();
  });
  document.getElementById("s2s-franchise-clear").addEventListener("click", () => {
    document.querySelectorAll("#s2s-franchise-checkboxes input").forEach((el) => (el.checked = false));
    selectedFranchises = new Set();
    updateChipSummary("s2s-franchise-summary", selectedFranchises);
    document.getElementById("s2s-franchise-details").open = false;
    renderAll();
  });

  document.getElementById("s2s-owner-apply").addEventListener("click", () => {
    selectedOwners = new Set(
      Array.from(document.querySelectorAll("#s2s-owner-checkboxes input:checked")).map((el) => el.value)
    );
    updateChipSummary("s2s-owner-summary", selectedOwners);
    document.getElementById("s2s-owner-details").open = false;
    renderAll();
  });
  document.getElementById("s2s-owner-clear").addEventListener("click", () => {
    document.querySelectorAll("#s2s-owner-checkboxes input").forEach((el) => (el.checked = false));
    selectedOwners = new Set();
    updateChipSummary("s2s-owner-summary", selectedOwners);
    document.getElementById("s2s-owner-details").open = false;
    renderAll();
  });

  document.getElementById("s2s-status-apply").addEventListener("click", () => {
    selectedStatuses = new Set(
      Array.from(document.querySelectorAll("#s2s-status-checkboxes input:checked")).map((el) => el.value)
    );
    updateChipSummary("s2s-status-summary", selectedStatuses);
    document.getElementById("s2s-status-details").open = false;
    renderAll();
  });
  document.getElementById("s2s-status-clear").addEventListener("click", () => {
    document.querySelectorAll("#s2s-status-checkboxes input").forEach((el) => (el.checked = false));
    selectedStatuses = new Set();
    updateChipSummary("s2s-status-summary", selectedStatuses);
    document.getElementById("s2s-status-details").open = false;
    renderAll();
  });

  document.querySelectorAll("#s2s-stage-chips .rm-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedStage = chip.dataset.stage;
      document.querySelectorAll("#s2s-stage-chips .rm-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderAll();
    });
  });

  document.getElementById("s2s-clear-filters").addEventListener("click", () => {
    document.getElementById("s2s-search").value = "";
    document.getElementById("s2s-min-value").value = "";
    document.getElementById("s2s-max-value").value = "";
    document.getElementById("s2s-close-from").value = "";
    document.getElementById("s2s-close-to").value = "";
    document.getElementById("s2s-hide-overdue").checked = false;
    document.getElementById("s2s-weight-prob").checked = false;
    document.querySelectorAll("#s2s-franchise-checkboxes input, #s2s-owner-checkboxes input, #s2s-status-checkboxes input").forEach(
      (el) => (el.checked = false)
    );
    selectedFranchises = new Set();
    selectedOwners = new Set();
    selectedStatuses = new Set();
    selectedStage = "";
    document.querySelectorAll("#s2s-stage-chips .rm-chip").forEach((c) => c.classList.remove("active"));
    document.querySelector('#s2s-stage-chips .rm-chip[data-stage=""]').classList.add("active");
    updateChipSummary("s2s-franchise-summary", selectedFranchises);
    updateChipSummary("s2s-owner-summary", selectedOwners);
    updateChipSummary("s2s-status-summary", selectedStatuses);
    renderAll();
  });

  document.addEventListener("click", (e) => {
    ["s2s-franchise-details", "s2s-owner-details", "s2s-status-details"].forEach((id) => {
      const details = document.getElementById(id);
      if (details && details.open && !details.contains(e.target)) details.open = false;
    });
  });

  document.querySelectorAll("#s2s-table thead th[data-sort]").forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = key === "opp" || key === "account" || key === "owner" || key === "franchise" || key === "stage" ? "asc" : "desc";
      }
      renderAll();
    });
  });
}

function updateChipSummary(elId, selectedSet) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (selectedSet.size === 0) el.textContent = "All";
  else if (selectedSet.size <= 2) el.textContent = Array.from(selectedSet).sort().join(", ");
  else el.textContent = `${selectedSet.size} selected`;
}

function getFilteredRows() {
  const search = document.getElementById("s2s-search").value.trim().toLowerCase();
  const minValue = parseFloat(document.getElementById("s2s-min-value").value);
  const maxValue = parseFloat(document.getElementById("s2s-max-value").value);
  const closeFrom = document.getElementById("s2s-close-from").value;
  const closeTo = document.getElementById("s2s-close-to").value;
  const hideOverdue = document.getElementById("s2s-hide-overdue").checked;
  const today = new Date().toISOString().slice(0, 10);

  return S2S_ROWS.filter((r) => {
    if (selectedStage && r.stage !== selectedStage) return false;
    if (selectedFranchises.size > 0 && !selectedFranchises.has(r.franchise)) return false;
    if (selectedOwners.size > 0 && !selectedOwners.has(r.owner)) return false;
    if (selectedStatuses.size > 0 && !selectedStatuses.has(r.status)) return false;
    if (!isNaN(minValue) && r.usd < minValue) return false;
    if (!isNaN(maxValue) && r.usd > maxValue) return false;
    if (closeFrom && (!r.close_date || r.close_date < closeFrom)) return false;
    if (closeTo && (!r.close_date || r.close_date > closeTo)) return false;
    if (hideOverdue && r.stage !== "Closed Won" && r.close_date && r.close_date < today) return false;
    if (search) {
      const hay = `${r.opp} ${r.account} ${r.owner} ${r.franchise || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function sortRows(rows) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (typeof av === "string") av = (av || "").toLowerCase();
    if (typeof bv === "string") bv = (bv || "").toLowerCase();
    if (av == null) av = "";
    if (bv == null) bv = "";
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
  return sorted;
}

function renderAll() {
  const filtered = getFilteredRows();
  const sorted = sortRows(filtered);
  renderKpis(filtered);
  renderTable(sorted);
  renderCharts(filtered);
}

function fmtUsd(n) {
  return (n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function renderKpis(rows) {
  const weight = document.getElementById("s2s-weight-prob").checked;
  const valueOf = (r) => (weight ? r.wusd : r.usd);

  const total = rows.reduce((s, r) => s + valueOf(r), 0);
  const closedWon = rows.filter((r) => r.stage === "Closed Won");
  const negotiation = rows.filter((r) => r.stage === "Negotiation");
  const quoting = rows.filter((r) => r.stage === "Quoting");
  const early = rows.filter((r) => ["Demo", "Qualification", "Prospect"].includes(r.stage));

  const approvedCount = (arr) => arr.filter((r) => r.status === "Approved").length;
  const sumVal = (arr) => arr.reduce((s, r) => s + valueOf(r), 0);

  const cards = [
    { label: "Total in view", value: fmtUsd(total), sub: `${rows.length} project${rows.length === 1 ? "" : "s"}${weight ? " · probability-weighted" : ""}` },
    { label: "Closed Won (30d)", value: fmtUsd(sumVal(closedWon)), sub: `${closedWon.length} projects` },
    { label: "Negotiation", value: fmtUsd(sumVal(negotiation)), sub: `${approvedCount(negotiation)} approved of ${negotiation.length}` },
    { label: "Quoting", value: fmtUsd(sumVal(quoting)), sub: `${approvedCount(quoting)} approved of ${quoting.length}` },
    { label: "Early stage", value: fmtUsd(sumVal(early)), sub: "Demo / Qualification / Prospect" },
  ];

  document.getElementById("s2s-kpi-grid").innerHTML = cards
    .map(
      (c) => `
      <div class="kpi-card">
        <div class="kpi-value">${c.value}</div>
        <div class="kpi-label">${escapeHtml(c.label)}</div>
        <div class="kpi-sub">${escapeHtml(c.sub)}</div>
      </div>`
    )
    .join("");
}

function renderTable(rows) {
  const body = document.getElementById("s2s-body");
  const empty = document.getElementById("s2s-empty-state");
  document.getElementById("s2s-count").textContent = `(${rows.length})`;

  if (rows.length === 0) {
    body.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  body.innerHTML = rows
    .map((r) => {
      const statusClass =
        r.status === "Approved" ? "status-done" : r.status === "Submitted for Approval" ? "status-progress" : "status-todo";
      return `
      <tr>
        <td>${escapeHtml(r.opp || "—")}</td>
        <td>${escapeHtml(r.account || "—")}</td>
        <td>${escapeHtml(r.owner || "—")}</td>
        <td>${escapeHtml(r.franchise || "—")}</td>
        <td>${escapeHtml(r.stage || "—")}</td>
        <td>${formatDate(r.close_date)}</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(r.status || "—")}</span></td>
        <td>${fmtUsd(r.usd)}</td>
        <td>${Math.round((r.prob || 0) * 100)}%</td>
        <td>${fmtUsd(r.wusd)}</td>
        <td>${(r.local || 0).toLocaleString("en-US", { style: "currency", currency: r.currency || "USD", maximumFractionDigits: 0 })}</td>
      </tr>`;
    })
    .join("");
}

const CHART_COLORS = {
  navy: "#00284C",
  steel: "#005198",
  slate: "#51565C",
  moss: "#4B7A52",
  amber: "#D98E3D",
  line: "#DBDBDD",
};

function destroyChart(c) {
  if (c) c.destroy();
}

function renderCharts(rows) {
  renderMonthChart(rows);
  renderStatusChart(rows);
  renderFranchiseChart(rows);
  renderTopChart(rows);
}

function renderMonthChart(rows) {
  const ctx = document.getElementById("s2s-month-chart");
  const today = new Date().toISOString().slice(0, 10);
  const byMonth = {};
  for (const r of rows) {
    if (!r.close_date) continue;
    const month = r.close_date.slice(0, 7);
    byMonth[month] = byMonth[month] || { overdue: 0, later: 0 };
    const isOverdue = r.stage !== "Closed Won" && r.close_date < today;
    if (isOverdue) byMonth[month].overdue += r.usd;
    else byMonth[month].later += r.usd;
  }
  const months = Object.keys(byMonth).sort();
  destroyChart(monthChart);
  monthChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        { label: "Overdue", data: months.map((m) => byMonth[m].overdue), backgroundColor: CHART_COLORS.amber, stack: "s" },
        { label: "On schedule", data: months.map((m) => byMonth[m].later), backgroundColor: CHART_COLORS.steel, stack: "s" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => fmtUsd(v) } } },
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function renderStatusChart(rows) {
  const ctx = document.getElementById("s2s-status-chart");
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + r.usd;
  const labels = Object.keys(byStatus);
  destroyChart(statusChart);
  statusChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ data: labels.map((l) => byStatus[l]), backgroundColor: [CHART_COLORS.moss, CHART_COLORS.amber, CHART_COLORS.slate] }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => fmtUsd(v) } } },
    },
  });
}

function renderFranchiseChart(rows) {
  const ctx = document.getElementById("s2s-franchise-chart");
  const byFranchise = {};
  for (const r of rows) {
    const key = r.franchise || "Unassigned";
    byFranchise[key] = (byFranchise[key] || 0) + r.usd;
  }
  const entries = Object.entries(byFranchise).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 14);
  const otherSum = entries.slice(14).reduce((s, [, v]) => s + v, 0);
  if (otherSum > 0) top.push(["Other", otherSum]);
  destroyChart(franchiseChart);
  franchiseChart = new Chart(ctx, {
    type: "bar",
    data: { labels: top.map((e) => e[0]), datasets: [{ data: top.map((e) => e[1]), backgroundColor: CHART_COLORS.steel }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => fmtUsd(v) } } },
    },
  });
}

function renderTopChart(rows) {
  const ctx = document.getElementById("s2s-top-chart");
  const top = [...rows].sort((a, b) => b.usd - a.usd).slice(0, 10);
  destroyChart(topChart);
  topChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map((r) => (r.opp && r.opp.length > 24 ? r.opp.slice(0, 24) + "…" : r.opp || "—")),
      datasets: [{ data: top.map((r) => r.usd), backgroundColor: CHART_COLORS.navy }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => fmtUsd(v) } } },
    },
  });
}
