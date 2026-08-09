import type { SocketStatus } from '../hooks/useSocket';

// Shared between the Navbar (inline on protected pages) and the standalone
// <ConnectionStatus /> pill (public pages). Keeping the maps in one place
// stops the two UIs from drifting on a label or colour change.

export const STATUS_STYLES: Record<SocketStatus, string> = {
  idle: 'bg-slate-700 text-slate-300',
  connecting: 'bg-amber-500/20 text-amber-300',
  open: 'bg-accent-emerald/20 text-accent-emerald',
  reconnecting: 'bg-amber-500/20 text-amber-300',
  error: 'bg-accent-rose/20 text-accent-rose',
};

export const STATUS_LABEL: Record<SocketStatus, string> = {
  idle: 'Signed out',
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  error: 'Connection error',
};

export function statusDotClass(status: SocketStatus): string {
  return status === 'open'
    ? 'bg-accent-emerald shadow-[0_0_8px_2px_var(--color-accent-emerald)]'
    : 'bg-current';
}
