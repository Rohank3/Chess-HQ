import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { ToastViewport } from './ToastViewport';

const STATUS_STYLES: Record<string, string> = {
  idle: 'bg-slate-700 text-slate-300',
  connecting: 'bg-amber-500/20 text-amber-300',
  open: 'bg-accent-emerald/20 text-accent-emerald',
  reconnecting: 'bg-amber-500/20 text-amber-300',
  error: 'bg-accent-rose/20 text-accent-rose',
};

const STATUS_LABEL: Record<string, string> = {
  idle: 'Signed out',
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  error: 'Connection error',
};

export function ConnectionStatus(): React.JSX.Element {
  const { user } = useAuth();
  const { status } = useSocket();

  if (!user) return <ToastViewport />;

  return (
    <>
      <div className="fixed top-4 right-4 z-40">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            STATUS_STYLES[status] ?? STATUS_STYLES.idle
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              status === 'open'
                ? 'bg-accent-emerald shadow-[0_0_8px_2px_var(--color-accent-emerald)]'
                : 'bg-current'
            }`}
          />
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>
      <ToastViewport />
    </>
  );
}
