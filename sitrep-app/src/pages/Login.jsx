import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

export default function Login() {
  // Login redirects back to the protected route that sent the user here.
  const { user, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const redirectTo = location.state?.from?.pathname || '/reports';

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(event) {
    // signIn sets the server-side cookie through AuthProvider, then navigation
    // returns the user to their intended destination.
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await signIn({ email, password });
      navigate(redirectTo, { replace: true });
    } catch (submissionError) {
      setError(submissionError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h2>Sign in</h2>
        {error && <div className="error-message">{error}</div>}

        <label className="form-group">
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="form-group">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="auth-switch">
          Need an account? <Link to="/signup">Create one</Link>
        </p>
      </form>
    </main>
  );
}
