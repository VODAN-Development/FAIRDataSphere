import { useOrganisationContext } from '../auth/useOrganisationContext.js';
import { useAuth } from '../auth/useAuth.js';

export default function OrganisationGate({ children, requireWrite = false }) {
  const { user } = useAuth();
  const {
    activeOrganisationId,
    error,
    loading,
    organisations,
    selectOrganisation,
  } = useOrganisationContext();

  if (loading) return <p>Loading organisations...</p>;
  if (error) return <div className="error-message">{error.message}</div>;
  if (organisations.length === 0 && user?.role !== 'admin') {
    return (
      <div className="error-message">
        You need to join or create an organisation before using this page.
      </div>
    );
  }

  const activeOrganisation = organisations.find(organisation => organisation.id === activeOrganisationId);
  const canWrite = user?.role === 'admin'
    || !!activeOrganisation?.currentUserPermissions?.appWrite;

  return (
    <div className="organisation-gated-page">
      <div className="active-organisation-bar">
        <label>
          Organisation
          <select value={activeOrganisationId} onChange={event => selectOrganisation(event.target.value)}>
            {user?.role === 'admin' && (
              <option value="">No organisation</option>
            )}
            {organisations.map(organisation => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {requireWrite && !canWrite ? (
        <div className="error-message">
          Guests can view organisation data, but cannot input, edit, or delete it.
        </div>
      ) : children}
    </div>
  );
}
