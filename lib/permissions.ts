export const ROLES = [
  'admin',
  'manager',
  'reception',
  'housekeeping',
  'barista',
  'security',
  'finance',
  'store',
] as const;

export type Role = (typeof ROLES)[number];

type Page = { path: string; label: string; roles: readonly Role[] };

// Order matters: a role lands on the first page it can see.
export const PAGES: readonly Page[] = [
  { path: '/dashboard', label: 'Dashboard', roles: ['admin', 'manager', 'reception', 'finance'] },
  { path: '/bookings', label: 'Bookings', roles: ['admin', 'manager', 'reception'] },
  { path: '/laundry', label: 'Laundry', roles: ['admin', 'manager', 'reception', 'housekeeping'] },
  { path: '/attendance', label: 'Attendance', roles: ['admin', 'manager', 'reception'] },
  { path: '/payments', label: 'Payments', roles: ['admin', 'manager', 'reception', 'finance'] },
  { path: '/inventory', label: 'Inventory', roles: ['admin', 'manager', 'reception', 'store', 'barista'] },
  { path: '/rooms', label: 'Rooms', roles: ['admin', 'manager', 'reception'] },
  { path: '/staff', label: 'Staff', roles: ['admin', 'manager'] },
  { path: '/guests', label: 'Guests', roles: ['admin', 'manager', 'reception'] },
  { path: '/help', label: 'Help', roles: ROLES },
];

// Mirrors the backend's @Roles on POST and DELETE /inventory.
const INVENTORY_ITEM_MANAGERS: readonly Role[] = ['admin', 'manager', 'reception', 'store'];

export function canManageInventoryItems(role: Role): boolean {
  return INVENTORY_ITEM_MANAGERS.includes(role);
}

export function pagesFor(role: Role): Page[] {
  return PAGES.filter((page) => page.roles.includes(role));
}

export function canSee(role: Role, path: string): boolean {
  return PAGES.some((page) => page.path === path && page.roles.includes(role));
}

export function landingFor(role: Role): string | null {
  return pagesFor(role)[0]?.path ?? null;
}

export const CHANGE_PASSWORD_PATH = '/change-password';

type Account = { role: Role; forceChangePassword: boolean };

export function homeFor(account: Account): string | null {
  return account.forceChangePassword ? CHANGE_PASSWORD_PATH : landingFor(account.role);
}

export function canOpen(account: Account, path: string): boolean {
  if (path === CHANGE_PASSWORD_PATH) return true;
  return !account.forceChangePassword && canSee(account.role, path);
}
