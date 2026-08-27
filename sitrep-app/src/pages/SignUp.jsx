import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAEeEXKtO-6WeBaTo';

export default function SignUp() {
  // Sign-up first proves the browser with Turnstile, then verifies email with a
  // one-time code before creating the session-backed account.
  const { user, requestSignUpCode, signUp } = useAuth();
  const navigate = useNavigate();
  const turnstileRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return undefined;

    let cancelled = false;
    function renderTurnstile() {
      if (cancelled || !window.turnstile || !turnstileRef.current || turnstileWidgetIdRef.current) return;
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action: 'signup',
        callback: token => setCaptchaToken(token),
        'expired-callback': () => setCaptchaToken(''),
        'error-callback': () => setCaptchaToken(''),
      });
    }

    if (window.turnstile) {
      renderTurnstile();
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = renderTurnstile;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    };
  }, []);

  if (user) {
    return <Navigate to="/reports" replace />;
  }

  function resetCaptcha() {
    setCaptchaToken('');
    if (window.turnstile && turnstileWidgetIdRef.current) {
      window.turnstile.reset(turnstileWidgetIdRef.current);
    }
  }

  async function handleRequestCode(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!captchaToken) {
      setError('Please complete the captcha.');
      return;
    }
    setSubmitting(true);
    try {
      await requestSignUpCode({ email, password, name, captchaToken });
      setCodeSent(true);
      setMessage('Check your email for a one-time code.');
    } catch (submissionError) {
      setError(submissionError.message);
    } finally {
      setSubmitting(false);
      resetCaptcha();
    }
  }

  async function handleVerifyCode(event) {
    // AuthProvider refetches /me after sign-up so protected routes see the new
    // user before navigation completes.
    event.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      await signUp({ email, password, name, verificationCode });
      navigate('/reports', { replace: true });
    } catch (submissionError) {
      setError(submissionError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={codeSent ? handleVerifyCode : handleRequestCode}>
        <h2>Create account</h2>
        {error && <div className="error-message">{error}</div>}
        {message && <div className="success-message">{message}</div>}

        <label className="form-group">
          Name
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={event => setName(event.target.value)}
            disabled={codeSent}
          />
        </label>

        <label className="form-group">
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            disabled={codeSent}
            required
          />
        </label>

        <label className="form-group">
          Password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            minLength={8}
            disabled={codeSent}
            required
          />
        </label>

        {!codeSent && (
          <div className="turnstile-widget" ref={turnstileRef} />
        )}

        {codeSent && (
          <label className="form-group">
            One-time code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={verificationCode}
              onChange={event => setVerificationCode(event.target.value)}
              minLength={6}
              maxLength={6}
              required
            />
          </label>
        )}

        <button type="submit" disabled={submitting}>
          {submitting
            ? codeSent ? 'Verifying...' : 'Sending code...'
            : codeSent ? 'Verify code and create account' : 'Send verification code'}
        </button>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
