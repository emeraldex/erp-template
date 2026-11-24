import json, os, urllib.request

# Defaults match a loopback deployment carrying the stock reference dataset.
# Override both for a deployment that binds elsewhere or set SEED_PASSWORD:
#   ERP_API=http://10.0.0.5:4000/api/v1 ERP_PASSWORD=... python3 scripts/section8-demo.py
BASE = os.environ.get("ERP_API", "http://localhost:4000/api/v1")
PASSWORD = os.environ.get("ERP_PASSWORD", "demo123")
TOK = {}

def call(method, path, body=None, role=None, expect_ok=True):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if role: req.add_header("Authorization", "Bearer " + TOK[role])
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=8) as r:
            return json.load(r), r.status
    except urllib.error.HTTPError as e:
        payload = json.load(e)
        if expect_ok:
            raise SystemExit(f"FAIL {method} {path}: {e.status} {payload}")
        return payload, e.status

# login all roles
for role, mail in {
    "STORES": "rahim", "WORKSHOP": "meiling", "MIS": "daniel", "MM": "hafiz",
    "PURCHASING": "suresh", "PCE": "kumar", "QUALITY": "qistina",
    "FINANCE": "farah", "BILLING": "zara",
}.items():
    res, _ = call("POST", "/auth/login", {"email": f"{mail}@company.example", "password": PASSWORD, "tokenInBody": True})
    TOK[role] = res["token"]
print("1. all 9 role logins OK")

# ── Scenario step 1: STORES registers a new MILITARY component ──
job, _ = call("POST", "/jobs", {
    "component": "Demo IFF Interrogator", "partNo": "IFF-4810", "serialNo": "SN-DEMO-01",
    "category": "MILITARY", "originUnit": "CPU Central", "repairUnit": "CENTRAL",
}, "STORES")
J = job["id"]
print(f"2. registered {J} status={job['status']} loc={job['location']}")

# negative: WORKSHOP may not dispatch (STORES-owned stage)
_, st = call("PATCH", f"/jobs/{J}/transition", {"to": "AWAITING_TDI", "fields": {"f219Ref": "F219-X"}}, "WORKSHOP", expect_ok=False)
assert st == 403, st
# negative: missing mandatory field
_, st = call("PATCH", f"/jobs/{J}/transition", {"to": "AWAITING_TDI", "fields": {}}, "STORES", expect_ok=False)
assert st == 400, st
# negative: illegal jump
_, st = call("PATCH", f"/jobs/{J}/transition", {"to": "SERVICEABLE", "fields": {}}, "MIS", expect_ok=False)
assert st == 400, st
print("3. guards OK: 403 wrong role · 400 missing field · 400 illegal transition")

# ── Step 2: dispatch + TDI ──
job, _ = call("PATCH", f"/jobs/{J}/transition", {"to": "AWAITING_TDI", "fields": {"f219Ref": "F219-2026-0301"}}, "STORES")
assert job["location"] == "BAY"
job, _ = call("PATCH", f"/jobs/{J}/transition", {"to": "TDI", "fields": {"f116Ref": "F116-2026-0142", "findings": "RF output low; PA module u/s"}}, "WORKSHOP")
print(f"4. dispatched (F219, loc→BAY) and TDI recorded (F116): status={job['status']}")

# ── Step 3: spares branch — F212 demand auto-created ──
job, _ = call("PATCH", f"/jobs/{J}/transition", {"to": "AWAITING_SPARE", "fields": {
    "f212Ref": "F212-2026-0501", "partDescription": "PA Module 50W", "partNo": "PA-50W", "qty": "1"}}, "WORKSHOP")
D = job["demandIds"][-1]
print(f"5. AWAITING_SPARE; demand {D} auto-raised from TDI")

dm, _ = call("PATCH", f"/demands/{D}/transition", {"to": "APPROVED", "fields": {}}, "MM")
dm, _ = call("PATCH", f"/demands/{D}/transition", {"to": "STOCK_CHECK", "fields": {"f244Ref": "F244-2026-077"}}, "STORES")
dm, _ = call("PATCH", f"/demands/{D}/transition", {"to": "RFQ_ISSUED", "fields": {"f220Ref": "F220-2026-0233"}}, "PURCHASING")

# min-3 rule: evaluating with 1 quote must fail
call("POST", f"/demands/{D}/quotations", {"supplierId": "SUP-001", "supplier": "Summit Defence & Services", "priceMYR": 18400, "eddDays": 30}, "PURCHASING")
_, st = call("PATCH", f"/demands/{D}/transition", {"to": "EVALUATED", "fields": {"f221Ref": "F221-X", "selectedSupplierId": "SUP-001"}}, "PURCHASING", expect_ok=False)
assert st == 400 and "three quotations" in str(_), (st, _)
call("POST", f"/demands/{D}/quotations", {"supplierId": "SUP-002", "supplier": "Precision Instruments (M)", "priceMYR": 17250, "eddDays": 45}, "PURCHASING")
call("POST", f"/demands/{D}/quotations", {"supplierId": "SUP-003", "supplier": "Radlink Avionics", "priceMYR": 19900, "eddDays": 21}, "PURCHASING")
dm, _ = call("PATCH", f"/demands/{D}/transition", {"to": "EVALUATED", "fields": {"f221Ref": "F221-2026-0090", "selectedSupplierId": "SUP-002"}}, "PURCHASING")
dm, _ = call("PATCH", f"/demands/{D}/transition", {"to": "PO_ISSUED", "fields": {"f312Ref": "F312-2026-1450"}}, "PURCHASING")
dm, _ = call("PATCH", f"/demands/{D}/transition", {"to": "RECEIVED", "fields": {}}, "STORES")
dm, _ = call("PATCH", f"/demands/{D}/transition", {"to": "ISSUED", "fields": {"f218Ref": "F218-2026-0870"}}, "STORES")
forms = [r["formNo"] for r in dm["records"]]
print(f"6. procurement: stock check→NIL→RFQ→3 quotes (min-3 enforced)→F221 eval→PO→receipt→issue; forms filed: {forms}")

# ── Step 4/5: complete maintenance + certification ──
job, _ = call("PATCH", f"/jobs/{J}/transition", {"to": "WIP", "fields": {}}, "MIS")
job, _ = call("PATCH", f"/jobs/{J}/transition", {"to": "SERVICEABLE", "fields": {
    "f114Ref": "F114-2026-0310", "f174Ref": "F174-2026-0288", "f111Ref": "F111-2026-0455",
    "certifiedBy": "Daniel Wong", "capacity": "MIS / Stamp 017"}}, "MIS")
assert job["location"] == "LOGISTIC"
print(f"7. WIP → SERVICEABLE with certification (F114/F174/F111 + identity/capacity); loc→LOGISTIC")

# ── Step 6: invoice + delivery note, close ──
job, _ = call("PATCH", f"/jobs/{J}/transition", {"to": "DELIVERED", "fields": {
    "f311Ref": "F311-2026-0777", "invoiceValue": "23400", "f218Ref": "F218-2026-0871"}}, "BILLING")
job, _ = call("PATCH", f"/jobs/{J}/transition", {"to": "CLOSED", "fields": {}}, "MM")
_, st = call("PATCH", f"/jobs/{J}/transition", {"to": "DELIVERED", "fields": {}}, "MM", expect_ok=False)
assert st == 400  # editing locked
print(f"8. invoiced+delivered (F311/F218) and CLOSED; further edits locked")

# ── Step 7: audit trail ──
job, _ = call("GET", f"/jobs/{J}", None, "STORES")
print(f"9. audit trail: {len(job['audit'])} entries, {len(job['records'])} controlled records on file:")
for e in job["audit"]:
    print(f"     {e['at'][:16]} {e['role']:<10} {e['action'][:70]}")

# ── Step 6 (invoicing): multi-stream billing + 6% GST (QP.51 / FR-13/14) ──
inv, _ = call("POST", "/invoicing", {"stream": "BRANCH_REPAIR", "jobId": "PS-2026-0338", "amountMYR": 23400}, "BILLING")
INV = inv["id"]
assert inv["gstMYR"] == 1404 and inv["totalMYR"] == 24804, inv  # 6% GST auto-computed
# role gate: FINANCE cannot certify (DRAFTED→CERTIFIED owned by BILLING/PCE)
_, st = call("PATCH", f"/invoicing/{INV}/transition", {"to": "CERTIFIED", "fields": {"customerSignRef": "X", "ctcRef": "Y"}}, "FINANCE", expect_ok=False)
assert st == 403, st
inv, _ = call("PATCH", f"/invoicing/{INV}/transition", {"to": "CERTIFIED", "fields": {"customerSignRef": "Customer-SIGN-DEMO", "ctcRef": "CTC-DEMO"}}, "BILLING")
inv, _ = call("PATCH", f"/invoicing/{INV}/transition", {"to": "TAX_RAISED", "fields": {"f311Ref": "F311-DEMO-01", "amountMYR": "23400"}}, "BILLING")
inv, _ = call("PATCH", f"/invoicing/{INV}/transition", {"to": "CORRECTNESS_CHECK", "fields": {}}, "BILLING")
inv, _ = call("PATCH", f"/invoicing/{INV}/transition", {"to": "SUBMITTED", "fields": {"correctnessBy": "CoE Officer"}}, "BILLING")
inv, _ = call("PATCH", f"/invoicing/{INV}/transition", {"to": "PAID", "fields": {"paymentRef": "CPU-PAY-DEMO"}}, "FINANCE")
assert inv["status"] == "PAID" and inv["outstanding"] is False, inv
print(f"14. invoicing: {INV} BRANCH_REPAIR RM23,400 + 6% GST = RM{inv['totalMYR']}; certify→GST→correctness gate→submit CPU→PAID")

# ACD stream-specific gate: cannot submit without Sales Performance Report (e-Payment)
acd, _ = call("POST", "/invoicing", {"stream": "ACD", "jobId": "PS-2026-0338", "amountMYR": 10000}, "PCE")
P = acd["id"]
call("PATCH", f"/invoicing/{P}/transition", {"to": "CERTIFIED", "fields": {"customerSignRef": "S", "ctcRef": "C"}}, "BILLING")
call("PATCH", f"/invoicing/{P}/transition", {"to": "TAX_RAISED", "fields": {"f311Ref": "F311-ACD", "amountMYR": "10000"}}, "BILLING")
call("PATCH", f"/invoicing/{P}/transition", {"to": "CORRECTNESS_CHECK", "fields": {}}, "BILLING")
_, st = call("PATCH", f"/invoicing/{P}/transition", {"to": "SUBMITTED", "fields": {"correctnessBy": "Z"}}, "BILLING", expect_ok=False)
assert st == 400 and "Sales Performance" in str(_), (st, _)
print("15. ACD stream gate enforced: submission blocked until keyed into Company Sales Performance Report (e-Payment)")

# ── Step 9 (AOG/ROA/Critical priority overlay — QP.56 / FR-15) ──
job2, _ = call("POST", "/jobs/PS-2026-0390/priority", {"type": "AOG", "quantity": 1, "route": "AW_SPARE", "colRef": "COL-AOG-DEMO", "edd": "2026-08-05", "remark": "Hasten Purchasing — airworthy spare"}, "PCE")
assert job2["priority"]["state"] == "OPEN" and job2["priority"]["type"] == "AOG", job2["priority"]
# negative: WORKSHOP may not raise priority (Mgr PC / CsE own the COL column)
_, st = call("POST", "/jobs/PS-2026-0405/priority", {"type": "AOG", "route": "OV", "colRef": "X"}, "WORKSHOP", expect_ok=False)
assert st == 403, st
job2, _ = call("PATCH", "/jobs/PS-2026-0390/priority", {"remark": "Supplier confirmed dispatch; COL remark updated"}, "PCE")
job2, _ = call("POST", "/jobs/PS-2026-0390/priority/close", {"reason": "DELIVERED"}, "PCE")
assert job2["priority"]["state"] == "CLOSED" and job2["priority"]["closeReason"] == "DELIVERED", job2["priority"]
print(f"16. AOG raised on PS-2026-0390 (route AW spares, COL column) → expedited → closed on delivery; 403 for wrong role")

# ── Step 8: supporting registers — CAR + FOD ──
p, _ = call("POST", "/registers/partners/SUP-002/car", {"ref": "F516-2026-0021", "reason": "Packaging discrepancy on F312-1450"}, "QUALITY")
print(f"10. CAR issued to {p['name']}: cars={len(p['cars'])} status={p['status']} (2nd CAR → dropped from lists)")
inc, _ = call("POST", "/fod/incidents", {"partName": "Safety wire offcut", "typeModel": "N/A", "serialNo": "N/A",
    "area": "CRITICAL", "location": "Bay 2 test bench", "discovered": "Found during panel close-up by ATP"}, "WORKSHOP")
print(f"11. FOD incident {inc['id']} filed → focal point {inc['focalPoint']}")

# ── Configurability (8.2): change an SLA timer at runtime ──
rule, _ = call("PATCH", "/config/sla/SLA-TDI", {"days": 3}, "QUALITY")
print(f"12. runtime config change: SLA-TDI now {rule['days']} days — no redeploy")

kpi, _ = call("GET", "/dashboard/kpis", None, "MM")
print(f"13. KPIs: open={kpi['openJobs']} wip={kpi['wip']} breaches={kpi['slaBreaches']}")
print("\nSECTION 8 SCENARIO: ALL STEPS PASS")
