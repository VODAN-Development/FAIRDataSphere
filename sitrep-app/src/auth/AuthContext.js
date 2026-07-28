import { createContext } from 'react';

// AuthProvider fills this with the current user plus sign-in/sign-up/sign-out
// actions. The default null helps hooks detect missing providers.
export const AuthContext = createContext(null);
