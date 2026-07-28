export function requireAuth(context) {
  // Resolvers call this at their boundary so unauthenticated requests fail before
  // touching organisation data, SPARQL repositories, or local JSON stores.
  if (!context?.currentUser) {
    throw new Error("You must be signed in to do that.");
  }
  return context.currentUser;
}

export function requireAdmin(context) {
  // Admin checks build on requireAuth so callers get the same signed-in contract
  // plus an explicit role assertion.
  const user = requireAuth(context);
  if (user.role !== "admin") {
    throw new Error("You must be an admin to do that.");
  }
  return user;
}
