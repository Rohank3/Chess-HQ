import { Outlet } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Navbar } from './components/Navbar';

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AuthProvider>
        <div className="min-h-dvh bg-slate-950 text-slate-200 antialiased">
          <ConnectionStatus />
          <Navbar />
          <Outlet />
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}
