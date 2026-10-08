// shared.js
// Utilities shared by index.html (Dashboard) and issues.html (Issues List).

async function loadDashboardData() {
  const res = await fetch(`data/data.json?_=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
  return res.json();
}

// Static reference data (franchise ownership) -- NOT synced from Jira,
// lives in franchises.json at the project root, maintained by hand.
let _franchiseDataCache = null;
async function loadFranchiseData() {
  if (_franchiseDataCache) return _franchiseDataCache;
  const res = await fetch(`franchises.json?_=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load franchises.json (${res.status})`);
  _franchiseDataCache = await res.json();
  return _franchiseDataCache;
}

// Given the franchise list and a territory code (e.g. "GBR02"), returns
// the matching franchise record, or null if none owns that territory.
function findFranchiseForTerritory(franchises, territoryCode) {
  if (!territoryCode) return null;
  return franchises.find((f) => f.territories.includes(territoryCode)) || null;
}

function renderSyncStatus(data) {
  const pulse = document.getElementById("pulse");
  const text = document.getElementById("sync-text");
  if (!pulse || !text) return;

  if (!data.generatedAt) {
    text.textContent = "Not synced yet -- showing sample data";
    pulse.classList.add("stale");
    return;
  }

  const generated = new Date(data.generatedAt);
  const hoursAgo = Math.round((Date.now() - generated.getTime()) / 3600000);
  const label =
    hoursAgo <= 0 ? "moments ago" : hoursAgo === 1 ? "1 hour ago" : `${hoursAgo} hours ago`;

  text.textContent = `Synced ${label}`;
  if (hoursAgo > 30) pulse.classList.add("stale");
}

// Flatten every project's issues into one array, tagging each with its
// project key/name so cross-project views (like the Dashboard) can use them.
function flattenIssues(data) {
  const all = [];
  for (const project of data.projects) {
    for (const issue of project.issues) {
      all.push({ ...issue, projectKey: project.key, jiraProjectName: project.name });
    }
  }
  return all;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "\u2014";
  // iso is a plain date like "2026-07-24" (no time/timezone). Parsing that
  // directly with `new Date(iso)` treats it as UTC midnight, which then
  // renders as the *previous* day in any timezone behind UTC (e.g.
  // Argentina). Build the Date from the parts instead, in local time, so
  // the calendar date never shifts regardless of the viewer's timezone.
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

// Project size tier, computed from Price (not a Jira field -- purely
// derived). A = <=$7.5k, B = $7.5k-$20k, C = >$20k.
function priceTier(price) {
  if (price == null) return null;
  if (price <= 7500) return "A";
  if (price <= 20000) return "B";
  return "C";
}
function priceTierLabel(tier) {
  return { A: "Tier A (\u2264$7.5k)", B: "Tier B ($7.5k\u2013$20k)", C: "Tier C (>$20k)" }[tier] || "\u2014";
}

function statusPillClass(statusCategory) {
  if (statusCategory === "Done") return "status-done";
  if (statusCategory === "In Progress") return "status-progress";
  return "status-todo";
}

// ===== Project detail modal (shared by Dashboard + Tickets pages) =====

function formatDateTime(iso) {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function linkOrDash(url, label) {
  if (!url) return "\u2014";
  const safeUrl = escapeHtml(url);
  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || url)}</a>`;
}

function ensureModalMounted() {
  if (document.getElementById("project-modal")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div id="project-modal" class="modal-overlay" style="display:none;">
      <div class="modal-card">
        <button id="modal-close" class="modal-close" aria-label="Close">&times;</button>
        <div id="modal-body"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);

  document.getElementById("modal-close").addEventListener("click", closeProjectModal);
  document.getElementById("project-modal").addEventListener("click", (e) => {
    if (e.target.id === "project-modal") closeProjectModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProjectModal();
  });
}

function closeProjectModal() {
  const modal = document.getElementById("project-modal");
  if (modal) modal.style.display = "none";
}

async function openProjectModal(issue) {
  ensureModalMounted();

  let ownerText = "\u2014";
  try {
    const franchises = await loadFranchiseData();
    const franchise = findFranchiseForTerritory(franchises, issue.territory);
    if (franchise && franchise.owners.length > 0) {
      ownerText = escapeHtml(franchise.owners.join(", "));
    }
  } catch (err) {
    console.error("Could not load franchise owner data:", err);
  }

  const fields = [
    ["Project ID", escapeHtml(issue.projectId || "\u2014")],
    ["Territory", escapeHtml(issue.territory || "Unassigned")],
    ["Franchise Owner(s)", ownerText],
    ["Service Type", escapeHtml(issue.serviceType || "\u2014")],
    ["Project Type", escapeHtml(issue.projectType || "\u2014")],
    ["Components", issue.components && issue.components.length ? escapeHtml(issue.components.join(", ")) : "\u2014"],
    ["Price", issue.price != null ? issue.price.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "\u2014"],
    ["Square Footage", issue.squareFootage != null ? issue.squareFootage.toLocaleString("en-US") : "\u2014"],
    ["Due Date", formatDate(issue.dueDate)],
    ["Assignee", escapeHtml(issue.assignee || "Unassigned")],
    ["FTP Folder Path", issue.ftpFolderPath ? `<code>${escapeHtml(issue.ftpFolderPath)}</code>` : "\u2014"],
    ["Map Link", linkOrDash(issue.mapLink, "Open map")],
    ["Salesforce Link", linkOrDash(issue.salesforceLink, "Open in Salesforce")],
  ];

  const commentsHtml =
    issue.statusCategory === "Done"
      ? `<p class="modal-note">Comments aren't synced for completed tickets.</p>`
      : issue.comments && issue.comments.length > 0
      ? issue.comments
          .map(
            (c) => `
        <div class="comment-item">
          <div class="comment-head">
            <span class="comment-author">${escapeHtml(c.author)}</span>
            <span class="comment-date">${formatDateTime(c.created)}</span>
          </div>
          <div class="comment-body">${escapeHtml(c.body)}</div>
        </div>`
          )
          .join("")
      : `<p class="modal-note">No comments on this ticket yet.</p>`;

  document.getElementById("modal-body").innerHTML = `
    <div class="modal-head">
      <span class="project-key">${issue.key}</span>
      <span class="status-pill ${statusPillClass(issue.statusCategory)}">${issue.statusCategory}</span>
    </div>
    <h2 class="modal-title">${escapeHtml(issue.projectName)}</h2>
    <div class="modal-field-grid">
      ${fields.map(([label, value]) => `
        <div class="modal-field">
          <div class="modal-field-label">${label}</div>
          <div class="modal-field-value">${value}</div>
        </div>`).join("")}
    </div>
    <div class="modal-comments">
      <h3>Comments</h3>
      ${commentsHtml}
    </div>
  `;

  document.getElementById("project-modal").style.display = "flex";
}
