@startuml

|Expert|

start

:Find event information\\n(online or local source);

:Write short paragraph\\n(~2 sentences describing event);



|Application|

:Create new event item;



|Expert|

:Fill in event details:

\- Event title

\- Paragraph

\- Source

\- Event type (preset)

\- Other metadata;

:Save event item;



|Application|

:Transform event item to RDF;

:Send RDF data to AllegroGraph server;



|AllegroGraph Server|

:Store RDF triples;

:Allow SPARQL querying of events;



|Application|

:Query events using SPARQL;

if (Create report?) then (yes)



&nbsp; |Expert|

&nbsp; :Compile report;

&nbsp; :Save report;



&nbsp; |Application|

&nbsp; :Transform report to RDF;

&nbsp; :Send RDF data to AllegroGraph server;



&nbsp; |AllegroGraph Server|

&nbsp; :Store RDF triples;

&nbsp; :Allow SPARQL querying of reports;



&nbsp; |Application|

&nbsp; :Query reports using SPARQL;

else (no)

endif



if (Export query content?) then (yes)

&nbsp; if (Report/Event?) then (Report)

&nbsp;   :Export reports to PDF;

&nbsp; else (Event)

&nbsp;   :Export events to:

&nbsp;   - RDF

&nbsp;   - Plaintext

&nbsp;   - PDF

&nbsp;   - Image;

&nbsp; endif

&nbsp; if (Share/Download?) then (Share)

&nbsp;   :Share through:

&nbsp;   - WhatsApp;

&nbsp; else (Download)

&nbsp;   :Download to device;

&nbsp; endif

endif



stop

@enduml

