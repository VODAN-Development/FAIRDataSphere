import { useContext } from 'react';
import { OrganisationContext } from './OrganisationContextValue.js';

export function useOrganisationContext() {
  const context = useContext(OrganisationContext);
  if (!context) {
    throw new Error('useOrganisationContext must be used inside OrganisationProvider');
  }
  return context;
}
