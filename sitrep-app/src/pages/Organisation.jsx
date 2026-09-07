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
    repositoryStatus
    repositoryProvisioningError
    joinRequiresPassword
    joinPassword
    currentUserRole
    currentUserPermissions {
      appRead
      appWrite
      manageOrganisation
      manageRoles
      promoteGuests
      viewJoinPassword
    }
    roles {
      id
      name
      builtIn
      permissions {
        appRead
        appWrite
        manageOrganisation
        manageRoles
        promoteGuests
        viewJoinPassword
      }
    }
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
  mutation CreateOrganisation($name: String!, $description: String, $joinRequiresPassword: Boolean, $joinPassword: String) {
    createOrganisation(name: $name, description: $description, joinRequiresPassword: $joinRequiresPassword, joinPassword: $joinPassword) {
      ...OrganisationFields
    }
  }
`;

const PROVISION_ORGANISATION_REPOSITORY = gql`
  ${ORGANISATION_FIELDS}
  mutation ProvisionOrganisationRepository($id: ID!) {
    provisionOrganisationRepository(id: $id) {
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
  mutation UpdateOrganisation($id: ID!, $name: String!, $description: String, $joinRequiresPassword: Boolean!, $joinPassword: String) {
    updateOrganisation(id: $id, name: $name, description: $description, joinRequiresPassword: $joinRequiresPassword, joinPassword: $joinPassword) {
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

const UPSERT_ORGANISATION_ROLE = gql`
  ${ORGANISATION_FIELDS}
  mutation UpsertOrganisationRole($organisationId: ID!, $id: ID, $name: String!, $permissions: OrganisationRolePermissionsInput!) {
    upsertOrganisationRole(organisationId: $organisationId, id: $id, name: $name, permissions: $permissions) {
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

const GET_URI_MIGRATION_STATUS = gql`
  query GetUriMigrationStatus($organisationId: ID!) {
    rdfUriMigrationStatus(organisationId: $organisationId) {
      organisationId
      needsMigration
      currentTemplates
      targetTemplates
      predicateChanges
      affectedTriples
    }
  }
`;

const MIGRATE_ORGANISATION_URIS = gql`
  mutation MigrateOrganisationUris($organisationId: ID!) {
    migrateOrganisationUris(organisationId: $organisationId) {
      organisationId
      needsMigration
      currentTemplates
      targetTemplates
      predicateChanges
      affectedTriples
    }
  }
`;

const EMPTY_ORGANISATIONS = [];
const ACTIVE_ORGANISATION_KEY = 'sitrep.activeOrganisationId';
const ROLE_PERMISSION_FIELDS = [
  ['appRead', 'View app data'],
  ['appWrite', 'Create and edit app data'],
  ['manageOrganisation', 'Manage organisation settings'],
  ['manageRoles', 'Manage roles and members'],
  ['promoteGuests', 'Promote guests to members'],
  ['viewJoinPassword', 'View join password'],
];

function permissionInput(permissions = {}) {
  return Object.fromEntries(ROLE_PERMISSION_FIELDS.map(([key]) => [key, !!permissions[key]]));
}

function OrganisationSettings({ organisation, onSave, saving }) {
  // Local form state lets owners edit organisation metadata before saving it to
  // the backend.
  const [name, setName] = useState(organisation.name);
  const [description, setDescription] = useState(organisation.description || '');
  const [joinRequiresPassword, setJoinRequiresPassword] = useState(organisation.joinRequiresPassword);
  const [joinPassword, setJoinPassword] = useState('');
  const canViewJoinPassword = !!organisation.joinPassword;

  function handleSubmit(event) {
    event.preventDefault();
    onSave(organisation.id, {
      name,
      description,
      joinRequiresPassword,
      joinPassword: joinPassword || null,
    });
    setJoinPassword('');
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
      {joinRequiresPassword && (
        <>
          {canViewJoinPassword && (
            <label className="form-group">
              Current join password
              <input value={organisation.joinPassword} readOnly />
            </label>
          )}
          <label className="form-group">
            {organisation.joinRequiresPassword ? 'New join password' : 'Join password'}
            <input
              type="password"
              value={joinPassword}
              onChange={event => setJoinPassword(event.target.value)}
              minLength="8"
              required={!organisation.joinRequiresPassword}
              placeholder={organisation.joinRequiresPassword ? 'Leave blank to keep current password' : ''}
            />
          </label>
        </>
      )}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save settings'}
      </button>
    </form>
  );
}

function RoleEditor({ role, canManageRoles, onSave, saving }) {
  const [name, setName] = useState(role.name);
  const [permissions, setPermissions] = useState(role.permissions);

  function handleSubmit(event) {
    event.preventDefault();
    onSave(role.id, name, permissions);
  }

  function setPermission(key, value) {
    setPermissions(current => ({
      ...current,
      [key]: value,
      ...(key === 'appWrite' && value ? { appRead: true } : {}),
    }));
  }

  return (
    <form className="organisation-role-editor" onSubmit={handleSubmit}>
      <div className="organisation-role-editor-header">
        <label className="form-group">
          Role name
          <input
            value={name}
            disabled={!canManageRoles || role.builtIn}
            onChange={event => setName(event.target.value)}
            required
          />
        </label>
        <span className={`organisation-role ${role.id}`}>{role.id}</span>
      </div>

      <div className="organisation-permission-grid">
        {ROLE_PERMISSION_FIELDS.map(([key, label]) => (
          <label className="organisation-permission-toggle" key={key}>
            <input
              type="checkbox"
              checked={!!permissions[key]}
              disabled={!canManageRoles || (role.id === 'owner' && [
                'appRead',
                'appWrite',
                'manageOrganisation',
                'manageRoles',
              ].includes(key))}
              onChange={event => setPermission(key, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>

      {canManageRoles && (
        <button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save role'}
        </button>
      )}
    </form>
  );
}

export default function Organisation() {
  // Organisation handles creation, joining, member role management, repository
  // credential visibility, and active organisation selection.
  const { user } = useAuth();
  const { data, loading, error } = useQuery(GET_ORGANISATIONS);
  const [activePanel, setActivePanel] = useState('profile');
  const [selectedOrganisationId, setSelectedOrganisationId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newJoinRequiresPassword, setNewJoinRequiresPassword] = useState(false);
  const [newJoinPassword, setNewJoinPassword] = useState('');
  const [joinSearch, setJoinSearch] = useState('');
  const [joinPasswords, setJoinPasswords] = useState({});
  const [selectedRoleId, setSelectedRoleId] = useState('owner');
  const [newRoleName, setNewRoleName] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const { data: migrationData, loading: migrationStatusLoading, refetch: refetchMigrationStatus } = useQuery(GET_URI_MIGRATION_STATUS, {
    variables: { organisationId: selectedOrganisationId },
    skip: user?.role !== 'admin' || !selectedOrganisationId,
  });
  const [createOrganisation, { loading: creating }] = useMutation(CREATE_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });
  const [provisionOrganisationRepository, { loading: provisioningRepository }] = useMutation(PROVISION_ORGANISATION_REPOSITORY, {
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
  const [upsertOrganisationRole, { loading: savingRoleDefinition }] = useMutation(UPSERT_ORGANISATION_ROLE, {
    refetchQueries: ['GetOrganisations'],
  });
  const [deleteOrganisation, { loading: deletingOrganisation }] = useMutation(DELETE_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });
  const [leaveOrganisation, { loading: leavingOrganisation }] = useMutation(LEAVE_ORGANISATION, {
    refetchQueries: ['GetOrganisations'],
  });
  const [migrateOrganisationUris, { loading: migratingUris }] = useMutation(MIGRATE_ORGANISATION_URIS);

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
    ? user?.role === 'admin' || !!selectedOrganisation.currentUserPermissions?.manageOrganisation
    : false;
  const canManageRoles = selectedOrganisation
    ? user?.role === 'admin' || !!selectedOrganisation.currentUserPermissions?.manageRoles
    : false;
  const ownerCount = selectedOrganisation?.members.filter(member => member.role === 'owner').length || 0;
  const canDelete = selectedOrganisation
    ? user?.role === 'admin'
      || (selectedOrganisation.currentUserRole === 'owner' && ownerCount === 1)
    : false;
  const canLeave = selectedOrganisation
    ? selectedOrganisation.currentUserRole !== 'owner'
      || ownerCount > 1
    : false;
  const roleLabel = selectedOrganisation
    ? user?.role === 'admin'
      ? selectedOrganisation.currentUserRole || 'admin'
      : selectedOrganisation.currentUserRole
    : '';
  const selectedRole = selectedOrganisation?.roles.find(role => role.id === selectedRoleId)
    || selectedOrganisation?.roles[0]
    || null;
  const panelOptions = [
    { id: 'profile', label: 'Profile' },
    { id: 'role', label: 'Roles' },
    ...(user?.role === 'admin' ? [{ id: 'migration', label: 'URI migration' }] : []),
    { id: 'danger', label: 'Danger' },
  ];

  async function handleCreate(event) {
    event.preventDefault();
    setMessage('');
    setFormError('');

    try {
      const result = await createOrganisation({
        variables: {
          name: newName,
          description: newDescription,
          joinRequiresPassword: newJoinRequiresPassword,
          joinPassword: newJoinRequiresPassword ? newJoinPassword : null,
        },
      });
      const createdOrganisation = result.data?.createOrganisation;
      setNewName('');
      setNewDescription('');
      setNewJoinRequiresPassword(false);
      setNewJoinPassword('');
      setMessage(createdOrganisation?.repositoryStatus === 'ready'
        ? 'Organisation created.'
        : 'Organisation created. Its data repository is pending because repository capacity is currently full.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleProvisionRepository(organisation) {
    setMessage('');
    setFormError('');

    try {
      const result = await provisionOrganisationRepository({ variables: { id: organisation.id } });
      const nextOrganisation = result.data?.provisionOrganisationRepository;
      setMessage(nextOrganisation?.repositoryStatus === 'ready'
        ? 'Data repository provisioned.'
        : 'Repository is still pending. Try again after inactive repositories have closed or shared memory has been freed.');
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

  async function handleRoleSave(roleId, name, permissions) {
    setMessage('');
    setFormError('');

    try {
      await upsertOrganisationRole({
        variables: {
          organisationId: selectedOrganisation.id,
          id: roleId,
          name,
          permissions: permissionInput(permissions),
        },
      });
      setMessage('Role permissions updated.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleCreateRole(event) {
    event.preventDefault();
    setMessage('');
    setFormError('');

    try {
      const result = await upsertOrganisationRole({
        variables: {
          organisationId: selectedOrganisation.id,
          id: null,
          name: newRoleName,
          permissions: {
            appRead: true,
            appWrite: false,
            manageOrganisation: false,
            manageRoles: false,
            promoteGuests: false,
            viewJoinPassword: false,
          },
        },
      });
      const createdRole = result.data?.upsertOrganisationRole?.roles.find(role => role.name === newRoleName);
      setSelectedRoleId(createdRole?.id || selectedRoleId);
      setNewRoleName('');
      setMessage('Role created.');
    } catch (submissionError) {
      setFormError(submissionError.message);
    }
  }

  async function handleMigrateOrganisationUris() {
    if (!selectedOrganisation) return;
    setMessage('');
    setFormError('');
    const confirmed = window.confirm(
      `Migrate the RDF URIs for "${selectedOrganisation.name}" to the id convention?\n\nExisting links will be rewritten and this cannot be undone automatically.`
    );
    if (!confirmed) return;

    try {
      await migrateOrganisationUris({ variables: { organisationId: selectedOrganisation.id } });
      await refetchMigrationStatus();
      setMessage('Organisation RDF URIs migrated.');
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

        {selectedOrganisation.repositoryStatus !== 'ready' && (
          <div className="organisation-repository-warning">
            <h4>Data repository pending</h4>
            <p>
              {selectedOrganisation.repositoryProvisioningError || 'Organisation settings are available, but data input is disabled until the data repository is provisioned.'}
            </p>
            {isOwner && (
              <button
                type="button"
                disabled={provisioningRepository}
                onClick={() => handleProvisionRepository(selectedOrganisation)}
              >
                {provisioningRepository ? 'Trying...' : 'Try creating repository'}
              </button>
            )}
          </div>
        )}

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
                <dt>Repository status</dt>
                <dd>{selectedOrganisation.repositoryStatus}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>{selectedOrganisation.name}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd>{selectedOrganisation.description || 'No description yet.'}</dd>
              </div>
              <div>
                <dt>Join password</dt>
                <dd>{selectedOrganisation.joinPassword || (selectedOrganisation.joinRequiresPassword ? 'Protected' : '-')}</dd>
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
        <div className="organisation-role-layout">
          <div className="organisation-members">
            <h4>Members</h4>
          {selectedOrganisation.members.map(member => {
            const canPromoteGuest = !isOwner
              && selectedOrganisation.currentUserPermissions?.promoteGuests
              && member.role === 'guest'
              && member.user.id !== user.id;
            return (
              <div className="organisation-member-row" key={member.user.id}>
                <div className="organisation-member-main">
                  <strong>{member.user.name || member.user.email}</strong>
                  <span>{member.user.email}</span>
                </div>
                {canManageRoles ? (
                  <select
                    value={member.role}
                    disabled={savingRole}
                    onChange={event => handleRoleChange(selectedOrganisation.id, member.user.id, event.target.value)}
                  >
                    {selectedOrganisation.roles.map(role => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
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

          <div className="organisation-roles-pane">
            <div className="organisation-roles-list">
              <h4>Role permissions</h4>
              {selectedOrganisation.roles.map(role => (
                <button
                  key={role.id}
                  type="button"
                  className={`organisation-role-card${selectedRole?.id === role.id ? ' selected' : ''}`}
                  onClick={() => setSelectedRoleId(role.id)}
                >
                  <strong>{role.name}</strong>
                  <span>
                    {role.permissions.appWrite
                      ? 'Can edit app data'
                      : role.permissions.appRead
                        ? 'Can view app data'
                        : 'No app access'}
                  </span>
                </button>
              ))}
            </div>

            {selectedRole && (
              <RoleEditor
                key={`${selectedOrganisation.id}-${selectedRole.id}`}
                role={selectedRole}
                canManageRoles={canManageRoles}
                onSave={handleRoleSave}
                saving={savingRoleDefinition}
              />
            )}

            {canManageRoles && (
              <form className="organisation-create-role" onSubmit={handleCreateRole}>
                <label className="form-group">
                  New role
                  <input
                    value={newRoleName}
                    onChange={event => setNewRoleName(event.target.value)}
                    placeholder="Analyst"
                    required
                  />
                </label>
                <button type="submit" disabled={savingRoleDefinition}>
                  Create role
                </button>
              </form>
            )}
          </div>
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
          <label className="organisation-private-toggle">
            <input
              type="checkbox"
              checked={newJoinRequiresPassword}
              onChange={event => setNewJoinRequiresPassword(event.target.checked)}
            />
            Require a password to join
          </label>
          {newJoinRequiresPassword && (
            <label className="form-group">
              Join password
              <input
                type="password"
                value={newJoinPassword}
                onChange={event => setNewJoinPassword(event.target.value)}
                minLength="8"
                required
              />
            </label>
          )}
          <button type="submit" disabled={creating || (newJoinRequiresPassword && !newJoinPassword)}>
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

  function renderMigrationPanel() {
    if (user?.role !== 'admin' || !selectedOrganisation) return null;
    const status = migrationData?.rdfUriMigrationStatus;
    return (
      <section className="organisation-detail-section">
        <h3>URI migration</h3>
        <p>Review and migrate this organisation's legacy RDF instance URIs to the id convention.</p>
        {migrationStatusLoading ? <p>Checking URI compatibility...</p> : status && (
          <>
            <p>
              {status.needsMigration
                ? `${status.affectedTriples} RDF triples use legacy namespaces.`
                : 'This organisation is already compatible with the id convention.'}
            </p>
            {status.predicateChanges?.length > 0 && (
              <p>Predicate changes: {status.predicateChanges.join(', ')}</p>
            )}
            {status.needsMigration && (
              <button type="button" onClick={handleMigrateOrganisationUris} disabled={migratingUris}>
                {migratingUris ? 'Migrating...' : 'Migrate organisation URIs'}
              </button>
            )}
          </>
        )}
      </section>
    );
  }

  function renderActivePanel() {
    if (activePanel === 'role') return renderRolePanel();
    if (activePanel === 'access') return renderAccessPanel();
    if (activePanel === 'migration') return renderMigrationPanel();
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
                    {organisation.repositoryStatus !== 'ready' && (
                      <span className="organisation-repository-badge">repo pending</span>
                    )}
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
