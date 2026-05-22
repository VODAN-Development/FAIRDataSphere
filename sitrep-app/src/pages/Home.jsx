import { Link } from 'react-router-dom';
import { gql, useQuery } from '@apollo/client';
import { useAuth } from '../auth/useAuth.js';
import { useOrganisationContext } from '../auth/useOrganisationContext.js';

const GET_HOME_OVERVIEW = gql`
  query GetHomeOverview($organisationId: ID) {
    reportItems(organisationId: $organisationId) {
      entryNumber
      reportId
    }
    reports(organisationId: $organisationId) {
      id
      selectedItemIds
    }
    rdfStructure(organisationId: $organisationId) {
      json
    }
  }
`;

function DashboardPane({ title, meta, children, actionTo, actionLabel, tone = 'default' }) {
  return (
    <section className={`home-pane ${tone}`}>
      <div className="home-pane-header">
        <h3>{title}</h3>
        {meta && <span>{meta}</span>}
      </div>
      <div className="home-pane-body">{children}</div>
      {actionTo && (
        <Link className="home-pane-action" to={actionTo}>
          {actionLabel}
        </Link>
      )}
    </section>
  );
}

export default function Home() {
  const { user } = useAuth();
  const {
    activeOrganisation,
    activeOrganisationCanWrite,
    activeOrganisationId,
    activeOrganisationIsUnscoped,
    loading: organisationLoading,
    organisations,
    selectOrganisation,
  } = useOrganisationContext();

  const shouldLoadOverview = !!user && (!!activeOrganisationId || activeOrganisationIsUnscoped);
  const { data, loading, error } = useQuery(GET_HOME_OVERVIEW, {
    variables: { organisationId: activeOrganisationId },
    skip: !shouldLoadOverview,
  });

  const reports = data?.reports || [];
  const reportItems = data?.reportItems || [];
  const assignedItems = reportItems.filter(item => item.reportId).length;
  const unassignedItems = reportItems.length - assignedItems;
  const rdfClassCount = (() => {
    if (!data?.rdfStructure?.json) return 0;
    try {
      const structure = JSON.parse(data.rdfStructure.json);
      return Object.keys({ ...(structure.classes || {}), ...(structure.uriTemplates || {}) }).length;
    } catch {
      return 0;
    }
  })();

  if (!user) {
    return (
      <main className="homepage home-dashboard-page">
        <section className="home-dashboard-hero">
          <h2>FAIR Data Sphere</h2>
          <p>Create, manage, and analyze situation reports for incidents and events.</p>
          <Link className="home-pane-action" to="/login">Login</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="homepage home-dashboard-page">
      <section className="home-dashboard-header">
        <div>
          <h2>Situation report dashboard</h2>
          <p>
            {activeOrganisation
              ? `Working in ${activeOrganisation.name}.`
              : activeOrganisationIsUnscoped
                ? 'Admin view across all organisations.'
                : 'Select or create an organisation to start working.'}
          </p>
        </div>
        <div className="home-dashboard-actions">
          <label className="home-organisation-selector">
            Organisation
            <select
              value={activeOrganisationId}
              onChange={event => selectOrganisation(event.target.value)}
              disabled={organisationLoading || (!organisations.length && user.role !== 'admin')}
            >
              {user.role === 'admin' && (
                <option value="">No organisation</option>
              )}
              {!organisations.length && user.role !== 'admin' && (
                <option value="">No organisations available</option>
              )}
              {organisations.map(organisation => (
                <option key={organisation.id} value={organisation.id}>
                  {organisation.name}
                </option>
              ))}
            </select>
          </label>
          {activeOrganisationCanWrite && (
            <Link className="home-primary-action" to="/data-input">
              Create report item
            </Link>
          )}
        </div>
      </section>

      {(error || organisationLoading) && (
        <div className={error ? 'error-message' : 'success-message'}>
          {error ? error.message : 'Loading organisation context...'}
        </div>
      )}

      <section className="home-pane-grid" aria-label="Dashboard panes">
        <DashboardPane
          title="Organisation"
          meta={activeOrganisation?.currentUserRole || user.role}
          actionTo="/organisation"
          actionLabel={activeOrganisation ? 'Manage organisation' : 'Set up organisation'}
        >
          <p>
            {activeOrganisation
              ? `${organisations.length} organisation${organisations.length === 1 ? '' : 's'} available.`
              : 'Create or join an organisation before entering report data.'}
          </p>
        </DashboardPane>

        <DashboardPane
          title="Data input"
          meta={activeOrganisationCanWrite ? 'Writable' : 'Read only'}
          actionTo="/data-input"
          actionLabel="Create new report item"
          tone="primary"
        >
          <p>{reportItems.length} item{reportItems.length === 1 ? '' : 's'} captured.</p>
          <p>{unassignedItems} item{unassignedItems === 1 ? '' : 's'} not assigned to a report.</p>
        </DashboardPane>

        <DashboardPane
          title="Reports"
          meta={loading ? 'Loading' : `${reports.length} total`}
          actionTo="/reports"
          actionLabel="Open reports"
        >
          <p>{reports.length} report{reports.length === 1 ? '' : 's'} created.</p>
          <p>{assignedItems} item{assignedItems === 1 ? '' : 's'} currently assigned.</p>
        </DashboardPane>

        <DashboardPane
          title="Items"
          meta={loading ? 'Loading' : `${reportItems.length} total`}
          actionTo="/items"
          actionLabel="Review items"
        >
          <p>Browse, edit, delete, and assign report items.</p>
        </DashboardPane>

        <DashboardPane
          title="RDF structure"
          meta={loading ? 'Loading' : `${rdfClassCount} classes`}
          actionTo="/rdf-structure"
          actionLabel="Edit structure"
        >
          <p>Configure fields, classes, relationships, and input behavior.</p>
        </DashboardPane>

        <DashboardPane
          title="Account"
          meta={user.email}
          actionTo="/account"
          actionLabel="Open account"
        >
          <p>Update profile details, password, and review your app role.</p>
        </DashboardPane>
      </section>
    </main>
  );
}
