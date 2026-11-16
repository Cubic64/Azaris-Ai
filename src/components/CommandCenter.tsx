import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Volume2, VolumeX, ArrowUpRight, Terminal } from 'lucide-react';
import type { ApprovalProposal, ChatMessage, DigitalEmployee } from '../types';
import { ApprovalCard } from './ApprovalCard';

interface CommandCenterProps {
  employees: DigitalEmployee[];
  activeEmployeeId: string;
  onSelectEmployee: (id: string) => void;
  messages: ChatMessage[];
  isThinking: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  interimTranscript: string;
  autoSpeak: boolean;
  onToggleAutoSpeak: () => void;
  onToggleListen: () => void;
  onSendMessage: (text: string) => void;
  onApproveProposal: (id: string, editedPayload?: Record<string, unknown>) => Promise<void>;
  onRejectProposal: (id: string) => void;
  onQuickPrompt: (prompt: string, employeeId?: string) => void;
  pendingCount: number;
  unreadGmailCount: number;
  overdueReceivables: number;
  whatsappCount: number;
  todayActionsCount?: number;
  onOpenDailyOverview?: () => void;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  employees,
  activeEmployeeId,
  onSelectEmployee,
  messages,
  isThinking,
  isListening,
  interimTranscript,
  autoSpeak,
  onToggleAutoSpeak,
  onToggleListen,
  onSendMessage,
  onApproveProposal,
  onRejectProposal,
  onQuickPrompt,
  pendingCount,
  unreadGmailCount,
  overdueReceivables,
  whatsappCount,
  todayActionsCount = 0,
  onOpenDailyOverview,
}) => {
  const [input, setInput] = useState('');
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;
    setInput('');
    onSendMessage(trimmed);
  };

  const activeEmployee = employees.find((e) => e.id === activeEmployeeId) || employees[0];

  return (
    <div className="flex flex-col h-full">
      {/* Executive Morning Briefing Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Approval Queue</div>
          <div className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {pendingCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Human-in-the-loop guardrails</div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Gmail Unread</div>
          <div className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {unreadGmailCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Live OAuth inbox sync</div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Receivables Pending</div>
          <div className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            ${overdueReceivables.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">QuickBooks ledger</div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">WhatsApp Threads</div>
          <div className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {whatsappCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active client channels</div>
        </div>
      </div>

      {/* Employee Selector Bar */}
      <div className="py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto">
          {employees.map((emp) => {
            const selected = emp.id === activeEmployee.id;
            return (
              <button
                key={emp.id}
                type="button"
                onClick={() => onSelectEmployee(emp.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selected
                    ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <img
                  src={emp.avatar}
                  alt={emp.name}
                  referrerPolicy="no-referrer"
                  className="w-5 h-5 rounded-full object-cover"
                />
                <span>{emp.name}</span>
                <span className={selected ? 'text-slate-300 dark:text-blue-100' : 'text-slate-400'}>
                  · {emp.role.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onOpenDailyOverview && (
            <button
              type="button"
              onClick={onOpenDailyOverview}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <span>All-Day Overview</span>
              <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">({todayActionsCount})</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleAutoSpeak}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {autoSpeak ? <Volume2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> : <VolumeX className="w-3.5 h-3.5" />}
            {autoSpeak ? 'Local Voice Reply On' : 'Local Voice Reply Off'}
          </button>
        </div>
      </div>

      {/* Conversation & Approval Stream */}
      <div className="flex-1 overflow-y-auto py-5 space-y-5 pr-1">
        {messages.length === 0 && (
          <div className="max-w-2xl space-y-4">
            <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
              Speak or type a command for {activeEmployee.name}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Your autonomous digital employees can read Gmail, draft WhatsApp messages, place voice calls,
              manage QuickBooks invoices, browse live websites, and control your laptop settings or system files—always
              checking with you via Approval Cards before taking external actions.
            </p>
            <div className="grid sm:grid-cols-2 gap-2.5 pt-2">
              {[
                {
                  label: 'Give me an overview of what you did all day',
                  emp: 'emp-maya',
                },
                {
                  label: 'Check unpaid invoices and ask permission before calling for invoice check-ups',
                  emp: 'emp-marcus',
                },
                {
                  label: 'Ask permission to set a meeting with Northwind Logistics about INV-1042',
                  emp: 'emp-aria',
                },
                {
                  label: 'Check Gmail for paid bills and update QuickBooks',
                  emp: 'emp-marcus',
                },
                {
                  label: 'Draft a WhatsApp message to Sarah Jenkins confirming noon sync',
                  emp: 'emp-aria',
                },
                {
                  label: 'Play lofi hip hop beats on YouTube and make it full screen',
                  emp: 'emp-kael',
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onQuickPrompt(item.label, item.emp)}
                  className="text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-start justify-between gap-2 transition-colors"
                >
                  <span>{item.label}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-0.5" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} space-y-2`}>
            <div
              className={`max-w-3xl rounded-xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-2 text-xs text-slate-500 dark:text-slate-400">
                  {msg.employeeAvatar && (
                    <img
                      src={msg.employeeAvatar}
                      alt={msg.employeeName || 'Agent'}
                      referrerPolicy="no-referrer"
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  )}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{msg.employeeName}</span>
                  {msg.providerUsed && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{msg.providerUsed}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{msg.timestamp}</span>
                </div>
              )}

              <div className="whitespace-pre-wrap">{msg.content}</div>

              {msg.toolTrace && msg.toolTrace.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1">
                  {msg.toolTrace.map((t, idx) => (
                    <div key={idx} className="flex items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      <Terminal className="w-3 h-3 shrink-0" />
                      <span>{t.name}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t.detail || t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {msg.proposals && msg.proposals.length > 0 && (
              <div className="w-full max-w-2xl space-y-3">
                {msg.proposals.map((prop) => (
                  <ApprovalCard
                    key={prop.id}
                    proposal={prop}
                    onApprove={onApproveProposal}
                    onReject={onRejectProposal}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {isThinking && (
          <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <img
              src={activeEmployee.avatar}
              alt={activeEmployee.name}
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover"
            />
            <span>{activeEmployee.name} is processing your request...</span>
          </div>
        )}
        <div ref={feedEndRef} />
      </div>

      {/* Command Input Bar */}
      <form onSubmit={handleSubmit} className="pt-3 border-t border-slate-200 dark:border-slate-800">
        {interimTranscript && (
          <div className="mb-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
            Listening: &ldquo;{interimTranscript}&rdquo;
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleListen}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            className={`h-11 px-3.5 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              isListening
                ? 'bg-rose-600 border-rose-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Command ${activeEmployee.name} (e.g. "Check Gmail", "Open stripe.com", "Switch to voice only mode")...`}
            className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          <button
            type="submit"
            disabled={!input.trim() || isThinking}
            className="h-11 px-5 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-sm font-medium hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-40 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>
      </form>
    </div>
  );
};
