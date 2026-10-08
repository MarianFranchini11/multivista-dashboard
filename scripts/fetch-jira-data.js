// scripts/fetch-jira-data.js
//
// Pulls issues from every Jira project the authenticated account can see,
// and writes a compact summary to data/data.json for the static dashboard.
//
// Required environment variables (set as GitHub Actions secrets):
//   JIRA_DOMAIN     e.g. "multivista.atlassian.net"
//   JIRA_EMAIL      the Atlassian account email tied to the API token
//   JIRA_API_TOKEN  the API token generated at id.atlassian.com

const fs = require("fs");
const path = require("path");

const DOMAIN = process.env.JIRA_DOMAIN;
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_API_TOKEN;

if (!DOMAIN || !EMAIL || !TOKEN) {
  console.error(
    "Missing one of JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN environment variables."
  );
  process.exit(1);
}

const BASE_URL = `https://${DOMAIN}/rest/api/3`;
const AUTH_HEADER =
  "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

async function jiraGet(urlPath) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    headers: {
      Authorization: AUTH_HEADER,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira request failed (${res.status}): ${urlPath}\n${body}`);
  }
  return res.json();
}

// Jira custom fields are exposed by internal id (e.g. "customfield_10102"),
// not by their visible name. Resolve the ids we care about once, by name.
const CUSTOM_FIELD_NAMES = [
  "MDS Territory",
  "ScanTo Service",
  "Price",
  "Square Footage",
  "Project Name",
  "Project Type",
  "FTP Folder Path",
  "Map Link",
  "Salesforce Link",
  "Quoted Turnaround",
  "Project ID",
  "Original Due Date",
];

async function resolveCustomFieldIds() {
  const allFields = await jiraGet("/field");
  const byName = {};
  for (const f of allFields) {
    byName[f.name.trim().toLowerCase()] = f.id;
  }
  const resolved = {};
  for (const name of CUSTOM_FIELD_NAMES) {
    const id = byName[name.trim().toLowerCase()];
    if (id) {
      resolved[name] = id;
    } else {
      console.log(`  [warn] Custom field "${name}" not found -- skipping.`);
    }
  }
  return resolved;
}

// Custom field values come back in different shapes depending on field
// type: plain strings/numbers for text fields, {value: "..."} for single
// select, arrays for multi-select, etc. Normalize to a plain string.
function extractFieldValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    return raw.map(extractFieldValue).filter(Boolean).join(", ") || null;
  }
  if (typeof raw === "object") {
    if (raw.type === "doc") {
      // Rich-text (textarea) fields store an Atlassian Document Format
      // object instead of a plain string.
      const text = adfToText(raw).trim();
      return text || null;
    }
    return raw.value ?? raw.name ?? null;
  }
  return String(raw);
}

// Same idea, but keeps the value numeric (for fields like Price we need to
// sum/average, not display as text).
function extractNumberValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    raw = raw.value ?? null;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

// Comment bodies come back as Atlassian Document Format (a structured JSON
// document), not plain text. Walk the tree and pull out just the text.
function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  let text = "";
  if (node.type === "text" && node.text) text += node.text;
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      text += adfToText(child);
    }
    // Add a line break after block-level nodes for readability.
    if (["paragraph", "heading", "listItem"].includes(node.type)) text += "\n";
  }
  return text;
}

// Fetch up to `limit` most recent comments for one issue.
async function getRecentComments(issueKey, limit = 10) {
  const body = await jiraGet(`/issue/${issueKey}/comment?maxResults=${limit}`);
  const comments = (body.comments || []).map((c) => ({
    author: c.author ? c.author.displayName : "Unknown",
    created: c.created,
    body: adfToText(c.body).trim(),
  }));
  comments.sort((a, b) => new Date(b.created) - new Date(a.created));
  return comments.slice(0, limit);
}

// Global list of every workflow status name -> its category (To Do / In
// Progress / Done). Needed to interpret changelog entries below, since the
// changelog only gives us status *names*, not categories.
async function getStatusCategoryMap() {
  const statuses = await jiraGet("/status");
  const map = {};
  for (const s of statuses) {
    map[s.name.trim().toLowerCase()] = s.statusCategory ? s.statusCategory.name : null;
  }
  return map;
}

// Looks at an issue's changelog once, and pulls out two dates:
//  - inProgressDate: first time it moved into a status whose *category* is
//    "In Progress" (used for the Gantt bar's visual start)
//  - dataValidatedDate: first time it moved into the specific status named
//    "S2S Backlog" (means the scan data was validated; used as the start
//    of the Quoted Turnaround clock)
// Either can be null if that transition never happened.
async function getStatusHistoryDates(issueKey, statusCategoryMap) {
  const body = await jiraGet(`/issue/${issueKey}/changelog?maxResults=100`);
  const histories = (body.values || []).slice().sort((a, b) => new Date(a.created) - new Date(b.created));
  let inProgressDate = null;
  let dataValidatedDate = null;
  for (const history of histories) {
    for (const item of history.items || []) {
      if (item.field !== "status") continue;
      const toName = (item.toString || "").trim();
      const category = statusCategoryMap[toName.toLowerCase()];
      if (!inProgressDate && category === "In Progress") {
        inProgressDate = history.created.slice(0, 10);
      }
      if (!dataValidatedDate && toName.toLowerCase() === "s2s backlog") {
        dataValidatedDate = history.created.slice(0, 10);
      }
    }
  }
  return { inProgressDate, dataValidatedDate };
}

// Determine which projects to sync: either an explicit list from
// JIRA_PROJECT_KEYS (comma-separated, e.g. "SCAN,ABC"), or -- if that's not
// set -- fall back to auto-discovering every project visible to the account.
//
// NOTE: we don't call /project/{key} here to fetch each project's display
// name -- that endpoint 404s on this Jira site (it uses the newer "Spaces"
// model where a board's project key doesn't resolve via the classic
// /project/{key} metadata endpoint). We only need issues, which we get via
// JQL search, and that works fine with the project key directly.
async function getProjects() {
  const explicitKeys = (process.env.JIRA_PROJECT_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (explicitKeys.length > 0) {
    console.log(`Using explicit project list: ${explicitKeys.join(", ")}`);
    return explicitKeys.map((key) => ({ key, name: key }));
  }

  // Fallback: auto-discover
  const projects = [];
  let startAt = 0;
  const maxResults = 50;
  while (true) {
    const page = await jiraGet(
      `/project/search?startAt=${startAt}&maxResults=${maxResults}`
    );
    console.log(
      `  [debug] /project/search page: total=${page.total}, isLast=${page.isLast}, values.length=${page.values.length}`
    );
    if (page.values.length === 0 && projects.length === 0) {
      console.log(`  [debug] raw response: ${JSON.stringify(page)}`);
    }
    projects.push(...page.values);
    if (page.isLast || projects.length >= page.total) break;
    startAt += maxResults;
  }
  return projects;
}

// Fetch all issues for a project (key fields only, paginated).
// Uses the current /search/jql endpoint. Pagination is token-based
// (nextPageToken), not offset-based -- the old startAt/search endpoint
// was fully removed by Atlassian.
async function getIssuesForProject(projectKey, customFieldIds) {
  const issues = [];
  const maxResults = 100;
  const fields = [
    "summary",
    "status",
    "assignee",
    "priority",
    "updated",
    "issuetype",
    "duedate",
    "resolutiondate",
    "created",
    "components",
    ...Object.values(customFieldIds),
  ];
  let nextPageToken = undefined;

  while (true) {
    const payload = {
      jql: `project = "${projectKey}" ORDER BY updated DESC`,
      maxResults,
      fields,
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    const body = await jiraPost("/search/jql", payload);

    for (const issue of body.issues) {
      const territoryId = customFieldIds["MDS Territory"];
      const serviceId = customFieldIds["ScanTo Service"];
      const priceId = customFieldIds["Price"];
      const sqftId = customFieldIds["Square Footage"];
      const projectNameId = customFieldIds["Project Name"];
      const projectTypeId = customFieldIds["Project Type"];
      const ftpId = customFieldIds["FTP Folder Path"];
      const mapLinkId = customFieldIds["Map Link"];
      const sfLinkId = customFieldIds["Salesforce Link"];
      const quotedTurnaroundId = customFieldIds["Quoted Turnaround"];
      const projectIdId = customFieldIds["Project ID"];
      const originalDueDateId = customFieldIds["Original Due Date"];
      const resolutionDate = issue.fields.resolutiondate || null;
      let deliveryStatus = null;
      if (resolutionDate && issue.fields.duedate) {
        deliveryStatus =
          resolutionDate.slice(0, 10) <= issue.fields.duedate ? "On time" : "Late";
      }

      issues.push({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status ? issue.fields.status.name : "Unknown",
        statusCategory: issue.fields.status
          ? issue.fields.status.statusCategory.name
          : "Unknown",
        assignee: issue.fields.assignee ? issue.fields.assignee.displayName : null,
        priority: issue.fields.priority ? issue.fields.priority.name : null,
        type: issue.fields.issuetype ? issue.fields.issuetype.name : null,
        updated: issue.fields.updated,
        dueDate: issue.fields.duedate || null,
        created: issue.fields.created || null,
        resolutionDate,
        deliveryStatus,
        territory: territoryId ? extractFieldValue(issue.fields[territoryId]) : null,
        serviceType: serviceId ? extractFieldValue(issue.fields[serviceId]) : null,
        price: priceId ? extractNumberValue(issue.fields[priceId]) : null,
        squareFootage: sqftId ? extractNumberValue(issue.fields[sqftId]) : null,
        projectName: projectNameId
          ? extractFieldValue(issue.fields[projectNameId])
          : issue.fields.summary,
        projectType: projectTypeId ? extractFieldValue(issue.fields[projectTypeId]) : null,
        ftpFolderPath: ftpId ? extractFieldValue(issue.fields[ftpId]) : null,
        mapLink: mapLinkId ? extractFieldValue(issue.fields[mapLinkId]) : null,
        salesforceLink: sfLinkId ? extractFieldValue(issue.fields[sfLinkId]) : null,
        quotedTurnaround: quotedTurnaroundId
          ? extractNumberValue(issue.fields[quotedTurnaroundId])
          : null,
        projectId: projectIdId ? extractFieldValue(issue.fields[projectIdId]) : null,
        originalDueDate: originalDueDateId ? extractFieldValue(issue.fields[originalDueDateId]) : null,
        components: (issue.fields.components || []).map((c) => c.name),
        inProgressDate: null,
        dataValidatedDate: null,
        comments: [],
      });
    }

    nextPageToken = body.nextPageToken;
    if (!nextPageToken) break;
  }

  // Comments + in-progress date require a separate call per issue -- only
  // do this for active (non-Done) tickets, so this stays fast even with
  // thousands of issues.
  const activeIssues = issues.filter((i) => i.statusCategory !== "Done");
  console.log(
    `  Fetching comments + status history for ${activeIssues.length} active ticket(s) (skipping ${issues.length - activeIssues.length} Done)...`
  );
  const statusCategoryMap = await getStatusCategoryMap();
  for (const issue of activeIssues) {
    try {
      issue.comments = await getRecentComments(issue.key);
    } catch (err) {
      console.error(`    Failed to fetch comments for ${issue.key}: ${err.message}`);
    }
    try {
      const dates = await getStatusHistoryDates(issue.key, statusCategoryMap);
      issue.inProgressDate = dates.inProgressDate;
      issue.dataValidatedDate = dates.dataValidatedDate;
    } catch (err) {
      console.error(`    Failed to fetch changelog for ${issue.key}: ${err.message}`);
      issue.inProgressDate = null;
      issue.dataValidatedDate = null;
    }
  }

  return issues;
}

async function jiraPost(urlPath, payload) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method: "POST",
    headers: {
      Authorization: AUTH_HEADER,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira request failed (${res.status}): ${urlPath}\n${body}`);
  }
  return res.json();
}

function summarizeByStatusCategory(issues) {
  const summary = { "To Do": 0, "In Progress": 0, Done: 0 };
  for (const issue of issues) {
    if (summary[issue.statusCategory] !== undefined) {
      summary[issue.statusCategory] += 1;
    }
  }
  return summary;
}

async function main() {
  console.log(`Fetching projects from ${DOMAIN} ...`);
  const projects = await getProjects();
  console.log(`Found ${projects.length} project(s).`);

  console.log("Resolving custom field ids...");
  const customFieldIds = await resolveCustomFieldIds();
  console.log(`  Resolved: ${JSON.stringify(customFieldIds)}`);

  const result = {
    generatedAt: new Date().toISOString(),
    domain: DOMAIN,
    projects: [],
  };

  for (const project of projects) {
    console.log(`  -> ${project.key} (${project.name})`);
    let issues = [];
    try {
      issues = await getIssuesForProject(project.key, customFieldIds);
    } catch (err) {
      console.error(`     Failed to fetch issues for ${project.key}: ${err.message}`);
      continue;
    }

    result.projects.push({
      key: project.key,
      name: project.name,
      totalIssues: issues.length,
      statusSummary: summarizeByStatusCategory(issues),
      issues,
    });
  }

  const outPath = path.join(__dirname, "..", "data", "data.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
