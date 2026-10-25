import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_REF = "xodufvmosjtpbamqnqkw";
const DEFAULT_CLIENT_EMAIL = "thop-qa-client@example.com";
const ACTIVE_CLIENT_EMAIL = "thop-qa-active-client@example.com";
const DEFAULT_CLIENT_NAME = "THOP QA synthetic default client";
const ACTIVE_CLIENT_NAME = "THOP QA synthetic active client";
const CATEGORY_NAME = "THOP QA Test Fixtures";
const SUPPLIER_NAME = "THOP QA Synthetic Supplier";
const QA_SKUS = {
  normal: "THOP-QA-ORDER",
  low: "THOP-QA-LOW-STOCK",
  expired: "THOP-QA-EXPIRED-ONLY",
  concurrent: "THOP-QA-CONCURRENT",
  purchase: "THOP-QA-PURCHASE",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function failIf(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message || "database error"}`);
}
function isoDate(offsetDays: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !url.includes(PROJECT_REF)) return json({ error: "WRONG_TEST_PROJECT" }, 500);

  let serviceKey = legacyServiceKey || "";
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw);
      serviceKey = secretKeys.default || serviceKey;
    } catch {
      return json({ error: "SERVER_KEY_CONFIGURATION_INVALID" }, 500);
    }
  }
  if (!serviceKey) return json({ error: "SERVER_KEY_NOT_CONFIGURED" }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "INVALID_SESSION" }, 401);
  const adminUserId = authData.user.id;
  const { data: adminProfile, error: adminProfileError } = await admin
    .from("profiles").select("role,estado_cuenta").eq("id", adminUserId).maybeSingle();
  if (adminProfileError) return json({ error: "PROFILE_LOOKUP_FAILED" }, 500);
  if (adminProfile?.role !== "ADMIN" || adminProfile?.estado_cuenta !== "ACTIVO") {
    return json({ error: "ADMIN_REQUIRED" }, 403);
  }

  let payload: { password?: unknown };
  try { payload = await req.json(); }
  catch { return json({ error: "INVALID_JSON" }, 400); }
  const password = typeof payload.password === "string" ? payload.password : "";
  if (password.length < 6 || password.length > 72) return json({ error: "QA_PASSWORD_LENGTH_INVALID" }, 400);

  try {
    // Only two reserved synthetic test identities are managed here. Passwords are
    // rotated to the supplied QA secret on each run; no non-QA email is accepted.
    async function ensureUser(email: string, fullName: string, status: "PENDIENTE" | "ACTIVO") {
      let userId: string | null = null;
      const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      failIf(listError, "AUTH_USER_LIST_FAILED");
      const existing = listed.users.find((u) => (u.email || "").toLowerCase() === email);
      if (existing) {
        userId = existing.id;
        const { error } = await admin.auth.admin.updateUserById(userId, {
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });
        failIf(error, "QA_USER_UPDATE_FAILED");
      } else {
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: fullName },
        });
        failIf(error, "QA_USER_CREATE_FAILED");
        userId = data.user?.id || null;
      }
      if (!userId) throw new Error("QA_USER_ID_MISSING");
      const { error: profileUpdateError } = await admin.from("profiles").update({
        email,
        full_name: fullName,
        role: "CLIENTE",
        tipo_cliente: "PUBLICO",
        estado_cuenta: status,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      failIf(profileUpdateError, "QA_PROFILE_FIXTURE_FAILED");
      const { data: profile, error: profileReadError } = await admin.from("profiles")
        .select("id,role,tipo_cliente,estado_cuenta").eq("id", userId).single();
      failIf(profileReadError, "QA_PROFILE_VERIFY_FAILED");
      if (profile.role !== "CLIENTE" || profile.tipo_cliente !== "PUBLICO" || profile.estado_cuenta !== status) {
        throw new Error("QA_PROFILE_FIXTURE_MISMATCH");
      }
      return { id: userId, profile };
    }

    const defaultClient = await ensureUser(DEFAULT_CLIENT_EMAIL, DEFAULT_CLIENT_NAME, "PENDIENTE");
    const activeClient = await ensureUser(ACTIVE_CLIENT_EMAIL, ACTIVE_CLIENT_NAME, "ACTIVO");

    // Remove only rows tagged to these fixed synthetic identities and fixture prefix.
    const { data: oldQaOrders, error: oldOrdersError } = await admin.from("orders")
      .select("id").eq("customer_id", activeClient.id).like("notes", "[THOP-QA:%");
    failIf(oldOrdersError, "QA_ORDER_CLEANUP_LOOKUP_FAILED");
    const oldOrderIds = (oldQaOrders || []).map((o) => o.id);
    if (oldOrderIds.length) {
      const { error } = await admin.from("inventory_movements").delete()
        .eq("reference_type", "order").in("reference_id", oldOrderIds);
      failIf(error, "QA_MOVEMENT_CLEANUP_FAILED");
      const { error: deleteOrdersError } = await admin.from("orders").delete().in("id", oldOrderIds);
      failIf(deleteOrdersError, "QA_ORDER_CLEANUP_FAILED");
    }

    const { data: oldQaPurchaseDetails, error: purchaseDetailsLookupError } = await admin.from("purchase_details")
      .select("purchase_id").like("lot_code", "THOP-QA-%");
    failIf(purchaseDetailsLookupError, "QA_PURCHASE_CLEANUP_LOOKUP_FAILED");
    const oldPurchaseIds = [...new Set((oldQaPurchaseDetails || []).map((x) => x.purchase_id))];
    if (oldPurchaseIds.length) {
      const { error } = await admin.from("inventory_movements").delete()
        .eq("reference_type", "purchase").in("reference_id", oldPurchaseIds);
      failIf(error, "QA_PURCHASE_MOVEMENT_CLEANUP_FAILED");
      const { error: deletePurchasesError } = await admin.from("purchases").delete().in("id", oldPurchaseIds);
      failIf(deletePurchasesError, "QA_PURCHASE_CLEANUP_FAILED");
    }
    const { data: oldLots, error: lotsLookupError } = await admin.from("lots").select("id").like("lot_code", "THOP-QA-%");
    failIf(lotsLookupError, "QA_LOT_CLEANUP_LOOKUP_FAILED");
    const oldLotIds = (oldLots || []).map((x) => x.id);
    if (oldLotIds.length) {
      const { error } = await admin.from("inventory_movements").delete().in("lot_id", oldLotIds);
      failIf(error, "QA_LOT_MOVEMENT_CLEANUP_FAILED");
      const { error: deleteLotsError } = await admin.from("lots").delete().in("id", oldLotIds);
      failIf(deleteLotsError, "QA_LOT_CLEANUP_FAILED");
    }

    const { data: category, error: categoryError } = await admin.from("categories")
      .upsert({ name: CATEGORY_NAME, active: true }, { onConflict: "name" }).select("id").single();
    failIf(categoryError, "QA_CATEGORY_FIXTURE_FAILED");

    const productSpecs = [
      { key: "normal", sku: QA_SKUS.normal, name: "THOP QA Standard Product", precio_publico: 10, precio_minorista: 8, precio_mayorista: 6, cost: 4 },
      { key: "low", sku: QA_SKUS.low, name: "THOP QA Low Stock Product", precio_publico: 11, precio_minorista: 9, precio_mayorista: 7, cost: 4 },
      { key: "expired", sku: QA_SKUS.expired, name: "THOP QA Expired Lot Product", precio_publico: 12, precio_minorista: 10, precio_mayorista: 8, cost: 5 },
      { key: "concurrent", sku: QA_SKUS.concurrent, name: "THOP QA Concurrent Product", precio_publico: 13, precio_minorista: 11, precio_mayorista: 9, cost: 5 },
      { key: "purchase", sku: QA_SKUS.purchase, name: "THOP QA Purchase Product", precio_publico: 14, precio_minorista: 12, precio_mayorista: 10, cost: 6 },
    ];
    const productIds: Record<string,string> = {};
    for (const spec of productSpecs) {
      const { data, error } = await admin.from("products").upsert({
        sku: spec.sku, name: spec.name, category_id: category.id,
        precio_publico: spec.precio_publico, precio_minorista: spec.precio_minorista,
        precio_mayorista: spec.precio_mayorista, cost: spec.cost, active: true, visible_catalog: true,
      }, { onConflict: "sku" }).select("id,sku").single();
      failIf(error, "QA_PRODUCT_FIXTURE_FAILED");
      productIds[spec.key] = data.id;
    }

    let supplierId: string;
    const { data: foundSupplier, error: supplierLookupError } = await admin.from("suppliers")
      .select("id").eq("name", SUPPLIER_NAME).limit(1).maybeSingle();
    failIf(supplierLookupError, "QA_SUPPLIER_LOOKUP_FAILED");
    if (foundSupplier?.id) supplierId = foundSupplier.id;
    else {
      const { data, error } = await admin.from("suppliers").insert({ name: SUPPLIER_NAME, active: true })
        .select("id").single();
      failIf(error, "QA_SUPPLIER_FIXTURE_FAILED");
      supplierId = data.id;
    }

    const lotSpecs = [
      { product: "normal", code: "THOP-QA-ORDER-LOT", received: 20, available: 20, expiry: isoDate(365), cost: 4 },
      { product: "low", code: "THOP-QA-LOW-LOT", received: 2, available: 2, expiry: isoDate(365), cost: 4 },
      // Deliberately leave quantity_available positive on this expired synthetic lot to prove
      // order creation excludes by expiry date, not only by availability.
      { product: "expired", code: "THOP-QA-EXPIRED-LOT", received: 4, available: 4, expiry: isoDate(-2), cost: 5 },
      { product: "concurrent", code: "THOP-QA-CONCURRENT-LOT", received: 5, available: 5, expiry: isoDate(365), cost: 5 },
    ];
    for (const spec of lotSpecs) {
      const { error } = await admin.from("lots").insert({
        product_id: productIds[spec.product], supplier_id: supplierId, lot_code: spec.code,
        expiry_date: spec.expiry, quantity_received: spec.received, quantity_available: spec.available,
        unit_cost: spec.cost,
      });
      failIf(error, "QA_LOT_FIXTURE_FAILED");
    }

    return json({
      ok: true,
      default_client: { id: defaultClient.id, profile: defaultClient.profile },
      active_client: { id: activeClient.id, profile: activeClient.profile },
      fixtures: { products: productIds, supplier_id: supplierId },
    });
  } catch (error) {
    // Never return passwords, tokens, or raw upstream Auth responses.
    return json({ error: "THOP_QA_BOOTSTRAP_FAILED", reason: String(error instanceof Error ? error.message : error).slice(0, 220) }, 500);
  }
});
