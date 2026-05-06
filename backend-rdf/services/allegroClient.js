const ALLEGRO_URL = "http://localhost:10035/repositories/sitrep";
const USERNAME = "admin";
const PASSWORD = "8wGlOkPzt73LTI4s";

export async function runSparqlQuery(query) {
  const response = await fetch(ALLEGRO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      "Accept": "application/sparql-results+json",
      "Authorization":
        "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64"),
    },
    body: query,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SPARQL Error ${response.status}: ${text}`);
  }

  return response.json();
}

export async function runSparqlUpdate(update) {
  const response = await fetch(ALLEGRO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-update",
      "Accept": "text/plain",
      "Authorization":
        "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64"),
    },
    body: update,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SPARQL Update Error ${response.status}: ${text}`);
  }

  return response.text();
}
