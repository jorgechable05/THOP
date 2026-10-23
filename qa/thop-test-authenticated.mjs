import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const adminEmail = process.env.ADMIN_EMAIL || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const clientEmail = process.env.CLIENT_EMAIL || "";
const clientPassword = process.env.CLIENT_PASSWORD || "";
const createClientIfMissing = process.env.CREATE_CLIENT_IF_MISSING === "true";

const results = [];
const startedAt = new Date().toISOString();
let adminToken = "";
let clientToken = "";
let adminProfile = null;
let clientProfile = null;

function record(id, name, status, details) {
  results.push({ id, name, status, details, at: new Date().toISOString() });
  console.log(`${status} ${id} ${name}: ${details}`);
}
function requireEnv() {
  const missing = [];
  for (const [k,v] of Object.entries({
    SUPABASE_URL: baseUrl,
    SUPABASE_PUBLISHABLE_KEY: apiKey,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword,
    CLIENT_EMAIL: clientEmail,
    CLIENT_PASSWORD: clientPassword,
  })) if (!v) missing.push(k);
  if (missing.length) throw new Error(`Missing required GitHub environment secrets: ${missing.join(", ")}`);
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("SUPABASE_URL must be an HTTPS URL");
}
async function request(path, { method = "GET", token = "", body, query = "" } = {}) {
  const response = await fetch(`${baseUrl}${path}${query}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token || apiKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}
function safeError(res) {
  const code = res?.data?.code || res?.data?.error_code || "api_error";
  const message = res?.data?.msg || res?.data?.message || res?.data?.error_description || "Request rejected";
  return `HTTP ${res.status}; ${String(code).slice(0,80)}; ${String(message).replace(/[\r\n\t]/g," ").slice(0,180)}`;
}
async function signIn(email, password) {
  const r = await request("/auth/v1/token", { method: "POST", query: "?grant_type=password", body: { email, password } });
  if (!r.ok || !r.data?.access_token) throw new Error(safeError(r));
  return { token: r.data.access_token, user: r.data.user };
}
async function getProfile(token) {
  const r = await request("/rest/v1/rpc/current_profile", { method: "POST", token, body: {} });
  return r;
}
async function rpc(token, name, body = {}) {
  return request(`/rest/v1/rpc/${name}`, { method: "POST", token, body });
}
async function run() {
  requireEnv();

  // Administrator session is independently authenticated through Supabase Auth.
  try {
    const session = await signIn(adminEmail, adminPassword);
    adminToken = session.token;
    const p = await getProfile(adminToken);
    if (!p.ok) {
      record("AUTH-01", "Administrator current_profile", "FAIL", safeError(p));
    } else {
      adminProfile = p.data;
      const role = Array.isArray(adminProfile) ? adminProfile[0]?.role : adminProfile?.role;
      if (role === "ADMIN") record("AUTH-01", "Administrator role", "PASS", "Authenticated session reports ADMIN");
      else record("AUTH-01", "Administrator role", "FAIL", `Expected ADMIN role; observed ${String(role ?? "missing")}`);
    }
  } catch (e) {
    record("AUTH-01", "Administrator sign-in/profile", "BLOCKED", String(e.message || e).slice(0,240));
  }

  // Register the synthetic client if requested; fall back to sign-in only if signup reports
  // an existing account. Do not record tokens, passwords, or full Auth responses.
  try {
    let session;
    if (createClientIfMissing) {
      const signup = await request("/auth/v1/signup", {
        method: "POST",
        body: { email: clientEmail, password: clientPassword, data: { role: "CLIENTE", customer_type: "PUBLICO" } },
      });
      if (signup.ok && signup.data?.access_token) {
        session = { token: signup.data.access_token, user: signup.data.user };
      } else {
        session = await signIn(clientEmail, clientPassword);
      }
    } else {
      session = await signIn(clientEmail, clientPassword);
    }
    clientToken = session.token;
    const p = await getProfile(clientToken);
    if (!p.ok) record("AUTH-02", "Client current_profile", "FAIL", safeError(p));
    else {
      clientProfile = p.data;
      const profile = Array.isArray(clientProfile) ? clientProfile[0] : clientProfile;
      const role = profile?.role;
      const type = profile?.customer_type ?? profile?.tipo_cliente ?? profile?.customerType;
      const status = profile?.status ?? profile?.estado;
      if (role === "CLIENTE" && (type === "PUBLICO" || type == null)) {
        record("AUTH-02", "Client profile defaults", type === "PUBLICO" ? "PASS" : "PARTIAL", `role=CLIENTE; customer type=${String(type ?? "not returned")}; status=${String(status ?? "not returned")}`);
      } else {
        record("AUTH-02", "Client profile defaults", "FAIL", `Expected CLIENTE/PUBLICO; observed role=${String(role)} type=${String(type)} status=${String(status)}`);
      }
    }
  } catch (e) {
    record("AUTH-02", "Client registration/sign-in", "BLOCKED", String(e.message || e).slice(0,240));
  }

  if (adminToken) {
    const r = await rpc(adminToken, "admin_list_products");
    record("AUTH-03", "Admin can invoke admin_list_products", r.ok ? "PASS" : "FAIL", r.ok ? "Authenticated ADMIN RPC succeeded" : safeError(r));
  } else record("AUTH-03", "Admin can invoke admin_list_products", "BLOCKED", "No administrator session");

  if (clientToken) {
    const r = await rpc(clientToken, "admin_list_products");
    record("AUTH-04", "Client denied admin_list_products", !r.ok ? "PASS" : "FAIL", !r.ok ? `RPC denied with HTTP ${r.status}` : "Client unexpectedly invoked administrative RPC");

    const direct = await request("/rest/v1/products", {
      token: clientToken,
      query: "?select=id,cost,precio_mayorista&limit=1",
    });
    record("SEC-01", "Client cannot read sensitive product columns", !direct.ok ? "PASS" : "FAIL",
      !direct.ok ? `Sensitive-column query rejected with HTTP ${direct.status}` : "Query succeeded; inspect response policy and returned rows before certification");

    for (const [id, table, label] of [
      ["SEC-02", "lots", "Client cannot read inventory lots"],
      ["SEC-03", "profiles", "Client cannot list profiles"],
    ]) {
      const r = await request(`/rest/v1/${table}`, { token: clientToken, query: "?select=*&limit=1" });
      const rowsVisible = r.ok && Array.isArray(r.data) && r.data.length > 0;
      record(id, label, !r.ok || (r.ok && Array.isArray(r.data) && r.data.length === 0) ? "PASS" : "FAIL",
        !r.ok ? `Request rejected with HTTP ${r.status}` : rowsVisible ? "Rows returned to client" : "No rows returned; verify RLS and grants before final certification");
    }
  } else {
    for (const [id,name] of [
      ["AUTH-04","Client denied admin_list_products"],
      ["SEC-01","Client cannot read sensitive product columns"],
      ["SEC-02","Client cannot read inventory lots"],
      ["SEC-03","Client cannot list profiles"],
    ]) record(id, name, "BLOCKED", "No client session");
  }

  const summary = {
    project: "THOP-TEST",
    projectRef: "xodufvmosjtpbamqnqkw",
    startedAt,
    completedAt: new Date().toISOString(),
    certification: "NOT_CERTIFIED",
    note: "Smoke tests only. This report does not certify all 25 acceptance cases. A rejected or empty REST response alone is not proof that every policy is correct.",
    results,
    counts: results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {}),
  };
  await mkdir("qa-results", { recursive: true });
  await writeFile("qa-results/thop-test-report.json", JSON.stringify(summary, null, 2) + "\n");
  if (results.some(x => x.status === "FAIL")) process.exitCode = 1;
}
try {
  await run();
} catch (e) {
  console.error(`BLOCKED runner setup: ${String(e.message || e).slice(0,240)}`);
  await mkdir("qa-results", { recursive: true });
  await writeFile("qa-results/thop-test-report.json", JSON.stringify({
    project: "THOP-TEST", projectRef: "xodufvmosjtpbamqnqkw",
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    certification: "NOT_CERTIFIED", results: [{ id: "SETUP-01", name: "Runner setup", status: "BLOCKED", details: String(e.message || e).slice(0,240) }]
  }, null, 2) + "\n");
  process.exitCode = 1;
} finally {
  // Drop references to tokens; never serialize or print them.
  adminToken = "";
  clientToken = "";
}
