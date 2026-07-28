import { useState } from 'react';
import { gql, useMutation } from '@apollo/client';
import { useAuth } from '../auth/useAuth.js';

const UPDATE_MY_ACCOUNT = gql`
  mutation UpdateMyAccount($email: String!, $name: String) {
    updateMyAccount(email: $email, name: $name) {
      id
      email
      name
      role
    }
  }
`;

const UPDATE_MY_PASSWORD = gql`
  mutation UpdateMyPassword($currentPassword: String!, $newPassword: String!) {
    updateMyPassword(currentPassword: $currentPassword, newPassword: $newPassword)
  }
`;

export default function Account() {
  // Account keeps profile, password, and role details in separate panels while
  // sharing the current user from AuthProvider.
  const { user } = useAuth();
  const [activePanel, setActivePanel] = useState('profile');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [updateMyAccount, { loading: savingProfile }] = useMutation(UPDATE_MY_ACCOUNT, {
    refetchQueries: ['Me'],
  });
  const [updateMyPassword, { loading: savingPassword }] = useMutation(UPDATE_MY_PASSWORD);

  async function handleProfileSubmit(event) {
    event.preventDefault();
    setProfileError('');
    setProfileMessage('');

    try {
      await updateMyAccount({ variables: { email, name } });
      setProfileMessage('Account details updated.');
    } catch (error) {
      setProfileError(error.message);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');

    // Confirm locally before sending the password update mutation.
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    try {
      await updateMyPassword({ variables: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated.');
    } catch (error) {
      setPasswordError(error.message);
    }
  }

  const panelOptions = [
    { id: 'profile', label: 'Profile' },
    { id: 'password', label: 'Password' },
    { id: 'role', label: 'Role' },
  ];

  function renderProfilePanel() {
    return (
      <form className="account-form account-detail-section" onSubmit={handleProfileSubmit}>
        <h3>Profile</h3>
        {profileError && <div className="error-message">{profileError}</div>}
        {profileMessage && <div className="success-message">{profileMessage}</div>}

        <label className="form-group">
          Name
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={event => setName(event.target.value)}
          />
        </label>

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

        <button type="submit" disabled={savingProfile}>
          {savingProfile ? 'Saving...' : 'Save account'}
        </button>
      </form>
    );
  }

  function renderPasswordPanel() {
    return (
      <form className="account-form account-detail-section" onSubmit={handlePasswordSubmit}>
        <h3>Password</h3>
        {passwordError && <div className="error-message">{passwordError}</div>}
        {passwordMessage && <div className="success-message">{passwordMessage}</div>}

        <label className="form-group">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            required
          />
        </label>

        <label className="form-group">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>

        <label className="form-group">
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>

        <button type="submit" disabled={savingPassword}>
          {savingPassword ? 'Updating...' : 'Update password'}
        </button>
      </form>
    );
  }

  function renderRolePanel() {
    return (
      <section className="account-detail-section">
        <div className="rdf-editor-heading">
          <h3>Role</h3>
        </div>
        <div className="organisation-repository">
          <h4>Account access</h4>
          <dl>
            <div>
              <dt>Role</dt>
              <dd>{user?.role || '-'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user?.email || '-'}</dd>
            </div>
          </dl>
        </div>
      </section>
    );
  }

  function renderActivePanel() {
    if (activePanel === 'password') return renderPasswordPanel();
    if (activePanel === 'role') return renderRolePanel();
    return renderProfilePanel();
  }

  return (
    <main className="settings-page">
      <div className="rdf-structure-window app-browser-window account-browser-window">
        <div className="rdf-window-header">
          <h2>Account</h2>
        </div>

        <aside className="rdf-class-sidebar account-sidebar">
          <div className="rdf-class-sidebar-heading">
            <h3>User</h3>
          </div>

          <div className="rdf-class-list">
            <div className="rdf-class-card selected">
              <div className="rdf-class-card-top">
                <span className="account-sidebar-user">
                  <strong>{user?.name || user?.email || 'Account'}</strong>
                  <span>{user?.email || ''}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="account-option-list" role="tablist" aria-label="Account sections">
            {panelOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className={`account-option-button${activePanel === option.id ? ' active' : ''}`}
                onClick={() => setActivePanel(option.id)}
                role="tab"
                aria-selected={activePanel === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        </aside>

        <main className="rdf-field-pane account-detail-pane">
          {renderActivePanel()}
        </main>
      </div>
    </main>
  );
}
