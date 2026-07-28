import { useContext } from 'react';
import { OrganisationContext } from './OrganisationContextValue.js';

export function useOrganisationContext() {
  const context = useContext(OrganisationContext);
  // Throwing here catches components that forgot to render under
  // OrganisationProvider.
  if (!context) {
    throw new Error('useOrganisationContext must be used inside OrganisationProvider');
  }
  return context;
}
