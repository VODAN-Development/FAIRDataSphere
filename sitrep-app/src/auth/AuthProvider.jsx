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
  mutation SignUp($email: String!, $password: String!, $name: String, $verificationCode: String!) {
    signUp(email: $email, password: $password, name: $name, verificationCode: $verificationCode) {
      user {
        id
        email
        name
        role
      }
    }
  }
`;

const REQUEST_SIGN_UP_CODE = gql`
  mutation RequestSignUpCode($email: String!, $password: String!, $name: String, $captchaToken: String!) {
    requestSignUpCode(email: $email, password: $password, name: $name, captchaToken: $captchaToken)
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
  const [requestSignUpCodeMutation] = useMutation(REQUEST_SIGN_UP_CODE);
  const [signUpMutation] = useMutation(SIGN_UP);
  const [signOutMutation] = useMutation(SIGN_OUT);

  const signIn = useCallback(async ({ email, password }) => {
    const result = await signInMutation({ variables: { email, password } });
    // The mutation sets an httpOnly cookie; refetching /me updates React state.
    await refetch();
    return result.data.signIn.user;
  }, [refetch, signInMutation]);

  const requestSignUpCode = useCallback(async ({ email, password, name, captchaToken }) => {
    const result = await requestSignUpCodeMutation({ variables: { email, password, name, captchaToken } });
    return result.data.requestSignUpCode;
  }, [requestSignUpCodeMutation]);

  const signUp = useCallback(async ({ email, password, name, verificationCode }) => {
    const result = await signUpMutation({ variables: { email, password, name, verificationCode } });
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
    requestSignUpCode,
    signIn,
    signUp,
    signOut,
  }), [data?.me, loading, requestSignUpCode, signIn, signOut, signUp]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
