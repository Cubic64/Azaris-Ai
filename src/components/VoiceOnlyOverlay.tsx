import React from 'react';
import { Mic, MicOff, VolumeX, LayoutGrid, Check, X } from 'lucide-react';
import type { ApprovalProposal, DigitalEmployee } from '../types';

interface VoiceOnlyOverlayProps {
  employees: DigitalEmployee[];
  activeEmployeeId: string;
  onSelectEmployee: (id: string) => void;
  isListening: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  audioLevel: number;
  interimTranscript: string;
  lastUserTranscript: string;
  lastAssistantReply: string;
  providerLabel: string;
  pendingProposals: ApprovalProposal[];
  onToggleListen: () => void;
  onStopSpeaking: () => void;
  onExitVoiceOnly: () => void;
  onApproveProposal: (id: string) => Promise<void>;
  onRejectProposal: (id: string) => void;
}

export const VoiceOnlyOverlay: React.FC<VoiceOnlyOverlayProps> = ({
  employees,
  activeEmployeeId,
  onSelectEmployee,
  isListening,
  isSpeaking,
  isThinking,
  audioLevel,
  interimTranscript,
  lastUserTranscript,
  lastAssistantReply,
  providerLabel,
  pendingProposals,
  onToggleListen,
  onStopSpeaking,
  onExitVoiceOnly,
  onApproveProposal,
  onRejectProposal,
}) => {
  const activeEmployee = employees.find((e) => e.id === activeEmployeeId) || employees[0];
  const scale = isListening ? 1 + audioLevel * 0.32 : isSpeaking ? 1.08 : 1;

  const statusText = isListening
    ? 'Listening locally via Web Speech API'
    : isThinking
    ? `${activeEmployee.name} is reasoning (${providerLabel})`
    : isSpeaking
    ? `${activeEmployee.name} is speaking locally`
    : 'Voice-Only Mode Ready · Tap microphone to speak';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col justify-between p-6 md:p-10">
      {/* Minimal Header */}
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <span className="font-display text-lg font-bold tracking-tight text-white">Azaris</span>
          <span aria-hidden="true" className="text-slate-600">/</span>
          <span className="text-sm text-slate-400">Voice-Only Mode · Local Audio</span>
        </div>

        <button
          type="button"
          onClick={onExitVoiceOnly}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <LayoutGrid className="w-4 h-4" />
          Exit Voice Mode
        </button>
      </div>

      {/* Center Acoustic Core */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full text-center space-y-8">
        {/* Employee Switcher */}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {employees.map((emp) => {
            const selected = emp.id === activeEmployee.id;
            return (
              <button
                key={emp.id}
                type="button"
                onClick={() => onSelectEmployee(emp.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selected
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <img
                  src={emp.avatar}
                  alt={emp.name}
                  referrerPolicy="no-referrer"
                  className="w-5 h-5 rounded-full object-cover"
                />
                {emp.name}
              </button>
            );
          })}
        </div>

        {/* Reactive Acoustic Orb */}
        <div className="relative flex items-center justify-center w-56 h-56">
          <div
            className={`absolute inset-0 rounded-full border transition-transform duration-100 ${
              isListening
                ? 'border-blue-500/40 bg-blue-500/10'
                : isSpeaking
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-slate-800 bg-slate-900/50'
            }`}
            style={{ transform: `scale(${scale})` }}
          />
          <div
            className={`absolute inset-6 rounded-full border transition-transform duration-150 ${
              isListening
                ? 'border-blue-400/50'
                : isSpeaking
                ? 'border-emerald-400/50'
                : 'border-slate-800'
            }`}
            style={{ transform: `scale(${1 + (scale - 1) * 0.6})` }}
          />
          <button
            type="button"
            onClick={onToggleListen}
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
            className="relative z-10 w-32 h-32 rounded-full overflow-hidden border-2 border-slate-700 hover:border-blue-400 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-500/40"
          >
            <img
              src={activeEmployee.avatar}
              alt={activeEmployee.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </button>
        </div>

        <div className="space-y-3 w-full">
          <p className="text-xs font-mono uppercase tracking-wider text-slate-400">{statusText}</p>

          {(interimTranscript || lastUserTranscript) && (
            <p className="text-base text-blue-300 font-medium min-h-[24px]">
              {interimTranscript ? `"${interimTranscript}..."` : `You: "${lastUserTranscript}"`}
            </p>
          )}

          {lastAssistantReply && (
            <p className="text-lg md:text-xl text-slate-100 font-normal leading-relaxed max-w-xl mx-auto">
              {lastAssistantReply}
            </p>
          )}
        </div>

        {/* Pending Guardrail Approval in Voice Mode */}
        {pendingProposals.length > 0 && (
          <div className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-slate-900 p-4 text-left space-y-3">
            <div className="text-xs font-medium text-amber-400">
              Action Approval Required · {pendingProposals[0].employeeName}
            </div>
            <div className="text-sm font-semibold text-white">{pendingProposals[0].title}</div>
            <p className="text-xs text-slate-300">{pendingProposals[0].summary}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onApproveProposal(pendingProposals[0].id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500"
              >
                <Check className="w-3.5 h-3.5" />
                Approve & Execute
              </button>
              <button
                type="button"
                onClick={() => onRejectProposal(pendingProposals[0].id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-medium hover:bg-slate-800"
              >
                <X className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Voice Controls */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onToggleListen}
          className={`inline-flex items-center gap-2.5 px-6 py-3 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
            isListening
              ? 'bg-rose-600 hover:bg-rose-500 text-white'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          {isListening ? 'Stop Listening' : 'Tap to Speak'}
        </button>

        {isSpeaking && (
          <button
            type="button"
            onClick={onStopSpeaking}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <VolumeX className="w-4 h-4" />
            Stop Voice
          </button>
        )}
      </div>
    </div>
  );
};
