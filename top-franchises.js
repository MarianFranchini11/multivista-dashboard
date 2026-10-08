// top-franchises.js
// Shows franchises owned by a specific set of people, with their
// territories and a live count of tickets in those territories.

const TOP_FRANCHISE_OWNERS = [
  "Luis Pascual",
  "Paul Mclaughlin",
  "JD Lott",
  "Justin Davis",
  "Markk Donnelly",
  "Huw Roberts",
  "David Stadnik",
  "Brent Pearce",
  "Charles Hill",
  "Karl Pallas",
  "Andrew Duffell",
  "Clayton Schuller",
];
const TOP_FRANCHISE_OWNERS_LOWER = new Set(TOP_FRANCHISE_OWNERS.map((o) => o.toLowerCase()));

let tfFranchises = [];
let tfTickets = [];

async function initTopFranchises() {
  try {
    const all = await loadFranchiseData();
    tfFranchises = all.filter((f) => f.owners.some((o) => TOP_FRANCHISE_OWNERS_LOWER.has(o.toLowerCase())));
  } catch (err) {
    console.error("Could not load franchise data:", err);
    document.getElementById("tf-list").innerHTML = `<p class="empty-state">Could not load franchises.json.</p>`;
    return;
  }

  try {
    const data = await loadDashboardData();
    renderSyncStatus(data);
    tfTickets = flattenIssues(data);
  } catch (err) {
    console.error("Could not load Jira tickets:", err);
  }

  populateOwnerFilter();
  renderList();

  document.getElementById("tf-owner-filter").addEventListener("change", renderList);
  document.getElementById("tf-search").addEventListener("input", renderList);
}

function populateOwnerFilter() {
  const select = document.getElementById("tf-owner-filter");
  select.innerHTML =
    '<option value="">All</option>' +
    TOP_FRANCHISE_OWNERS.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
}

function ticketCountsForTerritories(territoryCodes) {
  const tickets = tfTickets.filter((t) => territoryCodes.includes(t.territory));
  return {
    total: tickets.length,
    open: tickets.filter((t) => t.statusCategory !== "Done").length,
  };
}

function renderList() {
  const container = document.getElementById("tf-list");
  const countEl = document.getElementById("tf-count");
  const ownerFilter = document.getElementById("tf-owner-filter").value;
  const search = document.getElementById("tf-search").value.trim().toLowerCase();

  let rows = [...tfFranchises];
  if (ownerFilter) {
    rows = rows.filter((f) => f.owners.some((o) => o.toLowerCase() === ownerFilter.toLowerCase()));
  }
  if (search) {
    rows = rows.filter(
      (f) =>
        f.franchiseId.toLowerCase().includes(search) ||
        f.legalName.toLowerCase().includes(search) ||
        f.territories.some((t) => t.toLowerCase().includes(search))
    );
  }
  rows.sort((a, b) => a.franchiseId.localeCompare(b.franchiseId));

  if (countEl) countEl.textContent = `(${rows.length})`;

  if (rows.length === 0) {
    container.innerHTML = `<p class="empty-state">No franchises match these filters.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Franchise ID</th><th>Legal Name</th><th>Territories</th><th>Owners</th><th>Open Tickets</th><th>Total Tickets</th></tr>
        </thead>
        <tbody>
          ${rows
            .map((f) => {
              const counts = ticketCountsForTerritories(f.territories);
              return `<tr class="clickable-row" data-territories="${escapeHtml(f.territories.join(","))}">
              <td class="col-key">${escapeHtml(f.franchiseId)}</td>
              <td>${escapeHtml(f.legalName)}</td>
              <td>${escapeHtml(f.territories.join(", "))}</td>
              <td>${escapeHtml(f.owners.join(", "))}</td>
              <td>${counts.open}</td>
              <td>${counts.total}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll("tr[data-territories]").forEach((row) => {
    row.addEventListener("click", () => {
      const territories = row.dataset.territories.split(",");
      window.location.href = `issues.html?territory=${encodeURIComponent(territories[0])}`;
    });
  });
}

initTopFranchises();
