import type { Role } from '@/lib/permissions';

const roleNames: Record<Role, string> = {
  admin: 'Administrator', manager: 'Manager', reception: 'Reception', housekeeping: 'Housekeeping',
  barista: 'Barista', security: 'Security', finance: 'Finance', store: 'Store',
};

export default function HelpHero({ name, role }: { name: string; role: Role }) {
  const firstName = name.trim().split(/\s+/)[0] || 'there';
  return (
    <section className="mb-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Almis Hotel help</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">Good morning, {firstName}.</h1>
      <p className="mt-2 max-w-2xl text-muted">Short guides for your {roleNames[role].toLowerCase()} work, with the steps you use most often.</p>
    </section>
  );
}
