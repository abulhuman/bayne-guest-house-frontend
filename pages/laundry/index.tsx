import { useEffect, useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import Layout from '@/components/Layout';
import axios from '@/utils/axiosInstance';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import ListState from '@/components/ListState';
import Modal from '@/components/Modal';
import Field from '@/components/Field';
import { useToast } from '@/components/Toast';
import Alert from '@/components/Alert';
import Button, { buttonClass } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import Panel from '@/components/Panel';
import StatusChip, { Chip } from '@/components/StatusChip';
import Table from '@/components/Table';
import { useList, type List } from '@/lib/useList';
import { dateTime, money } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/permissions';

const ALLOWED_STATUSES = ['pending', 'in_progress', 'done'] as const;
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
};

type Laundry = { id: number; guestId: number; items: string; status: 'pending' | 'in_progress' | 'done'; createdAt: string | Date; guest?: { name: string; }; };
type Guest = { id: number; name: string; };
type Payment = { id: number; laundryId: number | null; status: string; amount: number; };

const REFUND_ROLES: readonly Role[] = ['admin', 'finance', 'reception', 'manager'];
const errMsg = (e: unknown, fallback: string) => (isAxiosError<{ message?: string; }>(e) && e.response?.data?.message) || fallback;

// Add Laundry Modal component
function AddLaundryModal({
  open, onClose, guests, onCreated, submitting, setSubmitting,
}: {
  open: boolean;
  onClose: () => void;
  guests: List<Guest>;
  onCreated: (row: any) => void;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
}) {
  const [guestId, setGuestId] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<{ name: string; qty: number; }[]>([{ name: '', qty: 1 }]);
  const [error, setError] = useState('');
  const [price, setPrice] = useState<string>(''); // ← NEW

  const reset = () => { setGuestId(''); setStatus(ALLOWED_STATUSES[0]); setItems([{ name: '', qty: 1 }]); setError(''); setPrice(''); };

  useEffect(() => { if (open) reset(); }, [open]);

  const updateItem = (i: number, patch: Partial<{ name: string; qty: number; }>) => {
    setItems(list => list.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () => setItems(l => [...l, { name: '', qty: 1 }]);
  const removeRow = (i: number) => setItems(l => l.length === 1 ? l : l.filter((_, idx) => idx !== i));

  const buildItemsString = () => {
    return items
      .filter(r => r.name.trim() && r.qty > 0)
      .map(r => `${r.qty} ${r.name.trim()}`)
      .join(', ');
  };

  const submit = async () => {
    setError('');
    if (!guestId) return setError('Guest required');
    const filtered = items.filter(r => r.name.trim() && r.qty > 0);
    if (filtered.length === 0) return setError('Add at least one item');
    const itemsStr = buildItemsString();
    const priceNum = price.trim() ? Number(price) : 0;
    if (!Number.isFinite(priceNum) || priceNum < 0) return setError('Price must be a non-negative number');
    try {
      setSubmitting(true);
      const res = await axios.post('/laundry', {
        guestId: Number(guestId),
        items: itemsStr,
        status: status || 'pending',
        price: priceNum, // ← include price
      });
      const created = res.data?.laundry ?? res.data;
      onCreated(created);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Add Laundry" size="xl" locked={submitting}>
      {error && <Alert className="mt-3">{error}</Alert>}

      <div className="mt-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Guest" className="md:col-span-2">
            {(id) => (
              <ListState list={guests} empty="No guests yet.">
                <Select
                  id={id}
                  value={guestId}
                  onChange={e => setGuestId(e.target.value)}
                >
                  <option value="">Select guest…</option>
                  {guests.rows.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </ListState>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={e => setStatus(e.target.value)}
              >
                {ALLOWED_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Price">
          {(id) => (
            <>
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                className="max-w-40"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="e.g. 150"
              />
              <p className="mt-1.5 text-xs text-muted">Payment will be recorded automatically for this amount.</p>
            </>
          )}
        </Field>

        <div>
          <p className="mb-1.5 block text-[13px] font-semibold text-ink">Items</p>
          <div className="space-y-2">
            {items.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  className="max-w-20 shrink-0"
                  value={row.qty}
                  onChange={e => updateItem(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                />
                <Input
                  className="flex-1"
                  placeholder="Item name"
                  value={row.name}
                  onChange={e => updateItem(i, { name: e.target.value })}
                />
                <Button
                  variant="danger-quiet"
                  size="sm"
                  onClick={() => removeRow(i)}
                  disabled={items.length === 1}
                  title="Remove row"
                >
                  –
                </Button>
                {i === items.length - 1 && (
                  <Button
                    size="sm"
                    onClick={addRow}
                    title="Add row"
                  >
                    +
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">Each row: quantity + item name (e.g. 3 Shirts). They will be combined automatically.</p>
        </div>

        <div className="rounded-input bg-page px-3.5 py-2.5 text-xs text-muted">
          Preview: {items.filter(r => r.name.trim()).length
            ? items.filter(r => r.name.trim() && r.qty > 0).map(r => `${r.qty} ${r.name.trim()}`).join(', ')
            : '—'}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button
          variant="text"
          onClick={onClose}
          disabled={submitting}
        >Cancel</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={submitting}
        >{submitting ? 'Saving…' : 'Save Laundry'}</Button>
      </div>
    </Modal>
  );
}

function LaundryInner() {
  const n = (d: any, k: string) => Array.isArray(d) ? d : (Array.isArray(d?.[k]) ? d[k] : []);
  const laundry = useList<Laundry>('laundry records', async () => n((await axios.get('/laundry')).data, 'laundry'));
  const guests = useList<Guest>('guests', async () => n((await axios.get('/guests')).data, 'guests'));
  const { user } = useAuth();
  const canRefund = !!user && REFUND_ROLES.includes(user.role);
  const payments = useList<Payment>('payments', async () => canRefund ? n((await axios.get('/payments')).data, 'payments') : []);
  const [confirmingRefund, setConfirmingRefund] = useState<Payment | null>(null);
  const [refunding, setRefunding] = useState<number | null>(null);
  const { rows, setRows } = laundry;
  const [q, setQ] = useState(''); const [status, setStatus] = useState<'All' | string>('All');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<Laundry | null>(null);
  const [removing, setRemoving] = useState(false);
  const { push } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ guestId: '', items: '', status: 'pending' });
  const [editError, setEditError] = useState('');
  const [justSaved, setJustSaved] = useState<number | null>(null);

  useEffect(() => {
    if (justSaved != null) {
      const t = setTimeout(() => setJustSaved(null), 2000);
      return () => clearTimeout(t);
    }
  }, [justSaved]);

  useEffect(() => {
    if (payments.state.kind === 'error') push(`${payments.state.message}. Refunds are unavailable.`, 'error');
  }, [payments.state, push]);

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    return rows.filter(r => {
      const inText = !t || r.items.toLowerCase().includes(t) || (r.guest?.name ?? '').toLowerCase().includes(t) || String(r.guestId).includes(t) || r.status.toLowerCase().includes(t);
      const inStatus = status === 'All' || r.status === status;
      return inText && inStatus;
    });
  }, [q, status, rows]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, totalPages); const start = (cur - 1) * pageSize; const slice = filtered.slice(start, start + pageSize);

  const handleCreated = (created: Laundry) => {
    const guest = guests.rows.find(g => g.id === created.guestId);
    setRows(p => [{ ...created, guest }, ...p]);
    payments.reload();
  };

  const beginEdit = (r: Laundry) => { setEditing(r.id); setEditForm({ guestId: String(r.guestId), items: r.items, status: r.status }); };
  const cancelEdit = () => { setEditing(null); setEditForm({ guestId: '', items: '', status: 'pending' }); setEditError(''); };
  const saveEdit = async (id: number) => {
    if (!editForm.items.trim()) {
      setEditError('Items required');
      return;
    }
    setSubmitting(true);
    setEditError('');
    try {
      const payload = { items: editForm.items.trim(), status: editForm.status };
      const res = await axios.patch(`/laundry/${id}`, payload);
      const updated: Laundry = res.data?.laundry ?? res.data ?? { id, ...payload };
      const guest = guests.rows.find(g => g.id === updated.guestId) || rows.find(r => r.id === id)?.guest;
      setRows(p => p.map(r => r.id === id ? { ...r, ...updated, guest } : r));
      setJustSaved(id);
      cancelEdit();
    } catch (e: any) {
      setEditError(e?.response?.data?.message || 'Update failed');
    } finally {
      setSubmitting(false);
    }
  };
  const remove = async (id: number) => {
    setRemoving(true);
    try {
      await axios.delete(`/laundry/${id}`);
      setRows(p => p.filter(x => x.id !== id));
    } catch (e) {
      push(errMsg(e, 'Delete failed'), 'error');
    } finally {
      setRemoving(false);
      setDeleting(null);
    }
  };
  const refund = async (paymentId: number) => {
    setRefunding(paymentId);
    try {
      await axios.patch(`/payments/${paymentId}`, { status: 'refunded' });
      payments.setRows(p => p.map(x => x.id === paymentId ? { ...x, status: 'refunded' } : x));
      push('Payment refunded', 'success');
    } catch (e) {
      push(errMsg(e, 'Refund failed'), 'error');
    } finally {
      setRefunding(null);
      setConfirmingRefund(null);
    }
  };

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Laundry</h1>
        {typeof window !== 'undefined' && !location.pathname.startsWith('/dashboard') && (
          <Link
            href="/dashboard"
            className={buttonClass('quiet', 'sm')}
          >
            Dashboard
          </Link>
        )}
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setAddModalOpen(true)}>
            + Add Laundry
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search by guest, items, status…" className="sm:w-96" />
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted">Status</label>
          <Select className="sm:w-auto" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="All">All</option>
            {ALLOWED_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted">Rows</label>
          <Select
            className="sm:w-auto"
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={cur <= 1}>Prev</Button>
          <span className="text-sm text-muted">Page {cur} / {totalPages}</span>
          <Button size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={cur >= totalPages}>Next</Button>
        </div>
      </div>

      {/* Table (moved out of the select; previously malformed) */}
      <Panel className="overflow-x-auto">
        <ListState list={laundry} empty="No laundry records.">
          {slice.length === 0 ? (
            <div className="p-6 text-muted">No laundry records.</div>
          ) : (
          <Table>
            <thead>
              <tr>
                <th>Guest</th>
                <th>Items</th>
                <th>Status</th>
                <th>Created</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slice.map(r => {
                const isEditing = editing === r.id;
                const payment = payments.rows.find(p => p.laundryId === r.id);
                return (
                  <tr key={r.id}>
                    <td>{r.guest?.name ?? `Guest #${r.guestId}`}</td>
                    <td>
                      {isEditing ? (
                        <div className="space-y-1">
                          <Textarea
                            value={editForm.items}
                            onChange={e => setEditForm(f => ({ ...f, items: e.target.value }))}
                            rows={3}
                          />
                          {editError && <div className="text-xs text-danger">{editError}</div>}
                        </div>
                      ) : r.items}
                    </td>
                    <td>
                      {isEditing ? (
                        <Select
                          className="sm:w-auto"
                          value={editForm.status}
                          onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                        >
                          {ALLOWED_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      ) : (
                        <StatusChip status={r.status} />
                      )}
                    </td>
                    <td className="font-mono text-sm whitespace-nowrap tabular-nums">{dateTime(r.createdAt)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        {isEditing ? (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => saveEdit(r.id)}
                              disabled={submitting}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => beginEdit(r)}
                            >
                              Edit
                            </Button>
                            {payment?.status === 'paid' && (
                              <Button
                                size="sm"
                                onClick={() => setConfirmingRefund(payment)}
                                disabled={refunding === payment.id}
                              >
                                {refunding === payment.id ? 'Refunding…' : 'Refund'}
                              </Button>
                            )}
                            <Button
                              variant="danger-quiet"
                              size="sm"
                              onClick={() => setDeleting(r)}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                        {justSaved === r.id && !isEditing && (
                          <Chip tone="accent">
                            Saved
                          </Chip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          )}
        </ListState>
      </Panel>

      <AddLaundryModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        guests={guests}
        onCreated={handleCreated}
        submitting={submitting}
        setSubmitting={setSubmitting}
      />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete laundry record" size="md" locked={removing}>
        <p className="text-sm text-muted">
          This removes the record for {deleting?.guest?.name ?? `Guest #${deleting?.guestId}`}.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="text" onClick={() => setDeleting(null)} disabled={removing}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => { if (deleting) remove(deleting.id); }}
            disabled={removing}
          >
            Delete
          </Button>
        </div>
      </Modal>
      <Modal open={!!confirmingRefund} onClose={() => setConfirmingRefund(null)} title="Refund payment" size="md" locked={refunding !== null}>
        <p className="text-sm text-muted">
          Refund this order&apos;s payment of {money(confirmingRefund?.amount ?? 0)}?
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="text" onClick={() => setConfirmingRefund(null)} disabled={refunding !== null}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => { if (confirmingRefund) refund(confirmingRefund.id); }}
            disabled={refunding !== null}
          >
            Refund
          </Button>
        </div>
      </Modal>
    </Layout>
  );
}

export default function LaundryPage() {
  return (
    <RequireAuth>
      <LaundryInner />
    </RequireAuth>
  );
}
// FE-4 live check, scratch PR. Do not merge.
