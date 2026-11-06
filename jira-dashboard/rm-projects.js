// rm-projects.js
// "Projects" sub-tab inside Resource Management: find a Jira ticket, then
// assign team members and log hours per day against it. Hours live in a
// Firestore collection ("assignments"), separate from Jira.

let rmDataLoaded = false;
let rmProjectsInitialized = false;
let rmOverviewInitialized = false;
let rmAllTickets = [];
let rmAssignments = [];
let rmSelectedTicketKey = null;
let rmMultiWeekOffsets = [0];
let rmSelectedWeekStart = null;
let rmActiveSubTab = "roster";
let rmUnSearch = "";
let rmUnTerritory = "";
let rmUnService = "";
let rmUnStatus = "";
let rmGapFilter = "";
let rmOvFilter = "";
let rmOvTeam = "";
let rmEstimates = {}; // ticketKey -> { hours, manual } -- also used by rm-timeline.js

// Loads Jira tickets + starts the live assignments listener. Safe to call
// from either the Projects or the Resource Overview tab -- runs once.
function ensureRMDataLoaded() {
  if (rmDataLoaded) return;
  rmDataLoaded = true;
  rmSelectedWeekStart = rmMondayOf(rmToISO(new Date()));

  loadDashboardData()
    .then((data) => {
      rmAllTickets = flattenIssues(data);
      populateRMUnassignedFilters();
      if (rmActiveSubTab === "projects") {
        renderRMTicketDetail();
        renderRMUnassignedList();
      }
    })
    .catch((err) => console.error("Could not load Jira tickets for assignment:", err));

  db.collection("assignments").onSnapshot(
    (snapshot) => {
      rmAssignments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      if (rmActiveSubTab === "projects") {
        renderRMStats();
        renderRMTicketDetail();
        renderRMUnassignedList();
      } else if (rmActiveSubTab === "overview") {
        renderRMOverviewTable();
      } else if (rmActiveSubTab === "timeline" && typeof renderRMTimeline === "function") {
        renderRMTimeline();
      }
    },
    (err) => console.error("Failed to load assignments:", err)
  );

  db.collection("estimates").onSnapshot(
    (snapshot) => {
      rmEstimates = {};
      snapshot.docs.forEach((doc) => {
        rmEstimates[doc.id] = doc.data();
      });
      if (rmActiveSubTab === "projects") renderRMUnassignedList();
      else if (rmActiveSubTab === "timeline" && typeof renderRMTimeline === "function") renderRMTimeline();
    },
    (err) => console.error("Failed to load estimates:", err)
  );
}

function initRMProjectsTab() {
  rmActiveSubTab = "projects";
  ensureRMDataLoaded();

  if (rmProjectsInitialized) {
    renderRMWeekLabel();
    renderRMStats();
    renderRMTicketDetail();
    return;
  }
  rmProjectsInitialized = true;

  document.getElementById("rm-week-search").addEventListener("input", (e) => {
    renderRMTicketSearchResults(e.target.value.trim());
  });
  document.getElementById("rm-week-prev").addEventListener("click", () => {
    rmSelectedWeekStart = rmAddDays(rmSelectedWeekStart, -7);
    renderRMWeekLabel();
    renderRMOverviewWeekLabel();
    renderRMStats();
    renderRMTicketDetail();
  });
  document.getElementById("rm-week-next").addEventListener("click", () => {
    rmSelectedWeekStart = rmAddDays(rmSelectedWeekStart, 7);
    renderRMWeekLabel();
    renderRMOverviewWeekLabel();
    renderRMStats();
    renderRMTicketDetail();
  });

  document.querySelectorAll('[data-gap]').forEach((chip) => {
    chip.addEventListener("click", () => {
      rmGapFilter = chip.dataset.gap;
      document.querySelectorAll('[data-gap]').forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderRMUnassignedList();
    });
  });

  document.getElementById("rm-un-search").addEventListener("input", (e) => {
    rmUnSearch = e.target.value.trim().toLowerCase();
    renderRMUnassignedList();
  });
  document.getElementById("rm-un-territory").addEventListener("change", (e) => {
    rmUnTerritory = e.target.value;
    renderRMUnassignedList();
  });
  document.getElementById("rm-un-service").addEventListener("change", (e) => {
    rmUnService = e.target.value;
    renderRMUnassignedList();
  });
  document.getElementById("rm-un-status").addEventListener("change", (e) => {
    rmUnStatus = e.target.value;
    renderRMUnassignedList();
  });
  document.getElementById("rm-un-clear").addEventListener("click", () => {
    rmUnSearch = "";
    rmUnTerritory = "";
    rmUnService = "";
    rmUnStatus = "";
    rmGapFilter = "";
    document.getElementById("rm-un-search").value = "";
    document.getElementById("rm-un-territory").value = "";
    document.getElementById("rm-un-service").value = "";
    document.getElementById("rm-un-status").value = "";
    document.querySelectorAll('[data-gap]').forEach((c) => c.classList.remove("active"));
    document.querySelector('[data-gap=""]').classList.add("active");
    renderRMUnassignedList();
  });

  renderRMWeekLabel();
  renderRMStats();
  renderRMTicketDetail();
  populateRMUnassignedFilters();
  renderRMUnassignedList();
}

function initRMOverviewTab() {
  rmActiveSubTab = "overview";
  ensureRMDataLoaded();

  if (rmOverviewInitialized) {
    renderRMOverviewWeekLabel();
    renderRMOverviewTable();
    return;
  }
  rmOverviewInitialized = true;

  document.getElementById("rm-ov-week-prev").addEventListener("click", () => {
    rmSelectedWeekStart = rmAddDays(rmSelectedWeekStart, -7);
    renderRMWeekLabel();
    renderRMOverviewWeekLabel();
    renderRMStats();
    renderRMOverviewTable();
  });
  document.getElementById("rm-ov-week-next").addEventListener("click", () => {
    rmSelectedWeekStart = rmAddDays(rmSelectedWeekStart, 7);
    renderRMWeekLabel();
    renderRMOverviewWeekLabel();
    renderRMStats();
    renderRMOverviewTable();
  });
  document.getElementById("rm-ov-team").addEventListener("change", (e) => {
    rmOvTeam = e.target.value;
    renderRMOverviewTable();
  });
  document.querySelectorAll("#rm-ov-chips .rm-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      rmOvFilter = chip.dataset.ov;
      document.querySelectorAll("#rm-ov-chips .rm-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderRMOverviewTable();
    });
  });

  populateRMOverviewTeamFilter();
  renderRMOverviewWeekLabel();
  renderRMOverviewTable();
}

// ---- Date helpers (this sub-tab needs a plain Mon-Sun week, distinct from
// the "Due month" filter on the Dashboard) ----
function rmToISO(d) {
  return d.toISOString().slice(0, 10);
}
function rmAddDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return rmToISO(d);
}
function rmMondayOf(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const wd = d.getUTCDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  d.setUTCDate(d.getUTCDate() + diff);
  return rmToISO(d);
}
function rmDayLabel(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}
function rmIsWeekend(iso) {
  const wd = new Date(iso + "T00:00:00Z").getUTCDay();
  return wd === 0 || wd === 6;
}
function rmCurrentWeekDates() {
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(rmAddDays(rmSelectedWeekStart, i));
  return dates;
}

function rmWeekRangeLabel(startIso, endIso) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = new Date(startIso + "T00:00:00Z");
  const e = new Date(endIso + "T00:00:00Z");
  const sMonth = MONTHS[s.getUTCMonth()];
  const eMonth = MONTHS[e.getUTCMonth()];
  const year = e.getUTCFullYear();
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) {
    return `Week of ${sMonth} ${s.getUTCDate()}\u2013${e.getUTCDate()}, ${year}`;
  }
  return `Week of ${sMonth} ${s.getUTCDate()} \u2013 ${eMonth} ${e.getUTCDate()}, ${year}`;
}

function renderRMWeekLabel() {
  const dates = rmCurrentWeekDates();
  document.getElementById("rm-week-label").textContent = rmWeekRangeLabel(dates[0], dates[6]);
}

function renderRMOverviewWeekLabel() {
  const el = document.getElementById("rm-ov-week-label");
  if (!el) return;
  const dates = rmCurrentWeekDates();
  el.textContent = rmWeekRangeLabel(dates[0], dates[6]);
}

function populateRMOverviewTeamFilter() {
  const select = document.getElementById("rm-ov-team");
  if (!select) return;
  const teams = new Set(allResources.map((r) => r.team));
  select.innerHTML =
    '<option value="">All</option>' +
    Array.from(teams).sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
}

function renderRMOverviewTable() {
  const container = document.getElementById("rm-overview-table");
  if (!container) return;

  const week = rmCurrentWeekDates();
  let active = allResources.filter((r) => r.active);
  if (rmOvTeam) active = active.filter((r) => r.team === rmOvTeam);

  const isAssignedThisWeek = (r) => week.some((d) => rmTotalForResourceDay(r.id, d) > 0);
  const assignedCount = active.filter(isAssignedThisWeek).length;
  const unassignedCount = active.length - assignedCount;
  const setCount = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `(${n})`;
  };
  setCount("rm-ov-count-all", active.length);
  setCount("rm-ov-count-assigned", assignedCount);
  setCount("rm-ov-count-unassigned", unassignedCount);

  if (rmOvFilter === "assigned") active = active.filter(isAssignedThisWeek);
  if (rmOvFilter === "unassigned") active = active.filter((r) => !isAssignedThisWeek(r));

  active = active.sort((a, b) => a.name.localeCompare(b.name));

  if (active.length === 0) {
    container.innerHTML = `<p class="empty-state">No resources match these filters.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="rm-grid">
        <thead>
          <tr>
            <th style="min-width:160px;">Resource</th>
            ${week.map((d) => `<th class="rm-daycol ${rmIsWeekend(d) ? "weekend" : ""}">${rmDayLabel(d)}</th>`).join("")}
            <th>Week Total</th>
          </tr>
        </thead>
        <tbody>
          ${active
            .map((r) => {
              let weekTotal = 0;
              const cells = week
                .map((d) => {
                  const total = rmTotalForResourceDay(r.id, d);
                  weekTotal += total;
                  const status = rmClassify(total, rmIsWeekend(d));
                  const tip = rmBreakdownForResourceDay(r.id, d).join(" \u00b7 ") || "No hours assigned";
                  return `<td class="rm-daycell rm-st-${status}" title="${rmStatusLabel(status)}: ${escapeHtml(tip)}">
                    <span class="rm-cellbox" style="cursor:default;">${total}</span>
                  </td>`;
                })
                .join("");
              return `<tr><td class="namecell">${escapeHtml(r.name)} <span class="teambadge">${escapeHtml(r.team)}</span></td>${cells}<td class="totalcell">${weekTotal}h</td></tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="legend">
      <span><span class="dot" style="background:var(--moss);"></span>Full 8h</span>
      <span><span class="dot" style="background:var(--amber);"></span>Under 8h</span>
      <span><span class="dot" style="background:var(--rm-over);"></span>Over 8h (overtime)</span>
      <span><span class="dot" style="background:var(--rm-sat);"></span>Worked weekend (overtime)</span>
      <span><span class="dot" style="background:var(--slate);"></span>Unassigned that day</span>
    </div>
  `;
}

// ---- Data helpers ----
// Core rule for the whole app: for any given day, we read/write
// "actualHours" if that day is in the past, or "plannedHours" if it's
// today or in the future. This is what makes a past week always show
// what really happened (per Time Tracking), a future week show only the
// plan, and the current week naturally blend both (today's cell splits
// the two: everything before it is real, everything from today on is
// still planning).
function rmFieldForDate(date) {
  const today = rmToISO(new Date());
  return date < today ? "actualHours" : "plannedHours";
}
function rmHourValue(assignment, date) {
  const field = rmFieldForDate(date);
  const bucket = assignment[field];
  if (bucket && bucket[date] != null) return bucket[date];
  // Back-compat: assignments created before the planned/actual split used
  // a single "hours" map -- fall back to that if the new fields are empty.
  if (assignment.hours && assignment.hours[date] != null) return assignment.hours[date];
  return 0;
}

function rmAssignmentsForTicket(ticketKey) {
  return rmAssignments.filter((a) => a.ticketKey === ticketKey);
}
function rmTotalForResourceDay(resourceId, date) {
  return rmAssignments
    .filter((a) => a.resourceId === resourceId)
    .reduce((sum, a) => sum + rmHourValue(a, date), 0);
}
function rmBreakdownForResourceDay(resourceId, date) {
  return rmAssignments
    .filter((a) => a.resourceId === resourceId && rmHourValue(a, date) > 0)
    .map((a) => `${a.ticketKey}: ${rmHourValue(a, date)}h`);
}
function rmClassify(total, isWeekend) {
  if (isWeekend) return total > 0 ? "satOT" : "weekendoff";
  if (total === 0) return "unassigned";
  if (total < 8) return "under";
  if (total === 8) return "ok";
  return "over";
}
function rmStatusLabel(s) {
  return {
    ok: "Full 8h",
    under: "Under 8h",
    over: "Overtime (>8h)",
    unassigned: "Unassigned",
    satOT: "Worked weekend (overtime)",
    weekendoff: "No work (weekend)",
  }[s];
}
function rmResourceById(id) {
  return allResources.find((r) => r.id === id);
}
function rmResourceName(id) {
  const r = rmResourceById(id);
  return r ? r.name : "\u2014";
}

// ---- Alerts / stats bar (mirrors the Dashboard's KPI card look) ----
function computeRMAlerts(week) {
  const unassignedWeek = [], underInstances = [], overInstances = [], weekendInstances = [];
  allResources.filter((r) => r.active).forEach((r) => {
    let weekTotal = 0;
    week.forEach((d) => (weekTotal += rmTotalForResourceDay(r.id, d)));
    if (weekTotal === 0) {
      unassignedWeek.push(r.name);
      return;
    }
    week.forEach((d) => {
      const total = rmTotalForResourceDay(r.id, d);
      const we = rmIsWeekend(d);
      if (!we) {
        if (total > 0 && total < 8) underInstances.push({ name: r.name, day: rmDayLabel(d) });
        else if (total > 8) overInstances.push({ name: r.name, day: rmDayLabel(d), total });
      } else if (total > 0) {
        weekendInstances.push({ name: r.name, day: rmDayLabel(d), total });
      }
    });
  });
  return { unassignedWeek, underInstances, overInstances, weekendInstances };
}

function renderRMStats() {
  const grid = document.getElementById("rm-stats-grid");
  if (!grid) return;
  const alerts = computeRMAlerts(rmCurrentWeekDates());
  const kpis = [
    { label: "No Assignment This Week", value: alerts.unassignedWeek.length },
    { label: "Days Under 8h", value: alerts.underInstances.length },
    { label: "Days Overtime (>8h)", value: alerts.overInstances.length },
    { label: "Weekend Work Logged", value: alerts.weekendInstances.length },
  ];
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

// ---- Ticket search ----
function renderRMTicketSearchResults(query) {
  const container = document.getElementById("rm-ticket-results");
  if (!query) {
    container.innerHTML = "";
    return;
  }
  const q = query.toLowerCase();
  const matches = rmAllTickets
    .filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        (t.projectId || "").toLowerCase().includes(q) ||
        (t.projectName || "").toLowerCase().includes(q) ||
        (t.summary || "").toLowerCase().includes(q)
    )
    .slice(0, 15);

  if (matches.length === 0) {
    container.innerHTML = `<p class="empty-state">No tickets match "${escapeHtml(query)}".</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap rm-ticket-pick-wrap">
      <table>
        <thead><tr><th>Key</th><th>Project ID</th><th>Project Name</th><th>Territory</th><th>Status</th></tr></thead>
        <tbody>
          ${matches
            .map(
              (t) => `
            <tr class="clickable-row" data-ticketkey="${t.key}">
              <td class="col-key">${t.key}</td>
              <td class="col-updated">${escapeHtml(t.projectId || "\u2014")}</td>
              <td>${escapeHtml(t.projectName)}</td>
              <td>${escapeHtml(t.territory || "Unassigned")}</td>
              <td><span class="status-pill ${statusPillClass(t.statusCategory)}">${t.statusCategory}</span></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-ticketkey]").forEach((row) => {
    row.addEventListener("click", () => selectRMTicket(row.dataset.ticketkey));
  });
}

// ---- "Staffing Gaps" list ----
// A ticket has a gap if: nobody's assigned yet, or someone is assigned but
// logged hours are falling behind the expected pace toward the estimate.
function rmGapCategory(ticket) {
  const assignedCount = new Set(rmAssignmentsForTicket(ticket.key).map((a) => a.resourceId)).size;
  if (assignedCount === 0) return "unstaffed";
  if (typeof rmComputePace !== "function") return "none";
  const pace = rmComputePace(ticket);
  if (pace.status === "no-estimate") return "no-estimate";
  if (pace.status === "under") return "understaffed";
  return "none";
}

function rmStaffingGapTickets() {
  return rmAllTickets.filter(
    (t) => t.statusCategory === "To Do" || t.statusCategory === "In Progress"
  );
}

function populateRMUnassignedFilters() {
  const territorySelect = document.getElementById("rm-un-territory");
  const serviceSelect = document.getElementById("rm-un-service");
  if (!territorySelect || !serviceSelect) return;

  const territories = new Set(rmAllTickets.map((t) => t.territory || "Unassigned"));
  const services = new Set(rmAllTickets.map((t) => t.serviceType).filter(Boolean));

  territorySelect.innerHTML =
    '<option value="">All</option>' +
    Array.from(territories).sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  serviceSelect.innerHTML =
    '<option value="">All</option>' +
    Array.from(services).sort().map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
}

function rmGapLabel(gap) {
  return {
    unstaffed: "Unstaffed",
    understaffed: "Understaffed",
    "no-estimate": "No Estimate",
    none: "On Track",
  }[gap];
}

function renderRMUnassignedList() {
  const container = document.getElementById("rm-unassigned-list");
  const countEl = document.getElementById("rm-unassigned-count");
  if (!container) return;

  // Show every open ticket -- nothing gets auto-hidden based on the pace
  // calculation, since that flips as soon as someone's assigned (even
  // before they've logged any real hours). The Gap column + chips are
  // there to help you judge, not to hide things from you.
  let tickets = rmStaffingGapTickets().map((t) => ({ t, gap: rmGapCategory(t) }));

  if (rmGapFilter) tickets = tickets.filter((row) => row.gap === rmGapFilter);
  if (rmUnSearch) {
    tickets = tickets.filter(
      (row) =>
        row.t.key.toLowerCase().includes(rmUnSearch) ||
        (row.t.projectId || "").toLowerCase().includes(rmUnSearch) ||
        (row.t.projectName || "").toLowerCase().includes(rmUnSearch)
    );
  }
  if (rmUnTerritory) tickets = tickets.filter((row) => (row.t.territory || "Unassigned") === rmUnTerritory);
  if (rmUnService) tickets = tickets.filter((row) => row.t.serviceType === rmUnService);
  if (rmUnStatus) tickets = tickets.filter((row) => row.t.statusCategory === rmUnStatus);

  tickets.sort((a, b) => (a.t.dueDate || "9999") < (b.t.dueDate || "9999") ? -1 : 1);

  if (countEl) countEl.textContent = `(${tickets.length} of ${rmStaffingGapTickets().length} open tickets)`;

  if (tickets.length === 0) {
    container.innerHTML = `<p class="empty-state">No tickets match these filters.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Key</th><th>Project ID</th><th>Project Name</th><th>Gap</th><th>Team</th><th>Hours</th><th>Territory</th><th>Status</th><th>Due Date</th></tr>
        </thead>
        <tbody>
          ${tickets
            .slice(0, 300)
            .map(({ t, gap }) => {
              const assignedCount = new Set(rmAssignmentsForTicket(t.key).map((a) => a.resourceId)).size;
              const pace = typeof rmComputePace === "function" ? rmComputePace(t) : { est: null, usedHours: 0 };
              const hoursText =
                pace.est != null ? `${pace.usedHours}h / ${pace.est}h` : assignedCount > 0 ? `${pace.usedHours}h logged` : "\u2014";
              return `
            <tr class="clickable-row" data-ticketkey="${t.key}">
              <td class="col-key">${t.key}</td>
              <td class="col-updated">${escapeHtml(t.projectId || "\u2014")}</td>
              <td>${escapeHtml(t.projectName)}</td>
              <td><span class="rm-pacepill rm-gap-${gap}">${rmGapLabel(gap)}</span></td>
              <td>${assignedCount}</td>
              <td class="col-updated">${hoursText}</td>
              <td>${escapeHtml(t.territory || "Unassigned")}</td>
              <td><span class="status-pill ${statusPillClass(t.statusCategory)}">${t.statusCategory}</span></td>
              <td class="col-updated">${formatDate(t.dueDate)}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-ticketkey]").forEach((row) => {
    row.addEventListener("click", () => selectRMTicket(row.dataset.ticketkey));
  });
}

function selectRMTicket(key) {
  rmSelectedTicketKey = key;
  document.getElementById("rm-week-search").value = "";
  document.getElementById("rm-ticket-results").innerHTML = "";
  renderRMTicketDetail();
  document.getElementById("rm-ticket-detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- Ticket detail + hour grid ----
function renderRMTicketDetail() {
  const container = document.getElementById("rm-ticket-detail");
  if (!rmSelectedTicketKey) {
    container.innerHTML = "";
    return;
  }
  const ticket = rmAllTickets.find((t) => t.key === rmSelectedTicketKey);
  if (!ticket) {
    container.innerHTML = `<p class="empty-state">Ticket ${escapeHtml(rmSelectedTicketKey)} not found.</p>`;
    return;
  }

  const week = rmCurrentWeekDates();
  const rows = rmAssignmentsForTicket(rmSelectedTicketKey);
  const assignedIds = new Set(rows.map((r) => r.resourceId));
  const available = allResources.filter((r) => r.active && !assignedIds.has(r.id));

  container.innerHTML = `
    <div class="panel-head" style="margin-top:24px;">
      <h2><span class="col-key">${ticket.key}</span> &middot; ${escapeHtml(ticket.projectName)} <span class="panel-subtitle">Project ID ${escapeHtml(ticket.projectId || "\u2014")}</span></h2>
      <span class="rm-roster-hint">Hours per day &middot; lives only in this ledger, does not sync back to Jira &middot; <a href="#" id="rm-view-history">View change history</a></span>
    </div>
    <div class="table-wrap">
      <table class="rm-grid">
        <thead>
          <tr>
            <th style="min-width:160px;">Resource</th>
            ${week.map((d) => `<th class="rm-daycol ${rmIsWeekend(d) ? "weekend" : ""}">${rmDayLabel(d)}</th>`).join("")}
            <th>Total</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="${week.length + 3}" class="empty">No resources assigned to this ticket yet.</td></tr>`
              : rows
                  .map((a) => {
                    let rowTotal = 0;
                    const cells = week
                      .map((d) => {
                        const totalDay = rmTotalForResourceDay(a.resourceId, d);
                        const own = rmHourValue(a, d);
                        rowTotal += own;
                        const status = rmClassify(totalDay, rmIsWeekend(d));
                        const isActual = rmFieldForDate(d) === "actualHours";
                        const tip = rmBreakdownForResourceDay(a.resourceId, d).join(" \u00b7 ") || "No hours";
                        return `<td class="rm-daycell rm-st-${status} ${isActual ? "rm-actual-cell" : ""}" title="${rmStatusLabel(status)}: ${escapeHtml(tip)}${isActual ? " (actual, from Time Tracking)" : " (planned)"}">
                          <span class="rm-cellbox"><input type="number" min="0" step="1" value="${own}" data-assign="${a.id}" data-date="${d}"></span>
                          ${isActual ? '<span class="rm-cell-tag">actual</span>' : ""}
                        </td>`;
                      })
                      .join("");
                    const m = rmResourceById(a.resourceId);
                    return `<tr class="${m && !m.active ? "inactive-row" : ""}">
                      <td class="namecell">${rmResourceName(a.resourceId)} ${m ? `<span class="teambadge ${escapeHtml(m.team)}">${escapeHtml(m.team)}</span>` : ""}</td>
                      ${cells}
                      <td class="totalcell">${rowTotal}h</td>
                      <td><button type="button" class="rm-remove-btn" data-removeassign="${a.id}">Remove</button></td>
                    </tr>`;
                  })
                  .join("")
          }
        </tbody>
      </table>
    </div>

    <div class="rm-multiassign">
      <div class="rm-multiassign-col">
        <div class="rm-multiassign-label">1. Pick people to add</div>
        <div class="rm-person-checks" id="rm-person-checks">
          ${
            available.length
              ? available.map((r) => `<label class="rm-person-check"><input type="checkbox" class="rm-person-check-input" value="${r.id}" /> ${escapeHtml(r.name)} <span class="teambadge">${escapeHtml(r.team)}</span></label>`).join("")
              : '<p class="modal-note">Everyone active is already assigned to this ticket.</p>'
          }
        </div>
        <div class="rm-newperson-row">
          <input type="text" class="rm-search" id="rm-new-name" placeholder="New resource name (no Jira account)" />
          <button type="button" class="clear-filters-btn" id="rm-add-new">+ Create &amp; check</button>
        </div>
      </div>
      <div class="rm-multiassign-col">
        <div class="rm-multiassign-label">2. Hours per weekday, for one or more weeks</div>
        <div id="rm-week-blocks-container"></div>
        <button type="button" id="rm-add-week-block" class="clear-filters-btn">+ Add another week</button>
      </div>
    </div>
    <div class="rm-apply-row">
      <button type="button" class="rm-add-btn" id="rm-apply-multiassign">Apply to selected people &amp; weeks</button>
      <span id="rm-apply-msg" class="rm-apply-msg"></span>
    </div>

    <div class="legend">
      <span><span class="dot" style="background:var(--moss);"></span>Full 8h</span>
      <span><span class="dot" style="background:var(--amber);"></span>Under 8h</span>
      <span><span class="dot" style="background:var(--rm-over);"></span>Over 8h (overtime)</span>
      <span><span class="dot" style="background:var(--rm-sat);"></span>Worked weekend (overtime)</span>
      <span><span class="dot" style="background:var(--slate);"></span>Unassigned that day</span>
      <span>Cells tagged "actual" are real hours from Time Tracking &mdash; still editable if you need to correct something.</span>
    </div>
    <div id="rm-history-panel" class="rm-history-panel" style="display:none;"></div>
  `;

  rmMultiWeekOffsets = [0];
  renderRMWeekBlocks();

  container.querySelectorAll("input[data-assign]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const val = Math.max(0, parseFloat(e.target.value) || 0);
      updateRMAssignmentHour(e.target.dataset.assign, e.target.dataset.date, val);
    });
  });
  container.querySelectorAll("[data-removeassign]").forEach((el) => {
    el.addEventListener("click", () => removeRMAssignment(el.dataset.removeassign));
  });
  const addNewBtn = document.getElementById("rm-add-new");
  if (addNewBtn) {
    addNewBtn.addEventListener("click", async () => {
      const input = document.getElementById("rm-new-name");
      const name = input.value.trim();
      if (!name) return;
      try {
        const resourceRef = await db.collection("resources").add({
          name,
          team: "Other",
          email: "",
          level: "Junior",
          active: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        input.value = "";
        input.placeholder = `Added ${name} \u2014 they'll appear in the list above once synced`;
      } catch (err) {
        alert(`Could not create resource: ${err.message}`);
      }
    });
  }
  document.getElementById("rm-add-week-block").addEventListener("click", () => {
    const nextOffset = Math.max(...rmMultiWeekOffsets) + 1;
    rmMultiWeekOffsets.push(nextOffset);
    renderRMWeekBlocks();
  });
  document.getElementById("rm-apply-multiassign").addEventListener("click", applyRMMultiAssign);

  const historyLink = document.getElementById("rm-view-history");
  if (historyLink) {
    historyLink.addEventListener("click", (e) => {
      e.preventDefault();
      toggleRMHistoryPanel(rmSelectedTicketKey);
    });
  }
}

// Renders the "2. Hours per weekday" week blocks based on rmMultiWeekOffsets,
// without touching the rest of the panel (so picking people / adding a week
// doesn't wipe hours you already typed in another block).
function renderRMWeekBlocks() {
  const container = document.getElementById("rm-week-blocks-container");
  if (!container) return;
  const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  container.innerHTML = rmMultiWeekOffsets
    .map((offset, blockIndex) => {
      const weekStart = rmAddDays(rmSelectedWeekStart, offset * 7);
      const weekdayDates = [0, 1, 2, 3, 4].map((i) => rmAddDays(weekStart, i));
      return `
        <div class="rm-weekblock">
          <div class="rm-weekblock-label">${rmWeekRangeLabel(weekStart, rmAddDays(weekStart, 6))}</div>
          <div class="rm-weekblock-days">
            ${weekdayDates
              .map(
                (d, i) => `
              <label class="rm-weekblock-day">${WEEKDAY_NAMES[i]}
                <input type="number" min="0" step="1" value="8" data-date="${d}" data-blockindex="${blockIndex}" />
              </label>`
              )
              .join("")}
          </div>
        </div>`;
    })
    .join("");
}

async function applyRMMultiAssign() {
  const msg = document.getElementById("rm-apply-msg");
  const checked = Array.from(document.querySelectorAll(".rm-person-check-input:checked")).map((el) => el.value);
  if (checked.length === 0) {
    msg.textContent = "Pick at least one person first.";
    msg.style.color = "#8A2A17";
    return;
  }

  const entries = [];
  document.querySelectorAll("#rm-week-blocks-container input[data-date]").forEach((inp) => {
    const hours = Math.max(0, parseFloat(inp.value) || 0);
    if (hours > 0) entries.push({ date: inp.dataset.date, hours });
  });

  msg.style.color = "var(--slate)";
  msg.textContent = "Applying\u2026";

  try {
    for (const resourceId of checked) {
      let existing = rmAssignmentsForTicket(rmSelectedTicketKey).find((a) => a.resourceId === resourceId);
      let assignmentId = existing ? existing.id : null;
      if (!assignmentId) {
        const ref = await db.collection("assignments").add({
          ticketKey: rmSelectedTicketKey,
          resourceId,
          plannedHours: {},
          actualHours: {},
        });
        assignmentId = ref.id;
      }
      if (entries.length > 0) {
        const patch = {};
        for (const { date, hours } of entries) patch[`${rmFieldForDate(date)}.${date}`] = hours;
        await db.collection("assignments").doc(assignmentId).update(patch);
        for (const { date, hours } of entries) {
          await logRMAssignmentHistory(rmSelectedTicketKey, resourceId, date, hours, rmFieldForDate(date));
        }
      }
    }
    msg.style.color = "#4B7A52";
    msg.textContent = `Applied to ${checked.length} ${checked.length === 1 ? "person" : "people"} across ${rmMultiWeekOffsets.length} week${rmMultiWeekOffsets.length === 1 ? "" : "s"}.`;
  } catch (err) {
    msg.style.color = "#8A2A17";
    msg.textContent = `Error: ${err.message}`;
  }
}

async function updateRMAssignmentHour(assignmentId, date, value) {
  try {
    const assignment = rmAssignments.find((a) => a.id === assignmentId);
    const field = rmFieldForDate(date);
    await db.collection("assignments").doc(assignmentId).update({ [`${field}.${date}`]: value });
    if (assignment) {
      await logRMAssignmentHistory(assignment.ticketKey, assignment.resourceId, date, value, field);
    }
  } catch (err) {
    console.error("Failed to update hours:", err);
    alert(`Could not save hours: ${err.message}`);
  }
}

// Append-only audit trail: every hour change (single-cell or bulk) gets a
// row here, and this collection is never edited or deleted. This means the
// exact plan for any past week can always be reconstructed later, even
// after people change their hours going forward.
async function logRMAssignmentHistory(ticketKey, resourceId, date, hours, field) {
  try {
    await db.collection("assignment_history").add({
      ticketKey,
      resourceId,
      date,
      hours,
      field: field || "actualHours",
      changedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to log assignment history:", err);
  }
}

async function toggleRMHistoryPanel(ticketKey) {
  const panel = document.getElementById("rm-history-panel");
  if (!panel) return;
  if (panel.style.display === "block") {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  panel.innerHTML = `<p class="modal-note">Loading history\u2026</p>`;
  try {
    const snapshot = await db
      .collection("assignment_history")
      .where("ticketKey", "==", ticketKey)
      .orderBy("changedAt", "desc")
      .limit(100)
      .get();
    if (snapshot.empty) {
      panel.innerHTML = `<p class="modal-note">No changes logged yet for this ticket.</p>`;
      return;
    }
    panel.innerHTML = `
      <div class="panel-head"><h3 style="font-family:var(--font-display);font-size:0.9rem;margin:0;">Change History</h3></div>
      <div class="rm-history-list">
        ${snapshot.docs
          .map((doc) => {
            const h = doc.data();
            const when = h.changedAt ? h.changedAt.toDate().toLocaleString("en-US") : "\u2014";
            return `<div class="rm-history-row">
              <span class="rm-history-when">${when}</span>
              <span>${escapeHtml(rmResourceName(h.resourceId))} \u2192 ${h.date}: <strong>${h.hours}h</strong> <span class="teambadge">${h.field === "plannedHours" ? "planned" : "actual"}</span></span>
            </div>`;
          })
          .join("")}
      </div>`;
  } catch (err) {
    panel.innerHTML = `<p class="modal-note">Could not load history: ${escapeHtml(err.message)}</p>`;
  }
}

async function addRMAssignment(ticketKey, resourceId) {
  try {
    await db.collection("assignments").add({ ticketKey, resourceId, plannedHours: {}, actualHours: {} });
  } catch (err) {
    console.error("Failed to add assignment:", err);
    alert(`Could not add resource to this ticket: ${err.message}`);
  }
}

async function removeRMAssignment(id) {
  if (!confirm("Remove this resource from the ticket? Their logged hours for it will be deleted.")) return;
  try {
    await db.collection("assignments").doc(id).delete();
  } catch (err) {
    console.error("Failed to remove assignment:", err);
    alert(`Could not remove: ${err.message}`);
  }
}
