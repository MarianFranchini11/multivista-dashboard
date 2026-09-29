// franchise-tracking.js
// Log follow-up meetings with a territory/franchise, attach comments and
// action items to existing Jira tickets or brand-new "potential" projects,
// track open actions across all meetings, and browse meeting history.
// Firestore collections: "meetings", "meeting_items", "potential_projects".

let ftTickets = [];
let ftMeetings = [];
let ftItems = [];
let ftPotentialProjects = [];
let ftActiveMeetingId = null;
let ftSelectedTarget = null; // { type: "jira"|"potential", key, label }
let ftSubTab = "log";

function ftEscapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function initFranchiseTracking() {
  document.getElementById("ft-meeting-date").value = new Date().toISOString().slice(0, 10);

  loadDashboardData()
    .then((data) => {
      ftTickets = flattenIssues(data);
      populateTerritorySuggestions();
    })
    .catch((err) => console.error("Could not load Jira tickets:", err));

  db.collection("potential_projects").onSnapshot(
    (snap) => {
      ftPotentialProjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    (err) => console.error("Failed to load potential projects:", err)
  );

  db.collection("meetings").onSnapshot(
    (snap) => {
      ftMeetings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      populateTerritoryFilters();
      if (ftSubTab === "history") renderHistory();
    },
    (err) => console.error("Failed to load meetings:", err)
  );

  db.collection("meeting_items").onSnapshot(
    (snap) => {
      ftItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (ftSubTab === "log") renderActiveMeetingItems();
      if (ftSubTab === "actions") renderActionItems();
      if (ftSubTab === "history") renderHistory();
    },
    (err) => console.error("Failed to load meeting items:", err)
  );

  document.querySelectorAll(".rm-subnav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const target = link.dataset.fttab;
      ftSubTab = target;
      document.querySelectorAll(".rm-subnav-link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
      document.getElementById("ft-tab-log").style.display = target === "log" ? "block" : "none";
      document.getElementById("ft-tab-actions").style.display = target === "actions" ? "block" : "none";
      document.getElementById("ft-tab-history").style.display = target === "history" ? "block" : "none";
      if (target === "actions") renderActionItems();
      if (target === "history") renderHistory();
    });
  });

  document.getElementById("ft-meeting-form").addEventListener("submit", handleStartMeeting);
  document.getElementById("ft-finish-meeting").addEventListener("click", (e) => {
    e.preventDefault();
    finishMeeting();
  });

  document.getElementById("ft-project-search").addEventListener("input", (e) => {
    renderTargetSearchResults(e.target.value.trim());
  });
  document.getElementById("ft-new-potential").addEventListener("input", (e) => {
    if (e.target.value.trim()) {
      document.getElementById("ft-project-search").value = "";
      document.getElementById("ft-search-results").innerHTML = "";
      ftSelectedTarget = { type: "potential-new", key: null, label: e.target.value.trim() };
      renderSelectedTarget();
    }
  });
  document.getElementById("ft-is-action").addEventListener("change", (e) => {
    document.getElementById("ft-action-owner").style.display = e.target.checked ? "inline-block" : "none";
    document.getElementById("ft-action-due").style.display = e.target.checked ? "inline-block" : "none";
  });
  document.getElementById("ft-add-item-btn").addEventListener("click", handleAddItem);

  document.getElementById("ft-actions-territory").addEventListener("change", renderActionItems);
  document.getElementById("ft-history-territory").addEventListener("change", renderHistory);
  document.getElementById("ft-history-search").addEventListener("input", renderHistory);
}

function populateTerritorySuggestions() {
  const territories = new Set(ftTickets.map((t) => t.territory).filter(Boolean));
  document.getElementById("ft-territory-suggestions").innerHTML = Array.from(territories)
    .sort()
    .map((t) => `<option value="${ftEscapeAttr(t)}"></option>`)
    .join("");
}

function populateTerritoryFilters() {
  const territories = new Set(ftMeetings.map((m) => m.territory).filter(Boolean));
  for (const id of ["ft-actions-territory", "ft-history-territory"]) {
    const select = document.getElementById(id);
    const current = select.value;
    select.innerHTML =
      '<option value="">All</option>' +
      Array.from(territories).sort().map((t) => `<option value="${ftEscapeAttr(t)}">${escapeHtml(t)}</option>`).join("");
    select.value = current;
  }
}

// ---- Starting / finishing a meeting ----
async function handleStartMeeting(e) {
  e.preventDefault();
  const date = document.getElementById("ft-meeting-date").value;
  const territory = document.getElementById("ft-meeting-territory").value.trim();
  const notes = document.getElementById("ft-meeting-notes").value.trim();
  if (!date || !territory) return;

  try {
    const ref = await db.collection("meetings").add({
      date,
      territory,
      notes,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    ftActiveMeetingId = ref.id;
    document.getElementById("ft-meeting-form-section").style.display = "none";
    document.getElementById("ft-active-meeting").style.display = "block";
    document.getElementById("ft-active-meeting-title").textContent =
      `${date} \u00b7 ${territory}${notes ? " \u00b7 " + notes : ""}`;
    renderActiveMeetingItems();
  } catch (err) {
    alert(`Could not start meeting: ${err.message}`);
  }
}

function finishMeeting() {
  ftActiveMeetingId = null;
  ftSelectedTarget = null;
  document.getElementById("ft-active-meeting").style.display = "none";
  document.getElementById("ft-meeting-form-section").style.display = "block";
  document.getElementById("ft-meeting-form").reset();
  document.getElementById("ft-meeting-date").value = new Date().toISOString().slice(0, 10);
}

// ---- Target picker (search Jira tickets + potential projects) ----
function renderTargetSearchResults(query) {
  const container = document.getElementById("ft-search-results");
  if (!query) {
    container.innerHTML = "";
    return;
  }
  const q = query.toLowerCase();
  const ticketMatches = ftTickets
    .filter((t) => t.key.toLowerCase().includes(q) || (t.projectName || "").toLowerCase().includes(q))
    .slice(0, 8);
  const potentialMatches = ftPotentialProjects
    .filter((p) => p.name.toLowerCase().includes(q))
    .slice(0, 8);

  if (ticketMatches.length === 0 && potentialMatches.length === 0) {
    container.innerHTML = `<p class="empty-state">No matches. Use the "New potential project" field instead if this doesn't exist yet.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <tbody>
          ${ticketMatches
            .map(
              (t) => `<tr class="clickable-row" data-type="jira" data-key="${ftEscapeAttr(t.key)}" data-label="${ftEscapeAttr(t.key + " \u2014 " + t.projectName)}">
              <td class="col-key">${t.key}</td><td>${escapeHtml(t.projectName)}</td><td>${escapeHtml(t.territory || "\u2014")}</td>
            </tr>`
            )
            .join("")}
          ${potentialMatches
            .map(
              (p) => `<tr class="clickable-row" data-type="potential" data-key="${ftEscapeAttr(p.id)}" data-label="${ftEscapeAttr(p.name + " (potential)")}">
              <td colspan="2">${escapeHtml(p.name)} <span class="teambadge">potential</span></td><td>${escapeHtml(p.territory || "\u2014")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-key]").forEach((row) => {
    row.addEventListener("click", () => {
      ftSelectedTarget = { type: row.dataset.type, key: row.dataset.key, label: row.dataset.label };
      document.getElementById("ft-project-search").value = "";
      document.getElementById("ft-new-potential").value = "";
      container.innerHTML = "";
      renderSelectedTarget();
    });
  });
}

function renderSelectedTarget() {
  const el = document.getElementById("ft-selected-target");
  if (!ftSelectedTarget) {
    el.textContent = "";
    return;
  }
  const tag = ftSelectedTarget.type === "jira" ? "existing ticket" : "potential project";
  el.innerHTML = `Selected: <strong>${escapeHtml(ftSelectedTarget.label)}</strong> (${tag}) &middot; <a href="#" id="ft-clear-target">clear</a>`;
  document.getElementById("ft-clear-target").addEventListener("click", (e) => {
    e.preventDefault();
    ftSelectedTarget = null;
    renderSelectedTarget();
  });
}

// ---- Adding an item to the active meeting ----
async function handleAddItem() {
  const errorEl = document.getElementById("ft-add-item-error");
  errorEl.hidden = true;

  if (!ftActiveMeetingId) return;
  if (!ftSelectedTarget) {
    errorEl.textContent = "Pick or create a project first.";
    errorEl.hidden = false;
    return;
  }
  const comment = document.getElementById("ft-comment-text").value.trim();
  if (!comment) {
    errorEl.textContent = "Add a comment before saving.";
    errorEl.hidden = false;
    return;
  }
  const isAction = document.getElementById("ft-is-action").checked;
  const owner = document.getElementById("ft-action-owner").value.trim();
  const dueDate = document.getElementById("ft-action-due").value;

  const meeting = ftMeetings.find((m) => m.id === ftActiveMeetingId);
  const territory = meeting ? meeting.territory : "";

  try {
    let targetType = ftSelectedTarget.type;
    let targetKey = ftSelectedTarget.key;
    let targetLabel = ftSelectedTarget.label;

    if (targetType === "potential-new") {
      const ref = await db.collection("potential_projects").add({
        name: ftSelectedTarget.label,
        territory,
        notes: "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      targetType = "potential";
      targetKey = ref.id;
      targetLabel = `${ftSelectedTarget.label} (potential)`;
    }

    await db.collection("meeting_items").add({
      meetingId: ftActiveMeetingId,
      territory,
      targetType,
      targetKey,
      targetLabel,
      comment,
      isAction,
      actionOwner: isAction ? owner : "",
      actionDueDate: isAction ? dueDate : "",
      actionStatus: isAction ? "open" : "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    ftSelectedTarget = null;
    renderSelectedTarget();
    document.getElementById("ft-comment-text").value = "";
    document.getElementById("ft-is-action").checked = false;
    document.getElementById("ft-action-owner").value = "";
    document.getElementById("ft-action-owner").style.display = "none";
    document.getElementById("ft-action-due").value = "";
    document.getElementById("ft-action-due").style.display = "none";
  } catch (err) {
    errorEl.textContent = `Could not save item: ${err.message}`;
    errorEl.hidden = false;
  }
}

function renderActiveMeetingItems() {
  const container = document.getElementById("ft-items-list");
  if (!container || !ftActiveMeetingId) return;
  const items = ftItems.filter((i) => i.meetingId === ftActiveMeetingId);

  if (items.length === 0) {
    container.innerHTML = `<p class="empty-state">No items added yet for this meeting.</p>`;
    return;
  }

  container.innerHTML = items
    .map(
      (it) => `
    <div class="rm-history-panel" style="margin-top:0;margin-bottom:8px;">
      <strong>${escapeHtml(it.targetLabel)}</strong> &mdash; ${escapeHtml(it.comment)}
      ${it.isAction ? `<span class="rm-pacepill rm-pace-under" style="margin-left:6px;">ACTION: ${escapeHtml(it.actionOwner || "?")} by ${escapeHtml(it.actionDueDate || "?")}</span>` : ""}
    </div>`
    )
    .join("");
}

// ---- Open Action Items tab ----
function renderActionItems() {
  const container = document.getElementById("ft-actions-list");
  const countEl = document.getElementById("ft-actions-count");
  const territoryFilter = document.getElementById("ft-actions-territory").value;

  let actions = ftItems.filter((i) => i.isAction && i.actionStatus === "open");
  if (territoryFilter) actions = actions.filter((i) => i.territory === territoryFilter);
  actions.sort((a, b) => (a.actionDueDate || "9999") < (b.actionDueDate || "9999") ? -1 : 1);

  if (countEl) countEl.textContent = `(${actions.length})`;

  if (actions.length === 0) {
    container.innerHTML = `<p class="empty-state">No open action items. Nice work!</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th></th><th>Project</th><th>Action</th><th>Owner</th><th>Due</th><th>Territory</th></tr></thead>
        <tbody>
          ${actions
            .map(
              (it) => `
            <tr>
              <td><input type="checkbox" class="ft-mark-done" data-id="${it.id}" /></td>
              <td>${escapeHtml(it.targetLabel)}</td>
              <td>${escapeHtml(it.comment)}</td>
              <td>${escapeHtml(it.actionOwner || "\u2014")}</td>
              <td class="col-updated">${escapeHtml(it.actionDueDate || "\u2014")}</td>
              <td>${escapeHtml(it.territory || "\u2014")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll(".ft-mark-done").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      if (!e.target.checked) return;
      try {
        await db.collection("meeting_items").doc(e.target.dataset.id).update({ actionStatus: "done" });
      } catch (err) {
        alert(`Could not update: ${err.message}`);
      }
    });
  });
}

// ---- Meeting History tab ----
function renderHistory() {
  const container = document.getElementById("ft-history-list");
  const territoryFilter = document.getElementById("ft-history-territory").value;
  const search = document.getElementById("ft-history-search").value.trim().toLowerCase();

  let meetings = [...ftMeetings];
  if (territoryFilter) meetings = meetings.filter((m) => m.territory === territoryFilter);
  if (search) {
    meetings = meetings.filter(
      (m) => (m.notes || "").toLowerCase().includes(search) || (m.territory || "").toLowerCase().includes(search)
    );
  }
  meetings.sort((a, b) => (a.date < b.date ? 1 : -1));

  if (meetings.length === 0) {
    container.innerHTML = `<p class="empty-state">No meetings match these filters.</p>`;
    return;
  }

  container.innerHTML = meetings
    .map((m) => {
      const items = ftItems.filter((i) => i.meetingId === m.id);
      return `
      <details class="rm-group">
        <summary>${escapeHtml(m.date)} \u00b7 ${escapeHtml(m.territory)}${m.notes ? " \u00b7 " + escapeHtml(m.notes) : ""} <span class="rm-group-count">(${items.length} item${items.length === 1 ? "" : "s"})</span></summary>
        <div style="padding:10px 14px;">
          ${
            items.length === 0
              ? `<p class="empty-state">No items logged.</p>`
              : items
                  .map(
                    (it) => `<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:0.85rem;">
                <strong>${escapeHtml(it.targetLabel)}</strong> &mdash; ${escapeHtml(it.comment)}
                ${it.isAction ? `<span class="rm-pacepill ${it.actionStatus === "done" ? "rm-pace-pace" : "rm-pace-under"}" style="margin-left:6px;">${it.actionStatus === "done" ? "DONE" : "ACTION"}: ${escapeHtml(it.actionOwner || "?")} by ${escapeHtml(it.actionDueDate || "?")}</span>` : ""}
              </div>`
                  )
                  .join("")
          }
        </div>
      </details>`;
    })
    .join("");
}

initFranchiseTracking();
