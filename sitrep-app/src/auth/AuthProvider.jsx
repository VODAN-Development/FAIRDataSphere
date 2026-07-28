import { useCallback, useMemo } from 'react';
import { gql, useApolloClient, useMutation, useQuery } from '@apollo/client';
import { AuthContext } from './AuthContext.js';

const ME = gql`
  query Me {
    me {
      id
      email
      name
      role
    }
  }
`;

const SIGN_IN = gql`
  mutation SignIn($email: String!, $password: String!) {
    signIn(email: $email, password: $password) {
      user {
        id
        email
        name
        role
      }
    }
  }
`;

const SIGN_UP = gql`
  mutation SignUp($email: String!, $password: String!, $name: String) {
    signUp(email: $email, password: $password, name: $name) {
      user {
        id
        email
        name
        role
      }
    }
  }
`;

const SIGN_OUT = gql`
  mutation SignOut {
    signOut
  }
`;

export function AuthProvider({ children }) {
  const apolloClient = useApolloClient();
  // Always ask the server for /me so a refreshed page reflects the cookie-backed
  // session instead of trusting stale client cache.
  const { data, loading, refetch } = useQuery(ME, {
    fetchPolicy: 'network-only',
    errorPolicy: 'ignore',
  });
  const [signInMutation] = useMutation(SIGN_IN);
  const [signUpMutation] = useMutation(SIGN_UP);
  const [signOutMutation] = useMutation(SIGN_OUT);

  const signIn = useCallback(async ({ email, password }) => {
    const result = await signInMutation({ variables: { email, password } });
    // The mutation sets an httpOnly cookie; refetching /me updates React state.
    await refetch();
    return result.data.signIn.user;
  }, [refetch, signInMutation]);

  const signUp = useCallback(async ({ email, password, name }) => {
    const result = await signUpMutation({ variables: { email, password, name } });
    await refetch();
    return result.data.signUp.user;
  }, [refetch, signUpMutation]);

  const signOut = useCallback(async () => {
    await signOutMutation();
    // Clear GraphQL cache so organisation-scoped data from the previous user is
    // not shown after the session cookie is removed.
    await apolloClient.clearStore();
    await refetch();
  }, [apolloClient, refetch, signOutMutation]);

  const value = useMemo(() => ({
    // Memoizing keeps context consumers from re-rendering unless auth state or
    // auth actions actually change.
    user: data?.me || null,
    loading,
    signIn,
    signUp,
    signOut,
  }), [data?.me, loading, signIn, signOut, signUp]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
