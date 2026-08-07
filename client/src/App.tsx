import { Outlet } from 'react-router-dom';

export function App(): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-200 antialiased">
      <Outlet />
    </div>
  );
}
