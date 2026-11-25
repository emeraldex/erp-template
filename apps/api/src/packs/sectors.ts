import { field, maintenancePack } from './maintenance';
import type { Entry } from './types';

const e = (key: string, label: string, labelMs: string, meta?: Record<string, unknown>): Entry => ({ key, label, labelMs, ...(meta ? { meta } : {}) });

/** Any maintenance or service business: a plain request-to-sign-off flow to start from. */
export const GENERAL = maintenancePack({
  id: 'general',
  name: 'General maintenance',
  description: 'A plain request → assign → work → sign-off flow with parts, approvals, contractors, assets and preventive maintenance. A starting point for any maintenance team.',
  terms: {},
  modules: {},
  roleTitles: {
    ADMIN: ['Administrator', 'Pentadbir'], HELPDESK: ['Help desk', 'Meja bantuan'], SUPERVISOR: ['Supervisor', 'Penyelia'],
    TECHNICIAN: ['Technician', 'Juruteknik'], STORES: ['Storekeeper', 'Penjaga stor'], PURCHASING: ['Purchasing', 'Perolehan'],
    FINANCE: ['Finance', 'Kewangan'], MANAGER: ['Maintenance manager', 'Pengurus penyelenggaraan'],
  },
  dictionaries: {
    category: [e('MECHANICAL', 'Mechanical', 'Mekanikal'), e('ELECTRICAL', 'Electrical', 'Elektrik'), e('GENERAL', 'General', 'Am')],
    assetType: [e('EQUIPMENT', 'Equipment', 'Peralatan'), e('VEHICLE', 'Vehicle', 'Kenderaan'), e('BUILDING', 'Building system', 'Sistem bangunan')],
  },
  minQuotations: 1,
  defaults: { jobPrefix: 'WO', initialLocation: 'ON_SITE', tax: { label: 'SST', ratePct: 8 } },
});

/** Buildings and campuses: help-desk requests, trades, term contractors, statutory PPM. */
export const FACILITIES = maintenancePack({
  id: 'facilities',
  name: 'Facilities & buildings',
  description: 'Help-desk requests across buildings, trades (HVAC, electrical, plumbing, lifts, fire), term contractors, planned preventive maintenance and statutory inspections.',
  terms: {
    jobRegister: 'Help desk', component: 'Asset / room', originUnit: 'Requested by (tenant / department)',
    site: 'Building', sites: 'Buildings', priority: 'Emergency call-out', vendorRepair: 'Contractor repair', vendorRepairs: 'Contractor repairs',
    pm: 'Planned preventive maintenance (PPM)',
  },
  modules: { vendorRepair: false, tools: false },
  roleTitles: {
    ADMIN: ['Administrator', 'Pentadbir'], HELPDESK: ['Help desk', 'Meja bantuan'], SUPERVISOR: ['Facilities supervisor', 'Penyelia fasiliti'],
    TECHNICIAN: ['Technician (trade)', 'Juruteknik'], STORES: ['Storekeeper', 'Penjaga stor'], PURCHASING: ['Procurement', 'Perolehan'],
    FINANCE: ['Finance', 'Kewangan'], MANAGER: ['Facilities manager', 'Pengurus fasiliti'],
  },
  dictionaries: {
    site: [e('HQ', 'Head office tower', 'Menara ibu pejabat'), e('ANNEX', 'Annex block', 'Blok anjung'), e('WAREHOUSE', 'Warehouse', 'Gudang')],
    location: [
      e('ON_SITE', 'On site', 'Di tapak'), e('PLANT_ROOM', 'Plant room', 'Bilik loji'), e('WORKSHOP', 'Workshop', 'Bengkel'),
      e('STORE', 'Store', 'Stor'), e('VENDOR', 'At contractor', 'Di kontraktor'), e('CUSTOMER', 'With occupant', 'Di penghuni'),
    ],
    category: [
      e('HVAC', 'Air-conditioning & ventilation', 'Penyamanan udara'), e('ELECTRICAL', 'Electrical', 'Elektrik'), e('PLUMBING', 'Plumbing', 'Paip'),
      e('LIFTS', 'Lifts & escalators', 'Lif & eskalator'), e('FIRE', 'Fire protection', 'Perlindungan kebakaran'), e('CIVIL', 'Civil & fabric', 'Sivil & struktur'),
      e('CLEANING', 'Cleaning & pest', 'Pembersihan & perosak'),
    ],
    priority: [
      e('EMERGENCY', 'Emergency — make safe in 2 h', 'Kecemasan — selamatkan dalam 2 jam', { tone: 'bad', responseHours: 2 }),
      e('URGENT', 'Urgent — respond in 24 h', 'Segera — respons dalam 24 jam', { tone: 'warn', responseHours: 24 }),
    ],
    incidentArea: [e('AWARENESS', 'Near miss', 'Nyaris kemalangan'), e('CONTROL', 'Unsafe condition', 'Keadaan tidak selamat'), e('CRITICAL', 'Injury or property damage', 'Kecederaan atau kerosakan harta')],
    course: [e('WORK_AT_HEIGHT', 'Working at height', 'Kerja di tempat tinggi'), e('ELECTRICAL_SAFETY', 'Electrical safety', 'Keselamatan elektrik'), e('CONFINED_SPACE', 'Confined space entry', 'Ruang terkurung')],
    assetType: [
      e('CHILLER', 'Chiller', 'Penyejuk'), e('AHU', 'Air handling unit', 'Unit pengendali udara'), e('LIFT', 'Lift', 'Lif'),
      e('GENSET', 'Generator set', 'Set penjana'), e('FIRE_PANEL', 'Fire alarm panel', 'Panel penggera kebakaran'), e('PUMP', 'Pump', 'Pam'),
    ],
  },
  completeRequires: [field('rootCause', 'Cause of fault')],
  minQuotations: 3,
  defaults: { jobPrefix: 'HD', initialLocation: 'ON_SITE', tax: { label: 'SST', ratePct: 8 } },
});

/** Vehicle fleets and workshops: services by mileage, breakdowns, roadworthiness checks. */
export const FLEET = maintenancePack({
  id: 'fleet',
  name: 'Fleet & vehicles',
  description: 'Workshop jobs for cars, vans, trucks, buses and forklifts: servicing by odometer or engine hours, breakdowns, vehicle-off-road priority and roadworthiness inspection.',
  terms: {
    job: 'Job card', jobs: 'Job cards', jobNo: 'Job card no.', jobRegister: 'Workshop jobs', component: 'Vehicle',
    originUnit: 'Driver / department', site: 'Depot', sites: 'Depots', priority: 'Vehicle off road (VOR)',
    asset: 'Vehicle', assets: 'Fleet', pm: 'Service schedule',
  },
  modules: { vendorRepair: true, tools: true },
  roleTitles: {
    ADMIN: ['Administrator', 'Pentadbir'], HELPDESK: ['Fleet coordinator', 'Penyelaras armada'], SUPERVISOR: ['Workshop supervisor', 'Penyelia bengkel'],
    TECHNICIAN: ['Mechanic', 'Mekanik'], STORES: ['Parts clerk', 'Kerani alat ganti'], PURCHASING: ['Purchasing', 'Perolehan'],
    FINANCE: ['Finance', 'Kewangan'], MANAGER: ['Fleet manager', 'Pengurus armada'],
  },
  dictionaries: {
    site: [e('HQ', 'Main depot', 'Depoh utama'), e('NORTH', 'North depot', 'Depoh utara'), e('SOUTH', 'South depot', 'Depoh selatan')],
    location: [
      e('YARD', 'Yard', 'Laman'), e('WORKSHOP', 'Workshop bay', 'Petak bengkel'), e('ON_ROAD', 'On the road', 'Di jalan'),
      e('STORE', 'Parts store', 'Stor alat ganti'), e('VENDOR', 'At specialist / dealer', 'Di pakar / pengedar'), e('CUSTOMER', 'With driver', 'Dengan pemandu'),
    ],
    category: [
      e('SERVICE', 'Scheduled service', 'Servis berjadual'), e('BREAKDOWN', 'Breakdown', 'Kerosakan'), e('TYRES', 'Tyres', 'Tayar'),
      e('BODYWORK', 'Bodywork', 'Badan kenderaan'), e('INSPECTION', 'Statutory inspection', 'Pemeriksaan berkanun'),
    ],
    priority: [
      e('VOR', 'Vehicle off road', 'Kenderaan tidak boleh bergerak', { tone: 'bad' }),
      e('SAFETY', 'Safety defect', 'Kecacatan keselamatan', { tone: 'bad' }),
      e('URGENT', 'Urgent', 'Segera', { tone: 'warn' }),
    ],
    route: [
      e('IN_HOUSE', 'In-house workshop', 'Bengkel dalaman', { note: 'Move to the next free bay' }),
      e('DEALER', 'Dealer / specialist', 'Pengedar / pakar', { note: 'Book the dealer under the warranty or service contract' }),
      e('SPARE_VEHICLE', 'Spare vehicle', 'Kenderaan ganti', { note: 'Issue a spare vehicle to the driver' }),
      e('EXPEDITE_PARTS', 'Expedite parts', 'Percepat alat ganti', { note: 'Purchasing expedites the parts order' }),
    ],
    incidentArea: [e('AWARENESS', 'Near miss', 'Nyaris kemalangan'), e('CONTROL', 'Tool / equipment control', 'Kawalan alatan'), e('CRITICAL', 'Accident damage', 'Kerosakan kemalangan')],
    course: [e('DEFENSIVE_DRIVING', 'Defensive driving', 'Pemanduan berhemah'), e('FORKLIFT', 'Forklift operation', 'Operasi forklift'), e('HV_SYSTEMS', 'EV high-voltage safety', 'Keselamatan voltan tinggi EV')],
    assetType: [
      e('CAR', 'Car', 'Kereta'), e('VAN', 'Van', 'Van'), e('TRUCK', 'Truck', 'Lori'), e('BUS', 'Bus', 'Bas'),
      e('TRAILER', 'Trailer', 'Treler'), e('FORKLIFT', 'Forklift', 'Forklift'),
    ],
  },
  startRequires: [field('odometer', 'Odometer reading')],
  inspection: { label: 'Road test / inspection', labelMs: 'Uji jalan / pemeriksaan', requires: [field('roadTestBy', 'Road-tested by'), field('inspectionRef', 'Inspection checklist ref')] },
  minQuotations: 2,
  sla: [
    { id: 'SLA-ASSIGN', entity: 'JOB', status: 'OPEN', days: 1, rule: 'Book into a bay within 1 day', source: 'Fleet policy' },
    { id: 'SLA-START', entity: 'JOB', status: 'ASSIGNED', days: 1, rule: 'Start work within 1 day', source: 'Fleet policy' },
    { id: 'SLA-WORK', entity: 'JOB', status: 'IN_PROGRESS', days: 3, rule: 'Return the vehicle to service within 3 days', source: 'Fleet policy' },
    { id: 'SLA-PARTS', entity: 'JOB', status: 'ON_HOLD_PARTS', days: 7, rule: 'Parts within 7 days', source: 'Fleet policy' },
    { id: 'SLA-INSPECT', entity: 'JOB', status: 'INSPECTION', days: 1, rule: 'Road test within 1 day', source: 'Fleet policy' },
    { id: 'SLA-DEALER', entity: 'OV', status: 'AT_VENDOR', days: 10, rule: 'Dealer repairs back within 10 days', source: 'Fleet policy' },
    { id: 'SLA-PAYMENT', entity: 'INVOICE', status: 'SENT', days: 30, rule: 'Payment within 30 days', source: 'Payment terms' },
  ],
  defaults: { jobPrefix: 'JC', initialLocation: 'YARD', tax: { label: 'SST', ratePct: 8 } },
});

/** Factories and process plants: breakdowns that stop production, permits to work, OEM repairs. */
export const INDUSTRIAL = maintenancePack({
  id: 'industrial',
  name: 'Industrial plant',
  description: 'Plant and production equipment: breakdowns ranked by production impact, permit to work and isolation, run-hour based preventive maintenance and repairs at OEM or rewinding shops.',
  terms: {
    component: 'Equipment', originUnit: 'Production line / area', site: 'Plant', sites: 'Plants', priority: 'Breakdown priority',
    asset: 'Equipment', assets: 'Equipment register', vendorRepair: 'OEM / shop repair', vendorRepairs: 'OEM & shop repairs',
  },
  modules: { vendorRepair: true, tools: true },
  roleTitles: {
    ADMIN: ['Administrator', 'Pentadbir'], HELPDESK: ['Production (requester)', 'Pengeluaran (pemohon)'], SUPERVISOR: ['Maintenance planner', 'Perancang penyelenggaraan'],
    TECHNICIAN: ['Maintenance technician', 'Juruteknik penyelenggaraan'], STORES: ['Storekeeper', 'Penjaga stor'], PURCHASING: ['Purchasing', 'Perolehan'],
    FINANCE: ['Finance', 'Kewangan'], MANAGER: ['Maintenance manager', 'Pengurus penyelenggaraan'],
  },
  dictionaries: {
    site: [e('HQ', 'Main plant', 'Loji utama'), e('PLANT2', 'Plant 2', 'Loji 2')],
    location: [
      e('ON_SITE', 'In place (line)', 'Di tempat (barisan)'), e('WORKSHOP', 'Maintenance workshop', 'Bengkel penyelenggaraan'),
      e('STORE', 'Store', 'Stor'), e('VENDOR', 'At OEM / shop', 'Di OEM / bengkel luar'), e('CUSTOMER', 'Returned to production', 'Dipulangkan ke pengeluaran'),
    ],
    category: [
      e('MECHANICAL', 'Mechanical', 'Mekanikal'), e('ELECTRICAL', 'Electrical', 'Elektrik'), e('INSTRUMENT', 'Instrumentation & control', 'Instrumentasi & kawalan'),
      e('LUBRICATION', 'Lubrication', 'Pelinciran'), e('CALIBRATION', 'Calibration', 'Penentukuran'),
    ],
    priority: [
      e('LINE_DOWN', 'Production stopped', 'Pengeluaran terhenti', { tone: 'bad' }),
      e('SAFETY', 'Safety / environmental', 'Keselamatan / alam sekitar', { tone: 'bad' }),
      e('DEGRADED', 'Running degraded', 'Beroperasi terhad', { tone: 'warn' }),
    ],
    incidentArea: [e('AWARENESS', 'Near miss', 'Nyaris kemalangan'), e('CONTROL', 'Isolation / lock-out breach', 'Pelanggaran pengasingan'), e('CRITICAL', 'Injury, spill or damage', 'Kecederaan, tumpahan atau kerosakan')],
    course: [e('LOTO', 'Lock-out / tag-out', 'Kunci & tanda (LOTO)'), e('CONFINED_SPACE', 'Confined space entry', 'Ruang terkurung'), e('HOT_WORK', 'Hot work', 'Kerja panas')],
    assetType: [
      e('MOTOR', 'Electric motor', 'Motor elektrik'), e('PUMP', 'Pump', 'Pam'), e('COMPRESSOR', 'Compressor', 'Pemampat'),
      e('CONVEYOR', 'Conveyor', 'Penghantar'), e('BOILER', 'Boiler', 'Dandang'), e('PLC', 'PLC / control panel', 'PLC / panel kawalan'),
    ],
  },
  startRequires: [field('permitRef', 'Permit to work no.'), field('isolationRef', 'Isolation / LOTO ref')],
  completeRequires: [field('rootCause', 'Root cause'), field('downtimeHours', 'Downtime (hours)')],
  minQuotations: 3,
  defaults: { jobPrefix: 'MWO', initialLocation: 'ON_SITE', tax: { label: 'SST', ratePct: 8 } },
});

/** Hospitals and clinics: biomedical equipment, electrical safety testing, OEM service. */
export const MEDICAL = maintenancePack({
  id: 'medical',
  name: 'Medical equipment',
  description: 'Biomedical engineering for hospitals and clinics: device repairs with patient-risk priority, electrical safety testing before return to service, OEM repairs and scheduled PPM.',
  terms: {
    component: 'Device', originUnit: 'Department / ward', site: 'Facility', sites: 'Facilities', priority: 'Clinical priority',
    asset: 'Device', assets: 'Device inventory', vendorRepair: 'OEM repair', vendorRepairs: 'OEM repairs', pm: 'Planned preventive maintenance (PPM)',
    incident: 'Adverse event', incidents: 'Adverse events & safety',
  },
  modules: { vendorRepair: true, tools: true },
  roleTitles: {
    ADMIN: ['Administrator', 'Pentadbir'], HELPDESK: ['Ward / department', 'Wad / jabatan'], SUPERVISOR: ['Biomedical engineer', 'Jurutera bioperubatan'],
    TECHNICIAN: ['Biomedical technician', 'Juruteknik bioperubatan'], STORES: ['Stores', 'Stor'], PURCHASING: ['Procurement', 'Perolehan'],
    FINANCE: ['Finance', 'Kewangan'], MANAGER: ['Head of biomedical engineering', 'Ketua kejuruteraan bioperubatan'],
  },
  dictionaries: {
    site: [e('HQ', 'Main hospital', 'Hospital utama'), e('CLINIC', 'Outpatient clinic', 'Klinik pesakit luar')],
    location: [
      e('ON_SITE', 'In clinical area', 'Di kawasan klinikal'), e('WORKSHOP', 'Biomedical workshop', 'Bengkel bioperubatan'),
      e('STORE', 'Equipment store', 'Stor peralatan'), e('VENDOR', 'At OEM', 'Di OEM'), e('CUSTOMER', 'Returned to department', 'Dipulangkan ke jabatan'),
    ],
    category: [
      e('REPAIR', 'Repair', 'Pembaikan'), e('PPM', 'Planned maintenance', 'Penyelenggaraan berjadual'), e('CALIBRATION', 'Calibration', 'Penentukuran'),
      e('SAFETY_TEST', 'Electrical safety test', 'Ujian keselamatan elektrik'), e('RECALL', 'Recall / field safety notice', 'Penarikan semula / notis keselamatan'),
    ],
    priority: [
      e('LIFE_SUPPORT', 'Life support / critical care', 'Sokongan hayat / rawatan kritikal', { tone: 'bad' }),
      e('PATIENT_IMPACT', 'Patient care affected', 'Rawatan pesakit terjejas', { tone: 'warn' }),
    ],
    route: [
      e('IN_HOUSE', 'In-house biomedical team', 'Pasukan bioperubatan dalaman', { note: 'Assign the on-call biomedical engineer' }),
      e('OEM', 'OEM field service', 'Servis lapangan OEM', { note: 'Log a call with the manufacturer under the service contract' }),
      e('LOAN', 'Loan / pool device', 'Peranti pinjaman / pool', { note: 'Issue a tested device from the equipment pool' }),
    ],
    incidentArea: [e('AWARENESS', 'Near miss', 'Nyaris kemalangan'), e('CONTROL', 'Device fault found in use', 'Kerosakan dikesan semasa digunakan'), e('CRITICAL', 'Patient or staff harm', 'Kecederaan pesakit atau kakitangan')],
    course: [e('ELECTRICAL_SAFETY', 'IEC 62353 testing', 'Ujian IEC 62353'), e('INFECTION_CONTROL', 'Infection control', 'Kawalan jangkitan'), e('OEM_TRAINING', 'OEM device training', 'Latihan peranti OEM')],
    assetType: [
      e('INFUSION_PUMP', 'Infusion pump', 'Pam infusi'), e('VENTILATOR', 'Ventilator', 'Ventilator'), e('DEFIBRILLATOR', 'Defibrillator', 'Defibrilator'),
      e('MONITOR', 'Patient monitor', 'Monitor pesakit'), e('ULTRASOUND', 'Ultrasound', 'Ultrabunyi'), e('XRAY', 'X-ray', 'X-ray'),
    ],
  },
  startRequires: [field('decontaminated', 'Decontamination certificate ref')],
  inspection: {
    label: 'Safety & performance test', labelMs: 'Ujian keselamatan & prestasi',
    requires: [field('safetyTestRef', 'Electrical safety test ref (IEC 62353)'), field('testedBy', 'Tested by')],
  },
  minQuotations: 3,
  sla: [
    { id: 'SLA-ASSIGN', entity: 'JOB', status: 'OPEN', days: 1, rule: 'Respond within 1 day', source: 'Biomedical service standard' },
    { id: 'SLA-START', entity: 'JOB', status: 'ASSIGNED', days: 1, rule: 'Start within 1 day', source: 'Biomedical service standard' },
    { id: 'SLA-WORK', entity: 'JOB', status: 'IN_PROGRESS', days: 7, rule: 'Return to service within 7 days', source: 'Biomedical service standard' },
    { id: 'SLA-PARTS', entity: 'JOB', status: 'ON_HOLD_PARTS', days: 14, rule: 'Parts within 14 days', source: 'Biomedical service standard' },
    { id: 'SLA-TEST', entity: 'JOB', status: 'INSPECTION', days: 1, rule: 'Safety test within 1 day of repair', source: 'IEC 62353' },
    { id: 'SLA-OEM', entity: 'OV', status: 'AT_VENDOR', days: 21, rule: 'OEM repairs back within 21 days', source: 'Service contract' },
    { id: 'SLA-PAYMENT', entity: 'INVOICE', status: 'SENT', days: 30, rule: 'Payment within 30 days', source: 'Payment terms' },
  ],
  defaults: { jobPrefix: 'BME', initialLocation: 'ON_SITE', tax: { label: 'SST', ratePct: 8 } },
});
