import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { http } from '../api/http';
import { Spinner } from '../components/Spinner';

type Status = 'verifying' | 'verified' | 'failed';

/**
 * /verify-email?token=… — the destination of the emailed verification link.
 * Consumes the token once on mount and reports success (or offers a resend
 * for an invalid/expired link). No auth required: the token is the proof of
 * email ownership.
 */
export function VerifyEmail(): React.JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>('verifying');

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus('failed');
      return;
    }
    http
      .post('/api/auth/verify-email', { token })
      .then(() => {
        if (!cancelled) setStatus('verified');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span
            aria-hidden
            className="size-2 rounded-full bg-neon-400 shadow-[0_0_10px_3px_var(--color-neon-400)]"
          />
          <span className="text-sm font-semibold tracking-[0.25em] text-slate-200 uppercase">
            Chess-HQ
          </span>
        </div>

        {status === 'verifying' && (
          <>
            <h1 className="text-2xl font-semibold text-slate-100">Verifying your email…</h1>
            <div className="mt-6 flex justify-center">
              <Spinner label="Verifying your email…" />
            </div>
          </>
        )}

        {status === 'verified' && (
          <>
            <h1 className="text-2xl font-semibold text-slate-100">Email verified</h1>
            <p className="mt-2 text-sm text-slate-400">
              Your email is confirmed. You can now reset your password from the login page if you
              ever forget it.
            </p>
            <Link
              to="/"
              className="mt-6 inline-block rounded-lg bg-neon-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400"
            >
              Back to Chess-HQ
            </Link>
          </>
        )}

        {status === 'failed' && (
          <>
            <h1 className="text-2xl font-semibold text-slate-100">Link invalid or expired</h1>
            <p className="mt-2 text-sm text-slate-400">
              This verification link isn't valid anymore. Verification links expire after 24
              hours, and each one can only be used once.
            </p>
            <Link
              to="/verify-email-sent"
              className="mt-6 inline-block rounded-lg bg-neon-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400"
            >
              Send me a new link
            </Link>
            <p className="mt-4 text-sm text-slate-400">
              <Link to="/login" className="text-neon-400 hover:text-neon-500">
                Sign in
              </Link>{' '}
              once your email is verified.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
