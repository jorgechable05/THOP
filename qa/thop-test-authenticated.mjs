import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const adminEmail = process.env.ADMIN_EMAIL || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const clientEmail = process.env.CLIENT_EMAIL || "";
const clientPassword = process.env.CLIENT_PASSWORD || "";
const createClientIfMissing = process.env.CREATE_CLIENT_IF_MISSING === "true";
const createAdminIfMissing = process.env.CREATE_ADMIN_IF_MISSING === "true";
const activeClientEmail = "thop-qa-active-client@example.com";
const qaPrefix = "[THOP-QA:";

const results = [];
const startedAt = new Date().toISOString();
let adminToken = "";
let clientToken = "";
let activeClientToken = "";
let adminProfile = null;
let clientProfile = null;
let activeClientProfile = null;
let fixtureData = null;

function record(id, name, status, details) {
  results.push({ id, name, status, details, at: new Date().toISOString() });
  console.log(`${status} ${id} ${name}: ${details}`);
}
function assertResult(id, name, condition, passDetails, failDetails) {
  record(id, name, condition ? "PASS" : "FAIL", condition ? passDetails : failDetails);
}
function requireEnv() {
  const missing = [];
  for (const [k, v] of Object.entries({
    SUPABASE_URL: baseUrl,
    SUPABASE_PUBLISHABLE_KEY: apiKey,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword,
    CLIENT_EMAIL: clientEmail,
    CLIENT_PASSWORD: clientPassword,
  })) if (!v) missing.push(k);
  if (missing.length) throw new Error(`Missing required GitHub environment secrets: ${missing.join(", ")}`);
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("SUPABASE_URL must be an HTTPS URL");
  const suppliedHost = new URL(baseUrl).hostname.toLowerCase();
  if (suppliedHost !== "xodufvmosjtpbamqnqkw.supabase.co") {
    throw new Error("SUPABASE_URL does not match the authorized THOP-TEST project; refusing to authenticate against another environment");
  }
  if (adminEmail.trim().toLowerCase() === clientEmail.trim().toLowerCase()) {
    throw new Error("Admin and default synthetic client must use different email addresses");
  }
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
  return { ok: response.ok, status: response.status, data, text };
}
function safeError(res) {
  const code = res?.data?.code || res?.data?.error_code || res?.data?.error || "api_error";
  const message = res?.data?.msg || res?.data?.message || res?.data?.error_description || res?.data?.reason || "Request rejected";
  return `HTTP ${res.status}; ${String(code).slice(0,80)}; ${String(message).replace(/[\r\n\t]/g," ").slice(0,180)}`;
}
async function signIn(email, password) {
  const r = await request("/auth/v1/token", { method: "POST", query: "?grant_type=password", body: { email, password } });
  if (!r.ok || !r.data?.access_token) throw new Error(safeError(r));
  return { token: r.data.access_token, user: r.data.user };
}
async function getProfile(token) {
  return request("/rest/v1/rpc/current_profile", { method: "POST", token, body: {} });
}
async function rpc(token, name, body = {}) {
  return request(`/rest/v1/rpc/${name}`, { method: "POST", token, body });
}
async function table(token, name, query = "?select=*") {
  return request(`/rest/v1/${name}`, { token, query });
}
async function rows(token, name, query = "?select=*") {
  const r = await table(token, name, query);
  if (!r.ok || !Array.isArray(r.data)) throw new Error(`${name}: ${safeError(r)}`);
  return r.data;
}
async function countRows(token, name, query = "?select=id") {
  return (await rows(token, name, query)).length;
}
function obj(data) {
  return Array.isArray(data) ? data[0] : data;
}
function fixture(key) {
  const id = fixtureData?.fixtures?.products?.[key];
  if (!id) throw new Error(`Missing fixture product id: ${key}`);
  return id;
}
function dateOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function qaNotes(label) {
  return `${qaPrefix}${label}]`;
}
async function qaOrders() {
  const all = await rows(activeClientToken || adminToken, "orders", "?select=id,notes,status,total,subtotal,customer_id&limit=1000");
  return all.filter((o) => o.customer_id === activeClientProfile?.id && typeof o.notes === "string" && o.notes.startsWith(qaPrefix));
}
async function lotByCode(code) {
  const found = await rows(adminToken, "lots", `?select=id,lot_code,quantity_received,quantity_available,expiry_date,unit_cost&lot_code=eq.${encodeURIComponent(code)}&limit=2`);
  return found[0] || null;
}
async function catalogPrice(productId) {
  const r = await rpc(activeClientToken, "catalog_price", { p_product_id: productId });
  return { response: r, price: typeof r.data === "number" ? r.data : Number(r.data) };
}
async function changeCustomerType(type) {
  return rpc(adminToken, "admin_update_customer_type", {
    p_customer_id: activeClientProfile.id,
    p_tipo: type,
  });
}
async function updateProduct(productId, { publicPrice, retailPrice = 8, wholesalePrice = 6, cost = 4 }) {
  return rpc(adminToken, "admin_update_product", {
    p_product_id: productId,
    p_sku: "THOP-QA-ORDER",
    p_name: "THOP QA Standard Product",
    p_description: "Synthetic THOP-TEST acceptance fixture",
    p_image_url: "",
    p_public_price: publicPrice,
    p_retail_price: retailPrice,
    p_wholesale_price: wholesalePrice,
    p_cost: cost,
    p_active: true,
    p_visible_catalog: true,
  });
}
async function run() {
  requireEnv();

  // Administrator account bootstrap is strictly opt-in and never elevates a signup automatically.
  try {
    let session;
    try {
      session = await signIn(adminEmail, adminPassword);
    } catch (loginError) {
      if (!createAdminIfMissing) throw loginError;
      const signup = await request("/auth/v1/signup", {
        method: "POST",
        body: { email: adminEmail, password: adminPassword, data: { full_name: "THOP QA synthetic administrator candidate" } },
      });
      const candidateId = signup?.data?.user?.id;
      if (signup.ok) {
        record("AUTH-01", "Administrator bootstrap candidate", "BLOCKED",
          `Signup created/accepted a CLIENTE by design; an authorized operator must promote only this synthetic account in THOP-TEST${candidateId ? `; user_id=${candidateId}` : ""}`);
      } else {
        record("AUTH-01", "Administrator sign-in/bootstrap", "BLOCKED",
          `Sign-in: ${String(loginError.message || loginError).slice(0,120)}; signup: ${safeError(signup)}`);
      }
      session = null;
    }
    if (session?.token) {
      adminToken = session.token;
      const p = await getProfile(adminToken);
      if (!p.ok) {
        record("AUTH-01", "Administrator current_profile", "FAIL", safeError(p));
      } else {
        adminProfile = obj(p.data);
        assertResult("AUTH-01", "Administrator role", adminProfile?.role === "ADMIN" && adminProfile?.estado_cuenta === "ACTIVO",
          "Authenticated session reports ADMIN/ACTIVO", `Expected ADMIN/ACTIVO; observed role=${String(adminProfile?.role)} status=${String(adminProfile?.estado_cuenta)}`);
      }
    }
  } catch (e) {
    record("AUTH-01", "Administrator sign-in/profile", "BLOCKED", String(e.message || e).slice(0,240));
  }

  // Admin-only helper provisions fixed synthetic users and isolated, tagged stock fixtures in THOP-TEST.
  if (createClientIfMissing && adminToken) {
    const provision = await request("/functions/v1/thop-qa-bootstrap-client", {
      method: "POST",
      token: adminToken,
      body: { password: clientPassword },
    });
    if (!provision.ok || provision.data?.ok !== true) {
      record("AUTH-02", "QA identities/fixtures bootstrap", "BLOCKED", safeError(provision));
    } else {
      fixtureData = provision.data;
      record("FIXTURE-01", "Synthetic QA identities and fixtures", "PASS",
        "Fixed default/active client identities and tagged catalog, supplier, and stock fixtures are ready in THOP-TEST");
    }
  } else if (!adminToken) {
    record("FIXTURE-01", "Synthetic QA identities and fixtures", "BLOCKED", "Administrator session required for test-only bootstrap");
  } else {
    record("FIXTURE-01", "Synthetic QA identities and fixtures", "BLOCKED", "CREATE_CLIENT_IF_MISSING is disabled; no automatic fixture setup was requested");
  }

  // Default-registration profile is kept PENDIENTE to test the trigger defaults.
  try {
    const defaultSession = await signIn(clientEmail, clientPassword);
    clientToken = defaultSession.token;
    const p = await getProfile(clientToken);
    if (!p.ok) {
      record("AUTH-02", "Client current_profile", "FAIL", safeError(p));
    } else {
      clientProfile = obj(p.data);
      const defaultsCorrect = clientProfile?.role === "CLIENTE" &&
        clientProfile?.tipo_cliente === "PUBLICO" &&
        clientProfile?.estado_cuenta === "PENDIENTE";
      assertResult("ACC-01", "New user defaults to CLIENTE/PUBLICO/PENDIENTE", defaultsCorrect,
        "Synthetic default profile has CLIENTE/PUBLICO/PENDIENTE",
        `Observed role=${String(clientProfile?.role)} customer=${String(clientProfile?.tipo_cliente)} status=${String(clientProfile?.estado_cuenta)}`);
    }
  } catch (e) {
    record("AUTH-02", "Default client sign-in/profile", "BLOCKED", String(e.message || e).slice(0,240));
  }

  // An independent active buyer session runs the price/order/RLS cases.
  try {
    const session = await signIn(activeClientEmail, clientPassword);
    activeClientToken = session.token;
    const p = await getProfile(activeClientToken);
    if (!p.ok) record("AUTH-05", "Active client session", "FAIL", safeError(p));
    else {
      activeClientProfile = obj(p.data);
      const correct = activeClientProfile?.role === "CLIENTE" &&
        activeClientProfile?.tipo_cliente === "PUBLICO" &&
        activeClientProfile?.estado_cuenta === "ACTIVO";
      assertResult("AUTH-05", "Independent active CLIENTE session", correct,
        "Active synthetic customer session is distinct from administrator and pending-registration session",
        `Observed role=${String(activeClientProfile?.role)} type=${String(activeClientProfile?.tipo_cliente)} status=${String(activeClientProfile?.estado_cuenta)}`);
    }
  } catch (e) {
    record("AUTH-05", "Active client session", "BLOCKED", String(e.message || e).slice(0,240));
  }

  // Core authorization smoke cases.
  if (adminToken) {
    const adminProducts = await rpc(adminToken, "admin_list_products");
    record("AUTH-03", "Admin can invoke admin_list_products", adminProducts.ok ? "PASS" : "FAIL",
      adminProducts.ok ? "Authenticated ADMIN RPC succeeded" : safeError(adminProducts));
    const adminProfiles = await rpc(adminToken, "admin_list_profiles");
    record("ACC-20", "Admin can access administrative profile report", adminProfiles.ok ? "PASS" : "FAIL",
      adminProfiles.ok ? "Administrative profile RPC succeeded" : safeError(adminProfiles));
  } else {
    record("AUTH-03", "Admin can invoke admin_list_products", "BLOCKED", "No administrator session");
    record("ACC-20", "Admin can access administrative profile report", "BLOCKED", "No administrator session");
  }

  if (activeClientToken) {
    const clientRpc = await rpc(activeClientToken, "admin_list_products");
    record("AUTH-04", "Client denied admin_list_products", !clientRpc.ok ? "PASS" : "FAIL",
      !clientRpc.ok ? `RPC denied with HTTP ${clientRpc.status}` : "Client unexpectedly invoked administrative RPC");
    const sensitive = await request("/rest/v1/products", {
      token: activeClientToken,
      query: "?select=id,cost,precio_mayorista&limit=1",
    });
    record("SEC-01", "Client cannot read cost/wholesale columns", !sensitive.ok ? "PASS" : "FAIL",
      !sensitive.ok ? `Sensitive-column query rejected with HTTP ${sensitive.status}` : "Sensitive-column query was allowed");

    for (const [id, query, label] of [
      ["SEC-02", "?select=id,quantity_available&limit=1", "Client cannot read inventory quantities"],
      ["ACC-10", "?select=id,expiry_date&limit=1", "Client cannot read lot expiry dates"],
    ]) {
      const r = await request("/rest/v1/lots", { token: activeClientToken, query });
      record(id, label, !r.ok ? "PASS" : "FAIL", !r.ok ? `Request rejected with HTTP ${r.status}` : "Client was allowed to read lot information");
    }
    const profiles = await request("/rest/v1/profiles", { token: activeClientToken, query: "?select=id,email&limit=1" });
    record("SEC-03", "Client cannot list profiles", !profiles.ok ? "PASS" : (Array.isArray(profiles.data) && profiles.data.length === 0 ? "INCONCLUSIVE" : "FAIL"),
      !profiles.ok ? `Request rejected with HTTP ${profiles.status}` : "Profiles endpoint did not prove isolation");
    const adminOnlyRpc = await rpc(activeClientToken, "admin_list_profiles");
    record("ACC-20B", "Client denied administrative profile report", !adminOnlyRpc.ok ? "PASS" : "FAIL",
      !adminOnlyRpc.ok ? `Denied with HTTP ${adminOnlyRpc.status}` : "Client unexpectedly invoked administrative profile report");

    // Case 2: a client cannot promote itself to MAYORISTA.
    const selfType = await request("/rest/v1/profiles", {
      method: "PATCH", token: activeClientToken,
      query: `?id=eq.${activeClientProfile.id}`,
      body: { tipo_cliente: "MAYORISTA" },
    });
    const afterSelfType = obj((await getProfile(activeClientToken)).data);
    assertResult("ACC-02", "Client cannot self-promote to MAYORISTA",
      (!selfType.ok || !Array.isArray(selfType.data) || selfType.data.length === 0) &&
      afterSelfType?.tipo_cliente === "PUBLICO",
      "Privilege-changing self-update was rejected and profile remains PUBLICO",
      `HTTP ${selfType.status}; observed type=${String(afterSelfType?.tipo_cliente)}`);

    // Case 3: a client cannot promote itself to ADMIN.
    const selfRole = await request("/rest/v1/profiles", {
      method: "PATCH", token: activeClientToken,
      query: `?id=eq.${activeClientProfile.id}`,
      body: { role: "ADMIN" },
    });
    const afterSelfRole = obj((await getProfile(activeClientToken)).data);
    assertResult("ACC-03", "Client cannot self-promote to ADMIN",
      (!selfRole.ok || !Array.isArray(selfRole.data) || selfRole.data.length === 0) &&
      afterSelfRole?.role === "CLIENTE",
      "Role-changing self-update was rejected and role remains CLIENTE",
      `HTTP ${selfRole.status}; observed role=${String(afterSelfRole?.role)}`);

    // Case 21: no editing another profile.
    const editOther = await request("/rest/v1/profiles", {
      method: "PATCH", token: activeClientToken,
      query: `?id=eq.${adminProfile?.id || ""}`,
      body: { full_name: "THOP QA unauthorized edit" },
    });
    const effectiveEdit = editOther.ok && Array.isArray(editOther.data) && editOther.data.length > 0;
    assertResult("ACC-21", "Client cannot edit another profile", !effectiveEdit,
      `No profile row was changed (HTTP ${editOther.status})`,
      "Client received a representation of a modified foreign profile");

    // Case 22: product writes are administrator-only.
    const productId = fixtureData?.fixtures?.products?.normal;
    const editProduct = productId ? await request("/rest/v1/products", {
      method: "PATCH", token: activeClientToken,
      query: `?id=eq.${productId}`,
      body: { name: "THOP QA unauthorized product edit" },
    }) : { ok: false, status: 0, data: null };
    const productMutation = editProduct.ok && Array.isArray(editProduct.data) && editProduct.data.length > 0;
    assertResult("ACC-22", "Client cannot modify product", !productMutation,
      `No product row was changed (HTTP ${editProduct.status})`,
      "Client received a representation of a modified product");
  } else {
    for (const [id,name] of [
      ["AUTH-04","Client denied admin_list_products"], ["SEC-01","Client cannot read sensitive columns"],
      ["SEC-02","Client cannot read inventory quantities"], ["ACC-10","Client cannot read lot expiry dates"],
      ["SEC-03","Client cannot list profiles"], ["ACC-20B","Client denied administrative profile report"],
      ["ACC-02","Client cannot self-promote to MAYORISTA"], ["ACC-03","Client cannot self-promote to ADMIN"],
      ["ACC-21","Client cannot edit another profile"], ["ACC-22","Client cannot modify product"],
    ]) record(id, name, "BLOCKED", "No active client session");
  }

  const enoughForBusinessTests = Boolean(adminToken && activeClientToken && fixtureData?.fixtures?.products && fixtureData?.fixtures?.supplier_id && activeClientProfile?.id);
  if (!enoughForBusinessTests) {
    for (const [id,name] of [
      ["ACC-04","PUBLICO price"],["ACC-05","MINORISTA price"],["ACC-06","MAYORISTA price"],["ACC-07","Special price priority"],
      ["ACC-11","Atomic normal order"],["ACC-12","Expired lot excluded"],["ACC-13","Insufficient stock rollback"],
      ["ACC-14","Concurrent orders do not oversell"],["ACC-15","Purchase rollback"],["ACC-16","Price change affects new orders"],
      ["ACC-17","Historical price snapshot"],["ACC-18","Purchase receipt"],["ACC-19","Purchase movement"],
      ["ACC-24","Last-stock concurrency"],["ACC-25","Admin customer type change affects price"],
    ]) record(id, name, "BLOCKED", "Missing authenticated QA session or bootstrap fixtures");
  } else {
    const productId = fixture("normal");
    const lowProductId = fixture("low");
    const expiredProductId = fixture("expired");
    const concurrentProductId = fixture("concurrent");
    const purchaseProductId = fixture("purchase");
    const supplierId = fixtureData.fixtures.supplier_id;

    try {
      // Prices 4-7: the server, not the browser, chooses by customer type and special price.
      for (const [type, expected, id] of [
        ["PUBLICO", 10, "ACC-04"],
        ["MINORISTA", 8, "ACC-05"],
        ["MAYORISTA", 6, "ACC-06"],
      ]) {
        const changed = await changeCustomerType(type);
        const priced = await catalogPrice(productId);
        assertResult(id, `Server catalog price for ${type}`,
          changed.ok && priced.response.ok && Math.abs(priced.price - expected) < 0.001,
          `Profile type=${type}; catalog_price=${String(priced.price)}`,
          `type update: ${changed.ok ? "ok" : safeError(changed)}; catalog_price: ${priced.response.ok ? String(priced.price) : safeError(priced.response)}; expected ${expected}`);
      }
      await changeCustomerType("PUBLICO");

      const special = await rpc(adminToken, "admin_update_special_prices", {
        p_customer_id: activeClientProfile.id,
        p_prices: { [productId]: "4.25" },
      });
      const specialPrice = await catalogPrice(productId);
      assertResult("ACC-07", "Active special price overrides customer price",
        special.ok && specialPrice.response.ok && Math.abs(specialPrice.price - 4.25) < 0.001,
        "Special price 4.25 overrides the PUBLICO list price",
        `update: ${special.ok ? "ok" : safeError(special)}; observed price=${String(specialPrice.price)}`);
      await rpc(adminToken, "admin_update_special_prices", { p_customer_id: activeClientProfile.id, p_prices: {} });

      // Case 11: successful transaction creates order, detail, tracking, and deducts stock atomically.
      const standardBefore = await lotByCode("THOP-QA-ORDER-LOT");
      const normalOrder = await rpc(activeClientToken, "create_order_atomic", {
        p_items: [{ product_id: productId, quantity: 2 }],
        p_notes: qaNotes("normal"),
      });
      const normalOrderId = normalOrder?.data?.order_id;
      const normalDetails = normalOrderId ? await rows(activeClientToken, "order_details", `?select=id,order_id,product_id,quantity,precio_unitario&order_id=eq.${normalOrderId}`) : [];
      const normalAfter = await lotByCode("THOP-QA-ORDER-LOT");
      const tracking = normalOrderId ? await rows(activeClientToken, "order_tracking", `?select=id,order_id,status&order_id=eq.${normalOrderId}`) : [];
      const normalOk = normalOrder.ok && normalOrderId && Number(normalOrder.data.total) === 20 &&
        normalDetails.length === 1 && Number(normalDetails[0].precio_unitario) === 10 &&
        tracking.some((x) => x.status === "RECIBIDO") &&
        standardBefore && normalAfter && normalAfter.quantity_available === standardBefore.quantity_available - 2;
      assertResult("ACC-11", "Normal order commits order/detail/tracking/stock together", normalOk,
        `Order created with total 20; stock ${standardBefore?.quantity_available}→${normalAfter?.quantity_available}`,
        `RPC=${normalOrder.ok ? JSON.stringify(normalOrder.data) : safeError(normalOrder)}; details=${normalDetails.length}; tracking=${tracking.length}`);

      // Cases 12 & 13: expired stock and insufficient stock both fail without partial order/stock changes.
      const expiredBefore = await lotByCode("THOP-QA-EXPIRED-LOT");
      const ordersBeforeExpired = await qaOrders();
      const expiredOrder = await rpc(activeClientToken, "create_order_atomic", {
        p_items: [{ product_id: expiredProductId, quantity: 1 }],
        p_notes: qaNotes("expired-rejected"),
      });
      const expiredAfter = await lotByCode("THOP-QA-EXPIRED-LOT");
      const ordersAfterExpired = await qaOrders();
      assertResult("ACC-12", "Expired lot cannot fulfill order",
        !expiredOrder.ok && expiredBefore?.quantity_available === expiredAfter?.quantity_available &&
        ordersAfterExpired.length === ordersBeforeExpired.length,
        "Order rejected and expired lot/order ledger unchanged",
        `RPC=${expiredOrder.ok ? "unexpected success" : safeError(expiredOrder)}; stock ${expiredBefore?.quantity_available}→${expiredAfter?.quantity_available}; orders ${ordersBeforeExpired.length}→${ordersAfterExpired.length}`);

      const lowBefore = await lotByCode("THOP-QA-LOW-LOT");
      const ordersBeforeLow = await qaOrders();
      const lowOrder = await rpc(activeClientToken, "create_order_atomic", {
        p_items: [{ product_id: lowProductId, quantity: 3 }],
        p_notes: qaNotes("insufficient-rejected"),
      });
      const lowAfter = await lotByCode("THOP-QA-LOW-LOT");
      const ordersAfterLow = await qaOrders();
      assertResult("ACC-13", "Insufficient stock leaves no partial order or stock change",
        !lowOrder.ok && lowBefore?.quantity_available === lowAfter?.quantity_available &&
        ordersAfterLow.length === ordersBeforeLow.length,
        "Order rejected; no order, detail, movement, or stock mutation committed",
        `RPC=${lowOrder.ok ? "unexpected success" : safeError(lowOrder)}; stock ${lowBefore?.quantity_available}→${lowAfter?.quantity_available}; orders ${ordersBeforeLow.length}→${ordersAfterLow.length}`);

      // Case 15: a failure after the first valid purchase item must roll back every inserted row.
      const beforePurchaseRollback = {
        purchases: await countRows(adminToken, "purchases", "?select=id&limit=1000"),
        details: await countRows(adminToken, "purchase_details", "?select=id&limit=1000"),
        qaLots: await countRows(adminToken, "lots", "?select=id&lot_code=like.THOP-QA-%&limit=1000"),
        movements: await countRows(adminToken, "inventory_movements", "?select=id&limit=1000"),
      };
      const rollbackPurchase = await rpc(adminToken, "receive_purchase_atomic", {
        p_supplier_id: supplierId,
        p_items: [
          { product_id: purchaseProductId, quantity: 1, unit_cost: "4.00", lot_code: `THOP-QA-ROLLBACK-${Date.now()}`, expiry_date: dateOffset(90) },
          { product_id: "not-a-uuid", quantity: 1, unit_cost: "1.00", lot_code: "THOP-QA-ROLLBACK-INVALID", expiry_date: dateOffset(90) },
        ],
      });
      const afterPurchaseRollback = {
        purchases: await countRows(adminToken, "purchases", "?select=id&limit=1000"),
        details: await countRows(adminToken, "purchase_details", "?select=id&limit=1000"),
        qaLots: await countRows(adminToken, "lots", "?select=id&lot_code=like.THOP-QA-%&limit=1000"),
        movements: await countRows(adminToken, "inventory_movements", "?select=id&limit=1000"),
      };
      const rollbackClean = !rollbackPurchase.ok &&
        JSON.stringify(beforePurchaseRollback) === JSON.stringify(afterPurchaseRollback);
      assertResult("ACC-15", "Failed purchase rolls back all partial writes", rollbackClean,
        "Invalid second item rejected; purchase/detail/lot/movement counts stayed unchanged",
        `RPC=${rollbackPurchase.ok ? "unexpected success" : safeError(rollbackPurchase)}; before=${JSON.stringify(beforePurchaseRollback)} after=${JSON.stringify(afterPurchaseRollback)}`);

      // Cases 18 & 19: receive a valid purchase and verify purchase, detail, lot, and movement.
      const purchaseCode = `THOP-QA-PURCHASE-COMMIT-${Date.now()}`;
      const receive = await rpc(adminToken, "receive_purchase_atomic", {
        p_supplier_id: supplierId,
        p_items: [{ product_id: purchaseProductId, quantity: 3, unit_cost: "4.20", lot_code: purchaseCode, expiry_date: dateOffset(120) }],
      });
      const purchaseId = receive?.data?.purchase_id;
      const purchaseRows = purchaseId ? await rows(adminToken, "purchases", `?select=id,status,total& id=eq.${purchaseId}`.replace("& ", "&")) : [];
      const purchaseDetails = purchaseId ? await rows(adminToken, "purchase_details", `?select=id,purchase_id,product_id,quantity,unit_cost,line_total,lot_code,expiry_date&purchase_id=eq.${purchaseId}`) : [];
      const receivedLot = await rows(adminToken, "lots", `?select=id,product_id,lot_code,quantity_received,quantity_available,unit_cost,expiry_date&lot_code=eq.${encodeURIComponent(purchaseCode)}`);
      const purchaseMovements = purchaseId ? await rows(adminToken, "inventory_movements", `?select=id,product_id,lot_id,movement_type,quantity,reference_type,reference_id&reference_id=eq.${purchaseId}`) : [];
      const purchaseOk = receive.ok && purchaseRows[0]?.status === "RECIBIDA" &&
        Math.abs(Number(purchaseRows[0]?.total) - 12.6) < 0.001 &&
        purchaseDetails.length === 1 && Number(purchaseDetails[0].quantity) === 3 &&
        Math.abs(Number(purchaseDetails[0].unit_cost) - 4.2) < 0.001 &&
        receivedLot.length === 1 && Number(receivedLot[0].quantity_available) === 3 &&
        purchaseMovements.some((m) => m.movement_type === "ENTRADA_COMPRA" && Number(m.quantity) === 3);
      assertResult("ACC-18", "Purchase receipt creates correct purchase/detail/lot", purchaseOk,
        "Received purchase total 12.60, quantity 3, lot with matching cost/expiry and stock",
        `RPC=${receive.ok ? JSON.stringify(receive.data) : safeError(receive)}; purchase=${purchaseRows.length}; detail=${purchaseDetails.length}; lot=${receivedLot.length}; movements=${purchaseMovements.length}`);
      assertResult("ACC-19", "Purchase receipt records inventory movement",
        purchaseOk && purchaseMovements.some((m) => m.movement_type === "ENTRADA_COMPRA" && m.reference_type === "purchase"),
        "ENTRADA_COMPRA movement references the received purchase",
        `Movement references/types=${JSON.stringify(purchaseMovements.map((m) => [m.reference_type,m.movement_type]))}`);

      // Cases 16 & 17: subsequent price changes affect new orders, never rewrite historical snapshots.
      const historicOrderId = normalOrderId;
      const oldSnapshotBefore = historicOrderId
        ? await rows(activeClientToken, "order_details", `?select=id,precio_unitario&order_id=eq.${historicOrderId}`)
        : [];
      const updatePrice = await updateProduct(productId, { publicPrice: 12, retailPrice: 9, wholesalePrice: 7, cost: 4 });
      const priceAfterChange = await catalogPrice(productId);
      const newOrder = await rpc(activeClientToken, "create_order_atomic", {
        p_items: [{ product_id: productId, quantity: 1 }],
        p_notes: qaNotes("after-price-change"),
      });
      const newOrderId = newOrder?.data?.order_id;
      const newDetail = newOrderId ? await rows(activeClientToken, "order_details", `?select=id,precio_unitario&order_id=eq.${newOrderId}`) : [];
      const oldSnapshotAfter = historicOrderId
        ? await rows(activeClientToken, "order_details", `?select=id,precio_unitario&order_id=eq.${historicOrderId}`)
        : [];
      assertResult("ACC-16", "Price update changes later catalog/orders", updatePrice.ok &&
        priceAfterChange.response.ok && Math.abs(priceAfterChange.price - 12) < 0.001 &&
        newOrder.ok && Math.abs(Number(newOrder.data.total) - 12) < 0.001 &&
        Math.abs(Number(newDetail[0]?.precio_unitario) - 12) < 0.001,
        "After price update, catalog and new order use price 12",
        `update=${updatePrice.ok ? "ok" : safeError(updatePrice)}; catalog=${String(priceAfterChange.price)}; newOrder=${newOrder.ok ? String(newOrder.data.total) : safeError(newOrder)}`);
      assertResult("ACC-17", "Historical order price remains unchanged", oldSnapshotBefore.length === 1 &&
        oldSnapshotAfter.length === 1 && Number(oldSnapshotBefore[0].precio_unitario) === 10 &&
        Number(oldSnapshotAfter[0].precio_unitario) === 10,
        "Earlier order detail preserves unit price 10 after catalog price changed",
        `before=${JSON.stringify(oldSnapshotBefore)} after=${JSON.stringify(oldSnapshotAfter)}`);

      // Cases 14 and 24: simultaneous orders competing for the last five units.
      const concurrentBefore = await lotByCode("THOP-QA-CONCURRENT-LOT");
      const [raceA, raceB] = await Promise.all([
        rpc(activeClientToken, "create_order_atomic", {
          p_items: [{ product_id: concurrentProductId, quantity: 4 }],
          p_notes: qaNotes("race-a"),
        }),
        rpc(activeClientToken, "create_order_atomic", {
          p_items: [{ product_id: concurrentProductId, quantity: 4 }],
          p_notes: qaNotes("race-b"),
        }),
      ]);
      const concurrentAfter = await lotByCode("THOP-QA-CONCURRENT-LOT");
      const raceOrders = (await qaOrders()).filter((o) => o.notes === qaNotes("race-a") || o.notes === qaNotes("race-b"));
      const raceSuccesses = [raceA, raceB].filter((x) => x.ok).length;
      const raceOk = raceSuccesses === 1 && concurrentBefore?.quantity_available === 5 &&
        concurrentAfter?.quantity_available === 1 && raceOrders.length === 1;
      assertResult("ACC-14", "Concurrent orders do not oversell stock", raceOk,
        "Exactly one of two simultaneous 4-unit orders succeeds against stock 5; balance is 1",
        `successes=${raceSuccesses}; stock=${concurrentBefore?.quantity_available}→${concurrentAfter?.quantity_available}; committed race orders=${raceOrders.length}`);
      assertResult("ACC-24", "Only one concurrent order obtains the last units", raceOk,
        "Database row locking admits only one competing transaction; failed order leaves no rows",
        `successes=${raceSuccesses}; committed race orders=${raceOrders.length}`);

      // Case 25: explicit administrator transition PUBLICO -> MAYORISTA changes price.
      await changeCustomerType("PUBLICO");
      const adminTypeChange = await changeCustomerType("MAYORISTA");
      const wholesaleAfterAdminChange = await catalogPrice(productId);
      assertResult("ACC-25", "Administrator changes customer type and effective price",
        adminTypeChange.ok && wholesaleAfterAdminChange.response.ok &&
        Math.abs(wholesaleAfterAdminChange.price - 7) < 0.001,
        "Admin changed active buyer to MAYORISTA; effective price follows current catalog wholesale price 7",
        `type change=${adminTypeChange.ok ? "ok" : safeError(adminTypeChange)}; effective price=${String(wholesaleAfterAdminChange.price)}`);
    } catch (e) {
      record("ACC-SETUP", "Business acceptance setup/execution", "BLOCKED", String(e.message || e).slice(0,240));
    } finally {
      // Restore shared synthetic fixtures after the test series; preserve the evidence in report.
      try { await rpc(adminToken, "admin_update_special_prices", { p_customer_id: activeClientProfile.id, p_prices: {} }); } catch {}
      try { await changeCustomerType("PUBLICO"); } catch {}
      try { await updateProduct(productId, { publicPrice: 10, retailPrice: 8, wholesalePrice: 6, cost: 4 }); } catch {}
    }
  }

  const summary = {
    project: "THOP-TEST",
    projectRef: "xodufvmosjtpbamqnqkw",
    startedAt,
    completedAt: new Date().toISOString(),
    certification: "NOT_CERTIFIED",
    note: "Automated authenticated acceptance checks against tagged synthetic data only. This runner now covers a broader subset of the 25-case matrix; cases not explicitly executed with evidence remain pending and this report is not full certification.",
    results,
    counts: results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {}),
  };
  await mkdir("qa-results", { recursive: true });
  await writeFile("qa-results/thop-test-report.json", JSON.stringify(summary, null, 2) + "\n");
  if (results.some((x) => ["FAIL", "INCONCLUSIVE", "BLOCKED"].includes(x.status))) process.exitCode = 1;
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
  adminToken = "";
  clientToken = "";
  activeClientToken = "";
}
