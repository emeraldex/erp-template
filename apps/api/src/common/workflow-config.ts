// ─── Configurable workflow engine data (FR-02) ────────────────────────────────
// Statuses, transitions, role gates, mandatory fields and SLA timers are DATA,
// not code. The web client renders its action buttons and forms from GET
// /config — change a rule here (or via the admin PATCH endpoint) and both the
// API enforcement and the UI change without recoding.

import {
  DemandStatus, InvoiceStatus, InvoiceStream, JobStatus, OvStatus, PriorityType,
  RepairRoute, StatusMeta, TransitionRule,
} from "./types";

export const JOB_STATUS_META: Record<JobStatus, StatusMeta> = {
  REGISTERED:      { en: "Registered",            ms: "Didaftarkan",              tone: "neutral" },
  AWAITING_TDI:    { en: "Awaiting TDI",          ms: "Menunggu TDI",             tone: "info" },
  TDI:             { en: "Tear-Down Inspection",  ms: "Pemeriksaan Rombak",       tone: "info" },
  AWAITING_SPARE:  { en: "Awaiting Spare",        ms: "Menunggu Alat Ganti",      tone: "warn" },
  AWAITING_INDENT: { en: "Awaiting Indent",       ms: "Menunggu Inden Pelanggan", tone: "warn" },
  WIP:             { en: "Work in Progress",      ms: "Kerja Dalam Proses",       tone: "info" },
  REC_OV:          { en: "At Outside Vendor",     ms: "Di Vendor Luar",           tone: "warn" },
  BER:             { en: "Beyond Economical Repair", ms: "Melepasi Baik Pulih Ekonomi", tone: "bad" },
  SOR:             { en: "Serious Occurrence",    ms: "Kejadian Serius",          tone: "bad" },
  SERVICEABLE:     { en: "Serviceable",           ms: "Boleh Guna",               tone: "good" },
  DELIVERED:       { en: "Delivered",             ms: "Telah Dihantar",           tone: "good" },
  CLOSED:          { en: "Closed",                ms: "Ditutup",                  tone: "neutral" },
};

// QP.44 stage transitions — role = JTS "process owner" of the stage
export const JOB_TRANSITIONS: TransitionRule<JobStatus>[] = [
  {
    from: "REGISTERED", to: "AWAITING_TDI",
    label: "Dispatch to workshop", labelMs: "Hantar ke bengkel",
    roles: ["STORES"], setLocation: "BAY",
    requires: [{ key: "f219Ref", label: "Internal Dispatch ref", formNo: "F219" }],
  },
  {
    from: "AWAITING_TDI", to: "TDI",
    label: "Record tear-down inspection", labelMs: "Rekod pemeriksaan rombak",
    roles: ["WORKSHOP"],
    requires: [
      { key: "f116Ref", label: "TDI report ref", formNo: "F116" },
      { key: "findings", label: "Findings / fault values" },
    ],
  },
  {
    from: "TDI", to: "AWAITING_SPARE",
    label: "Raise spares demand", labelMs: "Mohon alat ganti",
    roles: ["WORKSHOP"],
    requires: [{ key: "f212Ref", label: "Internal Demand & Issue Voucher ref", formNo: "F212" }],
  },
  {
    from: "TDI", to: "AWAITING_INDENT",
    label: "Submit quotation to customer (nil spares)", labelMs: "Hantar sebut harga kepada pelanggan",
    roles: ["WORKSHOP", "MM"],
    requires: [{ key: "f119Ref", label: "Price quotation ref", formNo: "F119" }],
  },
  {
    from: "TDI", to: "BER",
    label: "Declare Beyond Economical Repair", labelMs: "Isytihar BER",
    roles: ["MM"],
    requires: [
      { key: "f135Ref", label: "Defect Report ref", formNo: "F135" },
      { key: "f119Ref", label: "Replacement quotation ref", formNo: "F119" },
    ],
  },
  {
    from: "TDI", to: "SOR",
    label: "File Serious Occurrence Report", labelMs: "Failkan Laporan Kejadian Serius",
    roles: ["WORKSHOP", "MIS"],
    requires: [{ key: "sorRef", label: "SOR ref" }],
  },
  {
    from: "TDI", to: "REC_OV",
    label: "Route to Outside Vendor (beyond capability)", labelMs: "Salurkan kepada Vendor Luar",
    roles: ["WORKSHOP", "PCE"], setLocation: "HQ",
    requires: [{ key: "f135Ref", label: "Defect Report ref", formNo: "F135" }],
  },
  {
    from: "AWAITING_SPARE", to: "AWAITING_INDENT",
    label: "Submit TDI / quotation to customer", labelMs: "Hantar TDI / sebut harga kepada pelanggan",
    roles: ["MM"],
    requires: [{ key: "f119Ref", label: "Quotation ref", formNo: "F119" }],
  },
  {
    from: "AWAITING_INDENT", to: "WIP",
    label: "Record customer indent — start work", labelMs: "Rekod inden pelanggan — mula kerja",
    roles: ["MM"],
    requires: [{ key: "indentRef", label: "Customer indent ref" }],
  },
  {
    from: "AWAITING_SPARE", to: "WIP",
    label: "Spares received — start service", labelMs: "Alat ganti diterima — mula servis",
    roles: ["MIS", "WORKSHOP"],
    requires: [],
  },
  {
    from: "REC_OV", to: "SERVICEABLE",
    label: "OV repair received & certified", labelMs: "Baik pulih OV diterima & disahkan",
    roles: ["MIS"], setLocation: "LOGISTIC",
    requires: [{ key: "relCertRef", label: "Authorised Release / Calibration Cert ref" }],
  },
  {
    from: "BER", to: "SERVICEABLE",
    label: "Replacement received (CoC / CoO)", labelMs: "Gantian diterima (Sijil Akuan / Asal)",
    roles: ["PURCHASING", "MIS"], setLocation: "LOGISTIC",
    requires: [
      { key: "f231Ref", label: "Certificate of Conformance ref", formNo: "F231" },
      { key: "f232Ref", label: "Certificate of Origin ref", formNo: "F232" },
    ],
  },
  {
    from: "WIP", to: "SERVICEABLE",
    label: "Final inspection & certification", labelMs: "Pemeriksaan akhir & pensijilan",
    roles: ["MIS"], setLocation: "LOGISTIC",
    requires: [
      { key: "f114Ref", label: "Overhaul / Repair Record ref", formNo: "F114" },
      { key: "f174Ref", label: "Certificate of Release to Service ref", formNo: "F174" },
      { key: "f111Ref", label: "Serviceable Tag ref", formNo: "F111" },
      { key: "certifiedBy", label: "Certifying staff — identity" },
      { key: "capacity", label: "Certifying staff — capacity/stamp" },
    ],
  },
  {
    from: "SERVICEABLE", to: "DELIVERED",
    label: "Invoice & delivery note", labelMs: "Invois & nota penghantaran",
    roles: ["BILLING"], setLocation: "CUSTOMER",
    requires: [
      { key: "f311Ref", label: "Invoice no", formNo: "F311" },
      { key: "invoiceValue", label: "Invoice value (MYR)" },
      { key: "f218Ref", label: "Delivery Note ref", formNo: "F218" },
    ],
  },
  {
    from: "SOR", to: "CLOSED",
    label: "Close after customer decision", labelMs: "Tutup selepas keputusan pelanggan",
    roles: ["MM"], requires: [],
  },
  {
    from: "DELIVERED", to: "CLOSED",
    label: "Close job (lock editing)", labelMs: "Tutup kerja (kunci suntingan)",
    roles: ["STORES", "MM"], requires: [],
  },
];

export const DEMAND_STATUS_META: Record<DemandStatus, StatusMeta> = {
  RAISED:            { en: "Raised (F212)",        ms: "Dimohon (F212)",        tone: "neutral" },
  APPROVED:          { en: "HOD Approved",         ms: "Diluluskan HOD",        tone: "info" },
  STOCK_CHECK:       { en: "Stock Check",          ms: "Semakan Stok",          tone: "info" },
  ISSUED_FROM_STOCK: { en: "Issued from Stock",    ms: "Dikeluarkan dari Stok", tone: "good" },
  RFQ_ISSUED:        { en: "RFQ Issued",           ms: "RFQ Dikeluarkan",       tone: "info" },
  EVALUATED:         { en: "Quotes Evaluated",     ms: "Sebut Harga Dinilai",   tone: "info" },
  PO_ISSUED:         { en: "PO Issued",            ms: "PO Dikeluarkan",        tone: "warn" },
  RECEIVED:          { en: "Received & Inspected", ms: "Diterima & Diperiksa",  tone: "good" },
  ISSUED:            { en: "Issued to Originator", ms: "Diserahkan",            tone: "good" },
};

export const DEMAND_TRANSITIONS: TransitionRule<DemandStatus>[] = [
  {
    from: "RAISED", to: "APPROVED",
    label: "Verify & approve (WoS → HOD)", labelMs: "Sahkan & luluskan",
    roles: ["MM"], requires: [],
  },
  {
    from: "APPROVED", to: "STOCK_CHECK",
    label: "Run stock check", labelMs: "Jalankan semakan stok",
    roles: ["STORES"],
    requires: [{ key: "f244Ref", label: "Stock Check form ref", formNo: "F244" }],
  },
  {
    from: "STOCK_CHECK", to: "ISSUED_FROM_STOCK",
    label: "Stock available — issue via F213", labelMs: "Stok ada — keluarkan melalui F213",
    roles: ["STORES"],
    requires: [
      { key: "f213Ref", label: "External Demand & Issue Voucher ref", formNo: "F213" },
      { key: "holdingUnit", label: "Holding unit" },
    ],
  },
  {
    from: "STOCK_CHECK", to: "RFQ_ISSUED",
    label: "NIL stock — raise RFQ to approved suppliers", labelMs: "Stok NIL — keluarkan RFQ",
    roles: ["PURCHASING"],
    requires: [{ key: "f220Ref", label: "RFQ ref", formNo: "F220" }],
  },
  {
    from: "RFQ_ISSUED", to: "EVALUATED",
    label: "Evaluate quotations (min. 3) & select", labelMs: "Nilai sebut harga (min. 3) & pilih",
    roles: ["PURCHASING"],
    requires: [
      { key: "f221Ref", label: "Quotation Evaluation Proforma ref", formNo: "F221" },
      { key: "selectedSupplierId", label: "Selected supplier" },
    ],
  },
  {
    from: "EVALUATED", to: "PO_ISSUED",
    label: "Issue PO (authorised by Mgr Pu)", labelMs: "Keluarkan PO",
    roles: ["PURCHASING"],
    requires: [{ key: "f312Ref", label: "Purchase Order ref", formNo: "F312" }],
  },
  {
    from: "PO_ISSUED", to: "RECEIVED",
    label: "Receive at Central Stores & inspect (QP.15)", labelMs: "Terima di Stor Pusat & periksa",
    roles: ["STORES"], requires: [],
  },
  {
    from: "RECEIVED", to: "ISSUED",
    label: "Dispatch & issue to originator", labelMs: "Hantar & serah kepada pemohon",
    roles: ["STORES"],
    requires: [{ key: "f218Ref", label: "Delivery Note ref", formNo: "F218" }],
  },
];

export const OV_STATUS_META: Record<OvStatus, StatusMeta> = {
  RECEIVED_HQ:       { en: "Received at HQ",       ms: "Diterima di HQ",        tone: "neutral" },
  VENDOR_IDENTIFIED: { en: "Vendor Identified",      ms: "Vendor Dikenal Pasti",    tone: "info" },
  F134_SUBMITTED:    { en: "F134 with Customer",     ms: "F134 kepada Pelanggan",   tone: "warn" },
  APPROVED:          { en: "Customer Approved",      ms: "Diluluskan Pelanggan",    tone: "good" },
  REJECTED:          { en: "Not Approved — Return",  ms: "Tidak Diluluskan",        tone: "bad" },
  PO_ISSUED:         { en: "Repair Order Issued",    ms: "Pesanan Baik Pulih",      tone: "info" },
  AT_VENDOR:         { en: "At Contractor",          ms: "Di Kontraktor",           tone: "warn" },
  COST_ADVISED:      { en: "Cost & EDD Advised",     ms: "Kos & EDD Dimaklumkan",   tone: "info" },
  QUOTE_APPROVED:    { en: "Quotation Approved",     ms: "Sebut Harga Diluluskan",  tone: "good" },
  RECEIVED_BACK:     { en: "Received & Inspected",   ms: "Diterima & Diperiksa",    tone: "good" },
  RETURNED:          { en: "Returned to Customer",   ms: "Dikembalikan",            tone: "neutral" },
};

export const OV_TRANSITIONS: TransitionRule<OvStatus>[] = [
  {
    from: "RECEIVED_HQ", to: "VENDOR_IDENTIFIED",
    label: "Identify capable outside vendor", labelMs: "Kenal pasti vendor luar",
    roles: ["PCE"],
    requires: [{ key: "vendorId", label: "Vendor (from approved lists)" }],
  },
  {
    from: "VENDOR_IDENTIFIED", to: "F134_SUBMITTED",
    label: "Submit Request for OV Approval to customer", labelMs: "Hantar F134 kepada pelanggan",
    roles: ["PCE"],
    requires: [{ key: "f134Ref", label: "Request for OV Approval ref", formNo: "F134" }],
  },
  {
    from: "F134_SUBMITTED", to: "APPROVED",
    label: "Record customer approval", labelMs: "Rekod kelulusan pelanggan",
    roles: ["PCE", "MM"],
    requires: [{ key: "approvalRef", label: "Customer approval ref" }],
  },
  {
    from: "F134_SUBMITTED", to: "REJECTED",
    label: "Not approved — return item to customer", labelMs: "Tidak diluluskan — pulangkan",
    roles: ["PCE", "MM"], requires: [],
  },
  {
    from: "APPROVED", to: "PO_ISSUED",
    label: "Issue Purchase/Repair Order (Mgr PC)", labelMs: "Keluarkan Pesanan Baik Pulih",
    roles: ["PCE"],
    requires: [{ key: "f312Ref", label: "Purchase / Repair Order ref", formNo: "F312" }],
  },
  {
    from: "PO_ISSUED", to: "AT_VENDOR",
    label: "Dispatch item to contractor", labelMs: "Hantar item kepada kontraktor",
    roles: ["STORES", "PCE"],
    requires: [{ key: "f218Ref", label: "Delivery Note ref", formNo: "F218" }],
  },
  {
    from: "AT_VENDOR", to: "COST_ADVISED",
    label: "Record repair cost & EDD", labelMs: "Rekod kos baik pulih & EDD",
    roles: ["PCE"],
    requires: [
      { key: "costMYR", label: "Repair cost (MYR)" },
      { key: "eddDays", label: "EDD (days)" },
    ],
  },
  {
    from: "COST_ADVISED", to: "QUOTE_APPROVED",
    label: "Customer approves quotation (F119/F119B if above indent)", labelMs: "Pelanggan lulus sebut harga",
    roles: ["PCE", "MM"],
    requires: [{ key: "approvalRef", label: "MSU approval ref" }],
  },
  {
    from: "QUOTE_APPROVED", to: "RECEIVED_BACK",
    label: "Receive repaired item & inspect (QP.15)", labelMs: "Terima item & periksa",
    roles: ["STORES", "QUALITY"],
    requires: [{ key: "relCertRef", label: "Release / Calibration Certificate ref" }],
  },
  {
    from: "RECEIVED_BACK", to: "RETURNED",
    label: "Prepare return docs & return to customer", labelMs: "Sedia dokumen & pulangkan",
    roles: ["PCE", "BILLING"],
    requires: [
      { key: "f311Ref", label: "Invoice ref", formNo: "F311" },
      { key: "f117Ref", label: "Analysis Report ref", formNo: "F117" },
      { key: "f218Ref", label: "Delivery Note ref", formNo: "F218" },
    ],
  },
];

// ─── QP.51 Invoicing & Revenue Billing (5.8) — FR-13 / FR-14 ───────────────────
export const INVOICE_STATUS_META: Record<InvoiceStatus, StatusMeta> = {
  DRAFTED:           { en: "Drafted",             ms: "Dirangka",              tone: "neutral" },
  CERTIFIED:         { en: "Signed & CTC Made",   ms: "Ditandatangani & CTC",  tone: "info" },
  TAX_RAISED:        { en: "Tax Invoice + 6% GST", ms: "Invois Cukai + 6% GST", tone: "info" },
  CORRECTNESS_CHECK: { en: "Correctness Gate",    ms: "Semakan Ketepatan",     tone: "warn" },
  SUBMITTED:         { en: "Submitted to CPU",   ms: "Dihantar ke CPU",      tone: "warn" },
  REJECTED:          { en: "Rejected — Correct",  ms: "Ditolak — Perbetulkan", tone: "bad" },
  PAID:              { en: "Paid",                ms: "Dibayar",               tone: "good" },
};

// Single billing process; the applicable document set & deadlines vary by stream.
export const INVOICE_TRANSITIONS: TransitionRule<InvoiceStatus>[] = [
  {
    from: "DRAFTED", to: "CERTIFIED",
    label: "Obtain Customer signature & make CTC", labelMs: "Dapatkan tandatangan Customer & buat CTC",
    roles: ["BILLING", "PCE"],
    requires: [
      { key: "customerSignRef", label: "Customer / CAO signature ref" },
      { key: "ctcRef", label: "Certified True Copy ref", formNo: "CTC" },
    ],
  },
  {
    from: "CERTIFIED", to: "TAX_RAISED",
    label: "Raise Tax Invoice + 6% GST", labelMs: "Keluarkan Invois Cukai + 6% GST",
    roles: ["BILLING"],
    requires: [
      { key: "f311Ref", label: "Tax Invoice no", formNo: "F311" },
      { key: "amountMYR", label: "Invoice amount before GST (MYR)" },
    ],
  },
  {
    from: "TAX_RAISED", to: "CORRECTNESS_CHECK",
    label: "Forward to HQ / CoE Invoicing", labelMs: "Hantar ke Invois HQ / CoE",
    roles: ["BILLING", "PCE"], requires: [],
  },
  {
    from: "CORRECTNESS_CHECK", to: "SUBMITTED",
    label: "Correct & complete — submit to CPU (Finance)", labelMs: "Tepat & lengkap — hantar ke CPU (Finance)",
    roles: ["BILLING"],
    requires: [{ key: "correctnessBy", label: "CoE checked-by (correctness gate)" }],
  },
  {
    from: "CORRECTNESS_CHECK", to: "REJECTED",
    label: "Incomplete — return for correction", labelMs: "Tidak lengkap — pulangkan untuk pembetulan",
    roles: ["BILLING"],
    requires: [{ key: "reason", label: "Reason / missing items" }],
  },
  {
    from: "SUBMITTED", to: "REJECTED",
    label: "Rejected by CPU / MRA", labelMs: "Ditolak oleh CPU / MRA",
    roles: ["FINANCE", "BILLING"],
    requires: [{ key: "reason", label: "Rejection reason" }],
  },
  {
    from: "REJECTED", to: "TAX_RAISED",
    label: "Corrected — re-raise tax invoice", labelMs: "Diperbetulkan — keluarkan semula invois",
    roles: ["BILLING"],
    requires: [{ key: "f311Ref", label: "Corrected Tax Invoice no", formNo: "F311" }],
  },
  {
    from: "SUBMITTED", to: "PAID",
    label: "Payment received & recorded", labelMs: "Bayaran diterima & direkodkan",
    roles: ["FINANCE"],
    requires: [{ key: "paymentRef", label: "Payment reference" }],
  },
];

// Configurable stream definitions — document sets & deadlines are DATA (FR-13).
export interface InvoiceStreamDef {
  id: InvoiceStream;
  label: string;
  labelMs: string;
  customer: string;
  perJob: boolean;             // false = periodic (PBC monthly)
  docSet: string[];           // supporting document set
  deadlines: { label: string; note: string }[];
}

export const INVOICE_STREAMS: InvoiceStreamDef[] = [
  {
    id: "PBC", label: "Performance Based Contract", labelMs: "Kontrak Berasaskan Prestasi",
    customer: "CPU (Finance)", perJob: false,
    docSet: ["Sijil Pengesahan PBC", "Penalty Weightage 35% Availability", "Penalty Weightage 60% Serviceability", "PBC Tax Invoice (F311)"],
    deadlines: [
      { label: "PBC docs by 28th", note: "Branch PCD raises monthly PBC documents" },
      { label: "Customer signature by month-end", note: "HOB & Customer sign the set" },
      { label: "CTC to CoE by 5th", note: "Certified True Copy submitted to HQ Invoicing" },
    ],
  },
  {
    id: "BRANCH_REPAIR", label: "Branch-Repaired Component", labelMs: "Komponen Baik Pulih Cawangan",
    customer: "CPU (Finance)", perJob: true,
    docSet: ["Analysis Report (F117)", "AM 75 (signed)", "Delivery Note (F218)", "Over-and-Above Approval (if any)", "Certificate of Release to Service (F174, avionics)"],
    deadlines: [
      { label: "Notify Billing ≤ 3 days", note: "Branch PCD informs Billing on job completion" },
      { label: "Tax Invoice ≤ 3 working days", note: "Billing raises Tax Invoice + 6% GST" },
      { label: "Signed original ≤ 3 weeks", note: "Customer signs; CTC made" },
      { label: "3 sets to HQ ≤ 7 days", note: "Submit to HQ Invoicing" },
    ],
  },
  {
    id: "COE_MRA", label: "Production Control / CoE → MRA", labelMs: "Kawalan Pengeluaran / CoE → MRA",
    customer: "MRA → CPU (Finance)", perJob: true,
    docSet: ["Indent (AM 75)", "Analysis Report (F117)", "COC / ARC / Certificate of Release", "Serviceable / Unserviceable label", "Delivery Note (F218)", "Covering letter"],
    deadlines: [
      { label: "7 sets via Central Store to MRA", note: "CoE raises Tax Invoice + 6% GST" },
      { label: "Signed 4 sets to CPU (Finance)", note: "MRA returns signed tax invoice" },
    ],
  },
  {
    id: "ACD", label: "Accounts Dept (ACD)", labelMs: "Jabatan Akaun (ACD)",
    customer: "Accounts Dept (Payments) · e-Payment", perJob: true,
    docSet: ["Completed invoice", "Company Sales Performance Report (SPR)", "Local Order (LO)"],
    deadlines: [
      { label: "Forward to CoE ≤ 2 working days", note: "Branch forwards completed invoices" },
      { label: "Key into SPR → e-Payment", note: "CoE keys data & forwards to the Accounts Dept for payment" },
    ],
  },
];

// ─── QP.56 AOG / ROA / Critical priority overlay (5.9) — FR-15 ─────────────────
export const PRIORITY_META: Record<PriorityType, StatusMeta> = {
  AOG:      { en: "AOG · Aircraft On Ground", ms: "AOG · Pesawat Terkandas", tone: "bad" },
  ROA:      { en: "ROA · Radar Off the Air",  ms: "ROA · Radar Terhenti",    tone: "bad" },
  CRITICAL: { en: "Critical",                 ms: "Kritikal",                tone: "warn" },
};

export const REPAIR_ROUTE_META: Record<RepairRoute, { en: string; ms: string; note: string }> = {
  COE_UNIT:    { en: "CoE / Unit repair",  ms: "Baik pulih CoE / Unit", note: "Upgrade to priority repair; hasten immediate delivery" },
  OV:           { en: "Outside Vendor",      ms: "Vendor Luar",            note: "Hasten repair centre for EDD; ensure proforma/payment/shipping" },
  POOLEX:       { en: "Pool Exchange",       ms: "Pertukaran Pool",        note: "Source & respond within 14 days of notification" },
  AW_SPARE:     { en: "Airworthy spares",    ms: "Alat ganti boleh terbang", note: "Hasten Purchasing quoting AOG/ROA status, then elevate to CoE/Unit" },
  UNIT_PROCEED: { en: "Unit proceed",        ms: "Unit teruskan",          note: "No spares required — unit proceeds & expedites delivery" },
};

// ─── SLA timers (FR-10) ───────────────────────────────────────────────────────
export interface SlaRule {
  id: string;
  entity: "JOB" | "DEMAND" | "OV" | "INVOICE";
  status: string;
  days: number;
  rule: string;
  source: string;
}

export const SLA_RULES: SlaRule[] = [
  { id: "SLA-DISPATCH", entity: "JOB", status: "REGISTERED", days: 5, rule: "Deliver item to workshop within 5 days", source: "QP.17 §2" },
  { id: "SLA-TDI", entity: "JOB", status: "AWAITING_TDI", days: 5, rule: "Tear-down inspection within 5 days", source: "QP.17 §6" },
  { id: "SLA-QUOTE", entity: "JOB", status: "TDI", days: 5, rule: "Submit TDI/quotation within 5 days of advice", source: "QP.17 §8" },
  { id: "SLA-SPARES", entity: "JOB", status: "AWAITING_SPARE", days: 180, rule: "Spares received within 6 months", source: "QP.17 §11.1" },
  { id: "SLA-RFQ", entity: "DEMAND", status: "STOCK_CHECK", days: 2, rule: "Raise RFQ within 2 working days of NIL stock", source: "QP.14 §4" },
  { id: "SLA-SUPPLIER", entity: "DEMAND", status: "RFQ_ISSUED", days: 14, rule: "Supplier response within 14 days", source: "QP.14 alt path" },
  { id: "SLA-PO", entity: "DEMAND", status: "EVALUATED", days: 2, rule: "Issue PO within 2 working days of approval", source: "QP.14 §6" },
  { id: "SLA-OV-ID", entity: "OV", status: "RECEIVED_HQ", days: 15, rule: "Identify outside vendor within 15 working days", source: "QP.33 §3.1" },
  { id: "SLA-INV-RAISE", entity: "INVOICE", status: "DRAFTED", days: 3, rule: "Raise tax invoice within 3 working days of completion", source: "QP.51 §E2" },
  { id: "SLA-INV-SIGN", entity: "INVOICE", status: "TAX_RAISED", days: 21, rule: "Obtain signed original within 3 weeks", source: "QP.51 §E2" },
  { id: "SLA-INV-SUBMIT", entity: "INVOICE", status: "CORRECTNESS_CHECK", days: 7, rule: "Submit correct & complete set within 7 days", source: "QP.51 §E2" },
];
