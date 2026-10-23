import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync("index.html", "utf8");
const matrix = readFileSync("qa/THOP-TEST-acceptance-matrix.md", "utf8");
const failures = [];
function check(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (e) { failures.push({name, error:e.message}); console.error(`FAIL ${name}: ${e.message}`); } }

check("frontend points to THOP-TEST", () => {
  assert.match(html, /https:\/\/xodufvmosjtpbamqnqkw\.supabase\.co/);
  assert.doesNotMatch(html, /jajbmcwypbeokgssqulj/);
});
check("no service-role credential in frontend", () => {
  assert.doesNotMatch(html, /service_role|sb_secret_/i);
});
check("catalog projection matches schema", () => {
  assert.match(html, /catalog_products.*?effective_price/s);
  assert.match(html, /nombre:p\.name/);
  assert.match(html, /image_url/);
});
check("order RPC uses schema field names", () => {
  assert.match(html, /create_order_atomic/);
  assert.match(html, /product_id:x\.productId,quantity:x\.qty/);
});
check("profile and admin data use guarded RPC paths", () => {
  for (const name of ["current_profile","admin_list_products","admin_list_profiles","admin_list_orders","admin_list_inventory_summary","admin_list_suppliers","admin_list_special_prices","admin_update_special_prices","admin_update_customer_type","admin_update_order_status","admin_update_product","admin_set_product_visibility"]) {
    assert.ok(html.includes(name), `missing RPC wiring: ${name}`);
  }
});
check("sensitive tables are not queried directly by frontend", () => {
  assert.doesNotMatch(html, /sb\.from\("(?:lots|suppliers|inventory_movements|purchases|purchase_details|sales|sale_details|audit_log)"\)/);
  assert.doesNotMatch(html, /sb\.from\("products"\)/);
  assert.doesNotMatch(html, /sb\.from\("special_prices"\)/);
});
check("customer view does not expose stock states", () => {
  assert.match(html, /i\?\.role==="ADMIN"/);
  assert.match(html, /Registro como Público • Activación por administrador/);
});
check("25-case matrix has 25 pending cases", () => {
  const pending = (matrix.match(/\| PENDIENTE \|/g) || []).length;
  assert.equal(pending, 25);
});
check("all inline JavaScript parses", () => {
  const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const inline = tags.filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs));
  assert.ok(inline.length >= 2, "expected inline integration and app scripts");
  inline.forEach(([, attrs, body], i) => {
    new vm.Script(body, { filename: `index-inline-${i + 1}.js` });
  });
});

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
} else {
  console.log("All THOP static checks passed. This is not an end-to-end security certification.");
}
