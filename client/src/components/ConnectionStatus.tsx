import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import { ToastViewport } from './ToastViewport';
import { STATUS_LABEL, STATUS_STYLES, statusDotClass } from './connectionStyles';

/**
 * Renders the fixed top-right connection pill only when the user is
 * signed out (public pages have no Navbar). When signed in, the Navbar
 * owns the inline connection indicator, so this component just mounts the
 * toast viewport -- there's never two fixed connection pills on one screen.
 */
export function ConnectionStatus(): React.JSX.Element {
  const { user } = useAuth();
  const { status } = useSocket();

  if (!user) {
    // Signed out: keep the existing fixed pill on public pages so a
    // reconnecting visitor still sees connection state without a Navbar.
    return (
      <>
        <div className="fixed top-4 right-4 z-40">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              STATUS_STYLES[status]
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${statusDotClass(status)}`}
              aria-hidden
            />
            {STATUS_LABEL[status]}
          </span>
        </div>
        <ToastViewport />
      </>
    );
  }

  return <ToastViewport />;
}
