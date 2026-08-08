import { Outlet } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { ConnectionStatus } from './components/ConnectionStatus';

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AuthProvider>
        <div className="min-h-dvh bg-slate-950 text-slate-200 antialiased">
          <ConnectionStatus />
          <Outlet />
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}
