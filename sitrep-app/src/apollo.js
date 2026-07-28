import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";

// Apollo talks to the backend GraphQL endpoint and includes cookies so the
// httpOnly session cookie set by auth mutations is sent with every request.
export const client = new ApolloClient({
  link: new HttpLink({
    uri: import.meta.env.VITE_GRAPHQL_URL || "http://localhost:4000/graphql",
    credentials: "include",
  }),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // RDF structures are organisation-scoped, so cache entries must include
          // organisationId or the editor can show another organisation's schema.
          rdfStructure: {
            keyArgs: ["organisationId"],
            merge(existing, incoming, { mergeObjects }) {
              return mergeObjects(existing, incoming);
            },
          },
        },
      },
    },
  }),
  defaultOptions: {
    // Default toward fresh server data because the app has multiple pages that
    // mutate shared report, item, organisation, and RDF structure state.
    watchQuery: {
      fetchPolicy: "cache-and-network",
    },
    query: {
      fetchPolicy: "network-only",
    },
  },
});
