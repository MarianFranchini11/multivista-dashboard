// top-franchises.js
// This page reuses dashboard.js entirely (same KPIs, charts, Due Soon
// section, table) -- it just sets DASHBOARD_SCOPE_TERRITORIES before
// calling initDashboardPage(), so every bit of that page is automatically
// limited to the territories owned by this set of people.

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

async function initTopFranchisesScope() {
  const banner = document.getElementById("tf-scope-banner");
  try {
    const all = await loadFranchiseData();
    const matching = all.filter((f) => f.owners.some((o) => TOP_FRANCHISE_OWNERS_LOWER.has(o.toLowerCase())));
    const territories = Array.from(new Set(matching.flatMap((f) => f.territories)));

    DASHBOARD_SCOPE_TERRITORIES = territories;

    banner.innerHTML = `Scoped to <strong>${matching.length} franchise${matching.length === 1 ? "" : "s"}</strong> (${territories.length} territor${territories.length === 1 ? "y" : "ies"}) owned by: ${escapeHtml(TOP_FRANCHISE_OWNERS.join(", "))}.`;
  } catch (err) {
    console.error("Could not load franchise scope:", err);
    banner.innerHTML = `Could not load franchise scope -- showing nothing. Check that franchises.json is reachable.`;
    DASHBOARD_SCOPE_TERRITORIES = [];
  }

  initDashboardPage();
}

initTopFranchisesScope();
