import { useToast, type ToastKind } from '../context/ToastContext';

const KIND_STYLES: Record<ToastKind, string> = {
  info: 'border-slate-700 bg-slate-900/80 text-slate-200',
  success: 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  error: 'border-accent-rose/40 bg-accent-rose/10 text-accent-rose',
};

export function ToastViewport(): React.JSX.Element {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur-sm ${
            KIND_STYLES[t.kind] ?? KIND_STYLES.info
          }`}
          role="status"
        >
          <span>{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-current/60 transition hover:text-current"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
