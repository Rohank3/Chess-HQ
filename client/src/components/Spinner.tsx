export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <div className="size-6 animate-spin rounded-full border-2 border-slate-700 border-t-neon-400" />
      {label ? <p className="text-sm text-slate-400">{label}</p> : null}
    </div>
  );
}
