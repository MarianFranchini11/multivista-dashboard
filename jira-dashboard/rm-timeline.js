// rm-timeline.js
// "Timeline" sub-tab: Gantt view + upcoming deadlines for tickets that are
// To Do or In Progress, with a pace bar comparing hours logged vs. an
// estimate (Price / 2 / 25, or a manual override stored in Firestore).

let rmTimelineInitialized = false;
let rmTlSearch = "";
let rmTlTerritory = "";
let rmTlAssignee = "";
let rmTlUrgency = "";

function initRMTimelineTab() {
  rmActiveSubTab = "timeline";
  ensureRMDataLoaded();

  if (rmTimelineInitialized) {
    renderRMTimeline();
    return;
  }
  rmTimelineInitialized = true;

  // Re-render (incl. filter dropdown options) once Jira tickets/assignments
  // finish loading, in case Timeline was opened before Projects/Overview.
  loadDashboardData().then(() => {
    populateRMTimelineFilters();
    renderRMTimeline();
  });

  document.getElementById("rm-tl-search").addEventListener("input", (e) => {
    rmTlSearch = e.target.value.trim().toLowerCase();
    renderRMTimeline();
  });
  document.getElementById("rm-tl-territory").addEventListener("change", (e) => {
    rmTlTerritory = e.target.value;
    renderRMTimeline();
  });
  document.getElementById("rm-tl-assignee").addEventListener("change", (e) => {
    rmTlAssignee = e.target.value;
    renderRMTimeline();
  });
  document.querySelectorAll("#rm-tl-urgency-chips .rm-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      rmTlUrgency = chip.dataset.urgency;
      document.querySelectorAll("#rm-tl-urgency-chips .rm-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderRMTimeline();
    });
  });
  document.getElementById("rm-tl-clear").addEventListener("click", () => {
    rmTlSearch = "";
    rmTlTerritory = "";
    rmTlAssignee = "";
    rmTlUrgency = "";
    document.getElementById("rm-tl-search").value = "";
    document.getElementById("rm-tl-territory").value = "";
    document.getElementById("rm-tl-assignee").value = "";
    document.querySelectorAll("#rm-tl-urgency-chips .rm-chip").forEach((c) => c.classList.remove("active"));
    document.querySelector('#rm-tl-urgency-chips .rm-chip[data-urgency=""]').classList.add("active");
    renderRMTimeline();
  });
}

function populateRMTimelineFilters() {
  const base = rmTicketsForTimeline();

  const territories = new Set(base.map((t) => t.territory || "Unassigned"));
  const territorySelect = document.getElementById("rm-tl-territory");
  territorySelect.innerHTML =
    '<option value="">All</option>' +
    Array.from(territories).sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  // "Assigned To" here means Jira's native Assignee field (the manager on
  // the ticket), not our internal Resource Management hour assignments.
  const assigneeSelect = document.getElementById("rm-tl-assignee");
  const assignees = new Set(base.map((t) => t.assignee).filter(Boolean));
  assigneeSelect.innerHTML =
    '<option value="">All</option>' +
    Array.from(assignees).sort().map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
}

function rmTicketsForTimeline() {
  return rmAllTickets.filter(
    (t) => (t.statusCategory === "To Do" || t.statusCategory === "In Progress") && t.dueDate
  );
}

function rmFilteredTimelineTickets() {
  let tickets = rmTicketsForTimeline();
  const today = rmToISO(new Date());

  if (rmTlSearch) {
    tickets = tickets.filter(
      (t) =>
        t.key.toLowerCase().includes(rmTlSearch) ||
        (t.projectId || "").toLowerCase().includes(rmTlSearch) ||
        (t.projectName || "").toLowerCase().includes(rmTlSearch)
    );
  }
  if (rmTlTerritory) {
    tickets = tickets.filter((t) => (t.territory || "Unassigned") === rmTlTerritory);
  }
  if (rmTlAssignee) {
    tickets = tickets.filter((t) => t.assignee === rmTlAssignee);
  }
  if (rmTlUrgency) {
    tickets = tickets.filter((t) => rmUrgency(rmDaysBetween(today, t.dueDate)) === rmTlUrgency);
  }
  return tickets;
}

function rmEstimatedHours(ticket) {
  const override = rmEstimates[ticket.key];
  if (override && override.hours != null) return override.hours;
  if (ticket.price != null) return Math.round((ticket.price / 2 / 25) * 10) / 10;
  return null;
}

// "Hours logged" for pace/turnaround purposes means real work done, i.e.
// actualHours (from Time Tracking) -- planned-but-not-yet-worked hours
// don't count as progress. Falls back to the legacy single "hours" field
// for assignments created before the planned/actual split.
function rmHoursLoggedTotal(ticketKey) {
  return rmAssignments
    .filter((a) => a.ticketKey === ticketKey)
    .reduce((sum, a) => {
      if (a.actualHours) {
        return sum + Object.values(a.actualHours).reduce((s, h) => s + (h || 0), 0);
      }
      return sum + Object.values(a.hours || {}).reduce((s, h) => s + (h || 0), 0);
    }, 0);
}

function rmDaysBetween(aIso, bIso) {
  return Math.round((new Date(bIso) - new Date(aIso)) / 86400000);
}

function rmUrgency(daysLeft) {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "urgent";
  if (daysLeft <= 21) return "soon";
  return "ok";
}
function rmUrgencyLabel(daysLeft) {
  if (daysLeft < 0) return `Overdue by ${Math.abs(daysLeft)}d`;
  if (daysLeft === 0) return "Due today";
  return `${daysLeft}d left`;
}

function rmIsBusinessDay(iso) {
  const wd = new Date(iso + "T00:00:00Z").getUTCDay();
  return wd !== 0 && wd !== 6;
}
function rmBusinessDaysBetween(startIso, endIso) {
  if (!startIso) return 0;
  let count = 0;
  let cur = startIso;
  while (cur < endIso) {
    cur = rmAddDays(cur, 1);
    if (rmIsBusinessDay(cur)) count++;
  }
  return count;
}
function rmAddBusinessDays(startIso, n) {
  let cur = startIso;
  let added = 0;
  while (added < n) {
    cur = rmAddDays(cur, 1);
    if (rmIsBusinessDay(cur)) added++;
  }
  return cur;
}

function rmMonthTicks(startIso, endIso) {
  const ticks = [];
  let d = new Date(startIso + "T00:00:00Z");
  d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (rmToISO(d) < startIso) d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const end = new Date(endIso + "T00:00:00Z");
  while (d <= end) {
    ticks.push(rmToISO(d));
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return ticks;
}
function rmMonthLabel(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

// "Quoted Turnaround" is a Jira field: the quoted number of *business*
// days to produce the deliverable, counted from when the scan data was
// validated (i.e. the ticket entered the "S2S Backlog" status) -- not from
// when it first went In Progress.
function rmComputeTurnaround(ticket) {
  const quoted = ticket.quotedTurnaround;
  const started = ticket.dataValidatedDate;
  const today = rmToISO(new Date());
  if (!started) return { quoted, elapsed: 0, status: "not-started", estimatedDelivery: null };
  if (!quoted) return { quoted: null, elapsed: rmBusinessDaysBetween(started, today), status: "no-data", estimatedDelivery: null };
  const elapsed = rmBusinessDaysBetween(started, today);
  const estimatedDelivery = rmAddBusinessDays(started, quoted);
  const usedPct = elapsed / quoted;
  const status = elapsed > quoted ? "over" : usedPct >= 0.85 ? "near" : "within";
  return { quoted, elapsed, status, estimatedDelivery };
}
function rmTurnaroundLabel(status) {
  return {
    over: "Over quoted turnaround",
    near: "Near turnaround limit",
    within: "Within quoted turnaround",
    "not-started": "Data not validated yet (no S2S Backlog date)",
    "no-data": "No Quoted Turnaround set",
  }[status];
}

function rmComputePace(ticket) {
  const est = rmEstimatedHours(ticket);
  const started = ticket.inProgressDate; // null = hasn't started yet
  const today = rmToISO(new Date());
  const usedHours = rmHoursLoggedTotal(ticket.key);
  if (!est) return { est, usedHours, usedPct: null, expectedPct: null, status: "no-estimate" };

  const usedPct = Math.min(999, Math.round((usedHours / est) * 100));
  if (!started) {
    // Hasn't moved to In Progress yet: 0% expected pace so far.
    return { est, usedHours, usedPct, expectedPct: 0, status: usedPct > 10 ? "over" : "pace" };
  }
  const totalSpan = Math.max(1, rmDaysBetween(started, ticket.dueDate));
  const elapsed = Math.max(0, Math.min(totalSpan, rmDaysBetween(started, today)));
  const expectedPct = Math.round((elapsed / totalSpan) * 100);
  const diff = usedPct - expectedPct;
  const status = diff > 10 ? "over" : diff < -10 ? "under" : "pace";
  return { est, usedHours, usedPct, expectedPct, status };
}
function rmPaceLabel(status) {
  return {
    over: "Using more hours than estimated",
    under: "Using fewer hours than estimated",
    pace: "On pace with estimate",
    "no-estimate": "No estimate yet",
  }[status];
}

function renderRMTimeline() {
  renderRMGantt();
  renderRMDeadlines();
}

function renderRMGantt() {
  const container = document.getElementById("rm-gantt");
  if (!container) return;
  const tickets = rmFilteredTimelineTickets();
  const countEl = document.getElementById("rm-tl-count");
  if (countEl) countEl.textContent = `(${tickets.length})`;

  if (tickets.length === 0) {
    container.innerHTML = `<p class="empty-state">No tickets match these filters.</p>`;
    return;
  }

  const today = rmToISO(new Date());
  const VISUAL_WINDOW_DAYS = 45;

  // Cap how far back a bar visually starts -- a ticket that's been "In
  // Progress" for a year shouldn't stretch the whole chart's scale into
  // uselessness. The pace calculation elsewhere still uses the real date.
  const visualStart = (t) => {
    const started = t.inProgressDate || today; // not started yet -> today
    const capped = rmAddDays(today, -VISUAL_WINDOW_DAYS);
    return started > capped ? started : capped;
  };

  const starts = tickets.map(visualStart);
  const rangeStart = starts.reduce((a, b) => (a < b ? a : b));
  const rangeEnd = tickets.map((t) => t.dueDate).reduce((a, b) => (a > b ? a : b), today);
  const totalDays = Math.max(1, rmDaysBetween(rangeStart, rangeEnd));
  const pct = (iso) => Math.max(0, Math.min(100, (rmDaysBetween(rangeStart, iso) / totalDays) * 100));

  const sorted = [...tickets].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const monthTicks = rmMonthTicks(rangeStart, rangeEnd);

  container.innerHTML = `
    <div class="rm-ganttwrap">
      <div class="rm-ganttrow rm-ganttaxisrow">
        <div class="rm-ganttlabel"></div>
        <div class="rm-ganttrack rm-ganttaxistrack">
          ${monthTicks.map((m) => `<div class="rm-ganttmonth" style="left:${pct(m)}%;">${rmMonthLabel(m)}</div>`).join("")}
        </div>
      </div>
      <div class="rm-ganttbody">
        <div class="rm-todayline" style="left:${pct(today)}%;"><span class="rm-todaytag">Today</span></div>
        ${sorted
          .map((t) => {
            const start = visualStart(t);
            const left = pct(start);
            const width = Math.max(1.2, pct(t.dueDate) - left);
            const daysLeft = rmDaysBetween(today, t.dueDate);
            const u = rmUrgency(daysLeft);
            const startLabel = t.inProgressDate || "Not started";

            let markerHtml = "";
            if (t.dataValidatedDate && t.quotedTurnaround) {
              const turnaround = rmComputeTurnaround(t);
              const deadlineIso = turnaround.estimatedDelivery;
              const markerPct = pct(deadlineIso);
              const passed = turnaround.status === "over";
              markerHtml = `<div class="rm-turnaroundmarker ${passed ? "passed" : ""}" style="left:${markerPct}%;" title="Quoted turnaround deadline: ${deadlineIso}${passed ? " (passed)" : ""}"></div>`;
            }

            return `<div class="rm-ganttrow">
              <div class="rm-ganttlabel">${t.key}<span class="sub">${escapeHtml(t.projectName)}</span></div>
              <div class="rm-ganttrack">
                <span class="rm-ganttstart" style="left:${left}%;">${startLabel}</span>
                <div class="rm-ganttbar rm-gb-${u}" style="left:${left}%;width:${width}%;" title="${escapeHtml(t.projectName)} \u00b7 due ${t.dueDate}">${t.dueDate}</div>
                ${markerHtml}
              </div>
            </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

function renderRMDeadlines() {
  const container = document.getElementById("rm-deadlines");
  if (!container) return;
  const tickets = rmFilteredTimelineTickets();
  if (tickets.length === 0) {
    container.innerHTML = "";
    return;
  }
  const today = rmToISO(new Date());
  const sorted = [...tickets].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  container.innerHTML = sorted
    .map((t) => {
      const daysLeft = rmDaysBetween(today, t.dueDate);
      const u = rmUrgency(daysLeft);
      const pace = rmComputePace(t);
      const crew = rmAssignmentsForTicket(t.key).map((a) => rmResourceName(a.resourceId));
      const started = t.inProgressDate || "Not started";

      const paceHtml =
        pace.est == null
          ? `<div class="rm-pacewrap">
              <p class="modal-note" style="margin:0 0 6px;">No hour estimate for this ticket (Price not set).</p>
              <div class="rm-estimate-input">
                <input type="number" min="0" step="0.5" placeholder="Manual estimate (hours)" data-estimatefor="${t.key}" />
                <button type="button" class="clear-filters-btn" data-saveestimate="${t.key}">Save</button>
              </div>
            </div>`
          : `<div class="rm-pacewrap">
              <div class="rm-pacebar">
                <div class="rm-pacefill" style="width:${Math.min(100, pace.usedPct)}%;"></div>
                <div class="rm-pacemark" style="left:${Math.min(100, pace.expectedPct)}%;" title="Expected pace if hours were spent evenly"></div>
              </div>
              <div class="rm-pacetext">
                <span>${pace.usedHours}h logged of ${pace.est}h estimated (${pace.usedPct}%)</span>
                <span class="rm-pacepill rm-pace-${pace.status}">${rmPaceLabel(pace.status)}</span>
              </div>
            </div>`;

      const turnaround = rmComputeTurnaround(t);
      const turnaroundHtml =
        turnaround.status === "no-data"
          ? `<p class="modal-note" style="margin:6px 0 0;">No Quoted Turnaround set for this ticket.</p>`
          : turnaround.status === "not-started"
          ? `<p class="modal-note" style="margin:6px 0 0;">Turnaround clock hasn't started (data not validated / no S2S Backlog date yet).</p>`
          : `<div class="rm-pacewrap">
              <div class="rm-pacebar">
                <div class="rm-pacefill rm-turnfill-${turnaround.status}" style="width:${Math.min(100, Math.round((turnaround.elapsed / turnaround.quoted) * 100))}%;"></div>
              </div>
              <div class="rm-pacetext">
                <span>${turnaround.elapsed} business days elapsed of ${turnaround.quoted} quoted \u00b7 est. delivery ${turnaround.estimatedDelivery}</span>
                <span class="rm-pacepill rm-turn-${turnaround.status}">${rmTurnaroundLabel(turnaround.status)}</span>
              </div>
            </div>`;

      return `<div class="rm-deadlinerow">
        <span class="rm-deadlinedate">${started} \u2013 ${t.dueDate}</span>
        <span class="rm-deadlinename">
          <span class="col-key">${t.key}</span> &middot; ${escapeHtml(t.projectName)}
          ${paceHtml}
          ${turnaroundHtml}
        </span>
        <span class="daysbadge-${u}">${rmUrgencyLabel(daysLeft)}</span>
        <span class="rm-crew">${crew.length ? escapeHtml(crew.join(", ")) : "\u2014"}</span>
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-saveestimate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.saveestimate;
      const input = container.querySelector(`input[data-estimatefor="${key}"]`);
      const val = parseFloat(input.value);
      if (!val || val <= 0) return;
      db.collection("estimates")
        .doc(key)
        .set({ hours: val, manual: true })
        .catch((err) => alert(`Could not save estimate: ${err.message}`));
    });
  });
}
