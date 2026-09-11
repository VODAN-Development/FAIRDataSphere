# FAIR Data Sphere

## Overview

FAIR Data Sphere is a full-stack web application for creating, managing, and analysing situation reports for incidents and events. It combines a React frontend, a Node/Apollo GraphQL backend, and an AllegroGraph RDF store so report data can be captured through user-friendly forms after which it gets transformed into structured RDF.

The application supports authenticated users, organisation workspaces, role-based access, configurable RDF structures, report item management, compiled reports, and scheduled report automation.

### Main Objective

The project aims to make situation-report data easier to capture, organise, reuse, and query in a FAIR-oriented workflow. Users can enter incident data through dynamic forms, link items into reports, maintain organisation-specific RDF models, and persist the resulting data in a graph database for later retrieval and analysis.

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

3. Create the private AllegroGraph config from the tracked example:

   ```bash
   cp allegrograph/agraph.cfg.example allegrograph/agraph.cfg
   ```

   The real `allegrograph/agraph.cfg` is ignored by Git so deployment-only values, such as the Keycloak OAuth `client-secret`, do not get committed. Add the real `client-secret` to the copied file when the Keycloak client requires one.

4. Generate the internal AllegroGraph TLS files:

   ```bash
   mkdir -p certs

   openssl genrsa -out certs/agraph-ca.key 4096
   openssl req -x509 -new -nodes -key certs/agraph-ca.key -sha256 -days 825 -out certs/agraph-ca.crt -subj "/CN=Sitrep AllegroGraph Internal CA"

   openssl genrsa -out certs/agraph-server.key 2048
   openssl req -new -key certs/agraph-server.key -out certs/agraph-server.csr -subj "/CN=allegrograph"
   printf "subjectAltName=DNS:allegrograph,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n" > certs/agraph-server.ext
   openssl x509 -req -in certs/agraph-server.csr -CA certs/agraph-ca.crt -CAkey certs/agraph-ca.key -CAcreateserial -out certs/agraph-server.crt -days 825 -sha256 -extfile certs/agraph-server.ext

   cat certs/agraph-server.crt certs/agraph-server.key > certs/agraph-server.pem
   rm certs/agraph-server.csr certs/agraph-server.ext
   ```

   On Windows with OpenSSL available, you can instead run:

   ```powershell
   .\scripts\generate-agraph-certs.ps1
   ```

   The generated certificate files are ignored by Git. Keep `certs/agraph-ca.key` private; it can sign replacement internal certificates.

5. Start the stack:

   ```bash
   docker compose up --build
   ```

This starts:

- Caddy as the public reverse proxy for the frontend, backend API, Keycloak, and AllegroGraph WebView domains.
- AllegroGraph for RDF storage, using HTTPS on port `10036`.
- The backend GraphQL API on port `4000` internally.
- The built frontend served by nginx.

The AllegroGraph service mounts the ignored runtime file `allegrograph/agraph.cfg`. The tracked `allegrograph/agraph.cfg.example` disables plain HTTP with `AllowHTTP no`, enables `SSLPort 10036`, and reads the combined server certificate/private-key PEM from `/agraph/certs/server-cert-and-key.pem`. Docker Compose mounts `certs/agraph-server.pem` there. Caddy and the backend both mount `certs/agraph-ca.crt` so they can verify AllegroGraph's internal HTTPS certificate without disabling TLS verification.

The same config keeps repository instances warm for five minutes after their last access with `InstanceTimeout 5m`, then lets AllegroGraph close idle instances and release shared memory. This helps small servers keep many organisation repositories on disk without keeping every repository open in `/dev/shm`.

When changing AllegroGraph, Caddy, certificate, or environment settings, recreate the affected services so mounted files and environment variables are refreshed:

```bash
docker compose up -d --force-recreate allegrograph backend caddy
```

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
- Docker and Docker Compose for the containerised setup.
- AllegroGraph, either through `docker-compose.yml` or an external AllegroGraph instance.
- A modern browser.

Main application dependencies include React, React Router, Apollo Client, GraphQL, Express, Apollo Server, bcryptjs, cookie-parser, and CORS middleware.

## Usage Guide

1. Create an account or sign in.
2. Create or join an organisation workspace.
3. Use Data Input to create report items from the active RDF-backed form.
4. Use Items to browse, edit, delete, and assign report items.
5. Use Reports to create reports and link selected report items.
6. Use RDF Structure to review or customise classes, fields, predicates, datatypes, linked entities, and presets.
7. Use Organisation to manage organisation details, membership, roles, repository credentials, and join settings.
8. Use Account to update your profile or password.

Admins can also work without a selected organisation to manage global structures and data where permitted.

### Repository provisioning

Each organisation normally receives its own AllegroGraph repository during creation. If AllegroGraph cannot create the repository because shared memory is full, the organisation is still created in a pending state. Members can still join the organisation, owners can edit its profile, roles can be managed, and file-backed features such as compiled report settings remain available where they do not need RDF data.

Pending organisations cannot use RDF-backed pages such as Data Input, Items, Reports, or RDF entity browsing until the repository is provisioned. Owners and admins can open Organisation, select the pending workspace, and use **Try creating repository** after idle repositories have closed or memory has been freed.

### AllegroGraph HTTPS and Keycloak OAuth

AllegroGraph is intended to run behind Caddy but still speak HTTPS inside the Compose network. Public browsers connect to the AllegroGraph domain through Caddy, and Caddy proxies to `https://allegrograph:10036`. The backend also uses `ALLEGRO_BASE_URL=https://allegrograph:10036`.

Keycloak should only need HTTPS redirect URIs for AllegroGraph WebView. If Keycloak reports an HTTP redirect URI, check that the server has been recreated with the current `allegrograph/agraph.cfg`, `Caddyfile`, `.env`, and `docker-compose.yml` settings.

If Caddy fails with an error such as `failed reading ca cert: read /etc/caddy/certs/agraph-ca.crt: is a directory`, Docker previously created a directory because the cert file did not exist at container creation time. Remove the bad directory, regenerate the cert files, and recreate the services:

```bash
rm -rf certs/agraph-ca.crt certs/agraph-server.pem
# Regenerate certs, then:
docker compose up -d --force-recreate allegrograph backend caddy
```

## FAQ

### Where is the wiki?

No repository wiki is currently linked from this README. Project documentation can be expanded in this file, in `CONTRIBUTING.md`, or in the GitHub wiki if one is enabled.

### Where is data stored?

RDF data is stored in AllegroGraph. Some application metadata, such as users, organisations, compiled reports, and automation settings, is handled by the backend under `backend-rdf`.

### Can the RDF model be changed?

Yes. The RDF Structure page exposes the active structure and supports organisation-specific structures and presets. Core generated report and report-item fields are preserved because the backend depends on them.

### How do I fix AllegroGraph shared memory errors?

If SPARQL updates fail with an error such as `Could not create shared memory segment`, AllegroGraph cannot allocate enough shared memory for the repository operation. The Docker Compose setup configures the AllegroGraph container with `shm_size: 2g`, but an already-created container may need to be recreated before that setting takes effect:

```bash
docker compose up -d --force-recreate allegrograph
docker compose up -d --force-recreate backend
```

The compose setup also mounts `allegrograph/agraph.cfg`, where `InstanceTimeout 5m` tells AllegroGraph to close idle repository instances after roughly five minutes. The timeout is advisory, so cleanup may happen shortly after the five-minute mark rather than exactly on it. Recreate or restart the AllegroGraph container after changing this file:

```bash
docker compose up -d --force-recreate allegrograph
```

If the error persists, verify the live container has a large `/dev/shm` mount:

```bash
docker inspect --format '{{.HostConfig.ShmSize}}' "$(docker compose ps -q allegrograph)"
docker exec -it "$(docker compose ps -q allegrograph)" df -h /dev/shm
```

The shared-memory size should be larger than the requested segment size in the error, and idle repositories should release usage after the configured timeout. Also check that the host has enough available memory for AllegroGraph and Docker.

If repository creation fails while creating an organisation, FAIR Data Sphere saves the organisation without an AllegroGraph repository and marks it as pending. This keeps account, membership, profile, and role management available. Once shared memory is available again, retry from the Organisation page with **Try creating repository**.

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

For reuse, see the [license](https://github.com/VODAN-Development/FAIRDataSphere/blob/main/LICENSE). For contributing to this project, see the [contributor file](https://github.com/VODAN-Development/FAIRDataSphere/blob/main/CONTRIBUTING.md). For issue reporting, use the [issue board](https://github.com/VODAN-Development/FAIRDataSphere/issues).
