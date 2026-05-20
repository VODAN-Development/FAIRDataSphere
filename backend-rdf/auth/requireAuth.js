export function requireAuth(context) {
  if (!context?.currentUser) {
    throw new Error("You must be signed in to do that.");
  }
  return context.currentUser;
}

export function requireAdmin(context) {
  const user = requireAuth(context);
  if (user.role !== "admin") {
    throw new Error("You must be an admin to do that.");
  }
  return user;
}
