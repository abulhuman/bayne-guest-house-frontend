import { useEffect, useMemo, useState } from 'react';
import Layout from '@/components/Layout';
import RequireAuth from '@/components/RequireAuth';
import axios from '@/utils/axiosInstance';
import ListState from '@/components/ListState';
import Modal from '@/components/Modal';
import Field from '@/components/Field';
import { useAuth } from '@/context/AuthContext';
import { canManageInventoryItems } from '@/lib/permissions';
import { useList } from '@/lib/useList';
import { dateTime } from '@/lib/format';
import Link from 'next/link';
import Alert from '@/components/Alert';
import Button, { buttonClass } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import Panel from '@/components/Panel';
import { Chip } from '@/components/StatusChip';
import Table from '@/components/Table';
import { Plus } from '@phosphor-icons/react';

type Item = {
  id: number;
  name: string;
  category: string;
  unit?: string | null;   // 'pcs' | 'kg' | 'L'
  sku?: string | null;
  quantity: number;
  minThreshold?: number;
  updatedAt: string;
};

type Movement = {
  id: number;
  type: 'IN' | 'OUT' | 'ADJUST' | string;
  quantity: number;
  reason?: string | null;
  createdAt: string;
};

/* ---------- Modals ---------- */

function NewItemModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (it: Item) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState<'pcs' | 'kg' | 'L'>('pcs'); // ← dropdown value
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [minThreshold, setMinThreshold] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setCategory('');
    setUnit('pcs'); // default
    setSku('');
    setQuantity('');
    setMinThreshold('');
    setErr('');
  }, [open]);

  const submit = async () => {
    setErr('');
    if (!name.trim()) return setErr('Name is required');
    if (!category.trim()) return setErr('Category is required');
    try {
      setLoading(true);
      const res = await axios.post('/inventory', {
        name: name.trim(),
        category: category.trim(),
        unit, // from dropdown: 'pcs' | 'kg' | 'L'
        sku: sku.trim() || undefined,
        quantity: typeof quantity === 'number' ? quantity : undefined,
        minThreshold: typeof minThreshold === 'number' ? minThreshold : undefined,
      });
      onCreated(res.data);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Create failed');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="New Item" size="xl" locked={loading}>
      {err && <Alert className="mt-3">{err}</Alert>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>

        <Field label="Category">
          {(id) => <Input id={id} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g., Grocery, Kitchen, Housekeeping" />}
        </Field>

        <Field label="Unit">
          {(id) => (
            <Select
              id={id}
              value={unit}
              onChange={(e) => setUnit(e.target.value as 'pcs' | 'kg' | 'L')}
            >
              <option value="pcs">pcs</option>
              <option value="kg">kg</option>
              <option value="L">L</option>
            </Select>
          )}
        </Field>

        <Field label="SKU (optional)">
          {(id) => <Input id={id} value={sku} onChange={(e) => setSku(e.target.value)} />}
        </Field>

        <Field label="Initial Quantity (optional)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
            />
          )}
        </Field>

        <Field label="Min Threshold (optional)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={minThreshold}
              onChange={(e) => setMinThreshold(e.target.value === '' ? '' : Number(e.target.value))}
            />
          )}
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={loading}>
          {loading ? 'Saving…' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
}

function quantityError(qty: number | '', kind: 'in' | 'out' | 'adjust', stock: number): string | null {
  if (qty === '') return 'Enter quantity';
  if (!Number.isInteger(qty)) return 'Enter a whole number';
  if (kind === 'adjust') return qty < 0 ? 'Quantity cannot be negative' : null;
  if (qty <= 0) return 'Quantity must be more than 0';
  if (kind === 'out' && qty > stock) return 'Insufficient stock';
  return null;
}

function StockModal({
  open, onClose, onDone, item, kind,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (it: Item) => void;
  item: Item | null;
  kind: 'in' | 'out' | 'adjust';
}) {
  const [qty, setQty] = useState<number | ''>('');
  const [qtyErr, setQtyErr] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQty(''); setQtyErr(''); setReason(''); setErr('');
  }, [open]);

  if (!open || !item) return null;

  const title = kind === 'in' ? `Receive Stock — ${item.name}` : kind === 'out' ? `Issue Stock — ${item.name}` : `Adjust Stock — ${item.name}`;

  const submit = async () => {
    setErr('');
    const invalid = quantityError(qty, kind, item.quantity);
    setQtyErr(invalid ?? '');
    if (invalid) return;

    try {
      setLoading(true);
      // Unified backend endpoint: POST /inventory/:id/movements { type, quantity, reason? }
      const type = kind === 'in' ? 'IN' : kind === 'out' ? 'OUT' : 'ADJUST';
      const res = await axios.post(`/inventory/${item.id}/movements`, {
        type,
        quantity: qty,
        reason: reason || undefined,
      });
      onDone(res.data);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} locked={loading}>
      <div className="mt-2 text-sm text-muted">
        Current: {item.quantity} {item.unit || ''}
      </div>
      {err && <Alert className="mt-3">{err}</Alert>}

      <div className="mt-4 space-y-3">
        <Field label={`Quantity ${item.unit ? `(${item.unit})` : ''}`.trim()} error={qtyErr}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={kind === 'adjust' ? 0 : 1}
              step={1}
              aria-invalid={!!qtyErr}
              value={qty}
              onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={kind === 'adjust' ? 'Set absolute quantity' : 'Enter amount to add/remove'}
            />
          )}
        </Field>
        <Field label="Reason (optional)">
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={loading}>
          {loading ? 'Processing…' : 'Confirm'}
        </Button>
      </div>
    </Modal>
  );
}

function HistoryModal({
  open, onClose, item,
}: {
  open: boolean;
  onClose: () => void;
  item: Item | null;
}) {
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!open || !item) return;
      setLoading(true);
      try {
        const res = await axios.get(`/inventory/${item.id}/movements?limit=200`);
        setRows(Array.isArray(res.data) ? res.data : res.data.movements ?? res.data);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [open, item]);

  if (!open || !item) return null;

  return (
    <Modal open={open} onClose={onClose} title={`History — ${item.name}`} size="3xl">
      <div className="mt-4 overflow-x-auto rounded-panel border border-line">
        {loading ? (
          <div className="p-4 text-muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-muted">No movements.</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Quantity</th>
                <th>Reason</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id}>
                  <td>
                    {m.type === 'IN' && <Chip tone="accent">In</Chip>}
                    {m.type === 'OUT' && <Chip tone="danger">Out</Chip>}
                    {m.type === 'ADJUST' && <Chip tone="neutral">Adjust</Chip>}
                  </td>
                  <td className="font-mono text-sm tabular-nums">{m.quantity} {item.unit || ''}</td>
                  <td>{m.reason || <span className="text-muted">—</span>}</td>
                  <td className="font-mono text-sm whitespace-nowrap tabular-nums">{dateTime(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="text" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

type ItemActionsProps = {
  item: Item;
  onAdd: () => void;
  onSubtract: () => void;
  onAdjust: () => void;
  onHistory: () => void;
  onRemove?: () => Promise<void>;
  removing: boolean;
};

function ItemActionsModal({
  open, onClose, item, ...actions
}: Omit<ItemActionsProps, 'item' | 'removing'> & { open: boolean; onClose: () => void; item: Item | null; }) {
  const [removing, setRemoving] = useState(false);
  if (!open || !item) return null;
  const remove = actions.onRemove;
  const onRemove = remove && (async () => {
    setRemoving(true);
    try {
      await remove();
    } finally {
      setRemoving(false);
    }
  });
  return (
    <Modal open={open} onClose={onClose} title={item.name} size="md" locked={removing}>
      <ItemActions item={item} {...actions} onRemove={onRemove} removing={removing} />
      <div className="mt-5 flex justify-end">
        <Button variant="text" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

// Lives inside Modal so its confirm step unmounts with the dialog and never carries over to the next item.
function ItemActions({ item, onAdd, onSubtract, onAdjust, onHistory, onRemove, removing }: ItemActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');

  const doRemove = async () => {
    if (!onRemove) return;
    setErr('');
    try {
      await onRemove();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Remove failed');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <div className="mt-2 text-sm text-muted">
        <div>Category: {item.category}</div>
        <div>SKU: {item.sku || '—'}</div>
        <div>Quantity: {item.quantity} {item.unit || ''}</div>
        <div>Min: {item.minThreshold ?? 0}</div>
        <div>Updated: {dateTime(item.updatedAt)}</div>
      </div>
      {err && <Alert className="mt-3">{err}</Alert>}

      {!confirming ? (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={onAdd}>Add</Button>
          <Button variant="quiet" onClick={onSubtract}>Subtract</Button>
          <Button variant="quiet" onClick={onAdjust}>Adjust</Button>
          <Button variant="quiet" onClick={onHistory}>History</Button>
          {onRemove && <Button variant="danger-quiet" className="col-span-2" onClick={() => setConfirming(true)}>Remove Item</Button>}
        </div>
      ) : (
        <Alert className="mt-5">
          <div className="font-semibold">Confirm removal</div>
          <div className="mt-1">Remove “{item.name}” from inventory? Its stock history is kept.</div>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" size="sm" disabled={removing} onClick={doRemove}>
              {removing ? 'Removing…' : 'Confirm Remove'}
            </Button>
            <Button variant="text" size="sm" disabled={removing} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </Alert>
      )}
    </>
  );
}

/* ---------- Page ---------- */

function InventoryInner() {
  const { user } = useAuth();
  const canManage = !!user && canManageInventoryItems(user.role);
  const [q, setQ] = useState(''); const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const items = useList<Item>('inventory', async () => {
    const res = await axios.get('/inventory', {
      params: {
        q: query || undefined,
        category: category || undefined,
        low: onlyLow ? 'true' : undefined,
      }
    });
    const arr = Array.isArray(res.data) ? res.data : res.data.inventory ?? res.data;
    return arr.map((r: Item) => ({ ...r, minThreshold: r.minThreshold ?? 0 }));
  }, JSON.stringify([query, category, onlyLow]));
  const { rows, setRows } = items;

  const [newOpen, setNewOpen] = useState(false);
  const [stockItem, setStockItem] = useState<Item | null>(null);
  const [stockKind, setStockKind] = useState<'in' | 'out' | 'adjust'>('in');
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  // Add: actions item state
  const [actionsItem, setActionsItem] = useState<Item | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => r.category && set.add(r.category));
    return Array.from(set).sort();
  }, [rows]);

  const low = (r: Item) => (r.quantity <= (r.minThreshold ?? 0));

  // Add: remove handler
  const removeItem = async (id: number) => {
    await axios.delete(`/inventory/${id}`);
    setRows(prev => prev.filter(p => p.id !== id));
    setActionsItem(null);
  };

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        {/* Always show Dashboard button */}
        <Link
          href="/dashboard"
          className={buttonClass('quiet', 'sm')}
        >
          Dashboard
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            className="sm:w-64"
            placeholder="Search name, SKU, category…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select className="sm:w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-accent size-4" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
            Low stock only
          </label>
          {canManage && (
            <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
              New Item
            </Button>
          )}
        </div>
      </div>

      <Panel className="overflow-x-auto">
        <ListState list={items}>
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>SKU</th>
                <th>Quantity</th>
                <th>Min</th>
                <th>Updated</th>
                {/* Removed Actions column */}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  className="cursor-pointer transition-colors hover:bg-accent-tint active:bg-slate-tint"
                  onClick={() => setActionsItem(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setActionsItem(r); }}
                  tabIndex={0}
                >
                  <td>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-xs text-muted">{r.unit || ''}</div>
                  </td>
                  <td>{r.category}</td>
                  <td>{r.sku || <span className="text-muted">—</span>}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm tabular-nums">{r.quantity} {r.unit || ''}</span>
                      {low(r) && <Chip tone="danger">Low</Chip>}
                    </div>
                  </td>
                  <td className="font-mono text-sm tabular-nums">{r.minThreshold ?? 0}</td>
                  <td className="font-mono text-sm whitespace-nowrap tabular-nums">{dateTime(r.updatedAt)}</td>
                  {/* Removed inline Actions cell */}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="text-muted" colSpan={6}>No items.</td></tr>
              )}
            </tbody>
          </Table>
        </ListState>
      </Panel>

      <NewItemModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(it) => setRows(prev => [it, ...prev])}
      />
      <StockModal
        open={!!stockItem}
        onClose={() => setStockItem(null)}
        onDone={(it) => setRows(prev => prev.map(p => p.id === it.id ? it : p))}
        item={stockItem}
        kind={stockKind}
      />
      <HistoryModal
        open={!!historyItem}
        onClose={() => setHistoryItem(null)}
        item={historyItem}
      />
      {/* Add: actions modal */}
      <ItemActionsModal
        open={!!actionsItem}
        onClose={() => setActionsItem(null)}
        item={actionsItem}
        onAdd={() => { if (actionsItem) { setStockItem(actionsItem); setStockKind('in'); setActionsItem(null); } }}
        onSubtract={() => { if (actionsItem) { setStockItem(actionsItem); setStockKind('out'); setActionsItem(null); } }}
        onAdjust={() => { if (actionsItem) { setStockItem(actionsItem); setStockKind('adjust'); setActionsItem(null); } }}
        onHistory={() => { if (actionsItem) { setHistoryItem(actionsItem); setActionsItem(null); } }}
        onRemove={canManage ? async () => { if (actionsItem) await removeItem(actionsItem.id); } : undefined}
      />
    </Layout>
  );
}

export default function InventoryPage() {
  return (
    <RequireAuth>
      <InventoryInner />
    </RequireAuth>
  );
}
// FE-4 live check, scratch PR. Do not merge.
