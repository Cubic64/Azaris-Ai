import React from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  PhoneCall,
  RefreshCw,
  Volume2,
  XCircle,
} from 'lucide-react';
import type {
  DailyActivityOverview,
  QuickBooksInvoice,
  ScheduledMeeting,
} from '../types';

interface DailyOverviewViewProps {
  overview: DailyActivityOverview | null;
  selectedDate: string;
  onChangeDate: (dateKey: string) => void;
  onRefresh: () => Promise<void>;
  onSpeakSummary: (text: string) => void;
  meetings: ScheduledMeeting[];
  onUpdateMeetingStatus: (id: string, status: 'scheduled' | 'completed' | 'cancelled') => Promise<void>;
  invoices: QuickBooksInvoice[];
  onProposeCheckupCall: (inv: QuickBooksInvoice) => void;
  onProposeMeeting: (inv: QuickBooksInvoice) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  call: 'Voice Call',
  meeting: 'Meeting',
  quickbooks: 'QuickBooks',
  gmail: 'Gmail',
  whatsapp: 'WhatsApp',
  browser: 'Web / Media',
  system: 'Laptop / Files',
  approval: 'Approval',
};

export const DailyOverviewView: React.FC<DailyOverviewViewProps> = ({
  overview,
  selectedDate,
  onChangeDate,
  onRefresh,
  onSpeakSummary,
  meetings,
  onUpdateMeetingStatus,
  invoices,
  onProposeCheckupCall,
  onProposeMeeting,
}) => {
  const unpaidInvoices = invoices.filter((i) => i.status !== 'Paid');
  const nowMs = Date.now();
  const dueInvoices = unpaidInvoices.filter(
    (i) => (i.followUpWeeks ?? 2) > 0 && (!i.nextFollowUpAt || new Date(i.nextFollowUpAt).getTime() <= nowMs)
  );
  const upcomingInvoices = unpaidInvoices.filter(
    (i) => i.nextFollowUpAt && new Date(i.nextFollowUpAt).getTime() > nowMs
  );

  const counts = overview?.counts || {
    total: 0,
    calls: 0,
    meetings: 0,
    quickbooks: 0,
    gmail: 0,
    whatsapp: 0,
    browser: 0,
    system: 0,
    approvals: 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
            Daily Overview &amp; Multi-Week Check-Ups
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Everything your Azaris workforce did today, scheduled meetings, and recurring multi-week invoice check-up calls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onChangeDate(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-mono text-slate-800 dark:text-slate-100"
          />
          {overview?.narrative && (
            <button
              type="button"
              onClick={() => onSpeakSummary(overview.narrative)}
              className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              Speak Overview
            </button>
          )}
          <button
            type="button"
            onClick={() => onRefresh()}
            className="h-9 px-3.5 rounded-lg bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Executive All-Day Summary Banner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            All-Day Executive Summary ({overview?.dateKey || selectedDate})
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {counts.total} logged actions
          </span>
        </div>

        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          {overview?.narrative || 'Loading daily activity report...'}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-1">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
            <div className="text-[11px] text-slate-500">Voice Calls</div>
            <div className="font-mono tabular-nums text-lg font-semibold mt-0.5">{counts.calls}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
            <div className="text-[11px] text-slate-500">Meetings</div>
            <div className="font-mono tabular-nums text-lg font-semibold mt-0.5">{counts.meetings}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
            <div className="text-[11px] text-slate-500">QuickBooks</div>
            <div className="font-mono tabular-nums text-lg font-semibold mt-0.5">{counts.quickbooks}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
            <div className="text-[11px] text-slate-500">Gmail</div>
            <div className="font-mono tabular-nums text-lg font-semibold mt-0.5">{counts.gmail}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
            <div className="text-[11px] text-slate-500">WhatsApp</div>
            <div className="font-mono tabular-nums text-lg font-semibold mt-0.5">{counts.whatsapp}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
            <div className="text-[11px] text-slate-500">Chrome / System</div>
            <div className="font-mono tabular-nums text-lg font-semibold mt-0.5">
              {counts.browser + counts.system}
            </div>
          </div>
        </div>
      </div>

      {/* Invoice Check-Ups & Scheduled Meetings Split */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Multi-Week Invoice Check-Up Queue
              </h3>
              <p className="text-xs text-slate-500">
                Calls customers every few weeks for payment updates — always queues an Approval Card first.
              </p>
            </div>
            <span className="font-mono text-xs text-amber-600 dark:text-amber-400 font-semibold">
              {dueInvoices.length} due now
            </span>
          </div>

          <div className="space-y-2.5">
            {unpaidInvoices.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">All invoices are paid. No follow-up calls pending.</p>
            ) : (
              [...dueInvoices, ...upcomingInvoices].map((inv) => {
                const isDue = !inv.nextFollowUpAt || new Date(inv.nextFollowUpAt).getTime() <= nowMs;
                return (
                  <div
                    key={inv.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {inv.invoiceNumber} · {inv.customerName} (${inv.amount.toLocaleString()})
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {inv.customerPhone || 'No phone on file'} · Every {inv.followUpWeeks ?? 2} wk(s) ·{' '}
                        <span className={isDue ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                          {isDue
                            ? 'Due for check-up call'
                            : `Next call: ${new Date(inv.nextFollowUpAt!).toLocaleDateString()}`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onProposeCheckupCall(inv)}
                        className="h-8 px-2.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <PhoneCall className="w-3 h-3" />
                        Ask to Call
                      </button>
                      <button
                        type="button"
                        onClick={() => onProposeMeeting(inv)}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <Calendar className="w-3 h-3" />
                        Ask to Meet
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Scheduled Meetings */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Scheduled Meetings ({meetings.length})
              </h3>
              <p className="text-xs text-slate-500">
                Only created after your explicit approval via Command Center Approval Cards.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {meetings.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                No meetings scheduled yet. Click &ldquo;Ask to Meet&rdquo; on any invoice or ask Maya/Aria in Command Center.
              </p>
            ) : (
              meetings.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {m.title}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {m.contactName} ·{' '}
                        {new Date(m.scheduledFor).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        ({m.durationMinutes} min)
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-medium shrink-0 ${
                        m.status === 'completed'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : m.status === 'cancelled'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-blue-600 dark:text-blue-400'
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>

                  {m.notes && <p className="text-[11px] text-slate-600 dark:text-slate-300">{m.notes}</p>}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {m.calendarUrl && (
                      <a
                        href={m.calendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open in Google Calendar
                      </a>
                    )}
                    {m.status === 'scheduled' && (
                      <>
                        <button
                          type="button"
                          onClick={() => onUpdateMeetingStatus(m.id, 'completed')}
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Mark Done
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateMeetingStatus(m.id, 'cancelled')}
                          className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 hover:underline"
                        >
                          <XCircle className="w-3 h-3" />
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Chronological All-Day Activity Log */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            What Azaris Did All Day ({overview?.entries.length || 0} events)
          </span>
          <span className="text-[11px] font-mono text-slate-400">{selectedDate}</span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {!overview || overview.entries.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No activity recorded for {selectedDate} yet. Actions across Gmail, QuickBooks, Calls, Meetings, Chrome, and Files appear here automatically.
            </div>
          ) : (
            overview.entries.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono tabular-nums text-slate-400">
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{entry.employeeName}</span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                      {CATEGORY_LABELS[entry.category] || entry.category}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{entry.title}</div>
                  {entry.detail && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">{entry.detail}</div>
                  )}
                </div>

                <span
                  className={`text-xs font-medium shrink-0 ${
                    entry.status === 'completed' || entry.status === 'approved'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : entry.status === 'pending_approval'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {entry.status.replace('_', ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
