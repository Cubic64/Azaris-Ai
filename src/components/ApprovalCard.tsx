import React, { useState } from 'react';
import { Check, X, ShieldAlert, Pencil } from 'lucide-react';
import type { ApprovalProposal } from '../types';

interface ApprovalCardProps {
  proposal: ApprovalProposal;
  onApprove: (id: string, editedPayload?: Record<string, unknown>) => Promise<void>;
  onReject: (id: string) => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ proposal, onApprove, onReject }) => {
  const [editing, setEditing] = useState(false);
  const [payloadText, setPayloadText] = useState(JSON.stringify(proposal.payload, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setParseError(null);
    let finalPayload = proposal.payload;
    if (editing) {
      try {
        finalPayload = JSON.parse(payloadText) as Record<string, unknown>;
      } catch {
        setParseError('Payload must be valid JSON before executing.');
        return;
      }
    }
    setSubmitting(true);
    try {
      await onApprove(proposal.id, finalPayload);
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel =
    proposal.status === 'pending'
      ? 'Awaiting Approval'
      : proposal.status === 'executed'
      ? 'Executed'
      : proposal.status === 'rejected'
      ? 'Rejected'
      : proposal.status === 'failed'
      ? 'Execution Failed'
      : 'Approved';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src={proposal.employeeAvatar}
            alt={proposal.employeeName}
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-200">{proposal.employeeName}</span>
              <span aria-hidden="true">·</span>
              <span>{proposal.actionType.replace(/_/g, ' ')}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  proposal.status === 'executed'
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : proposal.status === 'failed' || proposal.status === 'rejected'
                    ? 'text-rose-600 dark:text-rose-400 font-medium'
                    : 'text-amber-600 dark:text-amber-400 font-medium'
                }
              >
                {statusLabel}
              </span>
            </div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50 mt-0.5 truncate">
              {proposal.title}
            </h4>
          </div>
        </div>

        {proposal.status === 'pending' && (
          <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-1" aria-hidden="true" />
        )}
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{proposal.summary}</p>

      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          {parseError && <p className="text-xs text-rose-600 dark:text-rose-400">{parseError}</p>}
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300 overflow-x-auto">
          {Object.entries(proposal.payload).map(([k, v]) => (
            <div key={k} className="flex gap-2 py-0.5">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">{k}:</span>
              <span className="truncate">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      )}

      {proposal.resultMessage && (
        <p
          className={`text-xs font-medium ${
            proposal.status === 'failed'
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-emerald-600 dark:text-emerald-400'
          }`}
        >
          {proposal.resultMessage}
        </p>
      )}

      {proposal.status === 'pending' && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            {submitting ? 'Executing...' : 'Approve & Execute'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
            {editing ? 'Cancel Edit' : 'Edit Payload'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onReject(proposal.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
};
