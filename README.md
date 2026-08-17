# FAIR Data Sphere

## Overview

FAIR Data Sphere is a full-stack web application for creating, managing, and analyzing situation reports for incidents and events. It combines a React frontend, a Node/Apollo GraphQL backend, and an AllegroGraph RDF store so report data can be captured through user-friendly forms while remaining available as structured RDF.

The application supports authenticated users, organisation workspaces, role-based access, configurable RDF structures, report item management, compiled reports, and scheduled report automation.

### Main Objective

The project aims to make situation-report data easier to capture, organize, reuse, and query in a FAIR-oriented workflow. Users can enter incident data through dynamic forms, link items into reports, maintain organisation-specific RDF models, and persist the resulting data in a graph database for later retrieval and analysis.

## Common Data Model

The common data model is defined as an editable RDF structure. The default model includes:

- `hds:SituationReport` for compiled or curated situation reports.
- `hds:Situation` for individual report items or incident entries.
- Supporting entities such as `hds:Location`, `hds:Organisation`, `hds:Perpetrator`, `schema:Person`, `schema:Place`, and `hds:Victim`.
- Common vocabularies and prefixes including `rdf`, `rdfs`, `owl`, `xsd`, `geo`, `schema`, `foaf`, `hds`, `sitrep`, and `resource`.

Report items include fields such as entry number, title, paragraph, date of event, location, event type, source, created date, and updated date. Event-type options can capture more specific data for military conflict, human rights abuses, humanitarian and health crises, political developments, economic issues, social developments, environmental issues, international response, trafficking, and media targeting.

The RDF structure drives both the frontend forms and the generated RDF triples. Administrators and organisation owners can edit fields, classes, predicates, datatypes, URI templates, nested groups, linked entities, and presets through the RDF Structure page.

## ETL Integration

FAIR Data Sphere performs application-level extract, transform, and load through its GraphQL and RDF layers:

- Extract: Users enter report items, linked entities, reports, and organisation settings through the React interface. Existing RDF-backed entities can be retrieved through GraphQL queries.
- Transform: The backend maps dynamic form fields to RDF predicates, datatypes, URI templates, nested resources, and linked entities based on the active RDF structure.
- Load: Generated triples are written to AllegroGraph. Report and report-item records can then be queried by the application, browsed as RDF entities, and reused in reports or compiled outputs.

The backend also supports organisation-specific RDF structures and presets, which allows different teams to adapt the data model while retaining core report and report-item behavior.

## Installation and Setup Instructions

### Docker Compose

The recommended production-style setup uses Docker Compose from the repository root.

1. Copy the root environment file:

   ```bash
   cp .env.example .env
   ```

2. Fill in the required values in `.env`, especially domain names, AllegroGraph credentials, `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`, `REPOSITORY_PASSWORD_ENCRYPTION_KEY`, and `JOIN_PASSWORD_ENCRYPTION_KEY`.

3. Start the stack:

   ```bash
   docker compose up --build
   ```

This starts:

- Caddy as the public reverse proxy.
- AllegroGraph for RDF storage.
- The backend GraphQL API on port `4000` internally.
- The built frontend served by nginx.

### Local Development

You can also run the frontend and backend directly.

1. Install backend dependencies:

   ```bash
   cd backend-rdf
   npm install
   cp .env.example .env
   npm start
   ```

2. Install frontend dependencies in a separate terminal:

   ```bash
   cd sitrep-app
   npm install
   cp .env.example .env
   npm run dev
   ```

3. Open the Vite development URL, usually `http://localhost:5173`.

For direct local development, make sure the frontend `VITE_GRAPHQL_URL` points to the backend GraphQL endpoint, for example `http://localhost:4000/graphql`, and that the backend `FRONTEND_ORIGIN` matches the frontend URL.

### Prerequisites and Dependencies

- Node.js with npm.
- Docker and Docker Compose for the containerized setup.
- AllegroGraph, either through `docker-compose.yml` or an external AllegroGraph instance.
- A modern browser.

Main application dependencies include React, React Router, Apollo Client, GraphQL, Express, Apollo Server, bcryptjs, cookie-parser, and CORS middleware.

## Usage Guide

1. Create an account or sign in.
2. Create or join an organisation workspace.
3. Use Data Input to create report items from the active RDF-backed form.
4. Use Items to browse, edit, delete, and assign report items.
5. Use Reports to create reports and link selected report items.
6. Use RDF Structure to review or customize classes, fields, predicates, datatypes, linked entities, and presets.
7. Use Organisation to manage organisation details, membership, roles, repository credentials, and join settings.
8. Use Account to update your profile or password.

Admins can also work without a selected organisation to manage global structures and data where permitted.

## FAQ

### Where is the wiki?

No repository wiki is currently linked from this README. Project documentation can be expanded in this file, in `CONTRIBUTING.md`, or in the GitHub wiki if one is enabled.

### Where is data stored?

RDF data is stored in AllegroGraph. Some application metadata, such as users, organisations, compiled reports, and automation settings, is handled by the backend under `backend-rdf`.

### Can the RDF model be changed?

Yes. The RDF Structure page exposes the active structure and supports organisation-specific structures and presets. Core generated report and report-item fields are preserved because the backend depends on them.

### Is this intended for local development or deployment?

Both. Use `npm run dev` for frontend development, `npm start` for the backend, and Docker Compose for a production-like deployment with Caddy and AllegroGraph.

## Example

A typical workflow is:

1. An analyst signs in and selects an organisation.
2. The analyst creates a report item for an incident, including title, event date, location, event type, affected parties, casualties, narrative description, and source.
3. The backend transforms the submitted fields into RDF triples using the active RDF structure.
4. The item appears on the Items page and can be attached to a Situation Report.
5. The report can be reviewed, updated, compiled, or automated for recurring report generation.

## Contributing & Issue Reporting

For reuse, see the [license](https://github.com/Liamvd/FAIRDataSphere/blob/main/LICENSE). For contributing to this project, see the [contributor file](https://github.com/Liamvd/FAIRDataSphere/blob/main/CONTRIBUTING.md). For issue reporting, use the [issue board](https://github.com/Liamvd/FAIRDataSphere/issues).
