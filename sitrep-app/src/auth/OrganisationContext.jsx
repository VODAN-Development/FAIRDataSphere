import { useMemo, useState } from 'react';
import { gql, useQuery } from '@apollo/client';
import { useAuth } from './useAuth.js';
import { OrganisationContext } from './OrganisationContextValue.js';

// Persist the last selected organisation locally so repeated visits reopen the
// same workspace when the user still has access to it.
const ACTIVE_ORGANISATION_KEY = 'sitrep.activeOrganisationId';
const EMPTY_ORGANISATIONS = [];

const GET_ACTIVE_ORGANISATIONS = gql`
  query GetActiveOrganisations {
    organisations {
      id
      name
      repositoryStatus
      repositoryProvisioningError
      currentUserRole
      currentUserPermissions {
        appWrite
      }
    }
    myOrganisations {
      id
      name
      repositoryStatus
      repositoryProvisioningError
      currentUserRole
      currentUserPermissions {
        appWrite
      }
    }
  }
`;

export function OrganisationProvider({ children }) {
  const { user } = useAuth();
  // Admins can see all organisations; regular users are restricted to their own
  // memberships. Both lists are fetched together so role switches are simple.
  const { data, loading, error } = useQuery(GET_ACTIVE_ORGANISATIONS, {
    skip: !user,
  });
  const [selectedOrganisationId, setSelectedOrganisationId] = useState(() => (
    localStorage.getItem(ACTIVE_ORGANISATION_KEY) || ''
  ));

  const organisations = user?.role === 'admin'
    ? data?.organisations || EMPTY_ORGANISATIONS
    : data?.myOrganisations || EMPTY_ORGANISATIONS;

  const activeOrganisationId = user?.role === 'admin' && !selectedOrganisationId
    // Empty organisation ID means the admin is working against the global,
    // unscoped repository/structure instead of a specific organisation.
    ? ''
    : user && organisations.some(organisation => organisation.id === selectedOrganisationId)
      ? selectedOrganisationId
      : user?.role === 'admin'
        ? ''
        : organisations[0]?.id || '';

  function selectOrganisation(id) {
    // Store only explicit organisation selections; the admin unscoped mode is
    // represented by absence of a saved ID.
    setSelectedOrganisationId(id);
    if (id) {
      localStorage.setItem(ACTIVE_ORGANISATION_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_ORGANISATION_KEY);
    }
  }

  const activeOrganisation = activeOrganisationId
    ? organisations.find(organisation => organisation.id === activeOrganisationId) || null
    : null;
  const activeOrganisationIsUnscoped = user?.role === 'admin' && !activeOrganisationId;
  const activeOrganisationCanWrite = user?.role === 'admin'
    || !!activeOrganisation?.currentUserPermissions?.appWrite;
  const value = useMemo(() => ({
    activeOrganisation,
    activeOrganisationCanWrite,
    activeOrganisationId,
    activeOrganisationIsUnscoped,
    error,
    loading,
    organisations,
    selectOrganisation,
  }), [activeOrganisation, activeOrganisationCanWrite, activeOrganisationId, activeOrganisationIsUnscoped, error, loading, organisations]);

  return (
      <OrganisationContext.Provider value={value}>
      {children}
    </OrganisationContext.Provider>
  );
}
