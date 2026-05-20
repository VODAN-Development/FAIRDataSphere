import { useMemo, useState } from 'react';
import { gql, useQuery } from '@apollo/client';
import { useAuth } from './useAuth.js';
import { OrganisationContext } from './OrganisationContextValue.js';
const ACTIVE_ORGANISATION_KEY = 'sitrep.activeOrganisationId';
const EMPTY_ORGANISATIONS = [];

const GET_ACTIVE_ORGANISATIONS = gql`
  query GetActiveOrganisations {
    organisations {
      id
      name
      currentUserRole
    }
    myOrganisations {
      id
      name
      currentUserRole
    }
  }
`;

export function OrganisationProvider({ children }) {
  const { user } = useAuth();
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
    ? ''
    : user && organisations.some(organisation => organisation.id === selectedOrganisationId)
      ? selectedOrganisationId
      : user?.role === 'admin'
        ? ''
        : organisations[0]?.id || '';

  function selectOrganisation(id) {
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
    || activeOrganisation?.currentUserRole === 'owner'
    || activeOrganisation?.currentUserRole === 'member';
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
