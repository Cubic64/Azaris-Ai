import React, { useState } from 'react';
import { RefreshCw, Plus, CheckCircle2, MailCheck, Receipt, PhoneCall, Calendar } from 'lucide-react';
import type {
  EmailSyncSummary,
  IntegrationCredentials,
  QuickBooksExpense,
  QuickBooksInvoice,
} from '../types';

interface QuickBooksViewProps {
  invoices: QuickBooksInvoice[];
  expenses: QuickBooksExpense[];
  credentials: IntegrationCredentials;
  onUpdateCredentials: (creds: IntegrationCredentials) => void;
  onSyncQuickBooks: () => Promise<void>;
  onProposeInvoice: (
    customerName: string,
    customerEmail: string,
    amount: number,
    description: string,
    customerPhone?: string,
    followUpWeeks?: number
  ) => void;
  onMarkPaid: (id: string) => Promise<void>;
  onAddExpense: (vendor: string, category: string, amount: number, status: 'Cleared' | 'Pending') => Promise<void>;
  onUpdateInvoiceFollowUp: (
    id: string,
    updates: { customerPhone?: string; followUpWeeks?: number }
  ) => Promise<void>;
  onProposeCheckupCall: (invoice: QuickBooksInvoice) => void;
  onProposeMeeting: (invoice: QuickBooksInvoice) => void;
  autoCheckupPrompts: boolean;
  onToggleAutoCheckupPrompts: (enabled: boolean) => void;
  onScanDueCheckups: () => Promise<number>;
  gmailConnected: boolean;
  autoReconcileEmail: boolean;
  onToggleAutoReconcile: (enabled: boolean) => void;
  autoApplyPaidInvoices: boolean;
  onToggleAutoApplyPaid: (enabled: boolean) => void;
  emailSyncIntervalSec: number;
  onChangeSyncInterval: (sec: number) => void;
  isScanningEmailQb: boolean;
  lastEmailSync: EmailSyncSummary | null;
  onScanEmailsNow: () => Promise<void>;
  onOpenGmailTab: () => void;
}

export const QuickBooksView: React.FC<QuickBooksViewProps> = ({
  invoices,
  expenses,
  credentials,
  onUpdateCredentials,
  onSyncQuickBooks,
  onProposeInvoice,
  onMarkPaid,
  onAddExpense,
  onUpdateInvoiceFollowUp,
  onProposeCheckupCall,
  onProposeMeeting,
  autoCheckupPrompts,
  onToggleAutoCheckupPrompts,
  onScanDueCheckups,
  gmailConnected,
  autoReconcileEmail,
  onToggleAutoReconcile,
  autoApplyPaidInvoices,
  onToggleAutoApplyPaid,
  emailSyncIntervalSec,
  onChangeSyncInterval,
  isScanningEmailQb,
  lastEmailSync,
  onScanEmailsNow,
  onOpenGmailTab,
}) => {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [checkupMsg, setCheckupMsg] = useState<string | null>(null);
  const [emailSyncError, setEmailSyncError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [custName, setCustName] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [followUpWeeks, setFollowUpWeeks] = useState(2);
  const [amount, setAmount] = useState('2500');
  const [desc, setDesc] = useState('');
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [editingPhoneVal, setEditingPhoneVal] = useState('');

  const [expVendor, setExpVendor] = useState('');
  const [expCategory, setExpCategory] = useState('Software');
  const [expAmount, setExpAmount] = useState('');
  const [expStatus, setExpStatus] = useState<'Cleared' | 'Pending'>('Cleared');

  const totalPaid = invoices.filter((i) => i.status === 'Paid').reduce((a, b) => a + b.amount, 0);
  const totalReceivable = invoices.filter((i) => i.status !== 'Paid').reduce((a, b) => a + b.amount, 0);
  const totalExpenses = expenses.reduce((a, b) => a + b.amount, 0);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await onSyncQuickBooks();
      setSyncMsg('QuickBooks ledger synchronized.');
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleEmailScan = async () => {
    setEmailSyncError(null);
    try {
      await onScanEmailsNow();
    } catch (err) {
      setEmailSyncError(err instanceof Error ? err.message : 'Email reconciliation failed.');
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim() || !amount) return;
    onProposeInvoice(
      custName.trim(),
      custEmail.trim(),
      Number(amount),
      desc.trim() || 'Services',
      custPhone.trim() || undefined,
      followUpWeeks
    );
    setCustName('');
    setCustEmail('');
    setCustPhone('');
    setDesc('');
    setShowCreate(false);
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expVendor.trim() || !Number(expAmount)) return;
    await onAddExpense(expVendor.trim(), expCategory, Number(expAmount), expStatus);
    setExpVendor('');
    setExpAmount('');
    setShowExpenseForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
            QuickBooks Financial Ledger
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track receivables, expenses, automated email bill payments, and Intuit QuickBooks Online sync.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowExpenseForm((v) => !v);
              setShowCreate(false);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium whitespace-nowrap hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Receipt className="w-3.5 h-3.5" />
            Log Expense
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCreate((v) => !v);
              setShowExpenseForm(false);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            New Invoice
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Collected Revenue</div>
          <div className="mt-1 font-mono tabular-nums text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
            ${totalPaid.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Open Receivables</div>
          <div className="mt-1 font-mono tabular-nums text-2xl font-semibold text-amber-600 dark:text-amber-400">
            ${totalReceivable.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Operating Expenses</div>
          <div className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            ${totalExpenses.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Periodic Email-to-QuickBooks Bill & Payment Watcher */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MailCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Periodic Gmail Bill &amp; Payment Watcher
              </div>
              <div className="text-[11px] text-slate-500">
                Automatically checks your inbox for invoice payment confirmations and vendor bills, then updates QuickBooks.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={autoReconcileEmail}
                onChange={(e) => onToggleAutoReconcile(e.target.checked)}
              />
              Auto-check inbox
            </label>

            <select
              value={emailSyncIntervalSec}
              onChange={(e) => onChangeSyncInterval(Number(e.target.value))}
              className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 text-xs font-mono"
            >
              <option value={30}>Every 30s</option>
              <option value={60}>Every 1m</option>
              <option value={300}>Every 5m</option>
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={autoApplyPaidInvoices}
                onChange={(e) => onToggleAutoApplyPaid(e.target.checked)}
              />
              Auto-mark paid
            </label>

            {gmailConnected ? (
              <button
                type="button"
                disabled={isScanningEmailQb}
                onClick={handleEmailScan}
                className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanningEmailQb ? 'animate-spin' : ''}`} />
                {isScanningEmailQb ? 'Scanning Gmail...' : 'Scan Gmail Now'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenGmailTab}
                className="h-8 px-3 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 text-xs font-medium whitespace-nowrap hover:bg-blue-50 dark:hover:bg-blue-950/30"
              >
                Connect Gmail to Enable
              </button>
            )}
          </div>
        </div>

        {emailSyncError && (
          <div className="text-xs text-rose-600 dark:text-rose-400">{emailSyncError}</div>
        )}

        {lastEmailSync && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 p-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
              <span>
                Last scanned <span className="font-mono">{lastEmailSync.scannedCount}</span> recent emails at{' '}
                <span className="font-mono">{new Date(lastEmailSync.lastScannedAt).toLocaleTimeString()}</span>
              </span>
              <span className="font-mono tabular-nums">
                {lastEmailSync.matchedPaid.length} payment matches · {lastEmailSync.detectedBills.length} bills detected
              </span>
            </div>

            {lastEmailSync.matchedPaid.length > 0 && (
              <div className="space-y-1">
                {lastEmailSync.matchedPaid.map((m) => (
                  <div key={`${m.invoiceId}-${m.emailId}`} className="text-emerald-700 dark:text-emerald-400">
                    Matched {m.invoiceNumber} ({m.customerName}, ${m.amount.toLocaleString()}) from "{m.emailSubject}" —{' '}
                    {m.markedPaid ? 'Marked Paid' : 'Ready to mark Paid'}
                  </div>
                ))}
              </div>
            )}

            {lastEmailSync.detectedBills.length > 0 && (
              <div className="space-y-1">
                {lastEmailSync.detectedBills.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
                    <span>
                      Bill detected: <strong>{b.vendor}</strong> (${b.amount.toLocaleString()} · {b.category}) from "
                      {b.emailSubject}"
                    </span>
                    {!b.logged ? (
                      <button
                        type="button"
                        onClick={() => onAddExpense(b.vendor, b.category, b.amount, 'Pending')}
                        className="text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                      >
                        Log Expense
                      </button>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400 shrink-0">Logged</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Multi-Week Invoice Check-Up Call & Meeting Watcher */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Multi-Week Invoice Check-Up Calls (Permission Required)
              </div>
              <div className="text-[11px] text-slate-500">
                Tracks open invoices on a 1–4 week follow-up cycle and ALWAYS queues an Approval Card asking your permission before calling or setting a meeting.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={autoCheckupPrompts}
                onChange={(e) => onToggleAutoCheckupPrompts(e.target.checked)}
              />
              Auto-ask when due
            </label>
            <button
              type="button"
              onClick={async () => {
                const count = await onScanDueCheckups();
                setCheckupMsg(
                  count > 0
                    ? `Queued ${count} permission Approval Card${count > 1 ? 's' : ''} in Command Center before calling.`
                    : 'No invoice check-up calls are currently overdue or unqueued.'
                );
              }}
              className="h-8 px-3 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              Check Due Follow-Ups
            </button>
          </div>
        </div>
        {checkupMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{checkupMsg}</p>}
      </div>

      {/* Intuit QuickBooks Online Live Connector */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            QuickBooks Online API Sync (Sandbox or Production)
          </span>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={credentials.quickbooksSandbox}
              onChange={(e) => onUpdateCredentials({ ...credentials, quickbooksSandbox: e.target.checked })}
            />
            Use Sandbox Host
          </label>
        </div>
        <div className="grid sm:grid-cols-12 gap-2.5">
          <input
            type="text"
            value={credentials.quickbooksRealmId}
            onChange={(e) => onUpdateCredentials({ ...credentials, quickbooksRealmId: e.target.value })}
            placeholder="QuickBooks Realm ID (Company ID)"
            className="sm:col-span-4 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
          />
          <input
            type="password"
            value={credentials.quickbooksAccessToken}
            onChange={(e) => onUpdateCredentials({ ...credentials, quickbooksAccessToken: e.target.value })}
            placeholder="OAuth 2.0 Bearer Access Token"
            className="sm:col-span-6 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
          />
          <button
            type="button"
            disabled={syncing || !credentials.quickbooksRealmId || !credentials.quickbooksAccessToken}
            onClick={handleSync}
            className="sm:col-span-2 h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync Live
          </button>
        </div>
        {syncMsg && <p className="text-xs text-slate-600 dark:text-slate-300">{syncMsg}</p>}
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
        >
          <div className="text-xs font-semibold">Create QuickBooks Invoice (Queues Approval Card)</div>
          <div className="grid sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              required
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              placeholder="Customer Name"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            />
            <input
              type="email"
              value={custEmail}
              onChange={(e) => setCustEmail(e.target.value)}
              placeholder="Billing Email"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            />
            <input
              type="tel"
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              placeholder="Phone (+14155550198)"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
            />
            <input
              type="number"
              required
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount ($)"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
            />
            <input
              type="text"
              required
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            />
            <select
              value={followUpWeeks}
              onChange={(e) => setFollowUpWeeks(Number(e.target.value))}
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            >
              <option value={1}>Check-up every 1 week</option>
              <option value={2}>Check-up every 2 weeks</option>
              <option value={3}>Check-up every 3 weeks</option>
              <option value={4}>Check-up every 4 weeks</option>
              <option value={0}>No recurring check-up</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium">
              Queue Invoice Approval
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {showExpenseForm && (
        <form
          onSubmit={handleCreateExpense}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
        >
          <div className="text-xs font-semibold">Record Operating Expense / Vendor Bill</div>
          <div className="grid sm:grid-cols-4 gap-2.5">
            <input
              type="text"
              required
              value={expVendor}
              onChange={(e) => setExpVendor(e.target.value)}
              placeholder="Vendor Name"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            />
            <input
              type="text"
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value)}
              placeholder="Category (e.g. Infrastructure)"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            />
            <input
              type="number"
              required
              min="1"
              step="0.01"
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              placeholder="Amount ($)"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
            />
            <select
              value={expStatus}
              onChange={(e) => setExpStatus(e.target.value as 'Cleared' | 'Pending')}
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            >
              <option value="Cleared">Cleared (Paid)</option>
              <option value="Pending">Pending Bill</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium">
              Save Expense
            </button>
            <button
              type="button"
              onClick={() => setShowExpenseForm(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Invoices Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200">
          Customer Invoices ({invoices.length})
        </div>
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              <th className="py-3 px-4 font-medium">Invoice</th>
              <th className="py-3 px-4 font-medium">Customer</th>
              <th className="py-3 px-4 font-medium">Phone &amp; Check-Up Cadence</th>
              <th className="py-3 px-4 font-medium">Due Date</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium text-right">Amount</th>
              <th className="py-3 px-4 font-medium text-right">Actions (Asks Permission)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {invoices.map((inv) => {
              const isDueNow =
                inv.status !== 'Paid' &&
                (inv.followUpWeeks ?? 2) > 0 &&
                (!inv.nextFollowUpAt || new Date(inv.nextFollowUpAt).getTime() <= Date.now());
              return (
                <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">{inv.invoiceNumber}</td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{inv.customerName}</div>
                    <div className="text-[11px] text-slate-500">{inv.description}</div>
                  </td>
                  <td className="py-3 px-4 text-xs space-y-1">
                    {editingPhoneId === inv.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="tel"
                          value={editingPhoneVal}
                          onChange={(e) => setEditingPhoneVal(e.target.value)}
                          placeholder="+14155550100"
                          className="h-7 w-32 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            await onUpdateInvoiceFollowUp(inv.id, { customerPhone: editingPhoneVal });
                            setEditingPhoneId(null);
                          }}
                          className="text-[11px] text-blue-600 dark:text-blue-400 font-medium"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPhoneId(inv.id);
                          setEditingPhoneVal(inv.customerPhone || '');
                        }}
                        className="font-mono text-[11px] text-slate-700 dark:text-slate-300 hover:underline block"
                      >
                        {inv.customerPhone || '+ Add phone'}
                      </button>
                    )}

                    {inv.status !== 'Paid' && (
                      <div className="flex items-center gap-2">
                        <select
                          value={inv.followUpWeeks ?? 2}
                          onChange={(e) =>
                            onUpdateInvoiceFollowUp(inv.id, { followUpWeeks: Number(e.target.value) })
                          }
                          className="h-6 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-1.5 text-[11px]"
                        >
                          <option value={0}>Cadence: Off</option>
                          <option value={1}>Every 1 wk</option>
                          <option value={2}>Every 2 wks</option>
                          <option value={3}>Every 3 wks</option>
                          <option value={4}>Every 4 wks</option>
                        </select>
                        <span
                          className={`text-[11px] ${
                            isDueNow ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'
                          }`}
                        >
                          {isDueNow
                            ? 'Due now'
                            : inv.nextFollowUpAt
                            ? `Next ${new Date(inv.nextFollowUpAt).toLocaleDateString()}`
                            : ''}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-500">{inv.dueDate}</td>
                  <td className="py-3 px-4 text-xs font-medium">
                    <span
                      className={
                        inv.status === 'Paid'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : inv.status === 'Overdue'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-medium">
                    ${inv.amount.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {inv.status !== 'Paid' && (
                      <div className="inline-flex items-center gap-2.5 justify-end flex-wrap">
                        <button
                          type="button"
                          onClick={() => onProposeCheckupCall(inv)}
                          className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          Ask to Call
                        </button>
                        <button
                          type="button"
                          onClick={() => onProposeMeeting(inv)}
                          className="inline-flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300 hover:underline whitespace-nowrap"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          Ask to Meet
                        </button>
                        <button
                          type="button"
                          onClick={() => onMarkPaid(inv.id)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Mark Paid
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Operating Expenses & Bills Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200">
          Operating Expenses &amp; Vendor Bills ({expenses.length})
        </div>
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              <th className="py-3 px-4 font-medium">Vendor</th>
              <th className="py-3 px-4 font-medium">Category</th>
              <th className="py-3 px-4 font-medium">Date</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {expenses.map((exp) => (
              <tr key={exp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">{exp.vendor}</td>
                <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">{exp.category}</td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-500">{exp.date}</td>
                <td className="py-3 px-4 text-xs font-medium">
                  <span
                    className={
                      exp.status === 'Cleared'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }
                  >
                    {exp.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-mono tabular-nums font-medium">
                  ${exp.amount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
