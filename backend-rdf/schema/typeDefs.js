export default `#graphql
  type RdfStructureField {
    name: String!
    label: String
    predicate: String
    datatype: String
    required: Boolean
    generated: Boolean
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
    fieldValues: [RdfFieldValue!]!
  }

  type Query {
    rdfStructure: RdfStructure!
    reportItems: [ReportItem!]!
    reportItem(id: ID!): ReportItem
    reports: [Report!]!
    report(id: ID!): Report
  }

  type Mutation {
    updateRdfStructure(json: String!): RdfStructure!

    createReportItemFromFields(fieldValues: [RdfFieldValueInput!]!): ReportItem!
    updateReportItemFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!): ReportItem
    deleteReportItem(id: ID!): Boolean!

    createReportFromFields(fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!]!): Report!
    updateReportFromFields(id: ID!, fieldValues: [RdfFieldValueInput!]!, selectedItemIds: [Int!]): Report
    deleteReport(id: ID!): Boolean!

    addItemToReport(reportId: ID!, itemId: ID!): Boolean!
    removeItemFromReport(reportId: ID!, itemId: ID!): Boolean!
  }
`;
