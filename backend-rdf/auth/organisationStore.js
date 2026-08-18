import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { listUsersByIds } from "./authStore.js";
import {
  createRepository,
  createRepositoryUser,
  defaultAllegroRepositoryConfig,
  deleteRepository,
  deleteRepositoryUser,
  runSparqlUpdate,
  withRepository,
} from "../services/allegroClient.js";
import {
  decryptJoinPassword,
  decryptRepositoryPassword,
  encryptJoinPassword,
  encryptRepositoryPassword,
} from "../services/organisationCredentialEncryption.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const ORGANISATIONS_FILE = path.join(DATA_DIR, "organisations.json");
const RDF_STRUCTURES_DIR = path.join(DATA_DIR, "rdf-structures");
const RDF_STRUCTURE_FILE_NAME = "reportRdfStructure.json";
const RDF_PRESETS_FILE_NAME = "presets.json";
const UNSCOPED_RDF_STRUCTURE_KEY = "no-organisation";
const REPOSITORY_PENDING_MESSAGE = "The organisation was created, but its AllegroGraph repository could not be created because shared memory is currently full. Data input will be unavailable until the repository is provisioned.";
let credentialUpgradeQueue = Promise.resolve();

// Higher weights represent broader organisation permissions.
const ROLE_WEIGHT = {
  guest: 1,
  member: 2,
  owner: 3,
};
const BUILT_IN_ROLE_IDS = ["owner", "member", "guest"];
const ORGANISATION_ROLES = new Set(BUILT_IN_ROLE_IDS);
const ROLE_PERMISSION_KEYS = [
  "appRead",
  "appWrite",
  "manageOrganisation",
  "manageRoles",
  "promoteGuests",
  "viewMemberCredentials",
  "viewOwnerCredentials",
  "viewJoinPassword",
  "allegroRead",
  "allegroWrite",
  "allegroQueryLimit",
];

const DEFAULT_ROLE_PERMISSIONS = {
  owner: {
    appRead: true,
    appWrite: true,
    manageOrganisation: true,
    manageRoles: true,
    promoteGuests: true,
    viewMemberCredentials: true,
    viewOwnerCredentials: true,
    viewJoinPassword: true,
    allegroRead: true,
    allegroWrite: true,
    allegroQueryLimit: false,
  },
  member: {
    appRead: true,
    appWrite: true,
    manageOrganisation: false,
    manageRoles: false,
    promoteGuests: true,
    viewMemberCredentials: true,
    viewOwnerCredentials: false,
    viewJoinPassword: false,
    allegroRead: true,
    allegroWrite: false,
    allegroQueryLimit: false,
  },
  guest: {
    appRead: true,
    appWrite: false,
    manageOrganisation: false,
    manageRoles: false,
    promoteGuests: false,
    viewMemberCredentials: false,
    viewOwnerCredentials: false,
    viewJoinPassword: false,
    allegroRead: false,
    allegroWrite: false,
    allegroQueryLimit: false,
  },
};

// Organisation names become repository names, so keep generated slugs compact
// and limited to characters AllegroGraph/user tooling can safely handle.
function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "organisation";
}

function generatedPassword() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
}

function generatedJoinPassword() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

// Each organisation receives dedicated write credentials plus separate read-only
// credentials for members who can view data but should not manage the repository.
function repositoryCredentials(organisationId, name) {
  const shortId = organisationId.split("-")[0];
  return {
    repository: `sitrep-${slug(name)}-${shortId}`,
    username: `sitrep_${shortId}`,
    password: generatedPassword(),
  };
}

function repositoryReadCredentials(organisationId, repository) {
  const shortId = organisationId.split("-")[0];
  return {
    repository,
    username: `sitrep_${shortId}_read`,
    password: generatedPassword(),
    write: false,
  };
}

function rdfStructureDirectoryKey(organisationId) {
  return organisationId || UNSCOPED_RDF_STRUCTURE_KEY;
}

function rdfStructureFilePath(organisationId) {
  return path.join(RDF_STRUCTURES_DIR, rdfStructureDirectoryKey(organisationId), RDF_STRUCTURE_FILE_NAME);
}

function rdfStructureDirectoryPath(organisationId) {
  return path.join(RDF_STRUCTURES_DIR, rdfStructureDirectoryKey(organisationId));
}

function rdfPresetMetadataFilePath(organisationId) {
  return path.join(rdfStructureDirectoryPath(organisationId), RDF_PRESETS_FILE_NAME);
}

function rdfPresetFilePath(organisationId, presetId) {
  return path.join(rdfStructureDirectoryPath(organisationId), `${presetId}.json`);
}

function sparqlLiteral(value) {
  return JSON.stringify(String(value));
}

function repositoryRoleCredentials(organisationId, repository, roleId) {
  const shortId = organisationId.split("-")[0];
  return {
    repository,
    username: `sitrep_${shortId}_${slug(roleId).replace(/-/g, "_")}`,
    password: generatedPassword(),
  };
}

function isRepositoryMemoryError(error) {
  return /shared memory|\/dev\/shm|insufficient shared memory|Could not create shared memory segment/i.test(error?.message || "");
}

function repositoryIsReady(organisation) {
  return !!(organisation.repository && organisation.repositoryUsername && organisation.repositoryPassword);
}

function repositoryPendingError(error) {
  if (!error) return null;
  return isRepositoryMemoryError(error)
    ? REPOSITORY_PENDING_MESSAGE
    : error.message || "The organisation data repository is not ready.";
}

async function provisionRepositoryCredentials(organisation) {
  const credentials = repositoryCredentials(organisation.id, organisation.name);
  const readCredentials = repositoryReadCredentials(organisation.id, credentials.repository);
  await createRepository(credentials.repository);
  await createRepositoryUser(credentials);
  await createRepositoryUser(readCredentials);
  return {
    ...organisation,
    repository: credentials.repository,
    repositoryUsername: credentials.username,
    repositoryPassword: credentials.password,
    repositoryReadUsername: readCredentials.username,
    repositoryReadPassword: readCredentials.password,
    repositoryProvisioningError: null,
  };
}

// Older deployments stored organisation-scoped triples in the shared repository.
// This removes those legacy records when an organisation is deleted.
async function deleteLegacyOrganisationData(organisationId) {
  await withRepository(defaultAllegroRepositoryConfig(), async () => {
    await runSparqlUpdate(`
      PREFIX sitrep: <http://sitrep.example.org/ontology#>
      DELETE {
        ?linked ?linkedPredicate ?linkedObject .
      }
      WHERE {
        ?entity sitrep:organisationId ${sparqlLiteral(organisationId)} ;
                ?predicate ?linked .
        ?linked ?linkedPredicate ?linkedObject .
        FILTER(isIRI(?linked))
        FILTER(STRSTARTS(STR(?linked), "http://sitrep.example.org/resource/"))
      };
      DELETE {
        ?entity ?predicate ?object .
      }
      WHERE {
        ?entity sitrep:organisationId ${sparqlLiteral(organisationId)} ;
                ?predicate ?object .
      }
    `);
  });
}

// Reads also perform a small data migration: old inline RDF structures are moved
// into their own files so organisation metadata stays small and credential-only.
async function readOrganisations() {
  try {
    const json = await readFile(ORGANISATIONS_FILE, "utf8");
    const organisations = JSON.parse(json);
    if (organisations.some(organisation => organisation.rdfStructureJson)) {
      await Promise.all(organisations.map(migrateInlineRdfStructure));
      await writeOrganisations(organisations);
      return organisations.map(withoutInlineRdfStructure);
    }
    return organisations;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Persist only metadata here; secrets are encrypted and RDF structure JSON lives
// in the per-organisation structure directory.
async function writeOrganisations(organisations) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ORGANISATIONS_FILE, `${JSON.stringify(organisations.map(serializedOrganisation), null, 2)}\n`, "utf8");
}

function withoutInlineRdfStructure(organisation) {
  const { rdfStructureJson, ...metadata } = organisation;
  return metadata;
}

function serializedOrganisation(organisation) {
  const metadata = withoutInlineRdfStructure(organisation);
  return {
    ...metadata,
    repositoryPassword: encryptRepositoryPassword(metadata.repositoryPassword),
    repositoryReadPassword: encryptRepositoryPassword(metadata.repositoryReadPassword),
    joinPassword: encryptJoinPassword(metadata.joinPassword),
    roles: normalizeOrganisationRoles(metadata).map(role => ({
      ...role,
      repositoryPassword: encryptRepositoryPassword(role.repositoryPassword),
    })),
  };
}

async function migrateInlineRdfStructure(organisation) {
  if (!organisation?.rdfStructureJson) return;
  const structurePath = rdfStructureFilePath(organisation.id);
  await mkdir(path.dirname(structurePath), { recursive: true });
  await writeFile(structurePath, `${JSON.stringify(JSON.parse(organisation.rdfStructureJson), null, 2)}\n`, "utf8");
}

function requireOrganisationRole(role) {
  if (!role || typeof role !== "string") {
    throw new Error("Role is required.");
  }
}

function normalizedRoleId(value) {
  return slug(value).replace(/-/g, "_").slice(0, 48);
}

function roleLabelFromId(roleId) {
  return String(roleId || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeRolePermissions(roleId, permissions = {}) {
  const defaults = DEFAULT_ROLE_PERMISSIONS[roleId] || DEFAULT_ROLE_PERMISSIONS.guest;
  return Object.fromEntries(ROLE_PERMISSION_KEYS.map(key => [key, permissions[key] ?? defaults[key] ?? false]));
}

function builtInRole(organisation, roleId) {
  const repositoryUsername = roleId === "owner"
    ? organisation.repositoryUsername || null
    : roleId === "member"
      ? organisation.repositoryReadUsername || null
      : null;
  const repositoryPassword = roleId === "owner"
    ? organisation.repositoryPassword || null
    : roleId === "member"
      ? organisation.repositoryReadPassword || null
      : null;
  return {
    id: roleId,
    name: roleLabelFromId(roleId),
    builtIn: true,
    permissions: normalizeRolePermissions(roleId),
    repositoryUsername,
    repositoryPassword,
  };
}

function normalizeOrganisationRoles(organisation) {
  const storedRoles = Array.isArray(organisation.roles) ? organisation.roles : [];
  const rolesById = new Map();

  for (const roleId of BUILT_IN_ROLE_IDS) {
    rolesById.set(roleId, builtInRole(organisation, roleId));
  }

  for (const role of storedRoles) {
    const roleId = normalizedRoleId(role.id || role.name);
    if (!roleId) continue;
    const existing = rolesById.get(roleId);
    const hasRepositoryUsername = Object.hasOwn(role, "repositoryUsername");
    const hasRepositoryPassword = Object.hasOwn(role, "repositoryPassword");
    rolesById.set(roleId, {
      id: roleId,
      name: BUILT_IN_ROLE_IDS.includes(roleId)
        ? roleLabelFromId(roleId)
        : String(role.name || existing?.name || roleLabelFromId(roleId)).trim(),
      builtIn: BUILT_IN_ROLE_IDS.includes(roleId),
      permissions: normalizeRolePermissions(roleId, role.permissions),
      repositoryUsername: hasRepositoryUsername ? role.repositoryUsername : existing?.repositoryUsername || null,
      repositoryPassword: hasRepositoryPassword ? role.repositoryPassword : existing?.repositoryPassword || null,
    });
  }

  return Array.from(rolesById.values());
}

function roleDefinitionFor(organisation, roleId) {
  return normalizeOrganisationRoles(organisation).find(role => role.id === roleId) || null;
}

function roleHasPermission(organisation, roleId, permission) {
  if (roleId === "owner" && ["manageOrganisation", "manageRoles"].includes(permission)) return true;
  return !!roleDefinitionFor(organisation, roleId)?.permissions?.[permission];
}

function canManageOrganisation(organisation, actor) {
  if (isAdmin(actor)) return true;
  const membership = membershipFor(organisation, actorId(actor));
  return !!membership && roleHasPermission(organisation, membership.role, "manageOrganisation");
}

function canManageRoles(organisation, actor) {
  if (isAdmin(actor)) return true;
  const membership = membershipFor(organisation, actorId(actor));
  return !!membership && roleHasPermission(organisation, membership.role, "manageRoles");
}

function membershipFor(organisation, userId) {
  return organisation.members.find(member => member.userId === userId) || null;
}

function isAdmin(user) {
  return user?.role === "admin";
}

function actorId(actor) {
  return typeof actor === "string" ? actor : actor?.id;
}

function requireOwner(organisation, actor) {
  if (isAdmin(actor)) return null;
  const userId = actorId(actor);
  const membership = membershipFor(organisation, userId);
  if (!membership || !roleHasPermission(organisation, membership.role, "manageOrganisation")) {
    throw new Error("You must be an organisation owner to do that.");
  }
  return membership;
}

// Convert internal organisation records into the permission-filtered GraphQL
// shape, including decrypted credentials only for roles allowed to see them.
async function organisationPayload(organisation, currentActor) {
  const currentUserId = actorId(currentActor);
  const users = await listUsersByIds(organisation.members.map(member => member.userId));
  const usersById = new Map(users.map(user => [user.id, user]));
  const currentMembership = membershipFor(organisation, currentUserId);
  const roles = normalizeOrganisationRoles(organisation);
  const currentPermissions = currentMembership
    ? roleDefinitionFor(organisation, currentMembership.role)?.permissions || {}
    : {};
  const canViewOwnerRepositoryCredentials = isAdmin(currentActor)
    || !!currentPermissions.viewOwnerCredentials;
  const canViewMemberRepositoryCredentials = canViewOwnerRepositoryCredentials
    || !!currentPermissions.viewMemberCredentials;
  const canViewJoinPassword = !!currentPermissions.viewJoinPassword;
  const canViewRoleCredentials = isAdmin(currentActor) || canManageRoles(organisation, currentActor);
  return {
    id: organisation.id,
    name: organisation.name,
    description: organisation.description || null,
    createdBy: organisation.createdBy,
    createdAt: organisation.createdAt,
    updatedAt: organisation.updatedAt,
    repository: canViewMemberRepositoryCredentials ? organisation.repository || null : null,
    repositoryStatus: repositoryIsReady(organisation) ? "ready" : "pending",
    repositoryProvisioningError: repositoryIsReady(organisation) ? null : organisation.repositoryProvisioningError || REPOSITORY_PENDING_MESSAGE,
    repositoryUsername: canViewOwnerRepositoryCredentials ? organisation.repositoryUsername || null : null,
    repositoryPassword: canViewOwnerRepositoryCredentials ? decryptRepositoryPassword(organisation.repositoryPassword) || null : null,
    repositoryReadUsername: canViewMemberRepositoryCredentials ? organisation.repositoryReadUsername || null : null,
    repositoryReadPassword: canViewMemberRepositoryCredentials ? decryptRepositoryPassword(organisation.repositoryReadPassword) || null : null,
    joinRequiresPassword: !!organisation.joinPassword,
    joinPassword: canViewJoinPassword ? decryptJoinPassword(organisation.joinPassword) || null : null,
    currentUserRole: currentMembership?.role || null,
    currentUserPermissions: currentMembership ? normalizeRolePermissions(currentMembership.role, currentPermissions) : null,
    roles: roles.map(role => ({
      id: role.id,
      name: role.name,
      builtIn: !!role.builtIn,
      permissions: role.permissions,
      repositoryUsername: canViewRoleCredentials ? role.repositoryUsername || null : null,
      repositoryPassword: canViewRoleCredentials ? decryptRepositoryPassword(role.repositoryPassword) || null : null,
    })),
    members: organisation.members.map(member => ({
      user: usersById.get(member.userId) || {
        id: member.userId,
        email: "Unknown user",
        name: null,
        role: "user",
      },
      role: member.role,
      joinedAt: member.joinedAt,
    })),
  };
}

export async function listOrganisations(currentActor) {
  const upgradedOrganisations = await readAndUpgradeVisibleOrganisationCredentials(currentActor);
  return Promise.all(upgradedOrganisations.map(organisation => organisationPayload(organisation, currentActor)));
}

export async function listMyOrganisations(currentActor) {
  const userId = actorId(currentActor);
  const organisations = await readAndUpgradeVisibleOrganisationCredentials(currentActor);
  return Promise.all(
    organisations
      .filter(organisation => membershipFor(organisation, userId))
      .map(organisation => organisationPayload(organisation, currentActor))
  );
}

export async function createOrganisation(userId, { name, description }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Organisation name is required.");
  }

  // Creating an organisation tries to provision the backing AllegroGraph
  // repository, but metadata is still saved if shared memory is temporarily full.
  const organisations = await readOrganisations();
  const now = new Date().toISOString();
  const id = randomUUID();
  let organisation = {
    id,
    name: trimmedName,
    description: String(description || "").trim() || null,
    repository: null,
    repositoryUsername: null,
    repositoryPassword: null,
    repositoryReadUsername: null,
    repositoryReadPassword: null,
    repositoryProvisioningError: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    members: [{
      userId,
      role: "owner",
      joinedAt: now,
    }],
  };
  try {
    organisation = await provisionRepositoryCredentials(organisation);
  } catch (error) {
    if (!isRepositoryMemoryError(error)) throw error;
    organisation.repositoryProvisioningError = repositoryPendingError(error);
    console.error("Organisation repository provisioning deferred", {
      organisationId: id,
      name: trimmedName,
      error: error.message,
    });
  }
  organisation.roles = normalizeOrganisationRoles(organisation);

  await writeOrganisations([...organisations, organisation]);
  return organisationPayload(organisation, userId);
}

export async function provisionOrganisationRepository(actor, organisationId) {
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }
  const organisation = organisations[organisationIndex];
  requireOwner(organisation, actor);
  if (repositoryIsReady(organisation)) {
    return organisationPayload(organisation, actor);
  }

  try {
    let provisionedOrganisation = {
      ...(await provisionRepositoryCredentials(organisation)),
      updatedAt: new Date().toISOString(),
    };
    provisionedOrganisation.roles = normalizeOrganisationRoles(provisionedOrganisation);
    for (const role of provisionedOrganisation.roles) {
      provisionedOrganisation = await ensureRoleRepositoryUser(provisionedOrganisation, role.id);
    }
    const nextOrganisations = [...organisations];
    nextOrganisations[organisationIndex] = provisionedOrganisation;
    await writeOrganisations(nextOrganisations);
    return organisationPayload(provisionedOrganisation, actor);
  } catch (error) {
    if (!isRepositoryMemoryError(error)) throw error;
    const nextOrganisation = {
      ...organisation,
      repositoryProvisioningError: repositoryPendingError(error),
      updatedAt: new Date().toISOString(),
    };
    const nextOrganisations = [...organisations];
    nextOrganisations[organisationIndex] = nextOrganisation;
    await writeOrganisations(nextOrganisations);
    return organisationPayload(nextOrganisation, actor);
  }
}

export async function joinOrganisation(userId, organisationId, password) {
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  if (membershipFor(organisation, userId)) {
    return organisationPayload(organisation, userId);
  }
  if (organisation.joinPassword && password !== decryptJoinPassword(organisation.joinPassword)) {
    throw new Error("The organisation password is incorrect.");
  }

  const now = new Date().toISOString();
  const nextOrganisation = {
    ...organisation,
    updatedAt: now,
    members: [
      ...organisation.members,
      { userId, role: "guest", joinedAt: now },
    ],
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return organisationPayload(nextOrganisation, userId);
}

export async function leaveOrganisation(actor, organisationId) {
  const userId = actorId(actor);
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  const membership = membershipFor(organisation, userId);
  if (!membership) {
    throw new Error("You are not part of this organisation.");
  }
  if (membership.role === "owner") {
    const remainingOwnerCount = organisation.members.filter(member => (
      member.role === "owner" && member.userId !== userId
    )).length;
    if (remainingOwnerCount === 0) {
      throw new Error("An organisation must have at least one owner.");
    }
  }

  const nextOrganisation = {
    ...organisation,
    updatedAt: new Date().toISOString(),
    members: organisation.members.filter(member => member.userId !== userId),
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return true;
}

export async function updateOrganisation(actor, organisationId, { name, description, joinRequiresPassword }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Organisation name is required.");
  }

  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  requireOwner(organisation, actor);

  const nextOrganisation = {
    ...organisation,
    name: trimmedName,
    description: String(description || "").trim() || null,
    joinPassword: joinRequiresPassword ? decryptJoinPassword(organisation.joinPassword) || generatedJoinPassword() : null,
    updatedAt: new Date().toISOString(),
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await writeOrganisations(nextOrganisations);
  return organisationPayload(nextOrganisation, actor);
}

export async function updateOrganisationMemberRole(actor, organisationId, targetUserId, role) {
  requireOrganisationRole(role);
  const actorUserId = actorId(actor);

  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  if (!roleDefinitionFor(organisation, role)) {
    throw new Error("Organisation role not found.");
  }
  const actorMembership = isAdmin(actor) ? null : membershipFor(organisation, actorUserId);
  const actorCanManageRoles = canManageRoles(organisation, actor);
  // Members can approve guests into full data access, but ownership changes stay
  // reserved for owners and admins.
  const actorCanPromoteGuest = actorMembership
    && roleHasPermission(organisation, actorMembership.role, "promoteGuests")
    && role === "member";
  if (!actorCanManageRoles && !actorCanPromoteGuest) {
    throw new Error("You must be an organisation owner to change this role.");
  }

  const targetMembership = membershipFor(organisation, targetUserId);
  if (!targetMembership) {
    throw new Error("User is not part of this organisation.");
  }
  if (actorCanPromoteGuest && targetUserId === actorUserId) {
    throw new Error("Members cannot change their own role.");
  }
  if (actorCanPromoteGuest && targetMembership.role !== "guest") {
    throw new Error("Members can only promote guests to members.");
  }
  if (targetMembership.role === "owner" && role !== "owner" && !isAdmin(actor)) {
    const ownerCount = organisation.members.filter(member => member.role === "owner").length;
    if (ownerCount <= 1) {
      throw new Error("An organisation must have at least one owner.");
    }
  }

  const nextOrganisation = {
    ...organisation,
    updatedAt: new Date().toISOString(),
    members: organisation.members.map(member => (
      member.userId === targetUserId ? { ...member, role } : member
    )),
  };
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = nextOrganisation;
  await ensureRoleRepositoryUser(nextOrganisation, role);
  await writeOrganisations(nextOrganisations);
  return organisationPayload(nextOrganisation, actor);
}

export async function upsertOrganisationRole(actor, organisationId, input) {
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  if (!canManageRoles(organisation, actor)) {
    throw new Error("You must be an organisation owner to manage roles.");
  }

  const id = input.id ? normalizedRoleId(input.id) : normalizedRoleId(input.name);
  if (!id) {
    throw new Error("Role name is required.");
  }
  const currentRoles = normalizeOrganisationRoles(organisation);
  const existingRole = currentRoles.find(role => role.id === id);
  const role = {
    id,
    name: BUILT_IN_ROLE_IDS.includes(id)
      ? roleLabelFromId(id)
      : String(input.name || existingRole?.name || roleLabelFromId(id)).trim(),
    builtIn: BUILT_IN_ROLE_IDS.includes(id),
    permissions: normalizeRolePermissions(id, input.permissions || existingRole?.permissions || {}),
    repositoryUsername: existingRole?.repositoryUsername || null,
    repositoryPassword: existingRole?.repositoryPassword || null,
  };
  if (!role.name) {
    throw new Error("Role name is required.");
  }
  if (role.builtIn) {
    role.permissions = {
      ...role.permissions,
      appRead: true,
      appWrite: id === "owner" ? true : role.permissions.appWrite,
      manageOrganisation: id === "owner" ? true : role.permissions.manageOrganisation,
      manageRoles: id === "owner" ? true : role.permissions.manageRoles,
      viewOwnerCredentials: id === "owner" ? true : role.permissions.viewOwnerCredentials,
      allegroRead: id === "owner" ? true : role.permissions.allegroRead,
      allegroWrite: id === "owner" ? true : role.permissions.allegroWrite,
      allegroQueryLimit: id === "owner" ? false : role.permissions.allegroQueryLimit,
    };
  }

  const nextRoles = currentRoles.map(candidate => candidate.id === id ? role : candidate);
  if (!existingRole) nextRoles.push(role);
  const nextOrganisation = {
    ...organisation,
    roles: nextRoles,
    updatedAt: new Date().toISOString(),
  };
  const syncedOrganisation = await ensureRoleRepositoryUser(nextOrganisation, id);
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = syncedOrganisation;
  await writeOrganisations(nextOrganisations);
  return organisationPayload(syncedOrganisation, actor);
}

export async function deleteOrganisation(actor, organisationId) {
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(organisation => organisation.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }

  const organisation = organisations[organisationIndex];
  const actorUserId = actorId(actor);
  if (!isAdmin(actor)) {
    const membership = membershipFor(organisation, actorUserId);
    if (!membership || !roleHasPermission(organisation, membership.role, "manageOrganisation")) {
      throw new Error("You must be an organisation owner to do that.");
    }
    const ownerCount = organisation.members.filter(member => member.role === "owner").length;
    if (ownerCount !== 1) {
      throw new Error("Only the sole organisation owner can delete an organisation.");
    }
  }

  if (organisation.repository) {
    await deleteRepository(organisation.repository);
  } else {
    await deleteLegacyOrganisationData(organisation.id);
  }
  if (organisation.repositoryUsername) {
    await deleteRepositoryUser(organisation.repositoryUsername);
  }
  if (organisation.repositoryReadUsername) {
    await deleteRepositoryUser(organisation.repositoryReadUsername);
  }
  for (const role of normalizeOrganisationRoles(organisation)) {
    if (!BUILT_IN_ROLE_IDS.includes(role.id) && role.repositoryUsername) {
      await deleteRepositoryUser(role.repositoryUsername);
    }
  }
  await rm(path.dirname(rdfStructureFilePath(organisationId)), { recursive: true, force: true });

  const nextOrganisations = organisations.filter(organisation => organisation.id !== organisationId);
  await writeOrganisations(nextOrganisations);
  return true;
}

export async function highestOrganisationRole(userId) {
  const organisations = await readOrganisations();
  return organisations
    .flatMap(organisation => organisation.members)
    .filter(member => member.userId === userId)
    .map(member => member.role)
    .sort((left, right) => ROLE_WEIGHT[right] - ROLE_WEIGHT[left])[0] || null;
}

export async function canWriteOrganisationData(user) {
  if (isAdmin(user)) return true;
  const userId = actorId(user);
  const organisations = await readOrganisations();
  return organisations.some(organisation => {
    const role = membershipFor(organisation, userId)?.role;
    return role && roleHasPermission(organisation, role, "appWrite");
  });
}

export async function canViewOrganisation(user, organisationId) {
  if (isAdmin(user)) return true;
  const organisations = await readOrganisations();
  const organisation = organisations.find(candidate => candidate.id === organisationId);
  const role = organisation ? membershipFor(organisation, actorId(user))?.role : null;
  return !!role && roleHasPermission(organisation, role, "appRead");
}

export async function canWriteOrganisation(user, organisationId) {
  if (isAdmin(user)) return true;
  const organisations = await readOrganisations();
  const organisation = organisations.find(candidate => candidate.id === organisationId);
  const role = organisation ? membershipFor(organisation, actorId(user))?.role : null;
  return !!role && roleHasPermission(organisation, role, "appWrite");
}

export async function organisationRepositoryConfig(organisationId) {
  if (!organisationId) return defaultAllegroRepositoryConfig();

  // Repository credentials may be pending when AllegroGraph shared memory was
  // full during organisation creation. Data pages should report that state
  // clearly instead of trying to provision a repository during normal reads.
  const organisation = await withCredentialUpgradeLock(async () => {
    const organisations = await readOrganisations();
    const organisationIndex = organisations.findIndex(candidate => candidate.id === organisationId);
    if (organisationIndex === -1) {
      throw new Error("Organisation not found.");
    }
    return ensureOrganisationCredentialSets(organisations, organisationIndex);
  });

  if (!repositoryIsReady(organisation)) {
    throw new Error(organisation.repositoryProvisioningError || REPOSITORY_PENDING_MESSAGE);
  }

  return {
    repository: organisation.repository,
    username: organisation.repositoryUsername,
    password: decryptRepositoryPassword(organisation.repositoryPassword),
  };
}

async function readAndUpgradeVisibleOrganisationCredentials(currentActor) {
  return withCredentialUpgradeLock(async () => {
    const organisations = await readOrganisations();
    return upgradeVisibleOrganisationCredentials(organisations, currentActor);
  });
}

// Serialize credential upgrades to avoid two concurrent requests provisioning
// duplicate repository users for the same organisation.
function withCredentialUpgradeLock(callback) {
  const nextUpgrade = credentialUpgradeQueue.then(callback, callback);
  credentialUpgradeQueue = nextUpgrade.catch(() => {});
  return nextUpgrade;
}

async function upgradeVisibleOrganisationCredentials(organisations, currentActor) {
  let nextOrganisations = organisations;
  for (const [index, organisation] of organisations.entries()) {
    const membership = membershipFor(organisation, actorId(currentActor));
    if (!isAdmin(currentActor) && !membership?.role) {
      continue;
    }
    const upgradedOrganisation = await ensureOrganisationCredentialSets(nextOrganisations, index);
    if (upgradedOrganisation !== nextOrganisations[index]) {
      nextOrganisations = [...nextOrganisations];
      nextOrganisations[index] = upgradedOrganisation;
    }
  }
  return nextOrganisations;
}

async function ensureOrganisationCredentialSets(organisations, organisationIndex) {
  const organisation = organisations[organisationIndex];
  let nextOrganisation = organisation;

  if (!organisation.repository) {
    return organisation;
  }

  if (!organisation.repositoryUsername || !organisation.repositoryPassword) {
    const credentials = repositoryCredentials(organisation.id, organisation.name);
    await createRepositoryUser({ ...credentials, repository: organisation.repository });
    nextOrganisation = {
      ...nextOrganisation,
      repositoryUsername: credentials.username,
      repositoryPassword: credentials.password,
    };
  }

  if (!nextOrganisation.repositoryReadUsername || !nextOrganisation.repositoryReadPassword) {
    const readCredentials = repositoryReadCredentials(nextOrganisation.id, nextOrganisation.repository);
    await createRepositoryUser(readCredentials);
    nextOrganisation = {
      ...nextOrganisation,
      repositoryReadUsername: readCredentials.username,
      repositoryReadPassword: readCredentials.password,
    };
  }

  if (nextOrganisation !== organisation) {
    nextOrganisation = {
      ...nextOrganisation,
      roles: normalizeOrganisationRoles(nextOrganisation),
    };
    nextOrganisation = {
      ...nextOrganisation,
      updatedAt: new Date().toISOString(),
    };
    const nextOrganisations = [...organisations];
    nextOrganisations[organisationIndex] = nextOrganisation;
    await writeOrganisations(nextOrganisations);
  }

  return nextOrganisation;
}

async function ensureRoleRepositoryUser(organisation, roleId) {
  const roles = normalizeOrganisationRoles(organisation);
  const roleIndex = roles.findIndex(role => role.id === roleId);
  if (roleIndex === -1) return organisation;
  if (!organisation.repository) return { ...organisation, roles };
  const role = roles[roleIndex];
  if (role.id === "owner" || role.id === "member") {
    const username = role.id === "owner" ? organisation.repositoryUsername : organisation.repositoryReadUsername;
    const password = role.id === "owner" ? organisation.repositoryPassword : organisation.repositoryReadPassword;
    const needsRepositoryAccess = !!role.permissions.allegroRead || !!role.permissions.allegroWrite;
    if (username && password && needsRepositoryAccess) {
      await createRepositoryUser({
        repository: organisation.repository,
        username,
        password: decryptRepositoryPassword(password) || password,
        write: !!role.permissions.allegroWrite,
        queryResultsLimit: !!role.permissions.allegroQueryLimit,
      });
    } else if (username && role.id !== "owner") {
      await deleteRepositoryUser(username);
    }
    const nextRoles = roles.map(candidate => {
      if (candidate.id === "owner") {
        return {
          ...candidate,
          repositoryUsername: organisation.repositoryUsername || candidate.repositoryUsername || null,
          repositoryPassword: organisation.repositoryPassword || candidate.repositoryPassword || null,
        };
      }
      if (candidate.id === "member") {
        return {
          ...candidate,
          repositoryUsername: needsRepositoryAccess
            ? organisation.repositoryReadUsername || candidate.repositoryUsername || null
            : null,
          repositoryPassword: needsRepositoryAccess
            ? organisation.repositoryReadPassword || candidate.repositoryPassword || null
            : null,
        };
      }
      return candidate;
    });
    return { ...organisation, roles: nextRoles };
  }

  const needsRepositoryAccess = !!role.permissions.allegroRead || !!role.permissions.allegroWrite;
  let nextRole = role;
  if (needsRepositoryAccess) {
    const credentials = role.repositoryUsername && role.repositoryPassword
      ? {
        repository: organisation.repository,
        username: role.repositoryUsername,
        password: decryptRepositoryPassword(role.repositoryPassword) || role.repositoryPassword,
      }
      : repositoryRoleCredentials(organisation.id, organisation.repository, role.id);
    await createRepositoryUser({
      ...credentials,
      write: !!role.permissions.allegroWrite,
      queryResultsLimit: !!role.permissions.allegroQueryLimit,
    });
    nextRole = {
      ...role,
      repositoryUsername: credentials.username,
      repositoryPassword: credentials.password,
    };
  } else if (role.repositoryUsername) {
    await deleteRepositoryUser(role.repositoryUsername);
    nextRole = {
      ...role,
      repositoryUsername: null,
      repositoryPassword: null,
    };
  }

  if (nextRole === role) return { ...organisation, roles };
  const nextRoles = [...roles];
  nextRoles[roleIndex] = nextRole;
  return { ...organisation, roles: nextRoles };
}

export async function organisationRdfStructureJson(organisationId) {
  try {
    return await readFile(rdfStructureFilePath(organisationId), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

export async function updateOrganisationRdfStructureJson(organisationId, json) {
  const structurePath = rdfStructureFilePath(organisationId);
  // Parse and re-stringify to validate the JSON and keep structures consistently
  // formatted on disk.
  await mkdir(path.dirname(structurePath), { recursive: true });
  await writeFile(structurePath, `${JSON.stringify(JSON.parse(json), null, 2)}\n`, "utf8");

  if (!organisationId) return;
  const organisations = await readOrganisations();
  const organisationIndex = organisations.findIndex(candidate => candidate.id === organisationId);
  if (organisationIndex === -1) {
    throw new Error("Organisation not found.");
  }
  const nextOrganisations = [...organisations];
  nextOrganisations[organisationIndex] = {
    ...nextOrganisations[organisationIndex],
    updatedAt: new Date().toISOString(),
  };
  await writeOrganisations(nextOrganisations);
}

// Presets are split into metadata plus one JSON file per preset. That keeps list
// calls lightweight while still allowing full structure loads on demand.
async function readRdfPresetMetadata(organisationId) {
  try {
    return JSON.parse(await readFile(rdfPresetMetadataFilePath(organisationId), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeRdfPresetMetadata(organisationId, presets) {
  await mkdir(rdfStructureDirectoryPath(organisationId), { recursive: true });
  await writeFile(rdfPresetMetadataFilePath(organisationId), `${JSON.stringify(presets, null, 2)}\n`, "utf8");
}

function validateRdfPresetName(name) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Preset name is required.");
  }
  return trimmedName.slice(0, 120);
}

function normalizeRdfStructureJson(json) {
  return `${JSON.stringify(JSON.parse(json), null, 2)}\n`;
}

async function rdfPresetPayload(organisationId, preset) {
  return {
    ...preset,
    scope: organisationId ? "organisation" : "global",
    organisationId: organisationId || null,
    json: await readFile(rdfPresetFilePath(organisationId, preset.id), "utf8"),
  };
}

export async function listOrganisationRdfStructurePresets(organisationId) {
  const organisationPresets = organisationId ? await readRdfPresetMetadata(organisationId) : [];
  const globalPresets = await readRdfPresetMetadata(null);
  return [
    ...(await Promise.all(globalPresets.map(preset => rdfPresetPayload(null, preset)))),
    ...(await Promise.all(organisationPresets.map(preset => rdfPresetPayload(organisationId, preset)))),
  ];
}

export async function saveOrganisationRdfStructurePreset(organisationId, { name, json, createdBy }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const preset = {
    id,
    name: validateRdfPresetName(name),
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const normalizedJson = normalizeRdfStructureJson(json);
  const presets = await readRdfPresetMetadata(organisationId);
  await mkdir(rdfStructureDirectoryPath(organisationId), { recursive: true });
  await writeFile(rdfPresetFilePath(organisationId, id), normalizedJson, "utf8");
  await writeRdfPresetMetadata(organisationId, [...presets, preset]);
  return rdfPresetPayload(organisationId, preset);
}

export async function rdfStructurePresetJson(organisationId, presetId) {
  const presets = await readRdfPresetMetadata(organisationId);
  const preset = presets.find(candidate => candidate.id === presetId);
  if (!preset) {
    throw new Error("RDF structure preset not found.");
  }
  return readFile(rdfPresetFilePath(organisationId, preset.id), "utf8");
}

export async function deleteOrganisationRdfStructurePreset(organisationId, presetId) {
  const presets = await readRdfPresetMetadata(organisationId);
  const preset = presets.find(candidate => candidate.id === presetId);
  if (!preset) {
    throw new Error("RDF structure preset not found.");
  }
  await rm(rdfPresetFilePath(organisationId, preset.id), { force: true });
  await writeRdfPresetMetadata(
    organisationId,
    presets.filter(candidate => candidate.id !== preset.id)
  );
  return true;
}
