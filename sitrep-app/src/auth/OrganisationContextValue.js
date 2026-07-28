import { createContext } from 'react';

// OrganisationProvider fills this with the active organisation/workspace and
// permission flags used across data-entry, item, report, and RDF pages.
export const OrganisationContext = createContext(null);
