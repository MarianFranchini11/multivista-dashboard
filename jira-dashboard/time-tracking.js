// time-tracking.js
// Self-service page: a team member types their email, sees every ticket
// they're assigned to (current + future), and logs their own hours.
// Reads/writes the SAME Firestore collections Resource Management uses
// ("resources" and "assignments"), so everything stays in sync both ways.

const TT_SESSION_KEY = "mv-tt-resource-id";

let ttResources = [];
let ttAssignments = [];
let ttTickets = [];
let ttResourceId = null;
let ttWeekStart = null;
let ttDataReady = { resources: false, assignments: false, tickets: false };

function ttToISO(d) {
  return d.toISOString().slice(0, 10);
}
function ttAddDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return ttToISO(d);
}
function ttMondayOf(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const wd = d.getUTCDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  d.setUTCDate(d.getUTCDate() + diff);
  return ttToISO(d);
}
function ttDayLabel(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}
function ttWeekRangeLabel(startIso, endIso) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = new Date(startIso + "T00:00:00Z");
  const e = new Date(endIso + "T00:00:00Z");
  const year = e.getUTCFullYear();
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return `Week of ${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}\u2013${e.getUTCDate()}, ${year}`;
  }
  return `Week of ${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()} \u2013 ${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}, ${year}`;
}
function ttCurrentWeekDates() {
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(ttAddDays(ttWeekStart, i));
  return dates;
}

function initTimeTracking() {
  ttWeekStart = ttMondayOf(ttToISO(new Date()));

  db.collection("resources").onSnapshot(
    (snap) => {
      ttResources = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      ttDataReady.resources = true;
      if (ttResourceId) renderMyView();
    },
    (err) => console.error("Failed to load resources:", err)
  );

  db.collection("assignments").onSnapshot(
    (snap) => {
      ttAssignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      ttDataReady.assignments = true;
      if (ttResourceId) renderMyView();
    },
    (err) => console.error("Failed to load assignments:", err)
  );

  loadDashboardData()
    .then((data) => {
      ttTickets = flattenIssues(data);
      ttDataReady.tickets = true;
      if (ttResourceId) renderMyView();
    })
    .catch((err) => console.error("Could not load Jira tickets:", err));

  document.getElementById("tt-email-form").addEventListener("submit", (e) => {
    e.preventDefault();
    tryIdentify(document.getElementById("tt-email-input").value.trim());
  });

  document.getElementById("tt-switch-link").addEventListener("click", (e) => {
    e.preventDefault();
    sessionStorage.removeItem(TT_SESSION_KEY);
    ttResourceId = null;
    document.getElementById("tt-myview").style.display = "none";
    document.getElementById("tt-identify").style.display = "flex";
    document.getElementById("tt-email-input").value = "";
  });

  document.getElementById("tt-week-prev").addEventListener("click", () => {
    ttWeekStart = ttAddDays(ttWeekStart, -7);
    renderMyView();
  });
  document.getElementById("tt-week-next").addEventListener("click", () => {
    ttWeekStart = ttAddDays(ttWeekStart, 7);
    renderMyView();
  });

  const savedId = sessionStorage.getItem(TT_SESSION_KEY);
  if (savedId) {
    ttResourceId = savedId;
    document.getElementById("tt-identify").style.display = "none";
    document.getElementById("tt-myview").style.display = "block";
  }
}

function tryIdentify(email) {
  const errorEl = document.getElementById("tt-email-error");
  errorEl.hidden = true;
  const normalized = email.trim().toLowerCase();
  const match = ttResources.find((r) => (r.email || "").trim().toLowerCase() === normalized);
  if (!match) {
    errorEl.hidden = false;
    return;
  }
  ttResourceId = match.id;
  sessionStorage.setItem(TT_SESSION_KEY, match.id);
  document.getElementById("tt-identify").style.display = "none";
  document.getElementById("tt-myview").style.display = "block";
  renderMyView();
}

function ttMyResource() {
  return ttResources.find((r) => r.id === ttResourceId);
}
function ttMyAssignments() {
  return ttAssignments.filter((a) => a.resourceId === ttResourceId);
}
function ttTicketByKey(key) {
  return ttTickets.find((t) => t.key === key);
}

function renderMyView() {
  if (!ttResourceId) return;
  if (!ttDataReady.resources || !ttDataReady.assignments || !ttDataReady.tickets) return;

  const me = ttMyResource();
  if (!me) {
    // Their resource doc might have just been deleted -- fall back to re-identify.
    sessionStorage.removeItem(TT_SESSION_KEY);
    ttResourceId = null;
    document.getElementById("tt-myview").style.display = "none";
    document.getElementById("tt-identify").style.display = "flex";
    return;
  }

  document.getElementById("tt-greeting").textContent = `Hi, ${me.name}! (${me.team})`;

  renderMyAssignmentsList(me);
  renderMyWeekLabel();
  renderMyHoursGrid(me);
}

function renderMyAssignmentsList(me) {
  const container = document.getElementById("tt-assignments-list");
  const countEl = document.getElementById("tt-assignment-count");
  const mine = ttMyAssignments()
    .map((a) => ({ a, ticket: ttTicketByKey(a.ticketKey) }))
    .filter((row) => row.ticket);

  mine.sort((a, b) => (a.ticket.dueDate || "9999") < (b.ticket.dueDate || "9999") ? -1 : 1);

  if (countEl) countEl.textContent = `(${mine.length})`;

  if (mine.length === 0) {
    container.innerHTML = `<p class="empty-state">No projects assigned to you yet. Check back later, or ask your manager.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Key</th><th>Project ID</th><th>Project Name</th><th>Territory</th><th>Status</th><th>Due Date</th></tr>
        </thead>
        <tbody>
          ${mine
            .map(
              ({ ticket }) => `
            <tr>
              <td class="col-key">${ticket.key}</td>
              <td class="col-updated">${escapeHtml(ticket.projectId || "\u2014")}</td>
              <td>${escapeHtml(ticket.projectName)}</td>
              <td>${escapeHtml(ticket.territory || "Unassigned")}</td>
              <td><span class="status-pill ${statusPillClass(ticket.statusCategory)}">${ticket.statusCategory}</span></td>
              <td class="col-updated">${formatDate(ticket.dueDate)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderMyWeekLabel() {
  const dates = ttCurrentWeekDates();
  document.getElementById("tt-week-label").textContent = ttWeekRangeLabel(dates[0], dates[6]);
}

function renderMyHoursGrid() {
  const container = document.getElementById("tt-hours-grid");
  const week = ttCurrentWeekDates();
  const mine = ttMyAssignments()
    .map((a) => ({ a, ticket: ttTicketByKey(a.ticketKey) }))
    .filter((row) => row.ticket);

  if (mine.length === 0) {
    container.innerHTML = `<p class="empty-state">You'll be able to log hours here once a manager assigns you to a project.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="rm-grid">
        <thead>
          <tr>
            <th style="min-width:180px;">Project</th>
            ${week.map((d) => `<th class="rm-daycol">${ttDayLabel(d)}</th>`).join("")}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${mine
            .map(({ a, ticket }) => {
              let rowTotal = 0;
              const today = ttToISO(new Date());
              const cells = week
                .map((d) => {
                  const bucket = a.actualHours || a.hours || {};
                  const own = bucket[d] || 0;
                  rowTotal += own;
                  const isFuture = d > today;
                  return `<td class="rm-daycell">
                    <span class="rm-cellbox"><input type="number" min="0" step="1" value="${own}" data-assign="${a.id}" data-date="${d}" ${isFuture ? "disabled title=\"Can't log hours for a future day\"" : ""}></span>
                  </td>`;
                })
                .join("");
              return `<tr>
                <td class="namecell"><span class="col-key">${ticket.key}</span><br /><span style="font-weight:400;">${escapeHtml(ticket.projectName)}</span></td>
                ${cells}
                <td class="totalcell">${rowTotal}h</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <p id="tt-save-msg" class="rm-apply-msg" style="margin-top:8px;"></p>
  `;

  container.querySelectorAll("input[data-assign]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const val = Math.max(0, parseFloat(e.target.value) || 0);
      ttUpdateHour(e.target.dataset.assign, e.target.dataset.date, val);
    });
  });
}

async function ttUpdateHour(assignmentId, date, value) {
  const msg = document.getElementById("tt-save-msg");
  try {
    await db.collection("assignments").doc(assignmentId).update({ [`actualHours.${date}`]: value });
    const assignment = ttAssignments.find((a) => a.id === assignmentId);
    if (assignment) {
      await db.collection("assignment_history").add({
        ticketKey: assignment.ticketKey,
        resourceId: assignment.resourceId,
        date,
        hours: value,
        field: "actualHours",
        changedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (msg) {
      msg.style.color = "#4B7A52";
      msg.textContent = "Saved.";
      setTimeout(() => { if (msg) msg.textContent = ""; }, 1500);
    }
  } catch (err) {
    console.error("Failed to update hours:", err);
    if (msg) {
      msg.style.color = "#8A2A17";
      msg.textContent = `Could not save: ${err.message}`;
    }
  }
}

initTimeTracking();
