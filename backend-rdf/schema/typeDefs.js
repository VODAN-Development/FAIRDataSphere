export default `#graphql
  # Public user shape returned to the frontend; password hashes never leave the
  # auth store.
  type User {
    id: ID!
    email: String!
    name: String
    role: String!
  }

  type AuthPayload {
    user: User!
  }

  # Organisation membership combines the public user profile with the role stored
  # on the organisation record.
  type OrganisationMember {
    user: User!
    role: String!
    joinedAt: String!
  }

  type OrganisationRolePermissions {
    appRead: Boolean!
    appWrite: Boolean!
    manageOrganisation: Boolean!
    manageRoles: Boolean!
    promoteGuests: Boolean!
    viewJoinPassword: Boolean!
  }

  type OrganisationRole {
    id: ID!
    name: String!
    builtIn: Boolean!
    permissions: OrganisationRolePermissions!
  }

  type Organisation {
    id: ID!
    name: String!
    description: String
    createdBy: ID!
    createdAt: String!
    updatedAt: String!
    repositoryStatus: String!
    repositoryProvisioningError: String
    joinRequiresPassword: Boolean!
    joinPassword: String
    currentUserRole: String
    currentUserPermissions: OrganisationRolePermissions
    roles: [OrganisationRole!]!
    members: [OrganisationMember!]!
  }

  # RDF structure fields describe both form rendering and RDF triple generation.
  type RdfStructureField {
    name: String!
    label: String
    predicate: String
    datatype: String
    required: Boolean
    generated: Boolean
    encrypted: Boolean
    inputType: String
    kind: String!
    allowMultiple: Boolean
    subfields: [RdfStructureField!]
    options: [RdfStructureOption!]
  }

  type RdfStructureOption {
    name: String!
    label: String
    value: String
    subfields: [RdfStructureField!]
  }

  type RdfStructure {
    json: String!
    reportItemFields: [RdfStructureField!]!
    reportFields: [RdfStructureField!]!
  }

  type RdfUriMigrationStatus {
    organisationId: ID!
    needsMigration: Boolean!
    currentTemplates: [String!]!
    targetTemplates: [String!]!
    predicateChanges: [String!]!
    affectedTriples: Int!
  }

  # Presets let global admins or organisation owners reuse RDF structures.
  type RdfStructurePreset {
    id: ID!
    name: String!
    json: String!
    scope: String!
    canDelete: Boolean!
    createdBy: ID
    createdAt: String!
    updatedAt: String!
  }

  input RdfFieldValueInput {
    name: String!
    value: String
  }

  input OrganisationRolePermissionsInput {
    appRead: Boolean
    appWrite: Boolean
    manageOrganisation: Boolean
    manageRoles: Boolean
    promoteGuests: Boolean
    viewJoinPassword: Boolean
  }

  # Dynamic field values are returned as name/value pairs with the metadata the
  # frontend needs to render or edit them.
  type RdfFieldValue {
    name: String!
    label: String
    value: String
    warning: String
    backupValue: String
    kind: String!
    datatype: String
    required: Boolean
    inputType: String
    allowMultiple: Boolean
    encrypted: Boolean
    subfields: [RdfStructureField!]
    options: [RdfStructureOption!]
  }

  type ReportItem {
    entryNumber: ID!
    uri: String!
    reportId: Int
    reportTitle: String
    reportNumber: String
    reportDate: String
    createdAt: String
    updatedAt: String
    fieldValues: [RdfFieldValue!]!
  }

  type Report {
    id: ID!
    selectedItemIds: [Int!]!
    createdAt: String
    updatedAt: String
    fieldValues: [RdfFieldValue!]!
  }

  # Compiled reports are generated presentation documents assembled from reports
  # and report items, then saved separately from RDF data.
  type CompiledReportConfig {
    organisationName: String
    reportSeriesTitle: String
    headerNote: String
    footerText: String
    accentColor: String
    includeFieldLabels: Boolean!
    itemFieldNames: [String!]!
  }

  type CompiledReport {
    id: ID!
    sourceReportId: ID!
    title: String!
    subtitle: String
    executiveSummary: String
    bodyMarkdown: String
    bodyHtml: String!
    selectedItemIds: [Int!]!
    itemFieldNames: [String!]!
    configSnapshot: String
    createdAt: String!
    updatedAt: String!
  }

  type ReportAutomation {
    id: ID!
    name: String!
    enabled: Boolean!
    intervalMinutes: Int!
    itemSelectionMode: String!
    selectedItemIds: [Int!]!
    reportFieldValues: [ReportAutomationFieldValue!]!
    compileEnabled: Boolean!
    compileItemFieldNames: [String!]!
    compiledConfig: CompiledReportConfig!
    nextRunAt: String
    lastRunAt: String
    lastReportId: ID
    lastCompiledReportId: ID
    lastRunMessage: String
    createdAt: String!
    updatedAt: String!
  }

  type ReportAutomationFieldValue {
    name: String!
    value: String
  }

  input CompiledReportConfigInput {
    organisationName: String
    reportSeriesTitle: String
    headerNote: String
    footerText: String
    accentColor: String
    includeFieldLabels: Boolean
    itemFieldNames: [String!]
  }

  input CompiledReportInput {
    sourceReportId: ID!
    title: String!
    subtitle: String
    executiveSummary: String
    bodyMarkdown: String
    bodyHtml: String!
    selectedItemIds: [Int!]!
    itemFieldNames: [String!]
    configSnapshot: String
  }

  input CompiledReportUpdateInput {
    title: String
    subtitle: String
    executiveSummary: String
    bodyMarkdown: String
    bodyHtml: String
    selectedItemIds: [Int!]
    itemFieldNames: [String!]
    configSnapshot: String
  }

  input ReportAutomationInput {
    name: String!
    enabled: Boolean!
    intervalMinutes: Int!
    itemSelectionMode: String!
    selectedItemIds: [Int!]
    reportFieldValues: [RdfFieldValueInput!]!
    compileEnabled: Boolean!
    compileItemFieldNames: [String!]
    compiledConfig: CompiledReportConfigInput
  }

  type RdfEntity {
    entityType: String!
    id: ID!
    uri: String!
    className: String
    importedIn: [RdfEntityReference!]!
    fieldValues: [RdfFieldValue!]!
  }

  type RdfEntityReference {
    entityType: String!
    id: ID!
    uri: String!
    className: String
    predicate: String
    label: String
  }

  type Query {
    # Authentication and organisation context.
    me: User
    users: [User!]!
    organisations: [Organisation!]!
    myOrganisations: [Organisation!]!

    # RDF structure and generic entity browsing.
    rdfStructure(organisationId: ID): RdfStructure!
    rdfStructurePresets(organisationId: ID): [RdfStructurePreset!]!
    rdfUriMigrationStatus(organisationId: ID!): RdfUriMigrationStatus!
    rdfEntities(entityType: String!, organisationId: ID, limit: Int, offset: Int): [RdfEntity!]!
    rdfEntityCount(entityType: String!, organisationId: ID): Int!

    # Report-item and report retrieval.
    reportItems(organisationId: ID, limit: Int, offset: Int): [ReportItem!]!
    reportItemCount(organisationId: ID): Int!
    reportItem(id: ID!, organisationId: ID): ReportItem
    reports(organisationId: ID, limit: Int, offset: Int): [Report!]!
    reportCount(organisationId: ID): Int!
    report(id: ID!, organisationId: ID): Report

    # Compiled report retrieval.
    compiledReportConfig(organisationId: ID): CompiledReportConfig!
    compiledReports(organisationId: ID): [CompiledReport!]!
    compiledReport(id: ID!, organisationId: ID): CompiledReport
    reportAutomations(organisationId: ID): [ReportAutomation!]!
  }

  type Mutation {
    # Account lifecycle.
    requestSignUpCode(email: String!, password: String!, name: String, captchaToken: String!): Boolean!
    signUp(email: String!, password: String!, name: String, verificationCode: String!): AuthPayload!
    signIn(email: String!, password: String!): AuthPayload!
    signOut: Boolean!
    updateMyAccount(email: String!, name: String): User!
    updateMyPassword(currentPassword: String!, newPassword: String!): Boolean!
    deleteUser(id: ID!): User!

    # Organisation lifecycle and membership.
    createOrganisation(name: String!, description: String, joinRequiresPassword: Boolean, joinPassword: String): Organisation!
    provisionOrganisationRepository(id: ID!): Organisation!
    joinOrganisation(id: ID!, password: String): Organisation!
    leaveOrganisation(id: ID!): Boolean!
    updateOrganisation(id: ID!, name: String!, description: String, joinRequiresPassword: Boolean!, joinPassword: String): Organisation!
    updateOrganisationMemberRole(organisationId: ID!, userId: ID!, role: String!): Organisation!
    upsertOrganisationRole(organisationId: ID!, id: ID, name: String!, permissions: OrganisationRolePermissionsInput!): Organisation!
    deleteOrganisation(id: ID!): Boolean!

    # RDF structure editing and preset management.
    updateRdfStructure(json: String!, organisationId: ID): RdfStructure!
    migrateOrganisationUris(organisationId: ID!): RdfUriMigrationStatus!
    saveRdfStructurePreset(name: String!, json: String!, organisationId: ID, scope: String): RdfStructurePreset!
    loadRdfStructurePreset(id: ID!, organisationId: ID, scope: String): RdfStructure!
    deleteRdfStructurePreset(id: ID!, organisationId: ID, scope: String): Boolean!

    # Dynamic report item CRUD.
    createReportItemFromFields(fieldValues: [RdfFieldValueInput!]!, organisationId: ID): ReportItem!
    updateReportItemFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): ReportItem
    deleteReportItem(id: ID!, organisationId: ID): Boolean!

    # Report CRUD and report-item membership.
    createReportFromFields(fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!], organisationId: ID): Report!
    updateReportFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!], organisationId: ID): Report
    deleteReport(id: ID!, organisationId: ID): Boolean!

    addItemToReport(reportId: ID!, itemId: ID!, organisationId: ID): Boolean!
    removeItemFromReport(reportId: ID!, itemId: ID!, organisationId: ID): Boolean!

    # Compiled report persistence.
    updateCompiledReportConfig(config: CompiledReportConfigInput!, organisationId: ID): CompiledReportConfig!
    createCompiledReport(input: CompiledReportInput!, organisationId: ID): CompiledReport!
    updateCompiledReport(id: ID!, input: CompiledReportUpdateInput!, organisationId: ID): CompiledReport!
    upsertReportAutomation(id: ID, input: ReportAutomationInput!, organisationId: ID): ReportAutomation!
    deleteReportAutomation(id: ID!, organisationId: ID): Boolean!
    runReportAutomation(id: ID!, organisationId: ID): ReportAutomation!

    # Generic RDF entity CRUD for custom classes.
    createRdfEntityFromFields(entityType: String!, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): RdfEntity!
    updateRdfEntity(entityType: String!, id: ID!, uri: String, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): RdfEntity!
    deleteRdfEntity(entityType: String!, id: ID!, uri: String, organisationId: ID): Boolean!
  }
`;
