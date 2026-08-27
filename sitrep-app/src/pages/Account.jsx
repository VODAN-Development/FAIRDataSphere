import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
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

const USERS = gql`
  query Users {
    users {
      id
      email
      name
      role
    }
  }
`;

const DELETE_USER = gql`
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id) {
      id
      email
      name
      role
    }
  }
`;

export default function Account() {
  // Account keeps profile, password, and role details in separate panels while
  // sharing the current user from AuthProvider.
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [activePanel, setActivePanel] = useState('profile');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [adminError, setAdminError] = useState('');
  const [updateMyAccount, { loading: savingProfile }] = useMutation(UPDATE_MY_ACCOUNT, {
    refetchQueries: ['Me'],
  });
  const [updateMyPassword, { loading: savingPassword }] = useMutation(UPDATE_MY_PASSWORD);
  const { data: usersData, loading: usersLoading } = useQuery(USERS, {
    skip: !isAdmin,
  });
  const [deleteUser, { loading: deletingUser }] = useMutation(DELETE_USER, {
    refetchQueries: ['Users', 'Organisations', 'MyOrganisations'],
  });

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

  async function handleDeleteUserSubmit(event) {
    event.preventDefault();
    setAdminError('');
    setAdminMessage('');

    const selectedUser = usersData?.users?.find(candidate => candidate.id === selectedUserId);
    if (!selectedUser) {
      setAdminError('Select a user to delete.');
      return;
    }
    if (selectedUser.id === user.id) {
      setAdminError('You cannot delete your own account.');
      return;
    }
    if (deleteConfirmation.trim().toLowerCase() !== selectedUser.email.toLowerCase()) {
      setAdminError('Type the user email address to confirm deletion.');
      return;
    }

    try {
      await deleteUser({ variables: { id: selectedUser.id } });
      setSelectedUserId('');
      setDeleteConfirmation('');
      setAdminMessage(`${selectedUser.email} was deleted.`);
    } catch (error) {
      setAdminError(error.message);
    }
  }

  const panelOptions = [
    { id: 'profile', label: 'Profile' },
    { id: 'password', label: 'Password' },
    { id: 'role', label: 'Role' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin options' }] : []),
  ];

  const selectableUsers = (usersData?.users || []).filter(candidate => candidate.id !== user?.id);
  const selectedUser = selectableUsers.find(candidate => candidate.id === selectedUserId);
  const visiblePanel = activePanel === 'admin' && !isAdmin ? 'profile' : activePanel;

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

  function renderAdminPanel() {
    return (
      <section className="account-detail-section">
        <div className="rdf-editor-heading">
          <h3>Admin options</h3>
        </div>

        <form className="account-admin-panel" onSubmit={handleDeleteUserSubmit}>
          <h4>Delete user</h4>
          {adminError && <div className="error-message">{adminError}</div>}
          {adminMessage && <div className="success-message">{adminMessage}</div>}

          <label className="form-group">
            User
            <select
              value={selectedUserId}
              onChange={event => {
                setSelectedUserId(event.target.value);
                setDeleteConfirmation('');
                setAdminError('');
                setAdminMessage('');
              }}
              disabled={usersLoading || deletingUser}
              required
            >
              <option value="">{usersLoading ? 'Loading users...' : 'Select a user'}</option>
              {selectableUsers.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name ? `${candidate.name} - ${candidate.email}` : candidate.email} ({candidate.role})
                </option>
              ))}
            </select>
          </label>

          {selectedUser && (
            <div className="account-delete-summary">
              <strong>{selectedUser.name || selectedUser.email}</strong>
              <span>{selectedUser.email}</span>
              <span>{selectedUser.role}</span>
            </div>
          )}

          <label className="form-group">
            Confirm email
            <input
              type="text"
              value={deleteConfirmation}
              onChange={event => setDeleteConfirmation(event.target.value)}
              placeholder={selectedUser?.email || ''}
              disabled={!selectedUser || deletingUser}
              required
            />
          </label>

          <button
            type="submit"
            className="account-delete-button"
            disabled={!selectedUser || deletingUser}
          >
            {deletingUser ? 'Deleting...' : 'Delete user'}
          </button>
        </form>
      </section>
    );
  }

  function renderActivePanel() {
    if (visiblePanel === 'admin' && isAdmin) return renderAdminPanel();
    if (visiblePanel === 'password') return renderPasswordPanel();
    if (visiblePanel === 'role') return renderRolePanel();
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
                className={`account-option-button${visiblePanel === option.id ? ' active' : ''}`}
                onClick={() => setActivePanel(option.id)}
                role="tab"
                aria-selected={visiblePanel === option.id}
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
