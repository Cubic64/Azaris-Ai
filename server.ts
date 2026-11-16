import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import * as cheerio from 'cheerio';
import QRCode from 'qrcode';
import pino from 'pino';

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const BASE_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : process.cwd();
if (!existsSync(BASE_DATA_DIR)) {
  mkdirSync(BASE_DATA_DIR, { recursive: true });
}
const WORKSPACE_ROOT = path.join(BASE_DATA_DIR, 'workspace-files');
const DATA_FILE = path.join(BASE_DATA_DIR, '.azaris-data.json');
const WA_AUTH_DIR = path.join(BASE_DATA_DIR, '.whatsapp-auth');

// libsignal logs harmless caught-and-retried session mismatch lines directly to console.error
// while Baileys auto-renegotiates a fresh Signal session via retry receipts.
const rawConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (
    first.includes('Failed to decrypt message with any known session') ||
    first.startsWith('Session error:')
  ) {
    return;
  }
  rawConsoleError(...args);
};

app.use(express.json({ limit: '4mb' }));

// Ensure sample workspace files directory exists on first boot
async function ensureWorkspaceSeeded() {
  if (!existsSync(WORKSPACE_ROOT)) {
    mkdirSync(WORKSPACE_ROOT, { recursive: true });
    mkdirSync(path.join(WORKSPACE_ROOT, 'Reports'), { recursive: true });
    mkdirSync(path.join(WORKSPACE_ROOT, 'Contracts'), { recursive: true });
    await fs.writeFile(
      path.join(WORKSPACE_ROOT, 'Executive-Briefing.md'),
      `# Morning Executive Briefing\n\n- Cash Position: $142,850 across operating accounts\n- Pending Receivables: $18,400 (2 invoices awaiting follow-up)\n- Priority Focus: Q4 Vendor Renewal & Product Launch Readiness\n`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(WORKSPACE_ROOT, 'Reports', 'Q4-Cashflow-Summary.txt'),
      `Q4 Operating Ledger Summary\nRevenue MTD: $64,200\nOperating Burn: $21,950\nNet Margin: +$42,250\nTop Overdue Invoice: INV-1042 (Northwind Logistics - $6,800)\n`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(WORKSPACE_ROOT, 'Contracts', 'Acme-MSA-Notes.txt'),
      `Acme Corp Master Services Agreement\nRenewal Date: December 1, 2026\nAnnual Value: $48,000\nPoint of Contact: Sarah Jenkins (sarah@acmecorp.example)\n`,
      'utf-8'
    );
  }
}

interface PersistedStore {
  whatsappThreads: Array<{
    id: string;
    contactName: string;
    phone: string;
    lastTimestamp: string;
    messages: Array<{
      id: string;
      direction: 'inbound' | 'outbound';
      text: string;
      timestamp: string;
      delivery: 'sent' | 'delivered' | 'read' | 'cloud-api' | 'wa-link';
    }>;
  }>;
  calls: Array<{
    id: string;
    contactName: string;
    phone: string;
    direction: 'outbound' | 'inbound';
    status: 'completed' | 'in-progress' | 'scheduled' | 'twilio-dispatched';
    durationSeconds: number;
    scriptOrSummary: string;
    timestamp: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    amount: number;
    status: 'Paid' | 'Pending' | 'Overdue';
    dueDate: string;
    description: string;
    followUpWeeks?: number;
    lastFollowUpAt?: string;
    nextFollowUpAt?: string;
    followUpNotes?: string;
  }>;
  expenses: Array<{
    id: string;
    vendor: string;
    category: string;
    amount: number;
    date: string;
    status: 'Cleared' | 'Pending';
    sourceEmailId?: string;
  }>;
  meetings: Array<{
    id: string;
    title: string;
    contactName: string;
    contactEmail?: string;
    contactPhone?: string;
    invoiceId?: string;
    invoiceNumber?: string;
    scheduledFor: string;
    durationMinutes: number;
    notes: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    calendarUrl?: string;
    googleCalendarEventId?: string;
    createdAt: string;
  }>;
  activityLog: Array<{
    id: string;
    timestamp: string;
    dateKey: string;
    category: 'call' | 'meeting' | 'quickbooks' | 'gmail' | 'whatsapp' | 'browser' | 'system' | 'approval';
    employeeId?: string;
    employeeName: string;
    title: string;
    detail: string;
    status: 'completed' | 'pending_approval' | 'approved' | 'rejected' | 'failed';
    relatedId?: string;
  }>;
}

function getDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DEFAULT_STORE: PersistedStore = {
  whatsappThreads: [
    {
      id: 'wa-1',
      contactName: 'Sarah Jenkins (Acme Corp)',
      phone: '+14155550142',
      lastTimestamp: '09:14 AM',
      messages: [
        {
          id: 'm1',
          direction: 'inbound',
          text: 'Hi! Can you confirm if the revised Q4 onboarding deck is ready before our noon sync?',
          timestamp: '09:14 AM',
          delivery: 'read',
        },
      ],
    },
    {
      id: 'wa-2',
      contactName: 'David Chen (Northwind)',
      phone: '+14155550198',
      lastTimestamp: 'Yesterday',
      messages: [
        {
          id: 'm2',
          direction: 'outbound',
          text: 'Sharing the updated freight schedule and invoice INV-1042 for review.',
          timestamp: 'Yesterday',
          delivery: 'delivered',
        },
      ],
    },
  ],
  calls: [
    {
      id: 'call-1',
      contactName: 'Sarah Jenkins',
      phone: '+14155550142',
      direction: 'outbound',
      status: 'completed',
      durationSeconds: 184,
      scriptOrSummary: 'Confirmed Q4 enterprise onboarding timeline and scheduled kickoff.',
      timestamp: 'Today, 08:45 AM',
    },
    {
      id: 'call-2',
      contactName: 'Marcus Accounting Desk',
      phone: '+14155550111',
      direction: 'inbound',
      status: 'completed',
      durationSeconds: 92,
      scriptOrSummary: 'Verified ACH settlement for INV-1039 ($11,600).',
      timestamp: 'Yesterday, 04:20 PM',
    },
  ],
  invoices: [
    {
      id: 'inv-1',
      invoiceNumber: 'INV-1042',
      customerName: 'Northwind Logistics',
      customerEmail: 'ap@northwind.example',
      customerPhone: '+14155550198',
      amount: 6800,
      status: 'Overdue',
      dueDate: '2026-11-05',
      description: 'Q4 Autonomous Dispatch Automation Retainer',
      followUpWeeks: 2,
      nextFollowUpAt: new Date(Date.now() - 3600_000).toISOString(),
    },
    {
      id: 'inv-2',
      invoiceNumber: 'INV-1043',
      customerName: 'Acme Corp',
      customerEmail: 'billing@acmecorp.example',
      customerPhone: '+14155550142',
      amount: 11600,
      status: 'Pending',
      dueDate: '2026-11-22',
      description: 'Enterprise AI Workforce Deployment Phase 2',
      followUpWeeks: 2,
      nextFollowUpAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
    },
    {
      id: 'inv-3',
      invoiceNumber: 'INV-1039',
      customerName: 'Helios BioLabs',
      customerEmail: 'finance@heliosbio.example',
      customerPhone: '+14155550188',
      amount: 24500,
      status: 'Paid',
      dueDate: '2026-10-30',
      description: 'Annual Operations Copilot License',
      followUpWeeks: 0,
    },
  ],
  expenses: [
    {
      id: 'exp-1',
      vendor: 'Cloud GPU Cluster',
      category: 'Infrastructure',
      amount: 1420,
      date: '2026-11-10',
      status: 'Cleared',
    },
    {
      id: 'exp-2',
      vendor: 'Twilio Telecom',
      category: 'Communications',
      amount: 185,
      date: '2026-11-08',
      status: 'Cleared',
    },
    {
      id: 'exp-3',
      vendor: 'Linear & Figma Seats',
      category: 'Software',
      amount: 490,
      date: '2026-11-04',
      status: 'Pending',
    },
  ],
  meetings: [],
  activityLog: [
    {
      id: 'act-seed-1',
      timestamp: new Date().toISOString(),
      dateKey: getDateKey(),
      category: 'call',
      employeeId: 'emp-aria',
      employeeName: 'Aria Patel',
      title: 'Onboarding Call: Sarah Jenkins (Acme Corp)',
      detail: 'Confirmed Q4 enterprise onboarding timeline and milestone schedule.',
      status: 'completed',
    },
    {
      id: 'act-seed-2',
      timestamp: new Date().toISOString(),
      dateKey: getDateKey(),
      category: 'quickbooks',
      employeeId: 'emp-marcus',
      employeeName: 'Marcus Vance',
      title: 'Reviewed Open Receivables ($18,400)',
      detail: 'Flagged INV-1042 (Northwind Logistics) for 2-week invoice check-up call (awaiting permission).',
      status: 'pending_approval',
    },
  ],
};

function appendActivityToStore(
  store: PersistedStore,
  entry: Omit<PersistedStore['activityLog'][number], 'id' | 'timestamp' | 'dateKey'> & {
    timestamp?: string;
    dateKey?: string;
  }
) {
  const now = entry.timestamp ? new Date(entry.timestamp) : new Date();
  store.activityLog.unshift({
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now.toISOString(),
    dateKey: entry.dateKey || getDateKey(now),
    category: entry.category,
    employeeId: entry.employeeId,
    employeeName: entry.employeeName || 'Azaris Workforce',
    title: entry.title,
    detail: entry.detail,
    status: entry.status,
    relatedId: entry.relatedId,
  });
  if (store.activityLog.length > 350) {
    store.activityLog = store.activityLog.slice(0, 350);
  }
}

function buildDailyOverview(store: PersistedStore, targetDateKey?: string) {
  const dateKey = targetDateKey || getDateKey();
  const entries = (store.activityLog || []).filter((e) => e.dateKey === dateKey);
  const counts = {
    total: entries.length,
    calls: entries.filter((e) => e.category === 'call').length,
    meetings: entries.filter((e) => e.category === 'meeting').length,
    quickbooks: entries.filter((e) => e.category === 'quickbooks').length,
    gmail: entries.filter((e) => e.category === 'gmail').length,
    whatsapp: entries.filter((e) => e.category === 'whatsapp').length,
    browser: entries.filter((e) => e.category === 'browser').length,
    system: entries.filter((e) => e.category === 'system').length,
    approvals: entries.filter((e) => e.category === 'approval').length,
  };

  const parts: string[] = [];
  if (counts.calls > 0) parts.push(`${counts.calls} voice call${counts.calls > 1 ? 's' : ''}`);
  if (counts.meetings > 0) parts.push(`${counts.meetings} meeting${counts.meetings > 1 ? 's' : ''} scheduled`);
  if (counts.quickbooks > 0) parts.push(`${counts.quickbooks} QuickBooks update${counts.quickbooks > 1 ? 's' : ''}`);
  if (counts.gmail > 0) parts.push(`${counts.gmail} Gmail action${counts.gmail > 1 ? 's' : ''}`);
  if (counts.whatsapp > 0) parts.push(`${counts.whatsapp} WhatsApp message${counts.whatsapp > 1 ? 's' : ''}`);
  if (counts.browser > 0) parts.push(`${counts.browser} Chrome/YouTube/Web task${counts.browser > 1 ? 's' : ''}`);
  if (counts.system > 0) parts.push(`${counts.system} laptop/file action${counts.system > 1 ? 's' : ''}`);

  const dueCount = store.invoices.filter(
    (inv) => inv.status !== 'Paid' && (!inv.nextFollowUpAt || new Date(inv.nextFollowUpAt).getTime() <= Date.now())
  ).length;

  const narrative =
    entries.length === 0
      ? `No actions have been logged yet for ${dateKey}. ${dueCount > 0 ? `${dueCount} unpaid invoice check-up call${dueCount > 1 ? 's are' : ' is'} waiting for your approval.` : 'All scheduled invoice check-ups are up to date.'}`
      : `Today (${dateKey}), your Azaris workforce logged ${entries.length} action${entries.length > 1 ? 's' : ''}: ${parts.join(', ')}. ${
          dueCount > 0
            ? `${dueCount} invoice check-up call${dueCount > 1 ? 's remain' : ' remains'} pending your permission.`
            : 'All due invoice check-ups have been handled or scheduled for future weeks.'
        }`;

  return { dateKey, narrative, counts, entries };
}

async function readStore(): Promise<PersistedStore> {
  try {
    if (!existsSync(DATA_FILE)) {
      await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf-8');
      return structuredClone(DEFAULT_STORE);
    }
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedStore>;
    const store: PersistedStore = {
      whatsappThreads: parsed.whatsappThreads || structuredClone(DEFAULT_STORE.whatsappThreads),
      calls: parsed.calls || structuredClone(DEFAULT_STORE.calls),
      invoices: parsed.invoices || structuredClone(DEFAULT_STORE.invoices),
      expenses: parsed.expenses || structuredClone(DEFAULT_STORE.expenses),
      meetings: parsed.meetings || [],
      activityLog: parsed.activityLog || [],
    };
    // Upgrade existing seeded invoices if missing multi-week follow-up fields
    for (const inv of store.invoices) {
      if (inv.id === 'inv-1' && !inv.customerPhone) inv.customerPhone = '+14155550198';
      if (inv.id === 'inv-2' && !inv.customerPhone) inv.customerPhone = '+14155550142';
      if (inv.status !== 'Paid' && typeof inv.followUpWeeks !== 'number') {
        inv.followUpWeeks = 2;
      }
      if (inv.status === 'Overdue' && !inv.nextFollowUpAt) {
        inv.nextFollowUpAt = new Date(Date.now() - 60_000).toISOString();
      }
    }
    return store;
  } catch {
    return structuredClone(DEFAULT_STORE);
  }
}

async function writeStore(store: PersistedStore): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function resolveSafeWorkspacePath(relPath: string): string {
  const cleaned = (relPath || '').replace(/^\/+/, '');
  const resolved = path.resolve(WORKSPACE_ROOT, cleaned);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error('Path traversal outside workspace root is prohibited.');
  }
  return resolved;
}

// Tool declarations shared across Gemini, Ollama, Claude, and OpenAI-compatible models
interface UnifiedToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

const UNIFIED_TOOLS: UnifiedToolDef[] = [
  {
    name: 'read_gmail_inbox',
    description: 'Search or list recent emails from the user connected Gmail inbox.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional Gmail search query like "is:unread" or "from:acme"' },
        maxResults: { type: 'number', description: 'Number of emails to retrieve (default 8)' },
      },
      required: [],
    },
  },
  {
    name: 'propose_send_gmail',
    description: 'Draft and propose sending a Gmail email. Creates a human-in-the-loop Approval Card before sending.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Full plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'propose_send_whatsapp',
    description: 'Draft and propose sending a WhatsApp message to a contact or phone number. Creates an Approval Card.',
    parameters: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: 'Contact display name' },
        phone: { type: 'string', description: 'Phone number with country code, e.g. +14155550142' },
        message: { type: 'string', description: 'WhatsApp message text' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'propose_voice_call',
    description:
      'Ask permission via an Approval Card before placing an outbound or invoice check-up phone call. NEVER place a call without using this Approval Card.',
    parameters: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: 'Contact name' },
        phone: { type: 'string', description: 'Phone number to dial' },
        script: { type: 'string', description: 'What to say or ask on the call after recipient picks up' },
        invoiceId: { type: 'string', description: 'Optional QuickBooks invoice ID for check-up tracking' },
        invoiceNumber: { type: 'string', description: 'Optional invoice number e.g. INV-1042' },
        followUpWeeks: {
          type: 'number',
          description: 'Number of weeks until next recurring check-up call (e.g. 2)',
        },
      },
      required: ['phone', 'script'],
    },
  },
  {
    name: 'get_due_invoice_checkups',
    description:
      'Check QuickBooks unpaid invoices that are due for check-up calls now or scheduled in upcoming weeks.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'propose_schedule_meeting',
    description:
      'Ask permission via an Approval Card before setting a meeting with a customer or contact. NEVER confirm a meeting without queuing this Approval Card first.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Meeting title, e.g. Northwind Invoice INV-1042 Follow-Up' },
        contactName: { type: 'string', description: 'Customer or attendee name' },
        contactEmail: { type: 'string', description: 'Attendee email address' },
        contactPhone: { type: 'string', description: 'Attendee phone number' },
        invoiceId: { type: 'string', description: 'Optional related QuickBooks invoice ID' },
        invoiceNumber: { type: 'string', description: 'Optional invoice number' },
        scheduledFor: { type: 'string', description: 'ISO date-time string YYYY-MM-DDTHH:MM' },
        durationMinutes: { type: 'number', description: 'Duration in minutes (default 30)' },
        notes: { type: 'string', description: 'Agenda or invoice check-up notes' },
      },
      required: ['contactName', 'scheduledFor'],
    },
  },
  {
    name: 'get_daily_activity_overview',
    description:
      'Get the full chronological overview and summary counts of everything Azaris did today (calls, meetings, emails, QuickBooks updates, WhatsApp, browser, and laptop tasks).',
    parameters: {
      type: 'object',
      properties: {
        dateKey: { type: 'string', description: 'Optional YYYY-MM-DD date (defaults to today)' },
      },
      required: [],
    },
  },
  {
    name: 'get_quickbooks_summary',
    description: 'Fetch current QuickBooks invoices, overdue balances, and expenses.',
    parameters: {
      type: 'object',
      properties: {
        filterStatus: { type: 'string', description: 'Filter by Paid, Pending, Overdue, or all' },
      },
      required: [],
    },
  },
  {
    name: 'propose_create_invoice',
    description: 'Propose creating a new invoice in QuickBooks. Creates an Approval Card.',
    parameters: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: 'Customer company or person name' },
        customerEmail: { type: 'string', description: 'Billing email address' },
        amount: { type: 'number', description: 'Invoice dollar amount' },
        description: { type: 'string', description: 'Line item description' },
        dueDate: { type: 'string', description: 'Due date YYYY-MM-DD' },
      },
      required: ['customerName', 'amount', 'description'],
    },
  },
  {
    name: 'browse_webpage',
    description: 'Navigate the autonomous browser agent to a live HTTPS URL and extract its title, headings, text, and links.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL starting with https:// or http://' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_system_files',
    description: 'List files and folders in the workspace or mounted laptop directory.',
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Relative directory path (empty string for root)' },
      },
      required: [],
    },
  },
  {
    name: 'read_system_file',
    description: 'Read the text contents of a system file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path, e.g. Executive-Briefing.md' },
      },
      required: ['path'],
    },
  },
  {
    name: 'propose_write_system_file',
    description: 'Propose creating or updating a system file on the laptop/workspace. Creates an Approval Card.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path, e.g. Reports/Notes.md' },
        content: { type: 'string', description: 'File text content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'propose_delete_system_file',
    description: 'Propose deleting a system file. Creates an Approval Card.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'control_laptop_setting',
    description: 'Control laptop or workstation settings (theme dark/light, volume, brightness, mute voice, wake lock, open view, switch to voice-only mode).',
    parameters: {
      type: 'object',
      properties: {
        setting: {
          type: 'string',
          description: 'Setting key: theme, voice_only_mode, auto_speak, wake_lock, os_volume, os_brightness, os_wifi, open_app, navigate_tab',
        },
        value: {
          type: 'string',
          description: 'Value e.g. dark, light, on, off, 50, Safari, gmail, comms, quickbooks, browser, system, models, command',
        },
      },
      required: ['setting', 'value'],
    },
  },
  {
    name: 'reconcile_gmail_quickbooks',
    description:
      'Scan the user Gmail inbox right now for bill payments, customer invoice settlements, and vendor receipts, and update QuickBooks invoices/expenses accordingly.',
    parameters: {
      type: 'object',
      properties: {
        autoApply: {
          type: 'boolean',
          description: 'Whether to immediately mark matched paid invoices as Paid and log detected bills (default true)',
        },
        maxResults: {
          type: 'number',
          description: 'Max recent Gmail messages to inspect (default 15)',
        },
      },
      required: [],
    },
  },
  {
    name: 'control_app_media',
    description:
      'Control Chrome search, play any YouTube video by search query or URL, or toggle fullscreen mode immediately.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Media/app action: chrome_search, youtube_play, or fullscreen',
          enum: ['chrome_search', 'youtube_play', 'fullscreen'],
        },
        query: {
          type: 'string',
          description: 'Google Chrome search query or URL, or YouTube video name/topic/URL to play',
        },
        fullscreenMode: {
          type: 'string',
          description: 'For fullscreen action: on, off, toggle, or video',
          enum: ['on', 'off', 'toggle', 'video'],
        },
      },
      required: ['action'],
    },
  },
];

async function reconcileEmailsWithQuickBooks(
  gmailToken: string,
  options?: { maxResults?: number; autoApply?: boolean }
) {
  const maxResults = Math.min(Math.max(Number(options?.maxResults || 15), 1), 30);
  const autoApply = options?.autoApply !== false;

  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${gmailToken}` },
  });
  if (!listRes.ok) {
    throw new Error(`Gmail API ${listRes.status}: ${await listRes.text()}`);
  }

  const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const ids = (listData.messages || []).slice(0, maxResults);

  const emails = (
    await Promise.all(
      ids.map(async (m) => {
        const mr = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${gmailToken}` } }
        );
        if (!mr.ok) return null;
        const msg = (await mr.json()) as {
          id: string;
          snippet?: string;
          payload?: { headers?: Array<{ name: string; value: string }> };
        };
        const headers = msg.payload?.headers || [];
        const getH = (k: string) => headers.find((h) => h.name.toLowerCase() === k.toLowerCase())?.value || '';
        return {
          id: msg.id,
          from: getH('From'),
          subject: getH('Subject') || '(No Subject)',
          date: getH('Date'),
          snippet: msg.snippet || '',
        };
      })
    )
  ).filter((e): e is NonNullable<typeof e> => Boolean(e));

  const store = await readStore();
  const paymentKeywords =
    /\b(paid|payment received|payment confirmed|settled|wire transfer|ach deposit|remittance|thank you for your payment|has paid|cleared|receipt for invoice)\b/i;
  const billKeywords =
    /\b(invoice|bill due|statement ready|amount due|total due|receipt|charged|billing statement|payment due)\b/i;

  const matchedPaid: Array<{
    invoiceId: string;
    invoiceNumber: string;
    customerName: string;
    amount: number;
    emailId: string;
    emailSubject: string;
    emailFrom: string;
    markedPaid: boolean;
  }> = [];

  const detectedBills: Array<{
    id: string;
    vendor: string;
    amount: number;
    category: string;
    emailId: string;
    emailSubject: string;
    logged: boolean;
  }> = [];

  let storeModified = false;

  for (const email of emails) {
    const haystack = `${email.from}\n${email.subject}\n${email.snippet}`;
    const haystackLower = haystack.toLowerCase();

    // 1. Match unpaid customer invoices against payment confirmations
    let matchedCustomerInvoice = false;
    if (paymentKeywords.test(haystack)) {
      for (const inv of store.invoices) {
        if (inv.status === 'Paid') continue;
        const invNumMatch = haystackLower.includes(inv.invoiceNumber.toLowerCase());
        const custDomain = inv.customerEmail.includes('@') ? inv.customerEmail.split('@')[1].toLowerCase() : '';
        const custNameMatch =
          inv.customerName.length > 2 && haystackLower.includes(inv.customerName.toLowerCase());
        const custEmailMatch =
          (inv.customerEmail && haystackLower.includes(inv.customerEmail.toLowerCase())) ||
          (custDomain && custDomain !== 'example.com' && haystackLower.includes(custDomain));
        const amtFormatted = inv.amount.toLocaleString('en-US');
        const amtMatch =
          haystack.includes(`$${amtFormatted}`) ||
          haystack.includes(`$${inv.amount}`) ||
          haystackLower.includes(`${inv.amount}.00`);

        if (invNumMatch || (custNameMatch && (amtMatch || paymentKeywords.test(haystack))) || (custEmailMatch && amtMatch)) {
          matchedCustomerInvoice = true;
          if (autoApply) {
            inv.status = 'Paid';
            storeModified = true;
          }
          matchedPaid.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            customerName: inv.customerName,
            amount: inv.amount,
            emailId: email.id,
            emailSubject: email.subject,
            emailFrom: email.from,
            markedPaid: autoApply,
          });
        }
      }
    }

    // 2. Detect vendor bills / receipts to record as QuickBooks expenses
    if (!matchedCustomerInvoice && billKeywords.test(haystack)) {
      const amtMatch = haystack.match(/(?:\$|USD\s*)([\d,]+(?:\.\d{1,2})?)/i);
      const parsedAmount = amtMatch ? Number(amtMatch[1].replace(/,/g, '')) : 0;
      if (parsedAmount > 0 && parsedAmount < 500000) {
        const rawVendor = email.from.replace(/<[^>]+>/g, '').replace(/["']/g, '').trim() || 'Email Vendor';
        const vendor = rawVendor.slice(0, 60);
        const alreadyLogged = store.expenses.some(
          (ex) =>
            ex.sourceEmailId === email.id ||
            (ex.vendor.toLowerCase() === vendor.toLowerCase() && Math.abs(ex.amount - parsedAmount) < 0.01)
        );
        if (!alreadyLogged) {
          const isCleared = /\b(paid|receipt|charged|settled|thank you for your payment)\b/i.test(haystack);
          const category = /aws|cloud|gpu|server|hosting|vercel/i.test(haystack)
            ? 'Infrastructure'
            : /twilio|phone|internet|telecom/i.test(haystack)
            ? 'Communications'
            : /saas|software|figma|linear|adobe|google|openai|anthropic/i.test(haystack)
            ? 'Software'
            : 'Vendor Bill';

          const expId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          if (autoApply) {
            store.expenses.unshift({
              id: expId,
              vendor,
              category,
              amount: parsedAmount,
              date: new Date().toISOString().slice(0, 10),
              status: isCleared ? 'Cleared' : 'Pending',
              sourceEmailId: email.id,
            });
            storeModified = true;
          }
          detectedBills.push({
            id: expId,
            vendor,
            amount: parsedAmount,
            category,
            emailId: email.id,
            emailSubject: email.subject,
            logged: autoApply,
          });
        }
      }
    }
  }

  if (matchedPaid.length > 0 || detectedBills.length > 0) {
    appendActivityToStore(store, {
      category: 'quickbooks',
      employeeId: 'emp-marcus',
      employeeName: 'Marcus Vance',
      title: `Gmail-to-QuickBooks Sync (${matchedPaid.length} paid, ${detectedBills.length} bills)`,
      detail: [
        ...matchedPaid.map((m) => `Marked ${m.invoiceNumber} (${m.customerName}) Paid`),
        ...detectedBills.map((b) => `Logged bill: ${b.vendor} ($${b.amount})`),
      ].join(' · '),
      status: 'completed',
    });
    storeModified = true;
  }

  if (storeModified) {
    await writeStore(store);
  }

  return {
    lastScannedAt: new Date().toISOString(),
    scannedCount: emails.length,
    matchedPaid,
    detectedBills,
    invoices: store.invoices,
    expenses: store.expenses,
  };
}

async function resolveYouTubeVideo(rawQuery: string): Promise<{
  query: string;
  videoId: string;
  title: string;
  watchUrl: string;
  embedUrl: string;
}> {
  const query = (rawQuery || '').trim() || 'lofi hip hop radio';

  // Direct YouTube URL check
  const directMatch = query.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i);
  if (directMatch?.[1]) {
    const videoId = directMatch[1];
    return {
      query,
      videoId,
      title: 'YouTube Video',
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&fs=1&enablejsapi=1`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const ytRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await ytRes.text();
    const rendererMatch = html.match(
      /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"((?:\\.|[^"])*)"/
    );
    const idMatch = rendererMatch || html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!idMatch?.[1]) {
      throw new Error(`Could not find a playable YouTube video for "${query}".`);
    }
    const videoId = idMatch[1];
    let title = query;
    if (rendererMatch?.[2]) {
      try {
        title = JSON.parse(`"${rendererMatch[2]}"`) as string;
      } catch {
        title = rendererMatch[2];
      }
    }
    return {
      query,
      videoId,
      title,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&fs=1&enablejsapi=1`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Real read-only tool executor used inside the server-side agent loop
async function executeReadTool(
  name: string,
  args: Record<string, unknown>,
  gmailToken?: string
): Promise<{ executed: boolean; result: unknown; proposal?: { actionType: string; title: string; summary: string; payload: Record<string, unknown> } }> {
  if (name === 'read_gmail_inbox') {
    if (!gmailToken) {
      return {
        executed: true,
        result: {
          connected: false,
          note: 'Gmail is not signed in yet. Ask the user to click "Sign in with Google" in the sidebar or Gmail tab.',
        },
      };
    }
    try {
      const q = encodeURIComponent(String(args.query || ''));
      const maxResults = Number(args.maxResults || 6);
      const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? `&q=${q}` : ''}`;
      const listRes = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${gmailToken}` },
      });
      if (!listRes.ok) {
        const errText = await listRes.text();
        return { executed: true, result: { error: `Gmail API ${listRes.status}: ${errText}` } };
      }
      const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
      const ids = (listData.messages || []).slice(0, maxResults);
      const summaries = await Promise.all(
        ids.map(async (m) => {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${gmailToken}` } }
          );
          if (!msgRes.ok) return null;
          const msg = (await msgRes.json()) as {
            id: string;
            snippet: string;
            labelIds?: string[];
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
          const headers = msg.payload?.headers || [];
          const getH = (k: string) => headers.find((h) => h.name.toLowerCase() === k.toLowerCase())?.value || '';
          return {
            id: msg.id,
            from: getH('From'),
            subject: getH('Subject'),
            date: getH('Date'),
            snippet: msg.snippet,
            unread: (msg.labelIds || []).includes('UNREAD'),
          };
        })
      );
      return { executed: true, result: { connected: true, emails: summaries.filter(Boolean) } };
    } catch (err) {
      return { executed: true, result: { error: err instanceof Error ? err.message : 'Failed reading Gmail' } };
    }
  }

  if (name === 'get_quickbooks_summary') {
    const store = await readStore();
    const filter = String(args.filterStatus || 'all').toLowerCase();
    const invoices =
      filter === 'all'
        ? store.invoices
        : store.invoices.filter((i) => i.status.toLowerCase() === filter);
    const totalReceivables = store.invoices
      .filter((i) => i.status !== 'Paid')
      .reduce((acc, cur) => acc + cur.amount, 0);
    const totalPaid = store.invoices
      .filter((i) => i.status === 'Paid')
      .reduce((acc, cur) => acc + cur.amount, 0);
    const totalExpenses = store.expenses.reduce((acc, cur) => acc + cur.amount, 0);
    return {
      executed: true,
      result: { totalReceivables, totalPaid, totalExpenses, invoices, expenses: store.expenses },
    };
  }

  if (name === 'browse_webpage') {
    try {
      const snapshot = await fetchAndParseWebpage(String(args.url || ''));
      return { executed: true, result: snapshot };
    } catch (err) {
      return { executed: true, result: { error: err instanceof Error ? err.message : 'Browse failed' } };
    }
  }

  if (name === 'list_system_files') {
    try {
      const dir = resolveSafeWorkspacePath(String(args.directory || ''));
      const items = await fs.readdir(dir, { withFileTypes: true });
      const entries = await Promise.all(
        items.map(async (item) => {
          const full = path.join(dir, item.name);
          const st = await fs.stat(full);
          return {
            name: item.name,
            path: path.relative(WORKSPACE_ROOT, full),
            type: item.isDirectory() ? 'directory' : 'file',
            size: st.size,
            modifiedAt: st.mtime.toISOString(),
          };
        })
      );
      return { executed: true, result: { root: 'workspace-files', entries } };
    } catch (err) {
      return { executed: true, result: { error: err instanceof Error ? err.message : 'Failed listing files' } };
    }
  }

  if (name === 'read_system_file') {
    try {
      const target = resolveSafeWorkspacePath(String(args.path || ''));
      const content = await fs.readFile(target, 'utf-8');
      return { executed: true, result: { path: args.path, content: content.slice(0, 8000) } };
    } catch (err) {
      return { executed: true, result: { error: err instanceof Error ? err.message : 'File not found' } };
    }
  }

  // Mutating / external / system actions -> Generate Azaris Approval Cards!
  if (name === 'propose_send_gmail') {
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'Approval Card queued for user confirmation.' },
      proposal: {
        actionType: 'gmail_send',
        title: `Send Email to ${String(args.to || '')}`,
        summary: `Subject: ${String(args.subject || '')}`,
        payload: args,
      },
    };
  }

  if (name === 'propose_send_whatsapp') {
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'WhatsApp Approval Card queued.' },
      proposal: {
        actionType: 'whatsapp_send',
        title: `Send WhatsApp to ${String(args.contactName || args.phone || '')}`,
        summary: String(args.message || '').slice(0, 140),
        payload: args,
      },
    };
  }

  if (name === 'propose_voice_call') {
    const invTag = args.invoiceNumber ? ` (${String(args.invoiceNumber)} check-up)` : '';
    const weeksNote = args.followUpWeeks ? ` · Next check-up in ${Number(args.followUpWeeks)} week(s)` : '';
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'Permission Approval Card queued before calling.' },
      proposal: {
        actionType: 'voice_call',
        title: `Approve Call: ${String(args.contactName || args.phone || '')}${invTag}`,
        summary: `${String(args.script || '').slice(0, 130)}${weeksNote}`,
        payload: args,
      },
    };
  }

  if (name === 'get_due_invoice_checkups') {
    const store = await readStore();
    const nowMs = Date.now();
    const unpaid = store.invoices.filter((i) => i.status !== 'Paid');
    const dueInvoices = unpaid.filter(
      (i) => !i.nextFollowUpAt || new Date(i.nextFollowUpAt).getTime() <= nowMs
    );
    const upcomingInvoices = unpaid.filter(
      (i) => i.nextFollowUpAt && new Date(i.nextFollowUpAt).getTime() > nowMs
    );
    return {
      executed: true,
      result: {
        dueCount: dueInvoices.length,
        dueInvoices,
        upcomingInvoices,
      },
    };
  }

  if (name === 'propose_schedule_meeting') {
    const when = String(args.scheduledFor || new Date(Date.now() + 86400_000).toISOString().slice(0, 16));
    const contact = String(args.contactName || 'Customer');
    const invTag = args.invoiceNumber ? ` (${String(args.invoiceNumber)})` : '';
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'Meeting Approval Card queued for your permission.' },
      proposal: {
        actionType: 'schedule_meeting',
        title: `Approve Meeting: ${String(args.title || `${contact} Invoice Check-Up`)}${invTag}`,
        summary: `With ${contact} at ${when.replace('T', ' ')} · ${Number(args.durationMinutes || 30)} min`,
        payload: {
          title: args.title || `${contact} Check-Up Meeting${invTag}`,
          contactName: contact,
          contactEmail: args.contactEmail || '',
          contactPhone: args.contactPhone || '',
          invoiceId: args.invoiceId || '',
          invoiceNumber: args.invoiceNumber || '',
          scheduledFor: when,
          durationMinutes: Number(args.durationMinutes || 30),
          notes: args.notes || 'Invoice payment status & update review.',
        },
      },
    };
  }

  if (name === 'get_daily_activity_overview') {
    const store = await readStore();
    const overview = buildDailyOverview(store, args.dateKey ? String(args.dateKey) : undefined);
    return {
      executed: true,
      result: overview,
    };
  }

  if (name === 'propose_create_invoice') {
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'QuickBooks Invoice Approval Card queued.' },
      proposal: {
        actionType: 'quickbooks_create_invoice',
        title: `Create QuickBooks Invoice ($${Number(args.amount || 0).toLocaleString()})`,
        summary: `${String(args.customerName || '')} — ${String(args.description || '')}`,
        payload: args,
      },
    };
  }

  if (name === 'propose_write_system_file') {
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'File Write Approval Card queued.' },
      proposal: {
        actionType: 'file_write',
        title: `Write File: ${String(args.path || '')}`,
        summary: `Save ${String(args.content || '').length} bytes to ${String(args.path || '')}`,
        payload: args,
      },
    };
  }

  if (name === 'propose_delete_system_file') {
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'File Delete Approval Card queued.' },
      proposal: {
        actionType: 'file_delete',
        title: `Delete File: ${String(args.path || '')}`,
        summary: `Permanently remove ${String(args.path || '')}`,
        payload: args,
      },
    };
  }

  if (name === 'control_laptop_setting') {
    const setting = String(args.setting || '');
    const value = String(args.value || '');
    // Safe UI switches can execute immediately as ui_mode; OS-level changes queue an approval or execute on bridge
    if (setting === 'theme' || setting === 'voice_only_mode' || setting === 'auto_speak' || setting === 'navigate_tab') {
      return {
        executed: true,
        result: { applied: true, setting, value },
        proposal: {
          actionType: 'ui_mode',
          title: `Update ${setting} to ${value}`,
          summary: `Immediate UI state update`,
          payload: { setting, value, autoExecute: true },
        },
      };
    }
    return {
      executed: false,
      result: { status: 'approval_card_created', message: 'Laptop setting Approval Card queued.' },
      proposal: {
        actionType: 'laptop_setting',
        title: `Change Laptop Setting: ${setting}`,
        summary: `Set ${setting} → ${value}`,
        payload: args,
      },
    };
  }

  if (name === 'reconcile_gmail_quickbooks') {
    if (!gmailToken) {
      return {
        executed: true,
        result: {
          connected: false,
          note: 'Gmail is not connected yet. Sign in with Google in Gmail Inbox first so Azaris can scan emails for paid bills.',
        },
      };
    }
    try {
      const summary = await reconcileEmailsWithQuickBooks(gmailToken, {
        maxResults: Number(args.maxResults || 15),
        autoApply: args.autoApply !== false,
      });
      return { executed: true, result: { connected: true, ...summary } };
    } catch (err) {
      return {
        executed: true,
        result: { error: err instanceof Error ? err.message : 'Email reconciliation failed' },
      };
    }
  }

  if (name === 'control_app_media') {
    const action = String(args.action || 'chrome_search');
    const query = String(args.query || '').trim();
    const fullscreenMode = String(args.fullscreenMode || 'on').toLowerCase();

    if (action === 'youtube_play') {
      try {
        const video = await resolveYouTubeVideo(query);
        return {
          executed: true,
          result: { ok: true, action: 'youtube_play', ...video },
          proposal: {
            actionType: 'app_media',
            title: `Play YouTube: ${video.title}`,
            summary: video.watchUrl,
            payload: { action: 'youtube_play', ...video, autoExecute: true },
          },
        };
      } catch (err) {
        const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        return {
          executed: true,
          result: { ok: false, error: err instanceof Error ? err.message : 'YouTube lookup failed', url: fallbackUrl },
          proposal: {
            actionType: 'app_media',
            title: `Search YouTube: ${query}`,
            summary: fallbackUrl,
            payload: { action: 'chrome_search', query, url: fallbackUrl, autoExecute: true },
          },
        };
      }
    }

    if (action === 'fullscreen') {
      return {
        executed: true,
        result: { ok: true, action: 'fullscreen', fullscreenMode },
        proposal: {
          actionType: 'app_media',
          title: fullscreenMode === 'off' ? 'Exit Full Screen' : 'Enter Full Screen',
          summary: `Fullscreen mode: ${fullscreenMode}`,
          payload: { action: 'fullscreen', fullscreenMode, autoExecute: true },
        },
      };
    }

    // chrome_search
    const isDirectUrl = /^https?:\/\//i.test(query) || /^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(query);
    const targetUrl = isDirectUrl
      ? /^https?:\/\//i.test(query)
        ? query
        : `https://${query}`
      : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    return {
      executed: true,
      result: { ok: true, action: 'chrome_search', query, url: targetUrl },
      proposal: {
        actionType: 'app_media',
        title: `Search Chrome: ${query}`,
        summary: targetUrl,
        payload: { action: 'chrome_search', query, url: targetUrl, autoExecute: true },
      },
    };
  }

  return { executed: true, result: { error: `Unknown tool: ${name}` } };
}

async function fetchAndParseWebpage(rawUrl: string) {
  let targetUrl = rawUrl.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.')
  ) {
    throw new Error('Private network addresses are restricted for the cloud browser agent.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AzarisBrowserAgent/1.0 (+https://azaris.ai)',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain',
      },
    });
    const html = await res.text();
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json') || contentType.includes('text/plain')) {
      return {
        url: res.url || parsed.toString(),
        title: parsed.hostname,
        description: contentType,
        headings: [],
        textContent: html.slice(0, 10000),
        links: [],
        formsCount: 0,
        fetchedAt: new Date().toISOString(),
      };
    }

    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe').remove();

    const title = $('title').first().text().trim() || parsed.hostname;
    const description = $('meta[name="description"]').attr('content')?.trim() || '';
    const headings = $('h1, h2, h3')
      .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean)
      .slice(0, 20);

    const links = $('a[href]')
      .map((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        const href = $(el).attr('href') || '';
        if (!text || !href || href.startsWith('#') || href.startsWith('javascript:')) return null;
        try {
          return { text: text.slice(0, 90), href: new URL(href, parsed.toString()).toString() };
        } catch {
          return null;
        }
      })
      .get()
      .filter((item): item is { text: string; href: string } => Boolean(item))
      .slice(0, 30);

    const formsCount = $('form').length;
    const textContent = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 10000);

    return {
      url: res.url || parsed.toString(),
      title,
      description,
      headings,
      textContent,
      links,
      formsCount,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function toGeminiType(t: string): Type {
  if (t === 'number') return Type.NUMBER;
  if (t === 'boolean') return Type.BOOLEAN;
  if (t === 'array') return Type.ARRAY;
  return Type.STRING;
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    runtime: 'node',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// Unified Multi-Provider LLM Chat Endpoint (Gemini, Ollama, Anthropic Claude, OpenAI / Custom API Key)
app.post('/api/llm/chat', async (req: Request, res: Response) => {
  const {
    provider = 'gemini',
    model,
    apiKey,
    baseUrl,
    messages = [],
    systemInstruction = '',
  } = req.body as {
    provider: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    systemInstruction?: string;
  };

  const gmailHeader = req.headers['x-gmail-token'];
  const gmailToken = typeof gmailHeader === 'string' && gmailHeader.trim() ? gmailHeader.trim() : undefined;

  const toolTrace: Array<{
    name: string;
    args: Record<string, unknown>;
    status: 'executed' | 'needs_approval' | 'failed';
    detail?: string;
  }> = [];
  const proposals: Array<{
    actionType: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }> = [];
  let browserSnapshot: unknown = null;

  try {
    // 1. GEMINI (Server-Side @google/genai SDK)
    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: 'Server Gemini API key is not configured. Set GEMINI_API_KEY in your server environment variables.',
        });
      }
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const selectedModel = model || 'gemini-4-hydrogen';
      const functionDeclarations: FunctionDeclaration[] = UNIFIED_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: Type.OBJECT,
          properties: Object.fromEntries(
            Object.entries(tool.parameters.properties).map(([k, v]) => [
              k,
              { type: toGeminiType(v.type), description: v.description },
            ])
          ),
          required: tool.parameters.required,
        },
      }));

      const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      let finalText = '';
      for (let step = 0; step < 3; step++) {
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: contents as never,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations }],
          },
        });

        const calls = response.functionCalls;
        if (calls && calls.length > 0) {
          const modelContent = response.candidates?.[0]?.content;
          if (modelContent) {
            contents.push(modelContent as never);
          }
          const responseParts: Array<Record<string, unknown>> = [];
          for (const fc of calls) {
            const fcName = fc.name || '';
            const fcArgs = (fc.args || {}) as Record<string, unknown>;
            const outcome = await executeReadTool(fcName, fcArgs, gmailToken);
            if (fcName === 'browse_webpage' && outcome.result && !(outcome.result as { error?: string }).error) {
              browserSnapshot = outcome.result;
            }
            if (outcome.proposal) {
              proposals.push(outcome.proposal);
            }
            toolTrace.push({
              name: fcName,
              args: fcArgs,
              status: outcome.proposal && !outcome.executed ? 'needs_approval' : 'executed',
              detail: outcome.proposal ? outcome.proposal.title : 'Completed',
            });
            responseParts.push({
              functionResponse: {
                id: fc.id,
                name: fcName,
                response: { output: outcome.result },
              },
            });
          }
          contents.push({ role: 'user', parts: responseParts });
          continue;
        }

        finalText = response.text || '';
        break;
      }

      return res.json({
        text: finalText || 'Action prepared for your review.',
        providerUsed: `Gemini (${selectedModel})`,
        toolTrace,
        proposals,
        browserSnapshot,
      });
    }

    // 2. OLLAMA LOCAL LLM
    if (provider === 'ollama') {
      const endpoint = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
      const selectedModel = model || 'llama3.2';
      const ollamaTools = UNIFIED_TOOLS.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));

      const chatMessages: Array<Record<string, unknown>> = [
        { role: 'system', content: systemInstruction },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      let finalText = '';
      for (let step = 0; step < 3; step++) {
        const ollamaRes = await fetch(`${endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            messages: chatMessages,
            tools: ollamaTools,
            stream: false,
          }),
        });
        if (!ollamaRes.ok) {
          const errMsg = await ollamaRes.text();
          return res.status(502).json({ error: `Ollama error (${ollamaRes.status}): ${errMsg}` });
        }
        const data = (await ollamaRes.json()) as {
          message?: {
            role: string;
            content: string;
            tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
          };
        };
        const msg = data.message;
        if (msg?.tool_calls && msg.tool_calls.length > 0) {
          chatMessages.push(msg as unknown as Record<string, unknown>);
          for (const tc of msg.tool_calls) {
            const fcName = tc.function.name;
            const fcArgs = tc.function.arguments || {};
            const outcome = await executeReadTool(fcName, fcArgs, gmailToken);
            if (fcName === 'browse_webpage' && outcome.result && !(outcome.result as { error?: string }).error) {
              browserSnapshot = outcome.result;
            }
            if (outcome.proposal) proposals.push(outcome.proposal);
            toolTrace.push({
              name: fcName,
              args: fcArgs,
              status: outcome.proposal && !outcome.executed ? 'needs_approval' : 'executed',
              detail: outcome.proposal ? outcome.proposal.title : 'Completed',
            });
            chatMessages.push({
              role: 'tool',
              content: JSON.stringify(outcome.result),
            });
          }
          continue;
        }
        finalText = msg?.content || '';
        break;
      }

      return res.json({
        text: finalText || 'Action prepared for your review.',
        providerUsed: `Ollama (${selectedModel})`,
        toolTrace,
        proposals,
        browserSnapshot,
      });
    }

    // 3. ANTHROPIC CLAUDE
    if (provider === 'anthropic') {
      if (!apiKey) {
        return res.status(400).json({ error: 'Anthropic API key is required for Claude.' });
      }
      const selectedModel = model || 'claude-sonnet-4-20250514';
      const claudeTools = UNIFIED_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      const claudeMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));

      let finalText = '';
      for (let step = 0; step < 3; step++) {
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: selectedModel,
            max_tokens: 2048,
            system: systemInstruction,
            tools: claudeTools,
            messages: claudeMessages,
          }),
        });
        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          return res.status(claudeRes.status).json({ error: `Claude API error: ${errText}` });
        }
        const data = (await claudeRes.json()) as {
          content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        };
        const toolUses = data.content.filter((b) => b.type === 'tool_use');
        if (toolUses.length > 0) {
          claudeMessages.push({ role: 'assistant', content: data.content });
          const toolResults: Array<Record<string, unknown>> = [];
          for (const tu of toolUses) {
            const fcName = tu.name || '';
            const fcArgs = tu.input || {};
            const outcome = await executeReadTool(fcName, fcArgs, gmailToken);
            if (fcName === 'browse_webpage' && outcome.result && !(outcome.result as { error?: string }).error) {
              browserSnapshot = outcome.result;
            }
            if (outcome.proposal) proposals.push(outcome.proposal);
            toolTrace.push({
              name: fcName,
              args: fcArgs,
              status: outcome.proposal && !outcome.executed ? 'needs_approval' : 'executed',
              detail: outcome.proposal ? outcome.proposal.title : 'Completed',
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(outcome.result),
            });
          }
          claudeMessages.push({ role: 'user', content: toolResults });
          continue;
        }
        finalText = data.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text || '')
          .join('\n');
        break;
      }

      return res.json({
        text: finalText || 'Action prepared for your review.',
        providerUsed: `Claude (${selectedModel})`,
        toolTrace,
        proposals,
        browserSnapshot,
      });
    }

    // 4. OPENAI / OPENROUTER / ANY CUSTOM OPENAI-COMPATIBLE API KEY
    const endpoint = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey && endpoint.includes('openai.com')) {
      return res.status(400).json({ error: 'API key is required for this provider.' });
    }
    const selectedModel = model || 'gpt-4o-mini';
    const openAiTools = UNIFIED_TOOLS.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    const oaiMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemInstruction },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    let finalText = '';
    for (let step = 0; step < 3; step++) {
      const oaiRes = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: oaiMessages,
          tools: openAiTools,
        }),
      });
      if (!oaiRes.ok) {
        const errText = await oaiRes.text();
        return res.status(oaiRes.status).json({ error: `Provider API error: ${errText}` });
      }
      const data = (await oaiRes.json()) as {
        choices?: Array<{
          message?: {
            role: string;
            content: string | null;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
        }>;
      };
      const choiceMsg = data.choices?.[0]?.message;
      if (choiceMsg?.tool_calls && choiceMsg.tool_calls.length > 0) {
        oaiMessages.push(choiceMsg as unknown as Record<string, unknown>);
        for (const tc of choiceMsg.tool_calls) {
          const fcName = tc.function.name;
          let fcArgs: Record<string, unknown> = {};
          try {
            fcArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            fcArgs = {};
          }
          const outcome = await executeReadTool(fcName, fcArgs, gmailToken);
          if (fcName === 'browse_webpage' && outcome.result && !(outcome.result as { error?: string }).error) {
            browserSnapshot = outcome.result;
          }
          if (outcome.proposal) proposals.push(outcome.proposal);
          toolTrace.push({
            name: fcName,
            args: fcArgs,
            status: outcome.proposal && !outcome.executed ? 'needs_approval' : 'executed',
            detail: outcome.proposal ? outcome.proposal.title : 'Completed',
          });
          oaiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(outcome.result),
          });
        }
        continue;
      }
      finalText = choiceMsg?.content || '';
      break;
    }

    return res.json({
      text: finalText || 'Action prepared for your review.',
      providerUsed: `${provider} (${selectedModel})`,
      toolTrace,
      proposals,
      browserSnapshot,
    });
  } catch (err) {
    console.error('LLM chat error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unexpected server error while calling LLM provider.',
    });
  }
});

// Ollama local model discovery proxy
app.get('/api/llm/ollama/models', async (req: Request, res: Response) => {
  const baseUrl = String(req.query.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const r = await fetch(`${baseUrl}/api/tags`);
    if (!r.ok) {
      return res.status(502).json({ error: `Ollama returned ${r.status}` });
    }
    const data = (await r.json()) as { models?: Array<{ name: string; size: number }> };
    return res.json({ models: data.models || [] });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Cannot reach Ollama endpoint from server.',
    });
  }
});

// GMAIL REAL PROXY ROUTES (Bearer token supplied by Firebase Google Sign-In client)
app.get('/api/gmail/messages', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing Gmail Bearer token' });
  const q = encodeURIComponent(String(req.query.q || ''));
  const maxResults = Number(req.query.maxResults || 15);
  try {
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? `&q=${q}` : ''}`;
    const listRes = await fetch(listUrl, { headers: { Authorization: auth } });
    if (!listRes.ok) {
      return res.status(listRes.status).json({ error: await listRes.text() });
    }
    const listData = (await listRes.json()) as { messages?: Array<{ id: string; threadId: string }> };
    const msgs = listData.messages || [];
    const detailed = await Promise.all(
      msgs.map(async (m) => {
        const mr = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: auth } }
        );
        if (!mr.ok) return null;
        const d = (await mr.json()) as {
          id: string;
          threadId: string;
          snippet: string;
          labelIds?: string[];
          payload?: { headers?: Array<{ name: string; value: string }> };
        };
        const headers = d.payload?.headers || [];
        const getH = (k: string) => headers.find((h) => h.name.toLowerCase() === k.toLowerCase())?.value || '';
        return {
          id: d.id,
          threadId: d.threadId,
          from: getH('From'),
          to: getH('To'),
          subject: getH('Subject') || '(No Subject)',
          date: getH('Date'),
          snippet: d.snippet,
          unread: (d.labelIds || []).includes('UNREAD'),
          labelIds: d.labelIds || [],
        };
      })
    );
    return res.json({ messages: detailed.filter(Boolean) });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Gmail list failed' });
  }
});

app.get('/api/gmail/messages/:id', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing Gmail Bearer token' });
  try {
    const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`, {
      headers: { Authorization: auth },
    });
    if (!mr.ok) return res.status(mr.status).json({ error: await mr.text() });
    const d = (await mr.json()) as {
      id: string;
      snippet: string;
      payload?: {
        body?: { data?: string };
        parts?: Array<{ mimeType: string; body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string } }> }>;
      };
    };

    const decodeB64 = (b64?: string) => {
      if (!b64) return '';
      const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(norm, 'base64').toString('utf-8');
    };

    let bodyText = decodeB64(d.payload?.body?.data);
    if (!bodyText && d.payload?.parts) {
      const plainPart = d.payload.parts.find((p) => p.mimeType === 'text/plain');
      const htmlPart = d.payload.parts.find((p) => p.mimeType === 'text/html');
      if (plainPart?.body?.data) {
        bodyText = decodeB64(plainPart.body.data);
      } else if (htmlPart?.body?.data) {
        const $ = cheerio.load(decodeB64(htmlPart.body.data));
        bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      }
    }
    return res.json({ id: d.id, body: bodyText || d.snippet });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed reading email' });
  }
});

app.post('/api/gmail/send', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing Gmail Bearer token' });
  const { to, subject, body } = req.body as { to: string; subject: string; body: string };
  if (!to || !subject) return res.status(400).json({ error: 'Recipient and subject are required.' });
  try {
    const rawMime = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      body || '',
    ].join('\r\n');
    const encoded = Buffer.from(rawMime, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded }),
    });
    if (!sendRes.ok) return res.status(sendRes.status).json({ error: await sendRes.text() });
    const sent = await sendRes.json();
    const store = await readStore();
    appendActivityToStore(store, {
      category: 'gmail',
      employeeId: 'emp-maya',
      employeeName: 'Maya Lin',
      title: `Sent Email to ${to}`,
      detail: `Subject: ${subject}`,
      status: 'completed',
    });
    await writeStore(store);
    return res.json({ ok: true, sent });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed sending email' });
  }
});

app.post('/api/gmail/messages/:id/modify', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing Gmail Bearer token' });
  const { removeLabelIds = [], addLabelIds = [] } = req.body as {
    removeLabelIds?: string[];
    addLabelIds?: string[];
  };
  try {
    const modRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/modify`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds, addLabelIds }),
    });
    if (!modRes.ok) return res.status(modRes.status).json({ error: await modRes.text() });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Modify failed' });
  }
});

// WHATSAPP ROUTES (Baileys Real WhatsApp Web QR + Pairing Code + Meta Cloud API + wa.me Fallback)
function validateWhatsAppPhoneServer(
  rawPhone: string
): { valid: true; digits: string; e164: string } | { valid: false; error: string } {
  const trimmed = (rawPhone || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Phone number is required (include country code, e.g. +14155550142).' };
  }
  if (/[a-zA-Z]/.test(trimmed)) {
    return {
      valid: false,
      error: 'Phone number cannot contain letters. Use digits and country code (e.g. +14155550142).',
    };
  }
  const compact = trimmed.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact)) {
    return {
      valid: false,
      error: 'Invalid phone number characters. Only digits and an optional leading "+" are allowed.',
    };
  }
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (digits.startsWith('0')) {
    return {
      valid: false,
      error: 'Omit leading zeros and include your country code (e.g. +14155550142 or +447700900123).',
    };
  }
  if (digits.length < 8 || digits.length > 15) {
    return {
      valid: false,
      error: 'Phone number must be 8 to 15 digits including country code (e.g. +14155550142).',
    };
  }
  return { valid: true, digits, e164: `+${digits}` };
}

interface WaQrState {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'error';
  qrDataUrl: string | null;
  pairingCode: string | null;
  phoneNumber: string | null;
  name: string | null;
  error: string | null;
}

const waState: WaQrState = {
  status: 'disconnected',
  qrDataUrl: null,
  pairingCode: null,
  phoneNumber: null,
  name: null,
  error: null,
};

let waSocket: {
  sendMessage: (
    jid: string,
    content: { text: string }
  ) => Promise<{ key?: { id?: string }; message?: Record<string, unknown> } | undefined>;
  requestPairingCode?: (phoneNumber: string) => Promise<string>;
  authState?: { creds?: { registered?: boolean } };
  logout: () => Promise<void>;
  end: (err?: Error) => void;
} | null = null;

let waSessionNonce = 0;
let credsWriteChain: Promise<void> = Promise.resolve();
let waSocketReady = false;
const waSentMessageCache = new Map<string, Record<string, unknown>>();

function cacheSentWaMessage(id?: string, message?: Record<string, unknown>) {
  if (!id || !message) return;
  waSentMessageCache.set(id, message);
  if (waSentMessageCache.size > 500) {
    const oldestKey = waSentMessageCache.keys().next().value;
    if (oldestKey) waSentMessageCache.delete(oldestKey);
  }
}

async function isWaCredsRegistered(): Promise<boolean> {
  try {
    const credsPath = path.join(WA_AUTH_DIR, 'creds.json');
    if (!existsSync(credsPath)) return false;
    const raw = await fs.readFile(credsPath, 'utf-8');
    const parsed = JSON.parse(raw) as { registered?: boolean };
    return Boolean(parsed.registered);
  } catch {
    return false;
  }
}

async function startWhatsAppQrSession(options?: { cleanUnregistered?: boolean; retryAttempt?: number }) {
  const sessionNonce = ++waSessionNonce;
  const cleanUnregistered = options?.cleanUnregistered ?? false;
  const retryAttempt = options?.retryAttempt ?? 0;

  if (waSocket) {
    try {
      waSocket.end();
    } catch {
      // Ignore socket shutdown error
    }
    waSocket = null;
  }
  waSocketReady = false;

  waState.status = 'connecting';
  waState.error = null;
  if (retryAttempt === 0) {
    waState.qrDataUrl = null;
    waState.pairingCode = null;
  }

  try {
    await credsWriteChain.catch(() => {});

    if (cleanUnregistered && !(await isWaCredsRegistered())) {
      await fs.rm(WA_AUTH_DIR, { recursive: true, force: true }).catch(() => {});
    }

    const baileysMod = await import('@whiskeysockets/baileys');
    const makeWASocket =
      (baileysMod as unknown as { default?: unknown; makeWASocket?: unknown }).makeWASocket ||
      (baileysMod as unknown as { default?: { default?: unknown; makeWASocket?: unknown } }).default?.makeWASocket ||
      (baileysMod as unknown as { default?: unknown }).default;
    const {
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers,
      makeCacheableSignalKeyStore,
      isJidBroadcast,
    } = baileysMod;

    if (!existsSync(WA_AUTH_DIR)) {
      mkdirSync(WA_AUTH_DIR, { recursive: true });
    }
    const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
    const waLogger = pino({ level: 'silent' });
    const cachedAuth = {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore ? makeCacheableSignalKeyStore(state.keys, waLogger) : state.keys,
    };

    let version: [number, number, number] = [2, 3000, 1023223821];
    try {
      const versionRes = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (versionRes && Array.isArray(versionRes.version)) {
        version = versionRes.version as [number, number, number];
      }
    } catch {
      // Keep safe fallback WA Web version
    }

    if (sessionNonce !== waSessionNonce) return;

    const browserTuple = Browsers?.macOS ? Browsers.macOS('Chrome') : ['Mac OS', 'Chrome', '126.0.6478.126'];
    const sock = (makeWASocket as (cfg: Record<string, unknown>) => Record<string, unknown>)({
      version,
      auth: cachedAuth,
      logger: waLogger,
      printQRInTerminal: false,
      browser: browserTuple,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30000,
      retryRequestDelayMs: 500,
      maxMsgRetryCount: 3,
      shouldIgnoreJid: (jid: string) =>
        Boolean(isJidBroadcast?.(jid) || jid === 'status@broadcast' || jid.endsWith('@newsletter')),
      getMessage: async (key: { id?: string }) => (key?.id ? waSentMessageCache.get(key.id) : undefined),
    });

    waSocket = sock as unknown as typeof waSocket;

    const ev = sock.ev as {
      on: (event: string, handler: (arg: unknown) => void) => void;
    };

    let sawQrOrOpen = false;

    ev.on('creds.update', () => {
      if (sessionNonce !== waSessionNonce) return;
      credsWriteChain = credsWriteChain
        .then(() => saveCreds())
        .catch(() => {});
    });

    ev.on('connection.update', async (updateRaw: unknown) => {
      if (sessionNonce !== waSessionNonce) return;

      const update = updateRaw as {
        connection?: string;
        lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } };
        qr?: string;
      };

      if (update.qr) {
        sawQrOrOpen = true;
        waSocketReady = true;
        waState.status = 'qr_ready';
        waState.error = null;
        waState.qrDataUrl = await QRCode.toDataURL(update.qr, { width: 280, margin: 2 });
      }

      if (update.connection === 'open') {
        sawQrOrOpen = true;
        waSocketReady = true;
        const user = (sock as { user?: { id?: string; name?: string } }).user;
        waState.status = 'connected';
        waState.qrDataUrl = null;
        waState.pairingCode = null;
        waState.phoneNumber = user?.id ? `+${user.id.split(':')[0].split('@')[0]}` : 'Linked';
        waState.name = user?.name || 'WhatsApp Linked';
        waState.error = null;
      }

      if (update.connection === 'close') {
        waSocketReady = false;
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const errMessage = update.lastDisconnect?.error?.message || 'WhatsApp connection closed.';
        const wasConnected = waState.status === 'connected';

        // Ensure credentials written during QR scan are flushed before reading them on restart
        await credsWriteChain.catch(() => {});
        if (sessionNonce !== waSessionNonce) return;

        // 515 (restartRequired) is normal immediately after scanning a QR code in WhatsApp Multi-Device
        if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          waState.status = 'connecting';
          waState.qrDataUrl = null;
          waState.error = null;
          setTimeout(() => {
            if (sessionNonce === waSessionNonce) {
              startWhatsAppQrSession({ cleanUnregistered: false, retryAttempt: 0 }).catch(() => {});
            }
          }, 300);
          return;
        }

        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
        const authRejected = isLoggedOut || statusCode === 405 || statusCode === DisconnectReason.badSession;

        if (authRejected) {
          waSocket = null;
          await fs.rm(WA_AUTH_DIR, { recursive: true, force: true }).catch(() => {});
          if (!sawQrOrOpen && retryAttempt < 1) {
            setTimeout(() => {
              if (sessionNonce === waSessionNonce) {
                startWhatsAppQrSession({ cleanUnregistered: true, retryAttempt: retryAttempt + 1 }).catch(() => {});
              }
            }, 500);
            return;
          }
          waState.status = 'disconnected';
          waState.qrDataUrl = null;
          waState.pairingCode = null;
          waState.phoneNumber = null;
          waState.name = null;
          waState.error = isLoggedOut
            ? 'WhatsApp session logged out. Click "Link WhatsApp via QR" to pair again.'
            : `WhatsApp pairing rejected (${statusCode || 'session'}). Click "Reset Auth & New QR" to retry.`;
          return;
        }

        const transientReconnect =
          wasConnected ||
          statusCode === DisconnectReason.connectionClosed ||
          statusCode === DisconnectReason.unavailableService;

        if (transientReconnect && retryAttempt < 3) {
          waState.status = 'connecting';
          setTimeout(() => {
            if (sessionNonce === waSessionNonce) {
              startWhatsAppQrSession({ cleanUnregistered: false, retryAttempt: retryAttempt + 1 }).catch(() => {});
            }
          }, 1000);
          return;
        }

        waSocket = null;
        waState.status = 'error';
        waState.qrDataUrl = null;
        waState.error = errMessage.includes('QR refs attempts ended')
          ? 'QR code expired before scanning. Click "Refresh QR" to generate a new code.'
          : errMessage;
      }
    });

    ev.on('messages.upsert', async (upsertRaw: unknown) => {
      if (sessionNonce !== waSessionNonce) return;
      const upsert = upsertRaw as {
        messages?: Array<{
          key?: { fromMe?: boolean; remoteJid?: string; id?: string };
          pushName?: string;
          message?: { conversation?: string; extendedTextMessage?: { text?: string } };
        }>;
      };
      for (const m of upsert.messages || []) {
        if (!m.message || m.key?.fromMe) continue;
        const jid = m.key?.remoteJid || '';
        if (!jid.endsWith('@s.whatsapp.net')) continue;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        if (!text) continue;
        const phone = `+${jid.split('@')[0]}`;
        const store = await readStore();
        const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let thread = store.whatsappThreads.find((t) => t.phone.replace(/[^\d]/g, '') === phone.replace(/[^\d]/g, ''));
        if (!thread) {
          thread = {
            id: `wa-${Date.now()}`,
            contactName: m.pushName || phone,
            phone,
            lastTimestamp: nowLabel,
            messages: [],
          };
          store.whatsappThreads.unshift(thread);
        }
        thread.lastTimestamp = nowLabel;
        thread.messages.push({
          id: m.key?.id || `in-${Date.now()}`,
          direction: 'inbound',
          text,
          timestamp: nowLabel,
          delivery: 'delivered',
        });
        await writeStore(store);
      }
    });
  } catch (err) {
    if (sessionNonce === waSessionNonce) {
      waState.status = 'error';
      waState.error = err instanceof Error ? err.message : 'Failed initializing WhatsApp Web socket.';
    }
  }
}

app.get('/api/whatsapp/qr/status', (_req: Request, res: Response) => {
  return res.json(waState);
});

app.post('/api/whatsapp/qr/start', async (_req: Request, res: Response) => {
  await startWhatsAppQrSession({ cleanUnregistered: true, retryAttempt: 0 });
  return res.json(waState);
});

app.post('/api/whatsapp/qr/reset', async (_req: Request, res: Response) => {
  ++waSessionNonce;
  if (waSocket) {
    try {
      waSocket.end();
    } catch {
      // Ignore
    }
    waSocket = null;
  }
  await fs.rm(WA_AUTH_DIR, { recursive: true, force: true }).catch(() => {});
  waState.phoneNumber = null;
  waState.name = null;
  waState.pairingCode = null;
  waState.qrDataUrl = null;
  waState.error = null;
  await startWhatsAppQrSession({ cleanUnregistered: true, retryAttempt: 0 });
  return res.json(waState);
});

app.post('/api/whatsapp/pairing-code', async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  const phoneCheck = validateWhatsAppPhoneServer(phone || '');
  if (!phoneCheck.valid) {
    return res.status(400).json({ error: phoneCheck.error });
  }

  try {
    if (!waSocket || waState.status === 'disconnected' || waState.status === 'error') {
      await startWhatsAppQrSession({ cleanUnregistered: true, retryAttempt: 0 });
    }

    // Wait briefly until the socket completes Noise handshake / emits first QR
    const deadline = Date.now() + 8000;
    while (!waSocketReady && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!waSocket || typeof waSocket.requestPairingCode !== 'function') {
      return res.status(503).json({ error: 'WhatsApp socket is not ready for pairing code generation.' });
    }
    if (waSocket.authState?.creds?.registered) {
      return res.status(400).json({ error: 'WhatsApp is already registered. Disconnect first to pair a new device.' });
    }

    const rawCode = await waSocket.requestPairingCode(phoneCheck.digits);
    const formattedCode = rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
    waState.pairingCode = formattedCode;
    return res.json({ ok: true, code: formattedCode, phone: phoneCheck.e164 });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed requesting WhatsApp pairing code.',
    });
  }
});

app.post('/api/whatsapp/qr/disconnect', async (_req: Request, res: Response) => {
  ++waSessionNonce;
  try {
    if (waSocket) {
      if (waState.status === 'connected') {
        await waSocket.logout().catch(() => {});
      }
      try {
        waSocket.end();
      } catch {
        // Ignore socket close errors
      }
      waSocket = null;
    }
    await fs.rm(WA_AUTH_DIR, { recursive: true, force: true }).catch(() => {});
  } finally {
    waSocketReady = false;
    waState.status = 'disconnected';
    waState.qrDataUrl = null;
    waState.pairingCode = null;
    waState.phoneNumber = null;
    waState.name = null;
    waState.error = null;
  }
  return res.json(waState);
});

app.get('/api/whatsapp/threads', async (_req: Request, res: Response) => {
  const store = await readStore();
  return res.json({ threads: store.whatsappThreads });
});

app.post('/api/whatsapp/send', async (req: Request, res: Response) => {
  const { phone, contactName, message, phoneNumberId, accessToken } = req.body as {
    phone: string;
    contactName?: string;
    message: string;
    phoneNumberId?: string;
    accessToken?: string;
  };
  if (!phone || !message?.trim()) {
    return res.status(400).json({ error: 'Phone number and non-empty message are required.' });
  }

  const phoneCheck = validateWhatsAppPhoneServer(phone);
  if (!phoneCheck.valid) {
    return res.status(400).json({ error: phoneCheck.error });
  }

  const cleanPhone = phoneCheck.e164;
  const digitsOnly = phoneCheck.digits;
  let delivery: 'cloud-api' | 'wa-link' | 'sent' = 'wa-link';
  let externalId: string | undefined;
  let fallbackReason: string | undefined;

  if (waState.status === 'connected' && waSocket) {
    try {
      const jid = `${digitsOnly}@s.whatsapp.net`;
      const sentMsg = await waSocket.sendMessage(jid, { text: message.trim() });
      externalId = sentMsg?.key?.id || undefined;
      cacheSentWaMessage(externalId, sentMsg?.message);
      delivery = 'sent';
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : 'Linked WhatsApp Web delivery failed; using wa.me fallback.';
    }
  }

  if (delivery === 'wa-link' && phoneNumberId && accessToken) {
    try {
      const waRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: digitsOnly,
          type: 'text',
          text: { body: message.trim() },
        }),
      });
      if (waRes.ok) {
        const waJson = (await waRes.json()) as { messages?: Array<{ id: string }> };
        externalId = waJson.messages?.[0]?.id;
        delivery = 'cloud-api';
        fallbackReason = undefined;
      } else {
        fallbackReason = `Meta Cloud API HTTP ${waRes.status} — falling back to wa.me direct link.`;
      }
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : 'Meta Cloud API unreachable — falling back to wa.me link.';
    }
  }

  if (delivery === 'wa-link' && !fallbackReason) {
    fallbackReason = 'No active WhatsApp Web QR link or Meta Cloud API session — opening pre-filled wa.me link.';
  }

  const store = await readStore();
  const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let thread = store.whatsappThreads.find((t) => t.phone.replace(/[^\d]/g, '') === digitsOnly);
  if (!thread) {
    thread = {
      id: `wa-${Date.now()}`,
      contactName: contactName || cleanPhone,
      phone: cleanPhone,
      lastTimestamp: nowLabel,
      messages: [],
    };
    store.whatsappThreads.unshift(thread);
  }
  thread.lastTimestamp = nowLabel;
  thread.messages.push({
    id: externalId || `wm-${Date.now()}`,
    direction: 'outbound',
    text: message.trim(),
    timestamp: nowLabel,
    delivery,
  });
  appendActivityToStore(store, {
    category: 'whatsapp',
    employeeId: 'emp-aria',
    employeeName: 'Aria Patel',
    title: `Sent WhatsApp to ${contactName || cleanPhone}`,
    detail: `${message.trim().slice(0, 120)} (${delivery})`,
    status: 'completed',
    relatedId: externalId,
  });
  await writeStore(store);

  const waLink = `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message.trim())}`;
  return res.json({ ok: true, delivery, externalId, waLink, fallbackReason, thread });
});

// VOICE CALLS ROUTES (Twilio Voice REST API + Call History + tel: URI)
app.get('/api/calls/history', async (_req: Request, res: Response) => {
  const store = await readStore();
  return res.json({ calls: store.calls });
});

app.post('/api/calls/initiate', async (req: Request, res: Response) => {
  const { phone, contactName, script, accountSid, authToken, fromNumber, invoiceId, followUpWeeks } = req.body as {
    phone: string;
    contactName?: string;
    script: string;
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
    invoiceId?: string;
    followUpWeeks?: number;
  };
  if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

  const cleanPhone = phone.replace(/[^\d+]/g, '');
  let status: 'completed' | 'twilio-dispatched' = 'completed';
  let twilioSid: string | undefined;
  let twilioStatus: string | undefined;

  if (accountSid && authToken && fromNumber) {
    try {
      const safeScript = (script || 'Hello, this is a call from Azaris AI.')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const twiml = `<Response><Pause length="1"/><Say voice="alice">${safeScript}</Say><Pause length="1"/><Hangup/></Response>`;
      const params = new URLSearchParams({
        To: cleanPhone,
        From: fromNumber,
        Twiml: twiml,
        MachineDetection: 'Enable',
      });
      const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const twRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      if (!twRes.ok) {
        return res.status(twRes.status).json({ error: `Twilio error: ${await twRes.text()}` });
      }
      const twData = (await twRes.json()) as { sid: string; status?: string };
      twilioSid = twData.sid;
      twilioStatus = twData.status || 'queued';
      status = 'twilio-dispatched';
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : 'Twilio call failed' });
    }
  }

  const store = await readStore();
  const record = {
    id: twilioSid || `call-${Date.now()}`,
    contactName: contactName || cleanPhone,
    phone: cleanPhone,
    direction: 'outbound' as const,
    status,
    durationSeconds: 0,
    scriptOrSummary: script || 'Voice briefing call placed.',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  store.calls.unshift(record);

  let updatedInvoice: PersistedStore['invoices'][number] | undefined;
  const matchedInv = invoiceId
    ? store.invoices.find((i) => i.id === invoiceId)
    : store.invoices.find(
        (i) => i.status !== 'Paid' && i.customerPhone && i.customerPhone.replace(/[^\d]/g, '') === cleanPhone.replace(/[^\d]/g, '')
      );
  if (matchedInv) {
    const weeks = Math.max(1, Number(followUpWeeks || matchedInv.followUpWeeks || 2));
    matchedInv.followUpWeeks = weeks;
    matchedInv.lastFollowUpAt = new Date().toISOString();
    matchedInv.nextFollowUpAt = new Date(Date.now() + weeks * 7 * 86400_000).toISOString();
    updatedInvoice = matchedInv;
  }

  appendActivityToStore(store, {
    category: 'call',
    employeeId: 'emp-aria',
    employeeName: 'Aria Patel',
    title: updatedInvoice
      ? `Invoice Check-Up Call: ${contactName || cleanPhone} (${updatedInvoice.invoiceNumber})`
      : `Outbound Call: ${contactName || cleanPhone}`,
    detail: `${(script || 'Dialed recipient').slice(0, 110)}${
      updatedInvoice
        ? ` · Next check-up scheduled in ${updatedInvoice.followUpWeeks} week(s) (${updatedInvoice.nextFollowUpAt?.slice(0, 10)})`
        : ''
    }`,
    status: 'completed',
    relatedId: record.id,
  });

  await writeStore(store);

  return res.json({
    ok: true,
    record,
    updatedInvoice,
    twilioSid,
    twilioStatus,
    telUri: `tel:${cleanPhone}`,
  });
});

app.post('/api/calls/twilio/status', async (req: Request, res: Response) => {
  const { sid, accountSid, authToken } = req.body as {
    sid?: string;
    accountSid?: string;
    authToken?: string;
  };
  if (!sid || !accountSid || !authToken) {
    return res.status(400).json({ error: 'Missing Twilio SID or credentials' });
  }
  try {
    const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const twRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${encodeURIComponent(sid)}.json`, {
      headers: { Authorization: `Basic ${authHeader}` },
    });
    if (!twRes.ok) {
      return res.status(twRes.status).json({ error: await twRes.text() });
    }
    const d = (await twRes.json()) as { status?: string; duration?: string };
    return res.json({ ok: true, status: d.status || 'unknown', duration: Number(d.duration || 0) });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Failed checking call status' });
  }
});

app.post('/api/calls/hangup', async (req: Request, res: Response) => {
  const { callId, twilioSid, accountSid, authToken, durationSeconds, reason } = req.body as {
    callId?: string;
    twilioSid?: string;
    accountSid?: string;
    authToken?: string;
    durationSeconds?: number;
    reason?: string;
  };

  let twilioHungUp = false;
  if (twilioSid && accountSid && authToken) {
    try {
      const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const params = new URLSearchParams({ Status: 'completed' });
      const twRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${encodeURIComponent(twilioSid)}.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );
      twilioHungUp = twRes.ok;
    } catch {
      // Ignore if Twilio call already terminated
    }
  }

  const store = await readStore();
  const target = store.calls.find(
    (c) => (callId && c.id === callId) || (twilioSid && c.id === twilioSid)
  );
  const finalDuration = Math.max(0, Math.round(Number(durationSeconds || 0)));

  const reasonLabel =
    reason === 'script_delivered'
      ? 'Auto-hung up after script delivered'
      : reason === 'silence_timeout'
      ? 'Auto-hung up due to silence timeout'
      : reason === 'twilio_ended'
      ? 'Twilio call completed'
      : 'Ended manually';

  if (target) {
    target.status = 'completed';
    if (finalDuration > 0) {
      target.durationSeconds = Math.max(target.durationSeconds || 0, finalDuration);
    }
    if (!target.scriptOrSummary.includes(reasonLabel)) {
      target.scriptOrSummary = `${target.scriptOrSummary} (${reasonLabel})`;
    }
  }

  appendActivityToStore(store, {
    category: 'call',
    employeeId: 'emp-aria',
    employeeName: 'Aria Patel',
    title: target ? `Call Ended: ${target.contactName}` : 'Voice Call Ended',
    detail: `${reasonLabel}${finalDuration > 0 ? ` · Duration: ${finalDuration}s` : ''}`,
    status: 'completed',
    relatedId: target?.id || callId || twilioSid,
  });

  await writeStore(store);
  return res.json({ ok: true, twilioHungUp, record: target });
});

// QUICKBOOKS ROUTES (Real Intuit QuickBooks Online API + Persistent Ledger)
app.get('/api/quickbooks/ledger', async (_req: Request, res: Response) => {
  const store = await readStore();
  return res.json({ invoices: store.invoices, expenses: store.expenses });
});

app.post('/api/quickbooks/sync', async (req: Request, res: Response) => {
  const { realmId, accessToken, sandbox = true } = req.body as {
    realmId: string;
    accessToken: string;
    sandbox?: boolean;
  };
  if (!realmId || !accessToken) {
    return res.status(400).json({ error: 'QuickBooks Realm ID and Access Token are required.' });
  }
  const baseHost = sandbox ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
  try {
    const query = encodeURIComponent('SELECT * FROM Invoice MAXRESULTS 20');
    const qbRes = await fetch(`${baseHost}/v3/company/${realmId}/query?query=${query}&minorversion=73`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!qbRes.ok) {
      return res.status(qbRes.status).json({ error: `QuickBooks API error: ${await qbRes.text()}` });
    }
    const data = (await qbRes.json()) as {
      QueryResponse?: {
        Invoice?: Array<{
          Id: string;
          DocNumber?: string;
          CustomerRef?: { name?: string };
          BillEmail?: { Address?: string };
          TotalAmt: number;
          Balance: number;
          DueDate?: string;
        }>;
      };
    };
    const liveInvoices = (data.QueryResponse?.Invoice || []).map((inv) => ({
      id: `qb-${inv.Id}`,
      invoiceNumber: inv.DocNumber || `QB-${inv.Id}`,
      customerName: inv.CustomerRef?.name || 'QuickBooks Customer',
      customerEmail: inv.BillEmail?.Address || '',
      amount: Number(inv.TotalAmt || 0),
      status: (inv.Balance === 0 ? 'Paid' : 'Pending') as 'Paid' | 'Pending',
      dueDate: inv.DueDate || '2026-11-30',
      description: 'Synced from QuickBooks Online',
      followUpWeeks: inv.Balance === 0 ? 0 : 2,
    }));

    if (liveInvoices.length > 0) {
      const store = await readStore();
      store.invoices = liveInvoices;
      appendActivityToStore(store, {
        category: 'quickbooks',
        employeeId: 'emp-marcus',
        employeeName: 'Marcus Vance',
        title: `Synced ${liveInvoices.length} Invoices from QuickBooks Online`,
        detail: `Company Realm ${realmId}`,
        status: 'completed',
      });
      await writeStore(store);
    }

    return res.json({ ok: true, count: liveInvoices.length, invoices: liveInvoices });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'QuickBooks sync failed' });
  }
});

app.post('/api/quickbooks/invoices', async (req: Request, res: Response) => {
  const { customerName, customerEmail, customerPhone, amount, description, dueDate, followUpWeeks } = req.body as {
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    amount: number;
    description: string;
    dueDate?: string;
    followUpWeeks?: number;
  };
  if (!customerName || !amount) {
    return res.status(400).json({ error: 'Customer name and amount are required.' });
  }
  const store = await readStore();
  const nextNum = 1044 + store.invoices.length;
  const weeks = Number(followUpWeeks ?? 2);
  const newInv = {
    id: `inv-${Date.now()}`,
    invoiceNumber: `INV-${nextNum}`,
    customerName,
    customerEmail: customerEmail || '',
    customerPhone: customerPhone || '',
    amount: Number(amount),
    status: 'Pending' as const,
    dueDate: dueDate || '2026-11-30',
    description: description || 'Consulting & AI Operations',
    followUpWeeks: weeks,
    ...(weeks > 0 ? { nextFollowUpAt: new Date(Date.now() + weeks * 7 * 86400_000).toISOString() } : {}),
  };
  store.invoices.unshift(newInv);
  appendActivityToStore(store, {
    category: 'quickbooks',
    employeeId: 'emp-marcus',
    employeeName: 'Marcus Vance',
    title: `Created Invoice ${newInv.invoiceNumber} ($${newInv.amount.toLocaleString()})`,
    detail: `${customerName} — ${newInv.description}${weeks > 0 ? ` · Check-up every ${weeks} wk(s)` : ''}`,
    status: 'completed',
    relatedId: newInv.id,
  });
  await writeStore(store);
  return res.json({ ok: true, invoice: newInv });
});

app.post('/api/quickbooks/invoices/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body as { status: 'Paid' | 'Pending' | 'Overdue' };
  const store = await readStore();
  const target = store.invoices.find((i) => i.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Invoice not found' });
  target.status = status;
  if (status === 'Paid') {
    target.nextFollowUpAt = undefined;
  }
  appendActivityToStore(store, {
    category: 'quickbooks',
    employeeId: 'emp-marcus',
    employeeName: 'Marcus Vance',
    title: `Updated ${target.invoiceNumber} -> ${status}`,
    detail: `${target.customerName} ($${target.amount.toLocaleString()})`,
    status: 'completed',
    relatedId: target.id,
  });
  await writeStore(store);
  return res.json({ ok: true, invoice: target });
});

app.post('/api/quickbooks/invoices/:id/follow-up', async (req: Request, res: Response) => {
  const { customerPhone, followUpWeeks, nextFollowUpAt, followUpNotes, completeCheckup } = req.body as {
    customerPhone?: string;
    followUpWeeks?: number;
    nextFollowUpAt?: string;
    followUpNotes?: string;
    completeCheckup?: boolean;
  };
  const store = await readStore();
  const target = store.invoices.find((i) => i.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Invoice not found' });

  if (typeof customerPhone === 'string') target.customerPhone = customerPhone.trim();
  if (typeof followUpNotes === 'string') target.followUpNotes = followUpNotes.trim();
  if (typeof followUpWeeks === 'number' && !Number.isNaN(followUpWeeks)) {
    target.followUpWeeks = Math.max(0, Math.min(12, followUpWeeks));
    if (!nextFollowUpAt) {
      target.nextFollowUpAt =
        target.followUpWeeks > 0
          ? new Date(Date.now() + target.followUpWeeks * 7 * 86400_000).toISOString()
          : undefined;
    }
  }
  if (nextFollowUpAt) {
    target.nextFollowUpAt = nextFollowUpAt;
  }
  if (completeCheckup) {
    const weeks = Math.max(1, target.followUpWeeks || 2);
    target.lastFollowUpAt = new Date().toISOString();
    target.nextFollowUpAt = new Date(Date.now() + weeks * 7 * 86400_000).toISOString();
  }

  await writeStore(store);
  return res.json({ ok: true, invoice: target });
});

app.get('/api/quickbooks/checkups/due', async (_req: Request, res: Response) => {
  const store = await readStore();
  const nowMs = Date.now();
  const unpaid = store.invoices.filter((i) => i.status !== 'Paid');
  const dueInvoices = unpaid.filter(
    (i) => (i.followUpWeeks ?? 2) > 0 && (!i.nextFollowUpAt || new Date(i.nextFollowUpAt).getTime() <= nowMs)
  );
  const upcomingInvoices = unpaid.filter(
    (i) => i.nextFollowUpAt && new Date(i.nextFollowUpAt).getTime() > nowMs
  );
  return res.json({ dueInvoices, upcomingInvoices });
});

app.post('/api/quickbooks/expenses', async (req: Request, res: Response) => {
  const { vendor, category, amount, date, status, sourceEmailId } = req.body as {
    vendor: string;
    category?: string;
    amount: number;
    date?: string;
    status?: 'Cleared' | 'Pending';
    sourceEmailId?: string;
  };
  if (!vendor || !Number(amount)) {
    return res.status(400).json({ error: 'Vendor and positive amount are required.' });
  }
  const store = await readStore();
  const newExp = {
    id: `exp-${Date.now()}`,
    vendor: vendor.trim(),
    category: category || 'Operating Expense',
    amount: Number(amount),
    date: date || new Date().toISOString().slice(0, 10),
    status: status || ('Pending' as const),
    ...(sourceEmailId ? { sourceEmailId } : {}),
  };
  store.expenses.unshift(newExp);
  appendActivityToStore(store, {
    category: 'quickbooks',
    employeeId: 'emp-marcus',
    employeeName: 'Marcus Vance',
    title: `Logged Expense: ${newExp.vendor} ($${newExp.amount.toLocaleString()})`,
    detail: `${newExp.category} · ${newExp.status}`,
    status: 'completed',
    relatedId: newExp.id,
  });
  await writeStore(store);
  return res.json({ ok: true, expense: newExp });
});

app.post('/api/quickbooks/reconcile-emails', async (req: Request, res: Response) => {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-gmail-token'] || '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing Gmail Bearer token for email reconciliation.' });
  }
  const { maxResults = 15, autoApply = true } = (req.body || {}) as {
    maxResults?: number;
    autoApply?: boolean;
  };
  try {
    const summary = await reconcileEmailsWithQuickBooks(token, { maxResults, autoApply });
    return res.json({ ok: true, ...summary });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed reconciling emails with QuickBooks.',
    });
  }
});

// MEETINGS & DAILY ACTIVITY OVERVIEW ROUTES
app.get('/api/meetings', async (_req: Request, res: Response) => {
  const store = await readStore();
  return res.json({ meetings: store.meetings });
});

app.post('/api/meetings', async (req: Request, res: Response) => {
  const {
    title,
    contactName,
    contactEmail,
    contactPhone,
    invoiceId,
    invoiceNumber,
    scheduledFor,
    durationMinutes = 30,
    notes = '',
  } = req.body as {
    title?: string;
    contactName: string;
    contactEmail?: string;
    contactPhone?: string;
    invoiceId?: string;
    invoiceNumber?: string;
    scheduledFor: string;
    durationMinutes?: number;
    notes?: string;
  };
  if (!contactName || !scheduledFor) {
    return res.status(400).json({ error: 'Contact name and scheduledFor date/time are required.' });
  }

  const startDate = new Date(scheduledFor);
  const validStart = Number.isNaN(startDate.getTime()) ? new Date(Date.now() + 86400_000) : startDate;
  const endDate = new Date(validStart.getTime() + Number(durationMinutes || 30) * 60_000);
  const fmtGCal = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const meetingTitle = title?.trim() || `Invoice Check-Up: ${contactName}${invoiceNumber ? ` (${invoiceNumber})` : ''}`;
  const calendarUrl =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(meetingTitle)}` +
    `&dates=${fmtGCal(validStart)}/${fmtGCal(endDate)}` +
    `&details=${encodeURIComponent(notes || 'Scheduled via Azaris Workstation')}` +
    (contactEmail ? `&add=${encodeURIComponent(contactEmail)}` : '');

  // Attempt Google Calendar API creation if Bearer token is supplied and authorized for calendar
  let googleCalendarEventId: string | undefined;
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    try {
      const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: meetingTitle,
          description: notes || 'Scheduled via Azaris Workstation',
          start: { dateTime: validStart.toISOString() },
          end: { dateTime: endDate.toISOString() },
          ...(contactEmail ? { attendees: [{ email: contactEmail }] } : {}),
        }),
      });
      if (calRes.ok) {
        const calJson = (await calRes.json()) as { id?: string };
        googleCalendarEventId = calJson.id;
      }
    } catch {
      // Non-fatal fallback: meeting is persisted locally with Google Calendar template link
    }
  }

  const store = await readStore();
  const meeting = {
    id: `mtg-${Date.now()}`,
    title: meetingTitle,
    contactName,
    contactEmail: contactEmail || undefined,
    contactPhone: contactPhone || undefined,
    invoiceId: invoiceId || undefined,
    invoiceNumber: invoiceNumber || undefined,
    scheduledFor: validStart.toISOString(),
    durationMinutes: Number(durationMinutes || 30),
    notes,
    status: 'scheduled' as const,
    calendarUrl,
    googleCalendarEventId,
    createdAt: new Date().toISOString(),
  };
  store.meetings.unshift(meeting);

  appendActivityToStore(store, {
    category: 'meeting',
    employeeId: 'emp-maya',
    employeeName: 'Maya Lin',
    title: `Scheduled Meeting: ${meeting.title}`,
    detail: `With ${contactName} on ${validStart.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}${googleCalendarEventId ? ' (Synced to Google Calendar)' : ''}`,
    status: 'completed',
    relatedId: meeting.id,
  });

  await writeStore(store);
  return res.json({ ok: true, meeting });
});

app.post('/api/meetings/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body as { status: 'scheduled' | 'completed' | 'cancelled' };
  const store = await readStore();
  const target = store.meetings.find((m) => m.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Meeting not found' });
  target.status = status;
  appendActivityToStore(store, {
    category: 'meeting',
    employeeId: 'emp-maya',
    employeeName: 'Maya Lin',
    title: `Meeting ${status}: ${target.title}`,
    detail: `Attendee: ${target.contactName}`,
    status: 'completed',
    relatedId: target.id,
  });
  await writeStore(store);
  return res.json({ ok: true, meeting: target });
});

app.get('/api/activity/overview', async (req: Request, res: Response) => {
  const dateKey = req.query.date ? String(req.query.date) : undefined;
  const store = await readStore();
  return res.json(buildDailyOverview(store, dateKey));
});

app.post('/api/activity/log', async (req: Request, res: Response) => {
  const { category, employeeId, employeeName, title, detail, status = 'completed', relatedId } = req.body as {
    category: PersistedStore['activityLog'][number]['category'];
    employeeId?: string;
    employeeName?: string;
    title: string;
    detail?: string;
    status?: PersistedStore['activityLog'][number]['status'];
    relatedId?: string;
  };
  if (!category || !title) {
    return res.status(400).json({ error: 'Category and title are required.' });
  }
  const store = await readStore();
  appendActivityToStore(store, {
    category,
    employeeId,
    employeeName: employeeName || 'Azaris Workforce',
    title,
    detail: detail || '',
    status,
    relatedId,
  });
  await writeStore(store);
  return res.json({ ok: true });
});

// AUTONOMOUS BROWSER AGENT & YOUTUBE RESOLVER ROUTES
app.get('/api/browser/youtube-resolve', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required.' });
  try {
    const video = await resolveYouTubeVideo(q);
    return res.json({ ok: true, ...video });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed resolving YouTube video.',
    });
  }
});

app.post('/api/browser/navigate', async (req: Request, res: Response) => {
  const { url } = req.body as { url: string };
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const snapshot = await fetchAndParseWebpage(url);
    const store = await readStore();
    appendActivityToStore(store, {
      category: 'browser',
      employeeId: 'emp-marcus',
      employeeName: 'Marcus Vance',
      title: `Browsed: ${snapshot.title || snapshot.url}`,
      detail: snapshot.url,
      status: 'completed',
    });
    await writeStore(store);
    return res.json({ ok: true, snapshot });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Navigation failed' });
  }
});

// SYSTEM FILES & LOCAL LAPTOP BRIDGE ROUTES
app.get('/api/system/workspace-files', async (req: Request, res: Response) => {
  try {
    const rel = String(req.query.dir || '');
    const targetDir = resolveSafeWorkspacePath(rel);
    const items = await fs.readdir(targetDir, { withFileTypes: true });
    const entries = await Promise.all(
      items.map(async (item) => {
        const full = path.join(targetDir, item.name);
        const st = await fs.stat(full);
        return {
          name: item.name,
          path: path.relative(WORKSPACE_ROOT, full),
          type: item.isDirectory() ? 'directory' : 'file',
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
          source: 'server' as const,
        };
      })
    );
    return res.json({ entries });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed reading directory' });
  }
});

app.post('/api/system/workspace-files/read', async (req: Request, res: Response) => {
  try {
    const target = resolveSafeWorkspacePath(String(req.body.path || ''));
    const content = await fs.readFile(target, 'utf-8');
    return res.json({ ok: true, content });
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'File not found' });
  }
});

app.post('/api/system/workspace-files/write', async (req: Request, res: Response) => {
  try {
    const target = resolveSafeWorkspacePath(String(req.body.path || ''));
    const parent = path.dirname(target);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    await fs.writeFile(target, String(req.body.content || ''), 'utf-8');
    return res.json({ ok: true, path: req.body.path });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed writing file' });
  }
});

app.post('/api/system/workspace-files/delete', async (req: Request, res: Response) => {
  try {
    const target = resolveSafeWorkspacePath(String(req.body.path || ''));
    await fs.rm(target, { recursive: true, force: true });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed deleting file' });
  }
});

// Authenticated HTTPS Bridge Relay (solves browser iframe Mixed-Content / Private Network blocks on localhost:43110)
interface BridgeRelayCommand {
  id: string;
  action: string;
  payload: Record<string, unknown>;
}

interface BridgeRelaySession {
  platform: string;
  hostname: string;
  home: string;
  lastSeen: number;
  queue: BridgeRelayCommand[];
  waitingPollResolve: ((cmd: BridgeRelayCommand | null) => void) | null;
  pendingResults: Map<
    string,
    {
      resolve: (res: { ok: boolean; data?: Record<string, unknown>; error?: string }) => void;
      timer: NodeJS.Timeout;
    }
  >;
}

const bridgeRelaySessions = new Map<string, BridgeRelaySession>();

function getOrCreateRelaySession(token: string): BridgeRelaySession {
  let s = bridgeRelaySessions.get(token);
  if (!s) {
    s = {
      platform: 'unknown',
      hostname: 'laptop',
      home: '',
      lastSeen: 0,
      queue: [],
      waitingPollResolve: null,
      pendingResults: new Map(),
    };
    bridgeRelaySessions.set(token, s);
  }
  return s;
}

app.get('/api/bridge/relay/health', (req: Request, res: Response) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.status(400).json({ online: false, error: 'Missing bridge pairing token' });
  }
  const s = bridgeRelaySessions.get(token);
  const online = Boolean(s && Date.now() - s.lastSeen < 35000);
  return res.json({
    online,
    platform: online ? s?.platform : undefined,
    hostname: online ? s?.hostname : undefined,
    home: online ? s?.home : undefined,
    lastSeenMs: s?.lastSeen ? Date.now() - s.lastSeen : null,
  });
});

app.get('/api/bridge/relay/poll', (req: Request, res: Response) => {
  const token = String(req.query.token || req.headers['x-bridge-token'] || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing bridge token' });

  const s = getOrCreateRelaySession(token);
  s.lastSeen = Date.now();
  if (req.query.platform) s.platform = String(req.query.platform);
  if (req.query.hostname) s.hostname = String(req.query.hostname);
  if (req.query.home) s.home = String(req.query.home);

  if (s.queue.length > 0) {
    const nextCmd = s.queue.shift()!;
    return res.json({ command: nextCmd });
  }

  // Replace any older waiting poll
  if (s.waitingPollResolve) {
    s.waitingPollResolve(null);
    s.waitingPollResolve = null;
  }

  let settled = false;
  const finish = (cmd: BridgeRelayCommand | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (s.waitingPollResolve === finish) s.waitingPollResolve = null;
    s.lastSeen = Date.now();
    if (!res.headersSent) {
      res.json({ command: cmd });
    }
  };

  const timer = setTimeout(() => finish(null), 20000);
  s.waitingPollResolve = finish;

  req.on('close', () => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      if (s.waitingPollResolve === finish) s.waitingPollResolve = null;
    }
  });
});

app.post('/api/bridge/relay/result', (req: Request, res: Response) => {
  const token = String(req.body.token || req.headers['x-bridge-token'] || '').trim();
  const id = String(req.body.id || '').trim();
  if (!token || !id) return res.status(400).json({ error: 'Missing token or command id' });

  const s = bridgeRelaySessions.get(token);
  if (!s) return res.status(404).json({ error: 'Relay session not found' });
  s.lastSeen = Date.now();

  const pending = s.pendingResults.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    s.pendingResults.delete(id);
    pending.resolve({
      ok: Boolean(req.body.ok),
      data: (req.body.data as Record<string, unknown>) || {},
      error: req.body.error ? String(req.body.error) : undefined,
    });
  }
  return res.json({ ok: true });
});

app.post('/api/bridge/relay/exec', async (req: Request, res: Response) => {
  const { token, action, payload } = req.body as {
    token?: string;
    action?: string;
    payload?: Record<string, unknown>;
  };
  if (!token || !action) {
    return res.status(400).json({ ok: false, error: 'Missing token or action' });
  }
  const s = bridgeRelaySessions.get(token);
  if (!s || Date.now() - s.lastSeen >= 35000) {
    return res.status(503).json({
      ok: false,
      error: 'Local OS Companion Bridge is not connected to relay. Run azaris-local-bridge.mjs on your laptop.',
    });
  }

  const cmd: BridgeRelayCommand = {
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    payload: payload || {},
  };

  const result = await new Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>((resolve) => {
    const timer = setTimeout(() => {
      s.pendingResults.delete(cmd.id);
      resolve({ ok: false, error: 'Timed out waiting for laptop bridge execution.' });
    }, 12000);

    s.pendingResults.set(cmd.id, { resolve, timer });
    if (s.waitingPollResolve) {
      const wake = s.waitingPollResolve;
      s.waitingPollResolve = null;
      wake(cmd);
    } else {
      s.queue.push(cmd);
    }
  });

  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error || 'Bridge execution failed' });
  }
  return res.json({ ok: true, ...(result.data || {}) });
});

// Downloadable 1-file Local Desktop Companion Bridge (Loopback port 43110 + Authenticated HTTPS Relay)
app.get('/api/system/local-bridge-script', (req: Request, res: Response) => {
  const rawOrigin = String(req.query.origin || req.headers.origin || process.env.APP_URL || '').trim();
  const safeOrigin = /^https?:\/\/[^"'\s`<>]+$/i.test(rawOrigin) ? rawOrigin : '';
  const rawToken = String(req.query.token || '').trim();
  const safeToken = /^[a-zA-Z0-9_-]{8,128}$/.test(rawToken) ? rawToken : '';

  const script = `#!/usr/bin/env node
// Azaris Local Laptop Bridge (Loopback 127.0.0.1:43110 + HTTPS Relay)
// Usage: node azaris-local-bridge.mjs [--relay <url>] [--token <token>]
import http from 'node:http';
import https from 'node:https';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = 43110;
const platform = os.platform();

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : '';
}

const RELAY_URL = (getArg('--relay') || ${JSON.stringify(safeOrigin)}).replace(/\\/+$/, '');
const BRIDGE_TOKEN = getArg('--token') || ${JSON.stringify(safeToken)};

function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function executeAction(action, data = {}) {
  if (action === '/health' || action === 'health') {
    return { ok: true, platform, hostname: os.hostname(), home: os.homedir() };
  }
  if (action === '/setting' || action === 'setting') {
    const { setting, value } = data;
    let output = 'Applied';
    const rawStr = String(value || '').trim();
    const safeApp = rawStr.replace(/["'$;|&<>\\x60]/g, '').trim();
    const safeUrl = /^https?:\/\//i.test(rawStr)
      ? rawStr.replace(/["'\\x60]/g, '')
      : \`https://www.google.com/search?q=\${encodeURIComponent(rawStr)}\`;

    if (platform === 'darwin') {
      if (setting === 'os_volume') output = await runCmd(\`osascript -e "set volume output volume \${Number(value)}"\`);
      else if (setting === 'theme') output = await runCmd(\`osascript -e 'tell app "System Events" to tell appearance preferences to set dark mode to \${value === 'dark' ? 'true' : 'false'}'\`);
      else if (setting === 'open_app') output = await runCmd(\`open -a "\${safeApp}"\`);
      else if (setting === 'chrome_search' || setting === 'open_url' || setting === 'youtube_play') {
        output = await runCmd(\`open -a "Google Chrome" "\${safeUrl}"\`);
      } else if (setting === 'fullscreen') {
        if (rawStr === 'video') {
          output = await runCmd(\`osascript -e 'tell application "Google Chrome" to activate' -e 'tell application "System Events" to keystroke "f"'\`);
        } else {
          output = await runCmd(\`osascript -e 'tell application "Google Chrome" to activate' -e 'tell application "System Events" to keystroke "f" using {command down, control down}'\`);
        }
      } else if (setting === 'os_wifi') output = await runCmd(\`networksetup -setairportpower en0 \${value === 'on' ? 'on' : 'off'}\`);
    } else if (platform === 'win32') {
      if (setting === 'open_app') {
        const target = /chrome/i.test(safeApp) ? 'chrome' : safeApp;
        output = await runCmd(\`start "" "\${target}"\`);
      } else if (setting === 'chrome_search' || setting === 'open_url' || setting === 'youtube_play') {
        output = await runCmd(\`start "" chrome "\${safeUrl}"\`);
      } else if (setting === 'fullscreen') {
        const keySeq = rawStr === 'video' ? 'f' : '{F11}';
        output = await runCmd(\`powershell -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('Chrome') | Out-Null; Start-Sleep -Milliseconds 150; $wshell.SendKeys('\${keySeq}')"\`);
      }
    } else {
      if (setting === 'os_volume') output = await runCmd(\`pactl set-sink-volume @DEFAULT_SINK@ \${Number(value)}%\`);
      else if (setting === 'open_app') {
        const target = /chrome/i.test(safeApp) ? 'google-chrome' : safeApp.toLowerCase();
        output = await runCmd(\`nohup "\${target}" >/dev/null 2>&1 &\`);
      } else if (setting === 'chrome_search' || setting === 'open_url' || setting === 'youtube_play') {
        output = await runCmd(\`nohup google-chrome "\${safeUrl}" >/dev/null 2>&1 || xdg-open "\${safeUrl}" >/dev/null 2>&1 &\`);
      } else if (setting === 'fullscreen') {
        const keyName = rawStr === 'video' ? 'f' : 'F11';
        output = await runCmd(\`xdotool key \${keyName}\`);
      }
    }
    return { ok: true, output };
  }
  if (action === '/call' || action === 'call') {
    const clean = String(data.phone || '').replace(/[^\\d+]/g, '');
    if (!clean) throw new Error('Phone number required');
    if (platform === 'darwin') {
      await runCmd(\`open "tel:\${clean}"\`);
      // Try pressing Return if FaceTime opens with a Call confirmation prompt
      setTimeout(() => {
        runCmd(\`osascript -e 'tell application "FaceTime" to activate' -e 'tell application "System Events" to key code 36'\`).catch(() => {});
      }, 1200);
    } else if (platform === 'win32') {
      await runCmd(\`start "" "tel:\${clean}"\`);
      // Best-effort auto-press Enter on Windows Phone Link once focused
      setTimeout(() => {
        runCmd(\`powershell -NoProfile -Command "Start-Sleep -Milliseconds 1200; $ws = New-Object -ComObject wscript.shell; if ($ws.AppActivate('Phone Link') -or $ws.AppActivate('Your Phone')) { Start-Sleep -Milliseconds 300; $ws.SendKeys('{ENTER}') }"\`).catch(() => {});
      }, 200);
    } else {
      await runCmd(\`xdg-open "tel:\${clean}"\`);
    }
    return { ok: true, dialed: clean };
  }
  if (action === '/call/hangup' || action === 'call/hangup') {
    if (platform === 'darwin') {
      await runCmd(\`osascript -e 'tell application "System Events" to tell process "FaceTime" to try' -e 'click (first button of window 1 whose description contains "End" or name contains "End" or description contains "Leave")' -e 'end try'\`).catch(() => {});
    } else if (platform === 'win32') {
      await runCmd(\`powershell -NoProfile -Command "$ws = New-Object -ComObject wscript.shell; if ($ws.AppActivate('Phone Link') -or $ws.AppActivate('Your Phone')) { Start-Sleep -Milliseconds 150; $ws.SendKeys('{ESC}') }"\`).catch(() => {});
    }
    return { ok: true, hungUp: true };
  }
  if (action === '/files/list' || action === 'files/list') {
    const dir = data.dir ? path.resolve(data.dir) : os.homedir();
    const items = await fs.readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
      items.slice(0, 120).map(async (i) => {
        const full = path.join(dir, i.name);
        let size = 0;
        let modifiedAt = new Date().toISOString();
        try {
          const st = await fs.stat(full);
          size = st.size;
          modifiedAt = st.mtime.toISOString();
        } catch {}
        return { name: i.name, path: full, type: i.isDirectory() ? 'directory' : 'file', size, modifiedAt };
      })
    );
    return { ok: true, dir, entries };
  }
  if (action === '/files/read' || action === 'files/read') {
    const content = await fs.readFile(path.resolve(data.path), 'utf-8');
    return { ok: true, content };
  }
  if (action === '/files/write' || action === 'files/write') {
    const target = path.resolve(data.path);
    await fs.writeFile(target, String(data.content || ''), 'utf-8');
    return { ok: true };
  }
  if (action === '/files/delete' || action === 'files/delete') {
    await fs.rm(path.resolve(data.path), { recursive: true, force: true });
    return { ok: true };
  }
  throw new Error('Unknown bridge action: ' + action);
}

const POPUP_HTML = \`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Azaris Local Bridge</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; background: #065f46; color: #6ee7b7; }
    .muted { color: #94a3b8; font-size: 12px; margin-top: 8px; line-height: 1.5; }
    code { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge" id="status">Bridge Connected</span>
    <h3 style="margin:10px 0 4px;font-size:15px;">Azaris Local OS Bridge Active</h3>
    <div class="muted" id="meta">Port 43110 · Platform: \${platform} (\${os.hostname()})</div>
    <div class="muted" id="log">Waiting for commands from Azaris... Keep this small window open or minimized.</div>
  </div>
  <script>
    const info = { platform: \${JSON.stringify(platform)}, hostname: \${JSON.stringify(os.hostname())}, home: \${JSON.stringify(os.homedir())} };
    function notifyOpener() {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'azaris-bridge-ready', ...info }, '*');
      } else {
        document.getElementById('status').textContent = 'No Parent Window';
        document.getElementById('status').style.background = '#7f1d1d';
        document.getElementById('status').style.color = '#fca5a5';
      }
    }
    notifyOpener();
    setInterval(notifyOpener, 2000);
    window.addEventListener('message', async (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'azaris-bridge-ping') {
        notifyOpener();
        return;
      }
      if (msg.type !== 'azaris-bridge-cmd' || !msg.id || !msg.action) return;
      document.getElementById('log').textContent = 'Executing: ' + msg.action;
      try {
        const res = await fetch(msg.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload || {}),
        });
        const data = await res.json().catch(() => ({}));
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type: 'azaris-bridge-res',
            id: msg.id,
            ok: res.ok && data.ok !== false,
            data,
            error: data.error || (!res.ok ? 'Bridge HTTP ' + res.status : undefined),
          }, '*');
        }
        document.getElementById('log').textContent = 'Last executed: ' + msg.action + ' (' + (res.ok ? 'OK' : 'Error') + ')';
      } catch (err) {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type: 'azaris-bridge-res',
            id: msg.id,
            ok: false,
            error: err && err.message ? err.message : 'Local fetch error',
          }, '*');
        }
      }
    });
  </script>
</body>
</html>\`;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && urlPath === '/popup') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(POPUP_HTML);
    return;
  }

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(await executeAction('/health')));
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const data = JSON.parse(body || '{}');
      const result = await executeAction(urlPath, data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(\`Azaris Local Laptop Bridge listening on http://127.0.0.1:\${PORT} (\${platform})\`);
});

function requestJson(urlStr, method = 'GET', payload = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const bodyStr = payload ? JSON.stringify(payload) : null;
    const req = mod.request(
      u,
      {
        method,
        timeout: 25000,
        headers: bodyStr
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : undefined,
      },
      (resp) => {
        let raw = '';
        resp.on('data', (c) => (raw += c));
        resp.on('end', () => {
          try {
            resolve({ status: resp.statusCode || 200, json: JSON.parse(raw || '{}') });
          } catch {
            resolve({ status: resp.statusCode || 500, json: {} });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('Relay poll timeout')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function startRelayLoop() {
  if (!RELAY_URL || !BRIDGE_TOKEN) {
    console.log('Local mode active. In Azaris, click "Connect Bridge Window" or open the app in a top-level tab.');
    return;
  }
  console.log(\`Connecting encrypted relay to \${RELAY_URL} ...\`);
  let announced = false;
  while (true) {
    try {
      const q = new URLSearchParams({
        token: BRIDGE_TOKEN,
        platform,
        hostname: os.hostname(),
        home: os.homedir(),
      });
      const res = await requestJson(\`\${RELAY_URL}/api/bridge/relay/poll?\${q.toString()}\`);
      if (res.status >= 300) {
        console.log(\`Relay returned HTTP \${res.status} (cloud preview auth gate). Click "Connect Bridge Window" in Azaris to pair locally over port 43110!\`);
        return;
      }
      if (!announced && res.status === 200) {
        announced = true;
        console.log('Connected to Azaris Cloud Relay! Your browser app can now control this laptop.');
      }
      const cmd = res.json && res.json.command;
      if (cmd && cmd.id) {
        try {
          const data = await executeAction(cmd.action, cmd.payload || {});
          await requestJson(\`\${RELAY_URL}/api/bridge/relay/result\`, 'POST', {
            token: BRIDGE_TOKEN,
            id: cmd.id,
            ok: true,
            data,
          });
        } catch (err) {
          await requestJson(\`\${RELAY_URL}/api/bridge/relay/result\`, 'POST', {
            token: BRIDGE_TOKEN,
            id: cmd.id,
            ok: false,
            error: err && err.message ? err.message : 'Execution failed',
          });
        }
      }
    } catch (err) {
      announced = false;
      console.error('Relay reconnect in 4s:', err && err.message ? err.message : err);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

startRelayLoop();
`;
  res.setHeader('Content-Disposition', 'attachment; filename="azaris-local-bridge.mjs"');
  res.setHeader('Content-Type', 'application/javascript');
  res.send(script);
});

process.on('unhandledRejection', (reason) => {
  rawConsoleError('Unhandled promise rejection in server:', reason);
});

process.on('uncaughtException', (err) => {
  rawConsoleError('Uncaught exception in server:', err);
});

async function startServer() {
  await ensureWorkspaceSeeded().catch((err) => {
    rawConsoleError('Workspace seeding error:', err);
  });

  if (await isWaCredsRegistered()) {
    startWhatsAppQrSession({ cleanUnregistered: false }).catch(() => {});
  }

  if (process.env.NODE_ENV !== 'production') {
    let viteMiddleware: express.RequestHandler | null = null;
    let viteInitError: unknown = null;
    const viteReadyPromise = (async () => {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      viteMiddleware = vite.middlewares;
    })().catch((err) => {
      viteInitError = err;
      rawConsoleError('Vite middleware failed to initialize:', err);
    });

    app.use(async (req: Request, res: Response, next: express.NextFunction) => {
      if (!viteMiddleware) {
        await viteReadyPromise;
      }
      if (viteMiddleware) {
        return viteMiddleware(req, res, next);
      }
      return res.status(500).send(
        viteInitError instanceof Error ? viteInitError.message : 'Vite dev middleware failed to start'
      );
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Azaris Workstation server running on http://0.0.0.0:${PORT}`);
  });
  server.on('error', (err) => {
    rawConsoleError(`Failed binding port ${PORT}:`, err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  rawConsoleError('Fatal server startup error:', err);
  process.exit(1);
});
