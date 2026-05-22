import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useAuth } from '../auth/useAuth.js';

const ORGANISATION_FIELDS = gql`
  fragment OrganisationFields on Organisation {
    id
    name
    description
    createdBy
    createdAt
    updatedAt
    repository
    repositoryUsername
    repositoryPassword
    repositoryReadUsername
    repositoryReadPassword
    joinRequiresPassword
    joinPassword
    currentUserRole
    members {
      role
      joinedAt
      user {
        id
        email
        name
      }
    }
  }
`;

const GET_ORGANISATIONS = gql`
  ${ORGANISATION_FIELDS}
  query GetOrganisations {
    organisations {
      ...OrganisationFields
    }
    myOrganisations {
      ...OrganisationFields
    }
  }
`;

const CREATE_ORGANISATION = gql`
  ${ORGANISATION_FIELDS}
  mutation CreateOrganisation($name: String!, $description: String) {
    createOrganisation(name: $name, description: $description) {
      ...OrganisationFields
    }
  }
`;

const JOIN_ORGANISATION = gql`
  ${ORGANISATION_FIELDS}
  mutation JoinOrganisation($id: ID!, $password: String) {
    joinOrganisation(id: $id, password: $password) {
      ...OrganisationFields
    }
  }
`;

const UPDATE_ORGANISATION = gql`
  ${ORGANISATION_FIELDS}
  mutation UpdateOrganisation($id: ID!, $name: String!, $description: String, $joinRequiresPassword: Boolean!) {
    updateOrganisation(id: $id, name: $name, description: $description, joinRequiresPassword: $joinRequiresPassword) {
      ...OrganisationFields
    }
  }
`;

const UPDATE_MEMBER_ROLE = gql`
  ${ORGANISATION_FIELDS}
  mutation UpdateOrganisationMemberRole($organisationId: ID!, $userId: ID!, $role: String!) {
    updateOrganisationMemberRole(organisationId: $organisationId, userId: $userId, role: $role) {
      ...OrganisationFields
    }
  }
`;

const DELETE_ORGANISATION = gql`
  mutation DeleteOrganisation($id: ID!) {
    deleteOrganisation(id: $id)
  }
`;

const LEAVE_ORGANISATION = gql`
  mutation LeaveOrganisation($id: ID!) {
    leaveOrganisation(id: $id)
  }
`;

const EMPTY_ORGANISATIONS = [];
const ACTIVE_ORGANISATION_KEY = 'sitrep.activeOrganisationId';

function OrganisationSettings({ organisation, onSave, saving }) {
  const [name, setName] = useState(organisation.name);
  const [description, setDescription] = useState(organisation.description || '');
  const [joinRequiresPassword, setJoinRequiresPassword] = useState(organisation.joinRequiresPassword);

  function handleSubmit(event) {
    event.preventDefault();
    onSave(organisation.id, { name, description, joinRequiresPassword });
  }

  return (
    <form className="organisation-settings" onSubmit={handleSubmit}>
      <h4>Organisation settings</h4>
      <label className="form-group">
        Name
        <input value={name} onChange={event => setName(event.target.value)} required />
      </label>
      <label className="form-group">
        Description
        <textarea value={description} onChange={event => setDescription(event.target.value)} rows="3" />
      </label>
      <label className="organisation-private-toggle">
        <input
          type="checkbox"
          checked={joinRequiresPassword}
          onChange={event => setJoinRequiresPassword(event.target.checked)}
        />
        Require a password to join
      </label>
      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save settings'}
      </button>
    </form>
  );
}

export default function Organisation() {
  const { user } = useAuth();
  const { data, loading, error } = useQuery(GET_ORGANISATIONS);
  const [activePanel, setActivePanel] = useState('profile');
  const [selectedOrganisationId, setSelectedOrganisationId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [joinSearch, setJoinSearch] = useState('');
  const [joinPasswords, setJoinPasswords] = useState({});
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [createOrganisation, { loading: creating }] = useMutation(CREATE_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });
  const [joinOrganisation, { loading: joining }] = useMutation(JOIN_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });
  const [updateOrganisation, { loading: savingSettings }] = useMutation(UPDATE_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });
  const [updateMemberRole, { loading: savingRole }] = useMutation(UPDATE_MEMBER_ROLE, {
    refetchQueries: ['GetOrganisations'],
  });
  const [deleteOrganisation, { loading: deletingOrganisation }] = useMutation(DELETE_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });
  const [leaveOrganisation, { loading: leavingOrganisation }] = useMutation(LEAVE_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });

  const myOrganisations = data?.myOrganisations || EMPTY_ORGANISATIONS;
  const managedOrganisations = user?.role === 'admin'
    ? data?.organisations || EMPTY_ORGANISATIONS
    : myOrganisations;
  const joinedIds = useMemo(() => new Set(myOrganisations.map(organisation => organisation.id)), [myOrganisations]);
  const availableOrganisations = (data?.organisations || []).filter(organisation => !joinedIds.has(organisation.id));
  const matchingAvailableOrganisations = availableOrganisations.filter(organisation => {
    const search = joinSearch.trim().toLowerCase();
    if (!search) return true;
    return `${organisation.name} ${organisation.description || ''}`.toLowerCase().includes(search);
  });
  const selectedOrganisation = managedOrganisations.find(organisation => organisation.id === selectedOrganisationId)
    || managedOrganisations[0]
    || null;
  const isOwner = selectedOrganisation
    ? user?.role === 'admin' || selectedOrganisation.currentUserRole === 'owner'
    : false;
  const isMember = selectedOrganisation
    ? isOwner || selectedOrganisation.currentUserRole === 'member'
    : false;
  const canViewJoinPassword = selectedOrganisation?.currentUserRole === 'owner';
  const canViewOwnerRepositoryCredentials = user?.role === 'admin'
    || selectedOrganisation?.currentUserRole === 'owner';
  const ownerCount = selectedOrganisation?.members.filter(member => member.role === 'owner').length || 0;
  const canDelete = selectedOrganisation
    ? user?.role === 'admin'
      || (selectedOrganisation.currentUserRole === 'owner' && ownerCount === 1)
    : false;
  const canLeave = selectedOrganisation
    ? selectedOrganisation.currentUserRole === 'guest'
      || selectedOrganisation.currentUserRole === 'member'
      || (selectedOrganisation.currentUserRole === 'owner' && ownerCount > 1)
    : false;
  const roleLabel = selectedOrganisation
    ? user?.role === 'admin'
      ? selectedOrganisation.currentUserRole || 'admin'
      : selectedOrganisation.currentUserRole
    : '';
  const panelOptions = [
    { id: 'profile', label: 'Profile' },
    { id: 'role', label: 'Roles' },
    { id: 'password', label: 'Credentials' },
    { id: 'danger', label: 'Danger' },
  ];

  async function handleCreate(event) {
    event.preventDefault();
    setMessage('');
    setFormError('');

    try {
      await createOrganisation({ variables: { name: newName, description: newDescription } });
      setNewName('');
      setNewDescription('');
      setMessage('Organisation created.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleJoin(id) {
    setMessage('');
    setFormError('');

    try {
      await joinOrganisation({ variables: { id, password: joinPasswords[id] || null } });
      setMessage('Joined organisation.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleSettingsSave(id, values) {
    setMessage('');
    setFormError('');

    try {
      await updateOrganisation({ variables: { id, ...values } });
      setMessage('Organisation settings updated.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleRoleChange(organisationId, memberUserId, role) {
    setMessage('');
    setFormError('');

    try {
      await updateMemberRole({ variables: { organisationId, userId: memberUserId, role } });
      setMessage('Role updated.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleDeleteOrganisation(organisation) {
    setMessage('');
    setFormError('');

    const confirmed = window.confirm(
      `Delete "${organisation.name}"?\n\nEverything in this organisation will be deleted permanently and cannot be recovered.`
    );
    if (!confirmed) return;

    try {
      await deleteOrganisation({ variables: { id: organisation.id } });
      if (localStorage.getItem(ACTIVE_ORGANISATION_KEY) === organisation.id) {
        localStorage.removeItem(ACTIVE_ORGANISATION_KEY);
      }
      setSelectedOrganisationId('');
      setActivePanel('profile');
      setMessage('Organisation deleted.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleLeaveOrganisation(organisation) {
    setMessage('');
    setFormError('');

    const confirmed = window.confirm(`Leave "${organisation.name}"?`);
    if (!confirmed) return;

    try {
      await leaveOrganisation({ variables: { id: organisation.id } });
      if (localStorage.getItem(ACTIVE_ORGANISATION_KEY) === organisation.id) {
        localStorage.removeItem(ACTIVE_ORGANISATION_KEY);
      }
      setSelectedOrganisationId('');
      setActivePanel('profile');
      setMessage('Left organisation.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  if (loading) return <main className="organisation-page">Loading organisations...</main>;

  function renderProfilePanel() {
    if (!selectedOrganisation) {
      return (
        <div className="rdf-empty-field-pane">
          <h3>No organisation selected</h3>
          <p>Create or join an organisation to edit its profile.</p>
        </div>
      );
    }

    return (
      <section className="organisation-detail-section">
        <div className="organisation-card-header organisation-detail-header">
          <div>
            <h3>{selectedOrganisation.name}</h3>
            <p>{selectedOrganisation.description || 'No description yet.'}</p>
          </div>
          <span className={`organisation-role ${roleLabel}`}>{roleLabel}</span>
        </div>

        {isOwner ? (
          <OrganisationSettings
            key={selectedOrganisation.id}
            organisation={selectedOrganisation}
            onSave={handleSettingsSave}
            saving={savingSettings}
          />
        ) : (
          <div className="organisation-repository">
            <h4>Profile</h4>
            <dl>
              <div>
                <dt>Name</dt>
                <dd>{selectedOrganisation.name}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd>{selectedOrganisation.description || 'No description yet.'}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    );
  }

  function renderRolePanel() {
    if (!selectedOrganisation) {
      return (
        <div className="rdf-empty-field-pane">
          <h3>No organisation selected</h3>
          <p>Create or join an organisation to manage roles.</p>
        </div>
      );
    }

    return (
      <section className="organisation-detail-section">
        <div className="rdf-editor-heading">
          <h3>Roles</h3>
        </div>
        <div className="organisation-members">
          {selectedOrganisation.members.map(member => {
            const canPromoteGuest = !isOwner
              && selectedOrganisation.currentUserRole === 'member'
              && member.role === 'guest'
              && member.user.id !== user.id;
            return (
              <div className="organisation-member-row" key={member.user.id}>
                <div className="organisation-member-main">
                  <strong>{member.user.name || member.user.email}</strong>
                  <span>{member.user.email}</span>
                </div>
                {isOwner ? (
                  <select
                    value={member.role}
                    disabled={savingRole}
                    onChange={event => handleRoleChange(selectedOrganisation.id, member.user.id, event.target.value)}
                  >
                    <option value="owner">owner</option>
                    <option value="member">member</option>
                    <option value="guest">guest</option>
                  </select>
                ) : canPromoteGuest ? (
                  <select
                    value={member.role}
                    disabled={savingRole}
                    onChange={event => handleRoleChange(selectedOrganisation.id, member.user.id, event.target.value)}
                  >
                    <option value="guest">guest</option>
                    <option value="member">member</option>
                  </select>
                ) : (
                  <span className={`organisation-role ${member.role}`}>{member.role}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function renderPasswordPanel() {
    if (!selectedOrganisation) {
      return (
        <div className="rdf-empty-field-pane">
          <h3>No organisation selected</h3>
          <p>Create or join an organisation to view access details.</p>
        </div>
      );
    }

    if (!isMember) {
      return (
        <div className="rdf-empty-field-pane">
          <h3>Credentials</h3>
          <p>Only organisation members and owners can view repository access credentials.</p>
        </div>
      );
    }

    return (
      <section className="organisation-detail-section">
        <div className="rdf-editor-heading">
          <h3>Credentials</h3>
        </div>
        <div className="organisation-repository">
          <h4>Repository access</h4>
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>{selectedOrganisation.repository || 'Not provisioned yet'}</dd>
            </div>
            <div>
              <dt>Web view</dt>
              <dd>
                <a href="https://agraph.fairdatasphere.com" target="_blank" rel="noreferrer">
                  agraph.fairdatasphere.com
                </a>
              </dd>
            </div>
          </dl>
        </div>
        <div className="organisation-repository">
          <h4>Member read-only access</h4>
          <dl>
            <div>
              <dt>Username</dt>
              <dd>{selectedOrganisation.repositoryReadUsername || '-'}</dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd>{selectedOrganisation.repositoryReadPassword || '-'}</dd>
            </div>
          </dl>
        </div>
        {canViewOwnerRepositoryCredentials && (
          <div className="organisation-repository">
            <h4>Owner read/write access</h4>
            <dl>
              <div>
                <dt>Username</dt>
                <dd>{selectedOrganisation.repositoryUsername || '-'}</dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd>{selectedOrganisation.repositoryPassword || '-'}</dd>
              </div>
            </dl>
          </div>
        )}
        {canViewJoinPassword && (
          <div className="organisation-repository">
            <h4>Join access</h4>
            <dl>
              <div>
                <dt>Password</dt>
                <dd>
                  {selectedOrganisation.joinRequiresPassword
                    ? selectedOrganisation.joinPassword || 'Private password unavailable'
                    : 'Open to join'}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    );
  }

  function renderAccessPanel() {
    return (
      <section className="organisation-detail-section organisation-access-grid">
        <form className="organisation-form" onSubmit={handleCreate}>
          <h3>Start an organisation</h3>
          <label className="form-group">
            Name
            <input value={newName} onChange={event => setNewName(event.target.value)} required />
          </label>
          <label className="form-group">
            Description
            <textarea value={newDescription} onChange={event => setNewDescription(event.target.value)} rows="3" />
          </label>
          <button type="submit" disabled={creating}>
            {creating ? 'Creating...' : 'Create organisation'}
          </button>
        </form>

        <div className="organisation-join-list">
          <h3>Join an organisation</h3>
          <label className="form-group organisation-join-search">
            Search
            <input
              value={joinSearch}
              onChange={event => setJoinSearch(event.target.value)}
              placeholder="Search organisations"
            />
          </label>
          {availableOrganisations.length === 0 ? (
            <p className="organisation-empty">No other organisations are available to join.</p>
          ) : matchingAvailableOrganisations.length === 0 ? (
            <p className="organisation-empty">No organisations match your search.</p>
          ) : (
            matchingAvailableOrganisations.map(organisation => (
              <div className="organisation-join-row" key={organisation.id}>
                <div>
                  <strong>{organisation.name}</strong>
                  <p>{organisation.description || 'No description yet.'}</p>
                  {organisation.joinRequiresPassword && (
                    <label className="form-group organisation-join-password">
                      Join password
                      <input
                        type="password"
                        value={joinPasswords[organisation.id] || ''}
                        onChange={event => setJoinPasswords(current => ({
                          ...current,
                          [organisation.id]: event.target.value,
                        }))}
                        required
                      />
                    </label>
                  )}
                </div>
                <button
                  type="button"
                  disabled={joining || (organisation.joinRequiresPassword && !joinPasswords[organisation.id])}
                  onClick={() => handleJoin(organisation.id)}
                >
                  Join
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderDangerPanel() {
    if (!selectedOrganisation) {
      return (
        <div className="rdf-empty-field-pane">
          <h3>No organisation selected</h3>
          <p>Create or join an organisation before using danger-zone actions.</p>
        </div>
      );
    }

    return (
      <section className="organisation-detail-section">
        {selectedOrganisation.currentUserRole && (
          <div className="organisation-danger-zone">
            <h4>Leave organisation</h4>
            <p>You will lose access to this organisation unless you join it again.</p>
            <button
              type="button"
              className="organisation-delete-button"
              disabled={leavingOrganisation || !canLeave}
              title={!canLeave ? 'The last owner cannot leave an organisation.' : undefined}
              onClick={() => handleLeaveOrganisation(selectedOrganisation)}
            >
              {leavingOrganisation ? 'Leaving...' : 'Leave organisation'}
            </button>
          </div>
        )}

        {!isOwner && (
          <div className="rdf-empty-field-pane">
            <h3>Delete organisation</h3>
            <p>Only organisation owners can delete an organisation.</p>
          </div>
        )}

        {isOwner && (
          <div className="organisation-danger-zone">
            <h4>Delete organisation</h4>
            <p>This permanently deletes the organisation and its data.</p>
            <button
              type="button"
              className="organisation-delete-button"
              disabled={deletingOrganisation || !canDelete}
              title={!canDelete ? 'Only the sole owner can delete an organisation.' : undefined}
              onClick={() => handleDeleteOrganisation(selectedOrganisation)}
            >
              {deletingOrganisation ? 'Deleting...' : 'Delete organisation'}
            </button>
          </div>
        )}
      </section>
    );
  }

  function renderActivePanel() {
    if (activePanel === 'role') return renderRolePanel();
    if (activePanel === 'password') return renderPasswordPanel();
    if (activePanel === 'access') return renderAccessPanel();
    if (activePanel === 'danger') return renderDangerPanel();
    return renderProfilePanel();
  }

  return (
    <main className="settings-page">
      <div className="rdf-structure-window app-browser-window organisation-browser-window">
        <div className="rdf-window-header">
          <h2>Organisation</h2>
          {(error || formError) && <div className="error-message">{formError || error.message}</div>}
          {message && <div className="success-message">{message}</div>}
        </div>

        <aside className="rdf-class-sidebar organisation-sidebar">
          <div className="rdf-class-sidebar-heading">
            <h3>{user?.role === 'admin' ? 'Organisations' : 'Your organisations'}</h3>
          </div>

          <div className="rdf-class-list">
            {managedOrganisations.length === 0 ? (
              <p className="organisation-empty">
                {user?.role === 'admin'
                  ? 'No organisations have been created yet.'
                  : 'You are not part of any organisation yet.'}
              </p>
            ) : (
              managedOrganisations.map(organisation => (
                <div
                  key={organisation.id}
                  className={`rdf-class-card${organisation.id === selectedOrganisation?.id ? ' selected' : ''}`}
                >
                  <div className="rdf-class-card-top">
                    <button
                      type="button"
                      className="rdf-class-nav-button"
                      onClick={() => setSelectedOrganisationId(organisation.id)}
                      aria-current={organisation.id === selectedOrganisation?.id ? 'page' : undefined}
                    >
                      {organisation.name}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            className={`organisation-access-button${activePanel === 'access' ? ' active' : ''}`}
            onClick={() => setActivePanel('access')}
            aria-pressed={activePanel === 'access'}
          >
            Create / join
          </button>

          <div className="organisation-option-list" role="tablist" aria-label="Organisation sections">
            {panelOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className={`organisation-option-button${activePanel === option.id ? ' active' : ''}`}
                onClick={() => setActivePanel(option.id)}
                role="tab"
                aria-selected={activePanel === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        </aside>

        <main className="rdf-field-pane organisation-detail-pane">
          {renderActivePanel()}
        </main>
      </div>
    </main>
  );
}
