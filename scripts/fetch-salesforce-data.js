// scripts/fetch-salesforce-data.js
//
// Pulls the Scan2Serv quote pipeline from Salesforce and writes a compact
// summary to data/salesforce-data.json for the static dashboard's
// "Scan2Serv Pipeline" page.
//
// Reproduces the exact 5 SOQL queries and the join/dedup/probability-weighting
// /currency-conversion logic of the original "Scan2Serv pipeline" Claude
// Dashboard artifact, so the numbers here match what that live dashboard
// would show.
//
// Required environment variables (set as GitHub Actions secrets). This uses
// the OAuth2 username-password flow, the simplest to automate for a service
// account; ask your Salesforce admin for a Connected App + these values:
//   SALESFORCE_LOGIN_URL       e.g. "https://login.salesforce.com" (or
//                               "https://test.salesforce.com" for a sandbox)
//   SALESFORCE_CLIENT_ID       Connected App "Consumer Key"
//   SALESFORCE_CLIENT_SECRET   Connected App "Consumer Secret"
//   SALESFORCE_USERNAME        service account username
//   SALESFORCE_PASSWORD        service account password
//   SALESFORCE_SECURITY_TOKEN  service account security token (append to
//                               password unless the org IP-allowlists the
//                               GitHub Actions runners, in which case this
//                               can be blank)
//
// NOTE: this script is written and ready, but has NOT been run end-to-end
// against real credentials -- that requires IT/the Salesforce admin to
// provision the Connected App and service account above. Until then,
// data/salesforce-data.json is seeded by a one-time manual pull (see
// README.md) and this script sits ready to wire into a GitHub Actions
// workflow once credentials exist.

const fs = require("fs");
const path = require("path");

const LOGIN_URL = process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID;
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;
const USERNAME = process.env.SALESFORCE_USERNAME;
const PASSWORD = process.env.SALESFORCE_PASSWORD;
const SECURITY_TOKEN = process.env.SALESFORCE_SECURITY_TOKEN || "";
const API_VERSION = "v60.0";

if (!CLIENT_ID || !CLIENT_SECRET || !USERNAME || !PASSWORD) {
  console.error(
    "Missing one of SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, SALESFORCE_USERNAME, SALESFORCE_PASSWORD environment variables."
  );
  process.exit(1);
}

async function authenticate() {
  const params = new URLSearchParams({
    grant_type: "password",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username: USERNAME,
    password: `${PASSWORD}${SECURITY_TOKEN}`,
  });
  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Salesforce authentication failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  return { accessToken: json.access_token, instanceUrl: json.instance_url };
}

async function soqlQuery(instanceUrl, accessToken, q) {
  const url = `${instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(q)}`;
  const records = [];
  let next = url;
  while (next) {
    const res = await fetch(next, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SOQL query failed (${res.status}): ${body}`);
    }
    const json = await res.json();
    records.push(...json.records);
    next = json.nextRecordsUrl ? `${instanceUrl}${json.nextRecordsUrl}` : null;
  }
  return records;
}

// ===== The 5 queries, verbatim from the original dashboard artifact =====

const QUOTE_FIELDS = `QuoteId qid, Quote.IsSyncing sy, Quote.Status st, Quote.OpportunityId oid, Quote.Opportunity.Name oname, Quote.Opportunity.StageName stage, Quote.Opportunity.CloseDate cd, Quote.Opportunity.Location_Franchise__r.Name fr, Quote.Account.Name acct, Quote.Opportunity.Owner.Name own, Quote.CurrencyIsoCode cur, SUM(TotalPrice) tot`;
const QUOTE_GROUP_BY = `QuoteId, Quote.IsSyncing, Quote.Status, Quote.OpportunityId, Quote.Opportunity.Name, Quote.Opportunity.StageName, Quote.Opportunity.CloseDate, Quote.Opportunity.Location_Franchise__r.Name, Quote.Account.Name, Quote.Opportunity.Owner.Name, Quote.CurrencyIsoCode`;
const PRODUCT_FILTER = `(Product2.Family LIKE 'SCAN2SERV%' OR Product2.Name LIKE 'SCAN2SERV%')`;
const STATUS_FILTER = `Quote.Status IN ('Draft','Submitted for Approval','Approved')`;

const QUERIES = {
  closed_won: `SELECT ${QUOTE_FIELDS} FROM QuoteLineItem WHERE ${PRODUCT_FILTER} AND Quote.Opportunity.StageName = 'Closed Won' AND Quote.Opportunity.CloseDate = LAST_N_DAYS:30 AND ${STATUS_FILTER} GROUP BY ${QUOTE_GROUP_BY}`,
  negotiation: `SELECT ${QUOTE_FIELDS} FROM QuoteLineItem WHERE ${PRODUCT_FILTER} AND Quote.Opportunity.StageName = 'Negotiation' AND ${STATUS_FILTER} GROUP BY ${QUOTE_GROUP_BY}`,
  quoting: `SELECT ${QUOTE_FIELDS} FROM QuoteLineItem WHERE ${PRODUCT_FILTER} AND Quote.Opportunity.StageName = 'Quoting' AND ${STATUS_FILTER} GROUP BY ${QUOTE_GROUP_BY}`,
  early: `SELECT ${QUOTE_FIELDS} FROM QuoteLineItem WHERE ${PRODUCT_FILTER} AND Quote.Opportunity.StageName IN ('Prospect','Qualification','Demo') AND ${STATUS_FILTER} GROUP BY ${QUOTE_GROUP_BY}`,
  fx: `SELECT IsoCode, ConversionRate FROM CurrencyType WHERE IsActive = true`,
};

// ===== Join / dedup / probability-weighting / currency-conversion logic =====
// (identical to scripts/build-salesforce-data.js / the original artifact)

const PROB = {
  "Closed Won": 1,
  Negotiation: 0.7,
  Quoting: 0.35,
  Demo: 0.25,
  Qualification: 0.1,
  Prospect: 0.1,
};
const RANK = { Approved: 3, "Submitted for Approval": 2, Draft: 1 };

function normalize(raw) {
  return raw.map((r) => ({
    quote_id: r.qid,
    synced: r.sy === true,
    status: r.st,
    opp_id: r.oid,
    opp: r.oname,
    stage: r.stage,
    close_date: r.cd,
    franchise: r.fr,
    account: r.acct,
    owner: r.own,
    currency: r.cur,
    amount: Number(r.tot),
  }));
}

function better(r, usd, o) {
  if (r.synced !== o.synced) return r.synced ? r : o;
  const rRank = RANK[r.status] || 0;
  const oRank = RANK[o.status] || 0;
  if (rRank !== oRank) return rRank > oRank ? r : o;
  return usd(r) >= usd(o) ? r : o;
}
const usdOf = (r) => r.amount;

function buildRows({ closed_won, negotiation, quoting, early, fx }) {
  const rateMap = {};
  for (const f of fx) rateMap[f.IsoCode] = Number(f.ConversionRate);

  const all = [...closed_won, ...negotiation, ...quoting, ...early];
  const byOpp = new Map();
  for (const r of all) {
    const existing = byOpp.get(r.opp_id);
    byOpp.set(r.opp_id, existing ? better(r, usdOf, existing) : r);
  }

  const rows = [];
  for (const r of byOpp.values()) {
    const usd = usdOf(r);
    const rate = rateMap[r.currency] != null ? rateMap[r.currency] : 1;
    const local = usd * rate;
    const prob = PROB[r.stage] != null ? PROB[r.stage] : 0;
    const wusd = usd * prob;
    const oppQuotes = all.filter((x) => x.opp_id === r.opp_id);
    rows.push({
      opp_id: r.opp_id,
      opp: r.opp,
      account: r.account,
      owner: r.owner,
      franchise: r.franchise,
      stage: r.stage,
      close_date: r.close_date,
      quote_id: r.quote_id,
      synced: r.synced,
      status: r.status,
      status_rank: RANK[r.status] || 0,
      currency: r.currency,
      local: Math.round(local * 100) / 100,
      usd: Math.round(usd * 100) / 100,
      prob,
      wusd: Math.round(wusd * 100) / 100,
      quotes: [...new Set(oppQuotes.map((x) => x.quote_id))],
      statuses: [...new Set(oppQuotes.map((x) => x.status))],
    });
  }
  rows.sort((a, b) => b.usd - a.usd);
  return rows;
}

async function main() {
  console.log("Authenticating with Salesforce...");
  const { accessToken, instanceUrl } = await authenticate();

  console.log("Running SOQL queries...");
  const [closed_won, negotiation, quoting, early, fxRaw] = await Promise.all([
    soqlQuery(instanceUrl, accessToken, QUERIES.closed_won),
    soqlQuery(instanceUrl, accessToken, QUERIES.negotiation),
    soqlQuery(instanceUrl, accessToken, QUERIES.quoting),
    soqlQuery(instanceUrl, accessToken, QUERIES.early),
    soqlQuery(instanceUrl, accessToken, QUERIES.fx),
  ]);

  const rows = buildRows({
    closed_won: normalize(closed_won),
    negotiation: normalize(negotiation),
    quoting: normalize(quoting),
    early: normalize(early),
    fx: fxRaw,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    source: "Salesforce (automated daily sync)",
    fx: fxRaw.map((f) => ({ code: f.IsoCode, rate: Number(f.ConversionRate) })),
    rows,
  };

  const outPath = path.join(__dirname, "..", "data", "salesforce-data.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${rows.length} project rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
