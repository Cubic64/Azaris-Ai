import React, { useState } from 'react';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import type { DigitalEmployee } from '../types';

interface EmployeesViewProps {
  employees: DigitalEmployee[];
  onUpdateEmployee: (emp: DigitalEmployee) => void;
  onAddEmployee: (emp: DigitalEmployee) => void;
  onChatWithEmployee: (id: string) => void;
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  employees,
  onUpdateEmployee,
  onAddEmployee,
  onChatWithEmployee,
}) => {
  const [selectedId, setSelectedId] = useState(employees[0]?.id || '');
  const [newMemory, setNewMemory] = useState('');
  const [showHireForm, setShowHireForm] = useState(false);
  const [hireName, setHireName] = useState('');
  const [hireRole, setHireRole] = useState('');
  const [hirePrompt, setHirePrompt] = useState('');

  const selected = employees.find((e) => e.id === selectedId) || employees[0];

  const handleAddMemory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.trim() || !selected) return;
    onUpdateEmployee({
      ...selected,
      memory: [...selected.memory, newMemory.trim()],
    });
    setNewMemory('');
  };

  const handleRemoveMemory = (idx: number) => {
    if (!selected) return;
    onUpdateEmployee({
      ...selected,
      memory: selected.memory.filter((_, i) => i !== idx),
    });
  };

  const handleHireSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hireName.trim() || !hireRole.trim()) return;
    const created: DigitalEmployee = {
      id: `emp-${Date.now()}`,
      name: hireName.trim(),
      role: hireRole.trim(),
      avatar: employees[0]?.avatar || '/src/assets/images/avatar_maya_cos_1794567788614.jpg',
      specialty: hireRole.trim(),
      systemPrompt:
        hirePrompt.trim() ||
        `You are ${hireName.trim()}, ${hireRole.trim()} in Azaris. Assist clearly and propose Approval Cards before taking external actions.`,
      memory: ['Adapt to founder preferences over time.'],
      allowedTools: ['read_gmail_inbox', 'browse_webpage', 'list_system_files'],
      active: true,
    };
    onAddEmployee(created);
    setSelectedId(created.id);
    setHireName('');
    setHireRole('');
    setHirePrompt('');
    setShowHireForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
            Autonomous Digital Employees
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure role instructions, persistent memory, and active status for each team member.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowHireForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-sm font-medium hover:bg-slate-800 dark:hover:bg-blue-500 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Hire Digital Employee
        </button>
      </div>

      {showHireForm && (
        <form
          onSubmit={handleHireSubmit}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">New Digital Employee</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={hireName}
                onChange={(e) => setHireName(e.target.value)}
                placeholder="e.g. Elena Rostova"
                className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Role Title</label>
              <input
                type="text"
                required
                value={hireRole}
                onChange={(e) => setHireRole(e.target.value)}
                placeholder="e.g. Growth & Research Analyst"
                className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Operating Instructions
            </label>
            <textarea
              rows={3}
              value={hirePrompt}
              onChange={(e) => setHirePrompt(e.target.value)}
              placeholder="Describe responsibilities, tone, and approval rules..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
            >
              Add to Workforce
            </button>
            <button
              type="button"
              onClick={() => setShowHireForm(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Roster List */}
        <div className="lg:col-span-5 space-y-2.5">
          {employees.map((emp) => {
            const active = emp.id === selected?.id;
            return (
              <button
                key={emp.id}
                type="button"
                onClick={() => setSelectedId(emp.id)}
                className={`w-full text-left p-4 rounded-xl border transition-colors flex items-center gap-3.5 ${
                  active
                    ? 'border-slate-900 dark:border-blue-500 bg-white dark:bg-slate-900'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <img
                  src={emp.avatar}
                  alt={emp.name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                      {emp.name}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {emp.active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 truncate">{emp.role}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{emp.specialty}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Employee Detail & Persistent Memory */}
        {selected && (
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <img
                  src={selected.avatar}
                  alt={selected.name}
                  referrerPolicy="no-referrer"
                  className="w-14 h-14 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                />
                <div>
                  <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
                    {selected.name}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{selected.role}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onChatWithEmployee(selected.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Open Thread
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                System Prompt & Guardrails
              </label>
              <textarea
                rows={4}
                value={selected.systemPrompt}
                onChange={(e) => onUpdateEmployee({ ...selected, systemPrompt: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-sm text-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Persistent Memory ({selected.memory.length})
                </h4>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                {selected.memory.map((mem, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{mem}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMemory(idx)}
                      aria-label="Remove memory item"
                      className="text-slate-400 hover:text-rose-600 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddMemory} className="flex gap-2">
                <input
                  type="text"
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder="Teach a permanent preference or workflow rule..."
                  className="flex-1 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
                />
                <button
                  type="submit"
                  className="px-4 h-10 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Save Memory
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
