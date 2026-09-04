# Trans Atlantic — Final Manual Launch Testing Notes

Production domain: `talogisticssolutions.com` (still WordPress, public), `app.talogisticssolutions.com` (staff, live on Railway), `api.talogisticssolutions.com` (API, live on Railway). WordPress remains the public site; DNS has not been cut over for the apex/`www` yet.

Tests are performed manually in-browser by Dominic/the user; results and any fixes are logged here as we go.

---

## Test 1: Staff Login → Dashboard Access

**URL**: `https://app.talogisticssolutions.com/`
**Result**: ❌ FAILED (first attempt) → ✅ **PASSED** (after fix)

### Issue found

Owner login failed with generic UI error "Unable to log in right now." — not a real "invalid credentials" message.

**Root cause**: `CORS_ORIGIN` on the `api` Railway service was never updated after the DNS cutover — it only allowed the old temporary Railway URL (`https://web-production-31f5d.up.railway.app`), not `https://app.talogisticssolutions.com`. The browser's CORS preflight to `/auth/login` from the real domain got no `Access-Control-Allow-Origin` header back, so the browser blocked the response before the frontend ever saw it — surfacing as a generic network failure, not an auth error.

**Diagnosis steps that confirmed it**:
- Direct `POST /auth/login` via curl (bypasses browser CORS enforcement) succeeded with `200 OK` — proved the Owner account, password, and API auth logic were all correct.
- CORS preflight comparison: old temp URL origin → `Access-Control-Allow-Origin` echoed back (allowed); `https://app.talogisticssolutions.com` origin → header missing entirely (blocked).

**Fix applied**:
- Updated `CORS_ORIGIN` on the `api` Railway service to:
  `https://web-production-31f5d.up.railway.app,https://app.talogisticssolutions.com,https://talogisticssolutions.com,https://www.talogisticssolutions.com`
- Redeployed the `api` service only (restart from existing image, no rebuild, no code changes).
- Verified: health check `200`, CORS preflight + actual login POST from `app.talogisticssolutions.com` both correctly return the matching `Access-Control-Allow-Origin` header, old temp URL still works (no regression).
- No DNS, database, Stripe, user/password, or application code changes were made — env var + redeploy only.

**Retest**: Owner logged in successfully, staff dashboard accessible. ✅ PASSED.

---

## Test 2: Customer Portal Login → Shipment Tracking

**Result**: ✅ **PASSED** (all 3 steps)

- Step 1 — Customer portal login (`/login` → `/portal`): PASSED. Landed on customer portal, 1 active shipment (`TAL-2026-000004`) visible.
- Step 2 — Shipment detail view: PASSED. Correct mode (Ocean LCL), route (US → GH), 1 item, status "Shipment created", tracking history showing creation timestamp (Sep 4, 2026, 11:00 AM). No other customer's data visible.
- Step 3 — Public tracking (`/track`, no login): PASSED, both parts.
  - Correct tracking number + correct last name → returned the shipment with only customer-safe info (no invoice/payment/internal data).
  - Correct tracking number + wrong last name → correctly returned "No matching shipment found", no data leaked.

No issues found. No fixes needed.

---

## Test 3: Public Contact/Quote Lead Capture → Staff Leads Inbox

**Result**: ✅ **PASSED** (both steps)

- Step 1 — Public Contact form submission: PASSED. "Message received" confirmation shown.
- Step 2 — Staff Website Leads inbox verification: PASSED. Submission ("TEST LeadCheck", subject "Test 3 verification") appeared correctly with type "Contact Message", status "New", and matching email/message.

No issues found. No fixes needed.

**Tests 4–9 deliberately not run** — per the change of plan, this functionality has already been exercised extensively during development/regression testing. To resume after launch, if needed: Test 4 (staff customer/shipment/warehouse creation), Test 5 (Containers/Manifests UI), Test 6 (Invoices/Payments/Stripe Checkout), Test 7 (Documents/R2), Test 8 (Resend email notifications), Test 9 (role-based access/tenant isolation spot-check).

---

## Post-Test-3: Content/Photo Audit & Launch Prep

**Status**: In progress — see findings below once complete.

### Test data created for this test (to be deleted after final testing)

| Record | ID | Identifying details |
|---|---|---|
| Customer | `cmtn54omu0001d0pysaj756sb` | `TA-000004`, name "TEST Test2PortalLogin", email `test2-portal-login@example.com` |
| Portal user (CUSTOMER role) | linked to customer above via `userId` | same email |
| Shipment | `cmtn54p3a0004d0pybxkssi0h` | tracking number `TAL-2026-000004`, 1 box item, no other events yet |

No existing real customer/shipment/invoice/payment data was touched — all three rows above are new.
