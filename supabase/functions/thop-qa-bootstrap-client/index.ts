import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_REF = "xodufvmosjtpbamqnqkw";
const QA_CLIENT_EMAIL = "thop-qa-client@example.com";
const QA_CLIENT_NAME = "THOP QA synthetic client";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "INVALID_SESSION" }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,estado_cuenta")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return json({ error: "PROFILE_LOOKUP_FAILED" }, 500);
  if (profile?.role !== "ADMIN" || profile?.estado_cuenta !== "ACTIVO") {
    return json({ error: "ADMIN_REQUIRED" }, 403);
  }

  let payload: { password?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }
  const password = typeof payload.password === "string" ? payload.password : "";
  // Supabase Auth's default minimum is six characters; don't impose a stricter
  // QA-only rule than the Auth service itself.
  if (password.length < 6 || password.length > 72) {
    return json({ error: "QA_PASSWORD_LENGTH_INVALID" }, 400);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: QA_CLIENT_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: QA_CLIENT_NAME },
  });
  if (!createError && created.user) {
    return json({ ok: true, created: true, user_id: created.user.id, email: QA_CLIENT_EMAIL });
  }

  // Idempotency: never reset an existing user's password. Report that the fixed
  // synthetic identity already exists and let the runner verify the configured secret by sign-in.
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (!listError) {
    const existing = listed.users.find((u) => (u.email || "").toLowerCase() === QA_CLIENT_EMAIL);
    if (existing) {
      return json({ ok: true, created: false, user_id: existing.id, email: QA_CLIENT_EMAIL });
    }
  }

  return json({
    error: "QA_CLIENT_CREATE_FAILED",
    reason: createError?.message || listError?.message || "Unknown Auth error",
  }, 500);
});
