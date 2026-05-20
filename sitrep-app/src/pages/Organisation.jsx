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
  mutation JoinOrganisation($id: ID!) {
    joinOrganisation(id: $id) {
      ...OrganisationFields
    }
  }
`;

const UPDATE_ORGANISATION = gql`
  ${ORGANISATION_FIELDS}
  mutation UpdateOrganisation($id: ID!, $name: String!, $description: String) {
    updateOrganisation(id: $id, name: $name, description: $description) {
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

const EMPTY_ORGANISATIONS = [];
const ACTIVE_ORGANISATION_KEY = 'sitrep.activeOrganisationId';

function OrganisationSettings({ organisation, onSave, saving }) {
  const [name, setName] = useState(organisation.name);
  const [description, setDescription] = useState(organisation.description || '');

  function handleSubmit(event) {
    event.preventDefault();
    onSave(organisation.id, { name, description });
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

  const myOrganisations = data?.myOrganisations || EMPTY_ORGANISATIONS;
  const managedOrganisations = user?.role === 'admin'
    ? data?.organisations || EMPTY_ORGANISATIONS
    : myOrganisations;
  const joinedIds = useMemo(() => new Set(myOrganisations.map(organisation => organisation.id)), [myOrganisations]);
  const availableOrganisations = (data?.organisations || []).filter(organisation => !joinedIds.has(organisation.id));
  const selectedOrganisation = managedOrganisations.find(organisation => organisation.id === selectedOrganisationId)
    || managedOrganisations[0]
    || null;
  const isOwner = selectedOrganisation
    ? user?.role === 'admin' || selectedOrganisation.currentUserRole === 'owner'
    : false;
  const ownerCount = selectedOrganisation?.members.filter(member => member.role === 'owner').length || 0;
  const canDelete = selectedOrganisation
    ? user?.role === 'admin'
      || (selectedOrganisation.currentUserRole === 'owner' && ownerCount === 1)
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
    { id: 'access', label: 'Create / join' },
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
      await joinOrganisation({ variables: { id } });
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
            const isProtectedOwner = user?.role !== 'admin'
              && member.role === 'owner'
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
                    disabled={savingRole || isProtectedOwner}
                    onChange={event => handleRoleChange(selectedOrganisation.id, member.user.id, event.target.value)}
                  >
                    <option value="owner">owner</option>
                    <option value="member">member</option>
                    <option value="guest">guest</option>
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

    if (!isOwner) {
      return (
        <div className="rdf-empty-field-pane">
          <h3>Password</h3>
          <p>Only organisation owners can view repository access credentials.</p>
        </div>
      );
    }

    return (
      <section className="organisation-detail-section">
        <div className="rdf-editor-heading">
          <h3>Password</h3>
        </div>
        <div className="organisation-repository">
          <h4>Repository access</h4>
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>{selectedOrganisation.repository || 'Not provisioned yet'}</dd>
            </div>
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
          {availableOrganisations.length === 0 ? (
            <p className="organisation-empty">No other organisations are available to join.</p>
          ) : (
            availableOrganisations.map(organisation => (
              <div className="organisation-join-row" key={organisation.id}>
                <div>
                  <strong>{organisation.name}</strong>
                  <p>{organisation.description || 'No description yet.'}</p>
                </div>
                <button type="button" disabled={joining} onClick={() => handleJoin(organisation.id)}>
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

    if (!isOwner) {
      return (
        <div className="rdf-empty-field-pane">
          <h3>Danger</h3>
          <p>Only organisation owners can delete an organisation.</p>
        </div>
      );
    }

    return (
      <section className="organisation-detail-section">
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
