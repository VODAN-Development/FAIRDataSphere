import { useState } from 'react';
import { RELEASE_NOTES } from '../content/releaseNotes.js';

function ReleaseNotes() {
  // Release notes are static content rendered from data so updates do not require
  // changing the page markup.
  if (RELEASE_NOTES.length === 0) {
    return <p>Release notes will be posted here.</p>;
  }

  return (
    <div className="release-note-list">
      {RELEASE_NOTES.map(note => (
        <article key={`${note.version}-${note.date}`} className="release-note">
          <header className="release-note-header">
            <div>
              <h4>{note.title}</h4>
              {note.summary && <p>{note.summary}</p>}
            </div>
            <div className="release-note-meta">
              <strong>{note.version}</strong>
              <time dateTime={note.date}>{note.date}</time>
            </div>
          </header>

          {(note.sections || []).map(section => (
            section.items?.length ? (
              <section key={section.title} className="release-note-section">
                <h5>{section.title}</h5>
                <ul>
                  {section.items.map(item => <li key={item}>{item}</li>)}
                </ul>
              </section>
            ) : null
          ))}
        </article>
      ))}
    </div>
  );
}

const ABOUT_SECTIONS = {
  // The sidebar is data-driven; add a section here to expose another About tab.
  overview: {
    label: 'Overview',
    title: 'Overview',
    content: (
      <p>
        This application is designed to help users create, manage, and analyze situation reports for various incidents and events.
      </p>
    ),
  },
  releaseNotes: {
    label: 'Release Notes',
    title: 'Release Notes',
    content: <ReleaseNotes />,
  },
};

export default function About() {
  // About is a small tabbed view for static product information and release
  // history.
  const [activeSectionKey, setActiveSectionKey] = useState('overview');
  const activeSection = ABOUT_SECTIONS[activeSectionKey];

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
            {Object.entries(ABOUT_SECTIONS).map(([key, section]) => (
              <button
                key={key}
                type="button"
                className={`about-option-button${key === activeSectionKey ? ' active' : ''}`}
                role="tab"
                aria-selected={key === activeSectionKey}
                onClick={() => setActiveSectionKey(key)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </aside>

        <main className="rdf-field-pane about-detail-pane">
          <section className="about-detail-section">
            <div className="rdf-editor-heading">
              <h3>{activeSection.title}</h3>
            </div>
            {activeSection.content}
          </section>
        </main>
      </div>
    </main>
  );
}
