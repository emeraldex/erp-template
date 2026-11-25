import { hashPassword } from '../common/password';
import type { PrismaClient } from '../generated/prisma/client';
import type { Pack } from './types';

type Db = PrismaClient;

/** Demo people for the general-purpose packs: one per standard role, password demo123. */
const PEOPLE: [role: string, id: string, name: string][] = [
  ['ADMIN', 'admin', 'Aisyah Rahman'],
  ['HELPDESK', 'helpdesk', 'Nur Aina Kamal'],
  ['SUPERVISOR', 'supervisor', 'Farid Hassan'],
  ['TECHNICIAN', 'technician', 'Ravi Kumar'],
  ['STORES', 'stores', 'Lim Wei Jie'],
  ['PURCHASING', 'purchasing', 'Siti Hajar'],
  ['FINANCE', 'finance', 'Chong Mei Yee'],
  ['MANAGER', 'manager', 'Daniel Tan'],
];

/** Sample work items per pack: [item, part / model no., serial / tag, category, requested by]. */
const ITEMS: Record<string, [string, string, string, string, string][]> = {
  general: [
    ['Air compressor', 'GA-37', 'CMP-001', 'MECHANICAL', 'Production'],
    ['Main distribution board', 'MDB-400A', 'MDB-01', 'ELECTRICAL', 'Facilities'],
    ['Loading dock door', 'RD-3000', 'DOOR-04', 'GENERAL', 'Warehouse'],
    ['Water pump', 'CR-15', 'PMP-12', 'MECHANICAL', 'Utilities'],
    ['Lighting circuit L3', 'LC-3', 'LGT-L3', 'ELECTRICAL', 'Admin office'],
    ['Forklift', 'FD25', 'FL-02', 'MECHANICAL', 'Warehouse'],
  ],
  facilities: [
    ['Chiller 2', 'York YK', 'CH-02', 'HVAC', 'Level 12 tenant'],
    ['Passenger lift A', 'KONE MonoSpace', 'LIFT-A', 'LIFTS', 'Lobby reception'],
    ['Domestic water pump 5', 'Grundfos CR10', 'PMP-05', 'PLUMBING', 'HR department'],
    ['Fire alarm panel', 'Notifier NFS2', 'FAP-01', 'FIRE', 'Security'],
    ['AHU 7', 'Trane M-Series', 'AHU-07', 'HVAC', 'Level 7 tenant'],
    ['AHU 3', 'Trane M-Series', 'AHU-03', 'HVAC', 'Finance department'],
  ],
  fleet: [
    ['Van WXY 2231', 'Toyota Hiace', 'WXY2231', 'SERVICE', 'Deliveries'],
    ['Truck BKR 8810', 'Isuzu NPR', 'BKR8810', 'BREAKDOWN', 'Logistics'],
    ['Bus PJK 1102', 'Scania K250', 'PJK1102', 'INSPECTION', 'Staff transport'],
    ['Car VBC 7720', 'Proton X50', 'VBC7720', 'TYRES', 'Sales team'],
    ['Forklift FL-03', 'Toyota 8FD25', 'FL03', 'SERVICE', 'Warehouse'],
    ['Truck BKR 8812', 'Isuzu NPR', 'BKR8812', 'BODYWORK', 'Logistics'],
  ],
  industrial: [
    ['Conveyor 3 drive motor', 'WEG W22 37kW', 'MTR-C3', 'ELECTRICAL', 'Packing line 3'],
    ['Boiler feed pump', 'Grundfos CR32', 'BFP-01', 'MECHANICAL', 'Utilities'],
    ['Air compressor 2', 'Atlas Copco GA75', 'CMP-02', 'MECHANICAL', 'Utilities'],
    ['Filler PLC', 'Siemens S7-1500', 'PLC-F1', 'INSTRUMENT', 'Filling line 1'],
    ['Gearbox oil change', 'SEW R97', 'GBX-M4', 'LUBRICATION', 'Mixing'],
    ['Pressure transmitter', 'Rosemount 3051', 'PT-104', 'CALIBRATION', 'Reactor area'],
  ],
  medical: [
    ['Infusion pump', 'B. Braun Infusomat', 'BB-44871', 'REPAIR', 'Ward 5A'],
    ['Ventilator', 'Hamilton C6', 'HC6-1022', 'PPM', 'ICU'],
    ['Defibrillator', 'Zoll R Series', 'ZR-77310', 'SAFETY_TEST', 'Emergency department'],
    ['Patient monitor', 'Philips IntelliVue MX450', 'MX-55120', 'REPAIR', 'Ward 3B'],
    ['Ultrasound', 'GE Logiq E10', 'LE10-2210', 'CALIBRATION', 'Radiology'],
    ['Infusion pump', 'B. Braun Infusomat', 'BB-44902', 'RECALL', 'Paediatric ward'],
  ],
};

/** Asset type of each sample item above, and the meter it runs on (if any). */
const ASSET_TYPES: Record<string, string[]> = {
  general: ['EQUIPMENT', 'BUILDING', 'BUILDING', 'EQUIPMENT', 'BUILDING', 'VEHICLE'],
  facilities: ['CHILLER', 'LIFT', 'PUMP', 'FIRE_PANEL', 'AHU', 'AHU'],
  fleet: ['VAN', 'TRUCK', 'BUS', 'CAR', 'FORKLIFT', 'TRUCK'],
  industrial: ['MOTOR', 'PUMP', 'COMPRESSOR', 'PLC', 'MOTOR', 'PLC'],
  medical: ['INFUSION_PUMP', 'VENTILATOR', 'DEFIBRILLATOR', 'MONITOR', 'ULTRASOUND', 'INFUSION_PUMP'],
};
const METER: Record<string, { key: string; label: string; unit: string; start: number; every: number } | undefined> = {
  fleet: { key: 'ODOMETER', label: 'Odometer', unit: 'km', start: 48_000, every: 10_000 },
  industrial: { key: 'HOURS', label: 'Run hours', unit: 'h', start: 11_800, every: 2_000 },
};
/** A typical preventive task per pack: title, days between, checklist. */
const PM_TASK: Record<string, [string, number, string[]]> = {
  general: ['Quarterly inspection', 90, ['Visual inspection', 'Check fixings and guards', 'Test operation']],
  facilities: ['Monthly PPM', 30, ['Clean filters', 'Check belts and bearings', 'Record supply / return temperatures', 'Check for leaks']],
  fleet: ['Scheduled service', 180, ['Engine oil and filter', 'Brake inspection', 'Tyre pressures and tread', 'Lights and wipers']],
  industrial: ['Preventive maintenance', 90, ['Vibration reading', 'Lubricate bearings', 'Check alignment', 'Inspect terminals and cabling']],
  medical: ['Annual PPM & safety test', 365, ['Visual and functional check', 'Electrical safety test (IEC 62353)', 'Performance verification', 'Update service label']],
};

const SUPPLIERS: [name: string, type: 'SUPPLIER' | 'SUBCONTRACTOR'][] = [
  ['Prime Parts Sdn Bhd', 'SUPPLIER'], ['Delta Industrial Supply', 'SUPPLIER'], ['Metro Technical Services', 'SUBCONTRACTOR'],
];

/** Demo users, partners and a handful of work orders across the workflow, for a general-purpose pack. */
export async function seedPackDemo(prisma: Db, pack: Pack): Promise<void> {
  const password = process.env.SEED_PASSWORD?.trim() || 'demo123';
  const forceChange = process.env.SEED_FORCE_PASSWORD_CHANGE
    ? ['1', 'true', 'yes'].includes(process.env.SEED_FORCE_PASSWORD_CHANGE.toLowerCase())
    : process.env.NODE_ENV === 'production';
  const site = pack.dictionaries.site[0].key;
  const roles = new Map(pack.roles.map((r) => [r.key, r.label]));
  for (const [role, id, name] of PEOPLE) {
    if (!roles.has(role)) continue;
    const data = {
      name, email: `${id}@company.example`, passwordHash: await hashPassword(password), role,
      designation: roles.get(role)!.slice(0, 40), branch: site, mustChangePassword: forceChange,
    };
    await prisma.user.upsert({ where: { id: `u-${id}` }, create: { id: `u-${id}`, ...data }, update: data });
  }

  for (const [i, [name, type]] of SUPPLIERS.entries()) {
    const id = `${type === 'SUPPLIER' ? 'SUP' : 'SUB'}-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`;
    await prisma.partner.upsert({
      where: { id },
      create: {
        id, name, type, status: 'REGISTERED', country: 'MY', certifications: ['ISO 9001'], lists: [type === 'SUPPLIER' ? 'APPROVED_SUPPLIERS' : 'APPROVED_CONTRACTORS'],
        rating: 2, ordinal: SUPPLIERS.length - i,
      },
      update: {},
    });
  }

  // The register: one asset per sample item, with its meter, and a preventive schedule each.
  const types = ASSET_TYPES[pack.id] ?? ASSET_TYPES.general;
  const meter = METER[pack.id];
  const task = PM_TASK[pack.id] ?? PM_TASK.general;
  const knownTypes = new Set(pack.dictionaries.assetType.map((t) => t.key));
  const assetOf = new Map<number, string>();
  for (const [i, [name, model, tag, itemCategory]] of (ITEMS[pack.id] ?? ITEMS.general).entries()) {
    const type = knownTypes.has(types[i]) ? types[i] : pack.dictionaries.assetType[0]?.key;
    if (!type) break;
    const id = `AST-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`;
    const [make, ...rest] = model.split(' ');
    await prisma.asset.upsert({
      where: { id },
      create: {
        id, tag, name, type, site, make, model: rest.join(' ') || model, serialNo: tag, criticality: i < 2 ? 'HIGH' : 'MEDIUM',
        createdBy: 'seed', ordinal: i + 1,
        ...(meter ? { meters: { create: [{ key: meter.key, label: meter.label, unit: meter.unit, value: meter.start + i * 1_500, readAt: new Date() }] } } : {}),
      },
      update: {},
    });
    assetOf.set(i, id);
    const pmId = `PM-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`;
    await prisma.pmSchedule.upsert({
      where: { id: pmId },
      create: {
        id: pmId, assetId: id, title: task[0], intervalDays: task[1],
        ...(meter ? { meterKey: meter.key, intervalMeter: meter.every, nextDueMeter: meter.start + i * 1_500 + meter.every - 500 * i } : {}),
        // Stagger the due dates so the forecast shows a spread of upcoming work.
        nextDueAt: new Date(Date.now() + (7 + i * 9) * 86_400_000), leadDays: 7,
        category: pack.dictionaries.category.some((c) => c.key === itemCategory) ? itemCategory : (pack.dictionaries.category[0]?.key ?? ''),
        checklist: task[2].map((label, n) => ({ key: `c${n + 1}`, label, required: true })) as never, createdBy: 'seed',
      },
      update: {},
    });
  }

  // Spread the samples over the first statuses so every screen has something in it.
  const statuses = pack.statuses.JOB.filter((s) => !s.meta?.final).map((s) => s.key);
  const items = ITEMS[pack.id] ?? ITEMS.general;
  const year = new Date().getFullYear();
  const supervisor = PEOPLE.find((p) => p[0] === 'HELPDESK')!;
  for (const [i, [component, partNo, serialNo, category, originUnit]] of items.entries()) {
    const id = `${pack.defaults.jobPrefix}-${year}-${String(i + 1).padStart(4, '0')}`;
    const status = statuses[i % statuses.length];
    const days = (items.length - i) * 2;
    const receivedAt = new Date(Date.now() - days * 86_400_000);
    await prisma.job.upsert({
      where: { id },
      create: {
        id, psDate: receivedAt.toISOString().slice(0, 10), component, partNo, serialNo,
        category: pack.dictionaries.category.some((c) => c.key === category) ? category : (pack.dictionaries.category[0]?.key ?? 'GENERAL'),
        originUnit, repairUnit: site, status, location: pack.defaults.initialLocation,
        jobType: 'CORRECTIVE', assetId: assetOf.get(i) ?? null,
        receivedAt, statusSince: new Date(Date.now() - Math.ceil(days / 2) * 86_400_000), ordinal: items.length - i,
        audit: { create: [{ at: receivedAt, by: supervisor[2], role: supervisor[0], action: `${pack.terms.job} raised`, seq: 0 }] },
      },
      update: {},
    });
  }
  console.log(`Demo data for the ${pack.name} pack: ${PEOPLE.length} users (password ${process.env.SEED_PASSWORD ? 'from SEED_PASSWORD' : 'demo123'}), ${SUPPLIERS.length} partners, ${assetOf.size} assets with preventive schedules, ${items.length} ${pack.terms.jobs.toLowerCase()}.`);
}
