export type LlmProviderId = 'gemini' | 'ollama' | 'anthropic' | 'openai' | 'custom';

export interface LlmConfig {
  provider: LlmProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  ollamaDirectBrowser?: boolean;
}

export type WorkspaceTab =
  | 'command'
  | 'overview'
  | 'employees'
  | 'gmail'
  | 'comms'
  | 'quickbooks'
  | 'browser'
  | 'system'
  | 'models';

export interface DigitalEmployee {
  id: string;
  name: string;
  role: string;
  avatar: string;
  specialty: string;
  systemPrompt: string;
  memory: string[];
  allowedTools: string[];
  preferredProvider?: LlmProviderId;
  preferredModel?: string;
  active: boolean;
}

export type ActionType =
  | 'gmail_send'
  | 'gmail_modify'
  | 'whatsapp_send'
  | 'voice_call'
  | 'schedule_meeting'
  | 'quickbooks_create_invoice'
  | 'quickbooks_mark_paid'
  | 'quickbooks_add_expense'
  | 'browser_navigate'
  | 'app_media'
  | 'file_write'
  | 'file_delete'
  | 'laptop_setting'
  | 'ui_mode';

export interface YouTubePlayerState {
  videoId: string;
  title: string;
  query: string;
  watchUrl: string;
  embedUrl: string;
  startedAt: string;
}

export interface EmailSyncMatchedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amount: number;
  emailId: string;
  emailSubject: string;
  emailFrom: string;
  markedPaid: boolean;
}

export interface EmailSyncDetectedBill {
  id: string;
  vendor: string;
  amount: number;
  category: string;
  emailId: string;
  emailSubject: string;
  logged: boolean;
}

export interface EmailSyncSummary {
  lastScannedAt: string;
  scannedCount: number;
  matchedPaid: EmailSyncMatchedInvoice[];
  detectedBills: EmailSyncDetectedBill[];
}

export interface ApprovalProposal {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string;
  actionType: ActionType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  resultMessage?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  employeeId?: string;
  employeeName?: string;
  employeeAvatar?: string;
  content: string;
  timestamp: string;
  providerUsed?: string;
  toolTrace?: Array<{
    name: string;
    args: Record<string, unknown>;
    status: 'executed' | 'needs_approval' | 'failed';
    detail?: string;
  }>;
  proposals?: ApprovalProposal[];
}

export interface GmailMessageItem {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  body?: string;
  labelIds?: string[];
}

export interface WhatsAppThread {
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
}

export interface CallRecord {
  id: string;
  contactName: string;
  phone: string;
  direction: 'outbound' | 'inbound';
  status: 'completed' | 'in-progress' | 'scheduled' | 'twilio-dispatched';
  durationSeconds: number;
  scriptOrSummary: string;
  timestamp: string;
}

export interface QuickBooksInvoice {
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
}

export interface QuickBooksExpense {
  id: string;
  vendor: string;
  category: string;
  amount: number;
  date: string;
  status: 'Cleared' | 'Pending';
  sourceEmailId?: string;
}

export interface ScheduledMeeting {
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
}

export interface ActivityLogEntry {
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
}

export interface DailyActivityOverview {
  dateKey: string;
  narrative: string;
  counts: {
    total: number;
    calls: number;
    meetings: number;
    quickbooks: number;
    gmail: number;
    whatsapp: number;
    browser: number;
    system: number;
    approvals: number;
  };
  entries: ActivityLogEntry[];
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  description: string;
  headings: string[];
  textContent: string;
  links: Array<{ text: string; href: string }>;
  formsCount: number;
  fetchedAt: string;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  source: 'server' | 'laptop-fs';
}

export interface IntegrationCredentials {
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  quickbooksRealmId: string;
  quickbooksAccessToken: string;
  quickbooksSandbox: boolean;
}

export interface VoiceSettings {
  autoSpeak: boolean;
  continuousListen: boolean;
  language: string;
  voiceURI: string;
  rate: number;
  pitch: number;
}

export interface WhatsAppQrState {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'error';
  qrDataUrl?: string | null;
  pairingCode?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
  error?: string | null;
}

export interface MountedLaptopFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  file: File;
}

