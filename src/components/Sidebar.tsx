import React from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Mail,
  Phone,
  Receipt,
  Globe,
  Laptop,
  Cpu,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import type { GoogleAccountProfile } from '../services/firebaseAuth';
import type { WorkspaceTab } from '../types';

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  pendingApprovalCount: number;
  googleUser: GoogleAccountProfile | null;
  gmailConnected: boolean;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
  isSigningIn: boolean;
  providerLabel: string;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'command', label: 'Command Center', icon: LayoutDashboard },
  { id: 'overview', label: 'Daily Overview', icon: ClipboardList },
  { id: 'employees', label: 'Digital Employees', icon: Users },
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'comms', label: 'WhatsApp & Calls', icon: Phone },
  { id: 'quickbooks', label: 'QuickBooks', icon: Receipt },
  { id: 'browser', label: 'Web Browser', icon: Globe },
  { id: 'system', label: 'Laptop & Files', icon: Laptop },
  { id: 'models', label: 'Models & Voice', icon: Cpu },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  pendingApprovalCount,
  googleUser,
  gmailConnected,
  onGoogleSignIn,
  onGoogleSignOut,
  isSigningIn,
  providerLabel,
}) => {
  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between">
      <div>
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap">
            Azaris
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[115px]">{providerLabel}</span>
        </div>

        <nav className="p-3 space-y-1" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'command' && pendingApprovalCount > 0 && (
                  <span className="font-mono tabular-nums text-xs font-semibold text-amber-600 dark:text-amber-300">
                    {pendingApprovalCount}
                  </span>
                )}
                {item.id === 'gmail' && (
                  <span className="text-[11px] text-slate-400 dark:text-slate-400">
                    {gmailConnected ? 'Live' : 'Off'}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
        {googleUser && gmailConnected ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {googleUser.photoURL ? (
                <img
                  src={googleUser.photoURL}
                  alt={googleUser.displayName || 'Google Account'}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold shrink-0">
                  {(googleUser.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {googleUser.displayName || 'Google Workspace'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {googleUser.email}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onGoogleSignOut}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect Google
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={isSigningIn}
              className="gsi-material-button w-full"
            >
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isSigningIn ? 'Connecting...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
            <a
              href={typeof window !== 'undefined' ? window.location.href : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              <ExternalLink className="w-3 h-3" />
              Open standalone tab for popups
            </a>
          </>
        )}
      </div>
    </aside>
  );
};
