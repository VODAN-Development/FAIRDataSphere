export default function About() {
  return (
    <main className="settings-page">
      <div className="rdf-structure-window app-browser-window about-browser-window">
        <div className="rdf-window-header">
          <h2>About</h2>
        </div>

        <aside className="rdf-class-sidebar about-sidebar">
          <div className="rdf-class-sidebar-heading">
            <h3>Information</h3>
          </div>

          <div className="about-option-list" role="tablist" aria-label="About sections">
            <button
              type="button"
              className="about-option-button active"
              role="tab"
              aria-selected="true"
            >
              Overview
            </button>
          </div>
        </aside>

        <main className="rdf-field-pane about-detail-pane">
          <section className="about-detail-section">
            <div className="rdf-editor-heading">
              <h3>Overview</h3>
            </div>
            <p>
              This application is designed to help users create, manage, and analyze situation reports for various incidents and events.
            </p>
          </section>
        </main>
      </div>
    </main>
  );
}
