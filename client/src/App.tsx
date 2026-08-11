import { Outlet } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { ActivityProvider } from './context/ActivityContext';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Navbar } from './components/Navbar';
import { ActiveGameWatcher } from './components/ActiveGameWatcher';

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AuthProvider>
        <ActivityProvider>
          <div className="min-h-dvh bg-slate-950 text-slate-200 antialiased">
            <ConnectionStatus />
            <ActiveGameWatcher />
            <Navbar />
            <Outlet />
          </div>
        </ActivityProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
