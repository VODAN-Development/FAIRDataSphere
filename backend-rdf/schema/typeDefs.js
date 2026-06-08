export default `#graphql
  type User {
    id: ID!
    email: String!
    name: String
    role: String!
  }

  type AuthPayload {
    user: User!
  }

  type OrganisationMember {
    user: User!
    role: String!
    joinedAt: String!
  }

  type Organisation {
    id: ID!
    name: String!
    description: String
    createdBy: ID!
    createdAt: String!
    updatedAt: String!
    repository: String
    repositoryUsername: String
    repositoryPassword: String
    repositoryReadUsername: String
    repositoryReadPassword: String
    joinRequiresPassword: Boolean!
    joinPassword: String
    currentUserRole: String
    members: [OrganisationMember!]!
  }

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

  type RdfStructurePreset {
    id: ID!
    name: String!
    json: String!
    createdBy: ID
    createdAt: String!
    updatedAt: String!
  }

  input RdfFieldValueInput {
    name: String!
    value: String
  }

  type RdfFieldValue {
    name: String!
    label: String
    value: String
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
    bodyHtml: String!
    selectedItemIds: [Int!]!
    itemFieldNames: [String!]!
    configSnapshot: String
    createdAt: String!
    updatedAt: String!
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
    bodyHtml: String!
    selectedItemIds: [Int!]!
    itemFieldNames: [String!]
    configSnapshot: String
  }

  input CompiledReportUpdateInput {
    title: String
    subtitle: String
    executiveSummary: String
    bodyHtml: String
    selectedItemIds: [Int!]
    itemFieldNames: [String!]
    configSnapshot: String
  }

  type RdfEntity {
    entityType: String!
    id: ID!
    uri: String!
    className: String
    fieldValues: [RdfFieldValue!]!
  }

  type Query {
    me: User
    organisations: [Organisation!]!
    myOrganisations: [Organisation!]!
    rdfStructure(organisationId: ID): RdfStructure!
    rdfStructurePresets(organisationId: ID): [RdfStructurePreset!]!
    rdfEntities(entityType: String!, organisationId: ID): [RdfEntity!]!
    reportItems(organisationId: ID): [ReportItem!]!
    reportItem(id: ID!, organisationId: ID): ReportItem
    reports(organisationId: ID): [Report!]!
    report(id: ID!, organisationId: ID): Report
    compiledReportConfig(organisationId: ID): CompiledReportConfig!
    compiledReports(organisationId: ID): [CompiledReport!]!
    compiledReport(id: ID!, organisationId: ID): CompiledReport
  }

  type Mutation {
    signUp(email: String!, password: String!, name: String): AuthPayload!
    signIn(email: String!, password: String!): AuthPayload!
    signOut: Boolean!
    updateMyAccount(email: String!, name: String): User!
    updateMyPassword(currentPassword: String!, newPassword: String!): Boolean!
    createOrganisation(name: String!, description: String): Organisation!
    joinOrganisation(id: ID!, password: String): Organisation!
    leaveOrganisation(id: ID!): Boolean!
    updateOrganisation(id: ID!, name: String!, description: String, joinRequiresPassword: Boolean!): Organisation!
    updateOrganisationMemberRole(organisationId: ID!, userId: ID!, role: String!): Organisation!
    deleteOrganisation(id: ID!): Boolean!

    updateRdfStructure(json: String!, organisationId: ID): RdfStructure!
    saveRdfStructurePreset(name: String!, json: String!, organisationId: ID): RdfStructurePreset!
    loadRdfStructurePreset(id: ID!, organisationId: ID): RdfStructure!

    createReportItemFromFields(fieldValues: [RdfFieldValueInput!]!, organisationId: ID): ReportItem!
    updateReportItemFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): ReportItem
    deleteReportItem(id: ID!, organisationId: ID): Boolean!

    createReportFromFields(fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!], organisationId: ID): Report!
    updateReportFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!], organisationId: ID): Report
    deleteReport(id: ID!, organisationId: ID): Boolean!

    addItemToReport(reportId: ID!, itemId: ID!, organisationId: ID): Boolean!
    removeItemFromReport(reportId: ID!, itemId: ID!, organisationId: ID): Boolean!
    updateCompiledReportConfig(config: CompiledReportConfigInput!, organisationId: ID): CompiledReportConfig!
    createCompiledReport(input: CompiledReportInput!, organisationId: ID): CompiledReport!
    updateCompiledReport(id: ID!, input: CompiledReportUpdateInput!, organisationId: ID): CompiledReport!
    createRdfEntityFromFields(entityType: String!, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): RdfEntity!
    updateRdfEntity(entityType: String!, id: ID!, uri: String, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): RdfEntity!
    deleteRdfEntity(entityType: String!, id: ID!, uri: String, organisationId: ID): Boolean!
  }
`;
