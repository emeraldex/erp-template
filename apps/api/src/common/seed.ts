import {
  AuditEntry, Demand, FodIncident, Invoice, Job, OvRepair, Partner, Tool, TrainingRecord, User,
} from "./types";

const d = (daysAgo: number) => {
  const t = new Date("2026-07-15T08:00:00+08:00");
  t.setDate(t.getDate() - daysAgo);
  return t.toISOString();
};
const day = (daysAgo: number) => d(daysAgo).slice(0, 10);
const a = (daysAgo: number, by: string, role: AuditEntry["role"], action: string, fields?: Record<string, string>): AuditEntry =>
  ({ at: d(daysAgo), by, role, action, ...(fields ? { fields } : {}) });

export const USERS: User[] = [
  { id: "u1", name: "Aisyah Rahman",    email: "aisyah@company.example",  password: "demo123", role: "ADMIN",      designation: "IT Mgmt", branch: "HQ" },
  { id: "u2", name: "Rahim Osman",      email: "rahim@company.example",   password: "demo123", role: "STORES",     designation: "StS",     branch: "HQ" },
  { id: "u3", name: "Tan Mei Ling",     email: "meiling@company.example", password: "demo123", role: "WORKSHOP",   designation: "Tst",     branch: "CENTRAL" },
  { id: "u4", name: "Daniel Wong",      email: "daniel@company.example",  password: "demo123", role: "MIS",        designation: "MIS",     branch: "CENTRAL" },
  { id: "u5", name: "Hafiz Kamarudin",  email: "hafiz@company.example",   password: "demo123", role: "MM",         designation: "SMM",     branch: "HQ" },
  { id: "u6", name: "Suresh Pillai",    email: "suresh@company.example",  password: "demo123", role: "PURCHASING", designation: "PcE",     branch: "HQ" },
  { id: "u7", name: "Kumar Vellu",      email: "kumar@company.example",   password: "demo123", role: "PCE",        designation: "PCE",     branch: "HQ" },
  { id: "u8", name: "Qistina Yusof",    email: "qistina@company.example", password: "demo123", role: "QUALITY",    designation: "QAD",     branch: "HQ" },
  { id: "u9", name: "Farah Idris",      email: "farah@company.example",   password: "demo123", role: "FINANCE",    designation: "Fin",     branch: "HQ" },
  { id: "u10", name: "Zara Abdullah",   email: "zara@company.example",    password: "demo123", role: "BILLING",    designation: "Bill",    branch: "HQ" },
];

export const PARTNERS: Partner[] = [
  {
    id: "SUP-001", name: "Summit Defence & Services", type: "SUPPLIER", status: "REGISTERED",
    country: "Malaysia", certifications: ["DGTA", "SIRIM"], lists: ["F224"],
    rating: 3, evaluationRef: "F225-2024-011", lastAssessed: day(210), nextReassessment: "2027-03-31",
    nonConformances: 1, factorsEvaluated: 20, cars: [],
    audit: [a(600, "Suresh Pillai", "PURCHASING", "Registered in F224")],
  },
  {
    id: "SUP-002", name: "Precision Instruments (M)", type: "SUPPLIER", status: "REGISTERED",
    country: "Malaysia", certifications: ["SIRIM", "MS ISO 9001"], lists: ["F224"],
    rating: 2, evaluationRef: "F225-2023-006", lastAssessed: day(400), nextReassessment: "2026-03-31",
    nonConformances: 4, factorsEvaluated: 20, cars: [{ ref: "F516-2025-003", date: day(150), reason: "Late delivery > 30 days on PO F312-1188" }],
    audit: [a(400, "Suresh Pillai", "PURCHASING", "3-year reassessment recorded")],
  },
  {
    id: "SUP-003", name: "Northstar Sensors Asia Pte", type: "SUPPLIER", status: "UNDER_EVALUATION",
    country: "Singapore", certifications: ["EASA", "FAA"], lists: [],
    evaluationRef: "F225-2026-004", nonConformances: 0, factorsEvaluated: 0, cars: [],
    audit: [a(12, "Suresh Pillai", "PURCHASING", "Evaluation F225 opened — pending QAD advice")],
  },
  {
    id: "SUB-001", name: "Skyline Power Systems", type: "SUBCONTRACTOR", status: "REGISTERED",
    country: "Malaysia", certifications: ["DGTA", "CPU"], lists: ["F229", "AVL", "MSN"],
    rating: 3, evaluationRef: "F228-2023-002", siteAuditRef: "F225A-2023-002",
    lastAssessed: day(500), nextReassessment: "2026-12-31",
    nonConformances: 0, factorsEvaluated: 16, cars: [],
    audit: [a(500, "Kumar Vellu", "PCE", "Registered across AVL / MSN / F229")],
  },
  {
    id: "SUB-002", name: "Vector Comms Repair Centre", type: "SUBCONTRACTOR", status: "REGISTERED",
    country: "France", certifications: ["EASA", "CAA"], lists: ["F229", "AVL"],
    rating: 2, evaluationRef: "F228-2022-005", lastAssessed: day(300), nextReassessment: "2025-12-31",
    nonConformances: 3, factorsEvaluated: 16,
    cars: [{ ref: "F516-2026-001", date: day(90), reason: "Calibration certificate missing on return consignment" }],
    audit: [a(300, "Qistina Yusof", "QUALITY", "Monitoring F230 updated — rating Suitable-Capable")],
  },
  {
    id: "SUB-003", name: "Meridian Defence Electronics", type: "SUBCONTRACTOR", status: "JTP_APPROVED",
    country: "Malaysia", certifications: ["SIRIM", "DSM"], lists: [],
    evaluationRef: "F228-2026-001", siteAuditRef: "F225A-2026-001",
    nonConformances: 0, factorsEvaluated: 0, cars: [],
    audit: [a(20, "Qistina Yusof", "QUALITY", "JTP selection & approval minuted — pending registration")],
  },
];

export const JOBS: Job[] = [
  {
    id: "PS-2026-0412", psDate: day(2), component: "IFF Transponder LRU", partNo: "AN/APX-113", serialNo: "SN-88231",
    category: "MILITARY", originUnit: "CPU Central", repairUnit: "CENTRAL",
    status: "REGISTERED", location: "LOGISTIC", receivedAt: d(2), statusSince: d(2),
    demandIds: [], records: [],
    audit: [a(2, "Rahim Osman", "STORES", "Job registered — receiving inspection per QP.20", { partNo: "AN/APX-113", serialNo: "SN-88231" })],
  },
  {
    id: "PS-2026-0405", psDate: day(9), component: "Radar Receiver Module", partNo: "RRP-117-RX", serialNo: "SN-40417",
    category: "MILITARY", originUnit: "MSU East", repairUnit: "CENTRAL",
    status: "AWAITING_TDI", location: "BAY", receivedAt: d(9), statusSince: d(7),
    demandIds: [], records: [{ formNo: "F219", refNo: "F219-2026-0405", date: day(7), by: "Rahim Osman" }],
    audit: [
      a(9, "Rahim Osman", "STORES", "Job registered"),
      a(7, "Rahim Osman", "STORES", "Dispatched to workshop", { f219Ref: "F219-2026-0405" }),
    ],
  },
  {
    id: "PS-2026-0398", psDate: day(14), component: "TACAN Beacon Assembly", partNo: "AN/TRN-26", serialNo: "SN-11902",
    category: "NAS", originUnit: "MRA North", repairUnit: "NORTH",
    status: "TDI", location: "BAY", receivedAt: d(14), statusSince: d(6),
    demandIds: [], records: [
      { formNo: "F219", refNo: "F219-2026-0398", date: day(12), by: "Rahim Osman" },
      { formNo: "F116", refNo: "F116-2026-0398", date: day(6), by: "Tan Mei Ling", note: "RF output 12 dB below spec; PSU capacitor drift" },
    ],
    audit: [
      a(14, "Rahim Osman", "STORES", "Job registered"),
      a(12, "Rahim Osman", "STORES", "Dispatched to workshop", { f219Ref: "F219-2026-0398" }),
      a(6, "Tan Mei Ling", "WORKSHOP", "TDI recorded", { f116Ref: "F116-2026-0398", findings: "RF output 12 dB low; PSU cap drift" }),
    ],
  },
  {
    id: "PS-2026-0390", psDate: day(21), component: "VHF/UHF Transceiver", partNo: "AN/ARC-210", serialNo: "SN-73301",
    category: "MILITARY", originUnit: "CPU Central", repairUnit: "CENTRAL",
    status: "AWAITING_SPARE", location: "BAY", receivedAt: d(21), statusSince: d(12),
    demandIds: ["F212-2026-118"],
    records: [
      { formNo: "F116", refNo: "F116-2026-0390", date: day(13), by: "Tan Mei Ling" },
      { formNo: "F212", refNo: "F212-2026-118", date: day(12), by: "Tan Mei Ling" },
    ],
    audit: [
      a(21, "Rahim Osman", "STORES", "Job registered"),
      a(19, "Rahim Osman", "STORES", "Dispatched to workshop", { f219Ref: "F219-2026-0390" }),
      a(13, "Tan Mei Ling", "WORKSHOP", "TDI recorded", { f116Ref: "F116-2026-0390" }),
      a(12, "Tan Mei Ling", "WORKSHOP", "Spares demand raised", { f212Ref: "F212-2026-118" }),
    ],
  },
  {
    id: "PS-2026-0377", psDate: day(30), component: "Nav Display Unit", partNo: "MFD-268C", serialNo: "SN-55118",
    category: "MILITARY", originUnit: "MSU East", repairUnit: "EAST",
    status: "AWAITING_INDENT", location: "BAY", receivedAt: d(30), statusSince: d(8),
    demandIds: [],
    records: [
      { formNo: "F116", refNo: "F116-2026-0377", date: day(10), by: "Tan Mei Ling" },
      { formNo: "F119", refNo: "F119-2026-0377", date: day(8), by: "Hafiz Kamarudin", note: "Quotation to MSU — awaiting indent" },
    ],
    audit: [
      a(30, "Rahim Osman", "STORES", "Job registered"),
      a(10, "Tan Mei Ling", "WORKSHOP", "TDI recorded — nil spares", { f116Ref: "F116-2026-0377" }),
      a(8, "Hafiz Kamarudin", "MM", "Quotation submitted to customer", { f119Ref: "F119-2026-0377" }),
    ],
  },
  {
    id: "PS-2026-0371", psDate: day(35), component: "Radar Power Supply", partNo: "PSU-4406", serialNo: "SN-20991",
    category: "NAS", originUnit: "MRA Northeast", repairUnit: "NORTHEAST",
    status: "WIP", location: "BAY", receivedAt: d(35), statusSince: d(5),
    demandIds: ["F212-2026-112"], indentRef: "IND-MSU-2026-2231",
    records: [
      { formNo: "F116", refNo: "F116-2026-0371", date: day(28), by: "Tan Mei Ling" },
      { formNo: "F212", refNo: "F212-2026-112", date: day(27), by: "Tan Mei Ling" },
    ],
    audit: [
      a(35, "Rahim Osman", "STORES", "Job registered"),
      a(28, "Tan Mei Ling", "WORKSHOP", "TDI recorded", { f116Ref: "F116-2026-0371" }),
      a(27, "Tan Mei Ling", "WORKSHOP", "Spares demand raised", { f212Ref: "F212-2026-112" }),
      a(6, "Hafiz Kamarudin", "MM", "Customer indent recorded", { indentRef: "IND-MSU-2026-2231" }),
      a(5, "Daniel Wong", "MIS", "Spares received — service started"),
    ],
  },
  {
    id: "PS-2026-0355", psDate: day(48), component: "Secondary Surveillance Radar Extractor", partNo: "SSR-EX-9", serialNo: "SN-30112",
    category: "NAS", originUnit: "CPU Central", repairUnit: "CENTRAL",
    status: "REC_OV", location: "HQ", receivedAt: d(48), statusSince: d(20), ovId: "OV-2026-031",
    demandIds: [],
    priority: {
      type: "ROA", quantity: 1, route: "OV", suffixK: false, state: "OPEN",
      colRef: "COL-ROA-2026-014", raisedAt: d(10), raisedBy: "Kumar Vellu",
      edd: day(-12), remark: "Vendor Skyline hastened for EDD; proforma & payment cleared, shipping arranged (OV PCD)",
      audit: [
        a(10, "Kumar Vellu", "PCE", "ROA raised on COL — expedite Outside Vendor route", { colRef: "COL-ROA-2026-014", type: "ROA", route: "OV" }),
        a(7, "Kumar Vellu", "PCE", "EDD reported to CAO/CPU; COL remark updated"),
      ],
    },
    records: [
      { formNo: "F116", refNo: "F116-2026-0355", date: day(40), by: "Tan Mei Ling" },
      { formNo: "F135", refNo: "F135-2026-0355", date: day(22), by: "Tan Mei Ling", note: "No test rig for extractor timing — beyond capability" },
    ],
    audit: [
      a(48, "Rahim Osman", "STORES", "Job registered"),
      a(40, "Tan Mei Ling", "WORKSHOP", "TDI recorded", { f116Ref: "F116-2026-0355" }),
      a(20, "Kumar Vellu", "PCE", "Routed to Outside Vendor", { f135Ref: "F135-2026-0355" }),
    ],
  },
  {
    id: "PS-2026-0341", psDate: day(60), component: "Gyro Reference Unit", partNo: "GRU-77", serialNo: "SN-61240",
    category: "MILITARY", originUnit: "MSU East", repairUnit: "EAST",
    status: "BER", location: "BAY", receivedAt: d(60), statusSince: d(15),
    demandIds: [],
    records: [
      { formNo: "F116", refNo: "F116-2026-0341", date: day(50), by: "Tan Mei Ling" },
      { formNo: "F135", refNo: "F135-2026-0341", date: day(15), by: "Hafiz Kamarudin", note: "Repair cost exceeds 70% of replacement — BER" },
      { formNo: "F119", refNo: "F119-2026-0341", date: day(15), by: "Hafiz Kamarudin" },
    ],
    audit: [
      a(60, "Rahim Osman", "STORES", "Job registered"),
      a(50, "Tan Mei Ling", "WORKSHOP", "TDI recorded", { f116Ref: "F116-2026-0341" }),
      a(15, "Hafiz Kamarudin", "MM", "Declared BER — replacement quotation to customer", { f135Ref: "F135-2026-0341", f119Ref: "F119-2026-0341" }),
    ],
  },
  {
    id: "PS-2026-0338", psDate: day(66), component: "Comms Control Panel", partNo: "CCP-118", serialNo: "SN-90773",
    category: "MILITARY", originUnit: "CPU Central", repairUnit: "CENTRAL",
    status: "SERVICEABLE", location: "LOGISTIC", receivedAt: d(66), statusSince: d(3),
    demandIds: ["F212-2026-101"], indentRef: "IND-CPU-2026-1187", invoiceIds: ["INV-2026-0051"],
    records: [
      { formNo: "F114", refNo: "F114-2026-0338", date: day(3), by: "Daniel Wong" },
      { formNo: "F174", refNo: "F174-2026-0338", date: day(3), by: "Daniel Wong" },
      { formNo: "F111", refNo: "F111-2026-0338", date: day(3), by: "Daniel Wong" },
    ],
    audit: [
      a(66, "Rahim Osman", "STORES", "Job registered"),
      a(3, "Daniel Wong", "MIS", "Final inspection passed — certified serviceable", {
        f114Ref: "F114-2026-0338", f174Ref: "F174-2026-0338", f111Ref: "F111-2026-0338",
        certifiedBy: "Daniel Wong (MIS-041)", capacity: "Certifying Staff — Avionics",
      }),
    ],
  },
  {
    id: "PS-2026-0322", psDate: day(80), component: "Weather Radar Antenna Drive", partNo: "WRA-D12", serialNo: "SN-17765",
    category: "NAS", originUnit: "MRA North", repairUnit: "NORTH",
    status: "CLOSED", location: "CUSTOMER", receivedAt: d(80), statusSince: d(10),
    demandIds: [], indentRef: "IND-MRA-2026-0954", invoiceIds: ["INV-2026-0044"],
    records: [
      { formNo: "F311", refNo: "F311-2026-0322", date: day(12), by: "Zara Abdullah", note: "RM 18,400.00" },
      { formNo: "F218", refNo: "F218-2026-0322", date: day(12), by: "Rahim Osman" },
    ],
    audit: [
      a(80, "Rahim Osman", "STORES", "Job registered"),
      a(12, "Zara Abdullah", "BILLING", "Invoiced & delivery note issued", { f311Ref: "F311-2026-0322", invoiceValue: "18400", f218Ref: "F218-2026-0322" }),
      a(10, "Hafiz Kamarudin", "MM", "Job closed — editing locked"),
    ],
  },
  {
    // Parent of OV-2026-027 and of invoices INV-2026-0052 / INV-2026-0053, all
    // of which referenced this PS number while the record itself was missing
    // from the dataset. Harmless against the in-memory store, but PostgreSQL
    // enforces the foreign keys, so the job is reconstructed here from the
    // details those three records already carry (MRA customer, Vector
    // outside-vendor repair, returned and billed but not yet paid).
    id: "PS-2026-0311", psDate: day(120), component: "V/UHF Comms Transceiver", partNo: "TRC-9500", serialNo: "SN-40118",
    category: "NAS", originUnit: "MRA North", repairUnit: "HQ",
    status: "DELIVERED", location: "CUSTOMER", receivedAt: d(120), statusSince: d(5),
    demandIds: [], ovId: "OV-2026-027", indentRef: "IND-MRA-2026-0881",
    invoiceIds: ["INV-2026-0052", "INV-2026-0053"],
    records: [
      { formNo: "F218", refNo: "F218-2026-0311", date: day(5), by: "Rahim Osman" },
    ],
    audit: [
      a(120, "Rahim Osman", "STORES", "Job registered"),
      a(95, "Kumar Vellu", "PCE", "Routed to outside vendor repair (QP.33)", { ovRef: "OV-2026-027" }),
      a(5, "Rahim Osman", "STORES", "Returned to customer — delivery note issued", { f218Ref: "F218-2026-0311" }),
    ],
  },
];

export const DEMANDS: Demand[] = [
  {
    id: "F212-2026-118", jobId: "PS-2026-0390", partDescription: "RF Power Amplifier Module", partNo: "PA-210-M4",
    qty: 1, status: "RFQ_ISSUED", statusSince: d(11), raisedBy: "Tan Mei Ling", branch: "CENTRAL",
    stockCheck: { f244Ref: "F244-2026-118", available: false },
    rfqRef: "F220-2026-118",
    quotations: [
      { supplierId: "SUP-001", supplier: "Summit Defence & Services", priceMYR: 46800, eddDays: 45 },
      { supplierId: "SUP-002", supplier: "Precision Instruments (M)", priceMYR: 43900, eddDays: 60, remarks: "Ex-stock Penang" },
    ],
    records: [
      { formNo: "F244", refNo: "F244-2026-118", date: day(12), by: "Rahim Osman", note: "NIL STOCK — Central & branches" },
      { formNo: "F220", refNo: "F220-2026-118", date: day(11), by: "Suresh Pillai" },
    ],
    audit: [
      a(12, "Rahim Osman", "STORES", "Stock check — NIL STOCK", { f244Ref: "F244-2026-118" }),
      a(11, "Suresh Pillai", "PURCHASING", "RFQ issued to approved suppliers", { f220Ref: "F220-2026-118" }),
    ],
  },
  {
    id: "F212-2026-112", jobId: "PS-2026-0371", partDescription: "HV Capacitor Bank", partNo: "CAP-4406-HV",
    qty: 2, status: "ISSUED", statusSince: d(6), raisedBy: "Tan Mei Ling", branch: "NORTHEAST",
    stockCheck: { f244Ref: "F244-2026-112", available: true, holdingUnit: "Central Logistic HQ" },
    quotations: [],
    records: [
      { formNo: "F244", refNo: "F244-2026-112", date: day(25), by: "Rahim Osman" },
      { formNo: "F213", refNo: "F213-2026-112", date: day(24), by: "Rahim Osman" },
      { formNo: "F218", refNo: "F218-2026-112", date: day(7), by: "Rahim Osman" },
    ],
    audit: [
      a(25, "Rahim Osman", "STORES", "Stock check — available at Central", { f244Ref: "F244-2026-112" }),
      a(24, "Rahim Osman", "STORES", "Issued from stock via F213", { f213Ref: "F213-2026-112" }),
      a(6, "Rahim Osman", "STORES", "Issued to originator against F212"),
    ],
  },
  {
    id: "F212-2026-121", jobId: "PS-2026-0398", partDescription: "PSU Electrolytic Capacitor Kit", partNo: "KIT-TRN26-PSU",
    qty: 1, status: "APPROVED", statusSince: d(4), raisedBy: "Tan Mei Ling", branch: "NORTH",
    quotations: [],
    records: [],
    audit: [
      a(5, "Tan Mei Ling", "WORKSHOP", "Demand raised (F212)"),
      a(4, "Hafiz Kamarudin", "MM", "Verified & approved — forwarded to Stores"),
    ],
  },
  {
    id: "F212-2026-124", jobId: "PS-2026-0341", partDescription: "Gyro Reference Unit (replacement)", partNo: "GRU-77",
    qty: 1, status: "EVALUATED", statusSince: d(3), raisedBy: "Hafiz Kamarudin", branch: "EAST",
    stockCheck: { f244Ref: "F244-2026-124", available: false },
    rfqRef: "F220-2026-124",
    quotations: [
      { supplierId: "SUP-001", supplier: "Summit Defence & Services", priceMYR: 128000, eddDays: 90 },
      { supplierId: "SUP-002", supplier: "Precision Instruments (M)", priceMYR: 122500, eddDays: 120 },
      { supplierId: "SUP-003", supplier: "Northstar Sensors Asia Pte", priceMYR: 119800, eddDays: 75, remarks: "OEM-new, cert F231/F232 included" },
    ],
    evaluation: { f221Ref: "F221-2026-124", selectedSupplierId: "SUP-003" },
    records: [{ formNo: "F221", refNo: "F221-2026-124", date: day(3), by: "Suresh Pillai" }],
    audit: [
      a(8, "Rahim Osman", "STORES", "Stock check — NIL STOCK"),
      a(7, "Suresh Pillai", "PURCHASING", "RFQ issued", { f220Ref: "F220-2026-124" }),
      a(3, "Suresh Pillai", "PURCHASING", "3 quotations compared — Northstar selected", { f221Ref: "F221-2026-124" }),
    ],
  },
  {
    // Referenced by PS-2026-0338.demandIds but absent from the dataset. With
    // the demand list now derived from the foreign key, a dangling id would
    // simply disappear from that job; the completed demand behind its
    // "spares fitted" audit entry is restored here instead.
    id: "F212-2026-101", jobId: "PS-2026-0338", partDescription: "IFF Crypto Module (replacement)", partNo: "KIV-78",
    qty: 1, status: "ISSUED", statusSince: d(8), raisedBy: "Tan Mei Ling", branch: "CENTRAL",
    stockCheck: { f244Ref: "F244-2026-101", available: true, holdingUnit: "HQ Central Store" },
    quotations: [],
    records: [{ formNo: "F244", refNo: "F244-2026-101", date: day(20), by: "Rahim Osman" }],
    audit: [
      a(22, "Tan Mei Ling", "WORKSHOP", "Demand raised from TDI (F212)"),
      a(20, "Rahim Osman", "STORES", "Stock check — available at HQ Central Store", { f244Ref: "F244-2026-101" }),
      a(8, "Rahim Osman", "STORES", "Issued from stock to workshop"),
    ],
  },
];

export const OV_REPAIRS: OvRepair[] = [
  {
    id: "OV-2026-031", jobId: "PS-2026-0355", defectReportRef: "F135-2026-0355", am75Ref: "AM75-8842",
    vendorId: "SUB-001", vendorName: "Skyline Power Systems",
    f134Ref: "F134-2026-031", poRef: "F312-2026-2210", costMYR: 64500, eddDays: 40,
    status: "AT_VENDOR", statusSince: d(9),
    records: [
      { formNo: "F134", refNo: "F134-2026-031", date: day(16), by: "Kumar Vellu" },
      { formNo: "F312", refNo: "F312-2026-2210", date: day(11), by: "Kumar Vellu", note: "Authorised Mgr PC" },
      { formNo: "F218", refNo: "F218-2026-031", date: day(9), by: "Rahim Osman" },
    ],
    audit: [
      a(19, "Kumar Vellu", "PCE", "Registered in Job-in Register F125"),
      a(17, "Kumar Vellu", "PCE", "Vendor identified — Skyline Power Systems"),
      a(16, "Kumar Vellu", "PCE", "F134 submitted to customer", { f134Ref: "F134-2026-031" }),
      a(12, "Hafiz Kamarudin", "MM", "Customer approval recorded", { approvalRef: "MSU-APPR-2026-0455" }),
      a(11, "Kumar Vellu", "PCE", "Repair order issued", { f312Ref: "F312-2026-2210" }),
      a(9, "Rahim Osman", "STORES", "Item dispatched to contractor", { f218Ref: "F218-2026-031" }),
    ],
  },
  {
    id: "OV-2026-027", jobId: "PS-2026-0311", defectReportRef: "F135-2026-0311", am75Ref: "AM75-8790",
    vendorId: "SUB-002", vendorName: "Vector Comms Repair Centre",
    f134Ref: "F134-2026-027", poRef: "F312-2026-2141", costMYR: 91200, eddDays: 60, aboveIndent: true, f119Ref: "F119B-2026-0311",
    status: "RECEIVED_BACK", statusSince: d(4),
    records: [
      { formNo: "F119", refNo: "F119B-2026-0311", date: day(30), by: "Kumar Vellu", note: "Above indented price — ACD variant" },
    ],
    audit: [
      a(30, "Kumar Vellu", "PCE", "Cost above indent — F119B submitted"),
      a(25, "Hafiz Kamarudin", "MM", "MSU approved quotation", { approvalRef: "MSU-APPR-2026-0431" }),
      a(4, "Qistina Yusof", "QUALITY", "Received & inspected — release certificate verified", { relCertRef: "ARC-TH-77812" }),
    ],
  },
];

export const FOD_INCIDENTS: FodIncident[] = [
  {
    id: "FOD-2026-009", date: day(6), partName: "Safety-wire offcut", typeModel: "N/A", serialNo: "N/A",
    area: "CRITICAL", location: "Bay 2 test bench — CENTRAL", discovered: "Found during tool-out check by Tst",
    rootCause: "Wire trimming over open chassis", correctiveAction: "Trimming tray mandated; toolbox talk held",
    reporter: "Tan Mei Ling", focalPoint: "Qistina Yusof", status: "UNDER_REVIEW",
    audit: [a(6, "Tan Mei Ling", "WORKSHOP", "FOD incident reported")],
  },
  {
    id: "FOD-2026-008", date: day(28), partName: "M3 washer", typeModel: "DIN125", serialNo: "N/A",
    area: "CONTROL", location: "Radar PSU bench — NORTHEAST", discovered: "Post-assembly foreign object check",
    rootCause: "Parts tray overturned", correctiveAction: "Lipped trays issued; recount procedure",
    reporter: "Daniel Wong", focalPoint: "Qistina Yusof", status: "CLOSED",
    audit: [a(28, "Daniel Wong", "MIS", "FOD incident reported"), a(20, "Qistina Yusof", "QUALITY", "Incident closed — trend logged")],
  },
];

export const TOOLS: Tool[] = [
  { tag: "T-014", name: "Torque driver 0.6–3 Nm", board: "Board A — Bay 1", holder: "Tan Mei Ling", status: "OUT", since: d(0) },
  { tag: "T-022", name: "Crimp tool DMC AFM8", board: "Board A — Bay 1", status: "IN", since: d(1) },
  { tag: "T-031", name: "IFF test cable set", board: "Board B — Bay 2", status: "MISSING", since: d(2) },
  { tag: "T-045", name: "ESD tweezers set", board: "Board B — Bay 2", status: "IN", since: d(3) },
];

export const TRAINING: TrainingRecord[] = [
  { person: "Tan Mei Ling", course: "FOD_RECURRENT", date: day(90), nextDue: "2027-04-16" },
  { person: "Daniel Wong", course: "FOD_RECURRENT", date: day(60), nextDue: "2027-05-16" },
  { person: "Rahim Osman", course: "FOD_INITIAL", date: day(30), nextDue: "2027-06-15" },
  { person: "Kumar Vellu", course: "FOD_RECURRENT", date: day(400), nextDue: "2026-06-10" },
];

// QP.51 (5.8) — invoices across all four streams, at various stages of billing
export const INVOICES: Invoice[] = [
  {
    id: "INV-2026-0044", stream: "BRANCH_REPAIR", jobId: "PS-2026-0322",
    customer: "CPU (Finance)", amountMYR: 18400, gstRate: 6, gstMYR: 1104, totalMYR: 19504,
    status: "PAID", statusSince: d(6), f311Ref: "F311-2026-0322", ctcRef: "CTC-2026-0322",
    customerSignRef: "Customer-SIGN-2026-0322", correctnessBy: "Zara Abdullah (CoE)",
    paymentRef: "CPU-PAY-2026-3391", paidAt: day(6), outstanding: false,
    raisedBy: "Zara Abdullah", branch: "NORTH",
    records: [{ formNo: "F311", refNo: "F311-2026-0322", date: day(12), by: "Zara Abdullah", note: "RM 18,400.00 + 6% GST" }],
    audit: [
      a(14, "Zara Abdullah", "BILLING", "Tax Invoice + 6% GST raised", { f311Ref: "F311-2026-0322", amountMYR: "18400", gstMYR: "1104" }),
      a(11, "Zara Abdullah", "BILLING", "Correctness gate cleared — submitted to CPU (Finance)", { correctnessBy: "Zara Abdullah (CoE)" }),
      a(6, "Farah Idris", "FINANCE", "Payment received & recorded", { paymentRef: "CPU-PAY-2026-3391" }),
    ],
  },
  {
    id: "INV-2026-0051", stream: "BRANCH_REPAIR", jobId: "PS-2026-0338",
    customer: "CPU (Finance)", amountMYR: 23400, gstRate: 6, gstMYR: 1404, totalMYR: 24804,
    status: "TAX_RAISED", statusSince: d(2), f311Ref: "F311-2026-0338",
    ctcRef: "CTC-2026-0338", customerSignRef: "Customer-SIGN-2026-0338", outstanding: true,
    raisedBy: "Zara Abdullah", branch: "CENTRAL",
    records: [{ formNo: "F311", refNo: "F311-2026-0338", date: day(2), by: "Zara Abdullah", note: "Awaiting correctness gate" }],
    audit: [
      a(3, "Zara Abdullah", "BILLING", "Customer signature obtained & CTC made", { customerSignRef: "Customer-SIGN-2026-0338", ctcRef: "CTC-2026-0338" }),
      a(2, "Zara Abdullah", "BILLING", "Tax Invoice + 6% GST raised", { f311Ref: "F311-2026-0338", amountMYR: "23400", gstMYR: "1404" }),
    ],
  },
  {
    id: "INV-2026-0050", stream: "PBC", customer: "CPU (Finance)", period: "2026-07",
    amountMYR: 412000, gstRate: 6, gstMYR: 24720, totalMYR: 436720,
    status: "CORRECTNESS_CHECK", statusSince: d(3), f311Ref: "F311-PBC-2026-07",
    ctcRef: "CTC-PBC-2026-07", customerSignRef: "CAO-SIGN-2026-07", outstanding: true,
    raisedBy: "Zara Abdullah", branch: "HQ",
    records: [
      { formNo: "PBC", refNo: "SIJIL-PBC-2026-07", date: day(9), by: "Kumar Vellu", note: "35% Availability / 60% Serviceability weightage" },
      { formNo: "F311", refNo: "F311-PBC-2026-07", date: day(3), by: "Zara Abdullah" },
    ],
    audit: [
      a(9, "Kumar Vellu", "PCE", "PBC docs raised (Sijil Pengesahan + Penalty Weightage) by 28th"),
      a(5, "Zara Abdullah", "BILLING", "CAO signature obtained & CTC made", { ctcRef: "CTC-PBC-2026-07" }),
      a(3, "Zara Abdullah", "BILLING", "PBC Tax Invoice + 6% GST raised — at HQ correctness gate", { f311Ref: "F311-PBC-2026-07" }),
    ],
  },
  {
    id: "INV-2026-0052", stream: "COE_MRA", jobId: "PS-2026-0311",
    customer: "MRA → CPU (Finance)", amountMYR: 96500, gstRate: 6, gstMYR: 5790, totalMYR: 102290,
    status: "SUBMITTED", statusSince: d(5), f311Ref: "F311-2026-0311",
    ctcRef: "CTC-2026-0311", customerSignRef: "MRA-SIGN-2026-0311", correctnessBy: "Zara Abdullah (CoE)",
    outstanding: true, raisedBy: "Zara Abdullah", branch: "HQ",
    records: [{ formNo: "F311", refNo: "F311-2026-0311", date: day(8), by: "Zara Abdullah", note: "7 sets via Central Store to MRA" }],
    audit: [
      a(8, "Zara Abdullah", "BILLING", "Tax Invoice + 6% GST + DN & covering letter raised", { f311Ref: "F311-2026-0311", amountMYR: "96500" }),
      a(5, "Zara Abdullah", "BILLING", "Correctness gate cleared — 7 sets via Central Store to MRA; 4 signed sets to CPU (Finance)", { correctnessBy: "Zara Abdullah (CoE)" }),
    ],
  },
  {
    id: "INV-2026-0053", stream: "ACD", jobId: "PS-2026-0311",
    customer: "Accounts Dept (Payments) · e-Payment", amountMYR: 31250, gstRate: 6, gstMYR: 1875, totalMYR: 33125,
    status: "DRAFTED", statusSince: d(1), salesPerfRef: "SPR-2026-0311", outstanding: true,
    raisedBy: "Kumar Vellu", branch: "HQ",
    records: [{ formNo: "SPR", refNo: "SPR-2026-0311", date: day(1), by: "Kumar Vellu", note: "To be keyed into Company Sales Performance Report → e-Payment" }],
    audit: [a(1, "Kumar Vellu", "PCE", "Completed invoice forwarded to CoE Invoicing (≤ 2 working days)")],
  },
];

export const WEEKLY_CLOSURES = [4, 6, 5, 8, 7, 9, 6, 10, 8, 11, 9, 12];
