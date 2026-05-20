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
    rdfEntities(entityType: String!, organisationId: ID): [RdfEntity!]!
    reportItems(organisationId: ID): [ReportItem!]!
    reportItem(id: ID!, organisationId: ID): ReportItem
    reports(organisationId: ID): [Report!]!
    report(id: ID!, organisationId: ID): Report
  }

  type Mutation {
    signUp(email: String!, password: String!, name: String): AuthPayload!
    signIn(email: String!, password: String!): AuthPayload!
    signOut: Boolean!
    updateMyAccount(email: String!, name: String): User!
    updateMyPassword(currentPassword: String!, newPassword: String!): Boolean!
    createOrganisation(name: String!, description: String): Organisation!
    joinOrganisation(id: ID!): Organisation!
    updateOrganisation(id: ID!, name: String!, description: String): Organisation!
    updateOrganisationMemberRole(organisationId: ID!, userId: ID!, role: String!): Organisation!
    deleteOrganisation(id: ID!): Boolean!

    updateRdfStructure(json: String!, organisationId: ID): RdfStructure!

    createReportItemFromFields(fieldValues: [RdfFieldValueInput!]!, organisationId: ID): ReportItem!
    updateReportItemFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): ReportItem
    deleteReportItem(id: ID!, organisationId: ID): Boolean!

    createReportFromFields(fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!], organisationId: ID): Report!
    updateReportFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!], organisationId: ID): Report
    deleteReport(id: ID!, organisationId: ID): Boolean!

    addItemToReport(reportId: ID!, itemId: ID!, organisationId: ID): Boolean!
    removeItemFromReport(reportId: ID!, itemId: ID!, organisationId: ID): Boolean!
    createRdfEntityFromFields(entityType: String!, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): RdfEntity!
    updateRdfEntity(entityType: String!, id: ID!, uri: String, fieldValues: [RdfFieldValueInput!]!, organisationId: ID): RdfEntity!
    deleteRdfEntity(entityType: String!, id: ID!, uri: String, organisationId: ID): Boolean!
  }
`;
