// Copy this shape into RELEASE_NOTES and replace the placeholder values when
// adding a new visible release note.
export const RELEASE_NOTE_TEMPLATE = {
  version: 'v0.0.0',
  date: '01-01-2026',
  title: 'Release title',
  summary: 'Short summary of the update.',
  sections: [
    {
      title: 'New',
      items: ['Users can customise, compile, edit, and download reports.'],
    },
    {
      title: 'Improved',
      items: ['Workflow or behavior that changed.'],
    },
    {
      title: 'Fixed',
      items: ['Minor bugs fixed related to update.'],
    },
  ],
};

// Release notes are ordered newest-first for the About page.
export const RELEASE_NOTES = [
    {
    version: 'v0.0.4',
    date: '18-08-2026',
    title: 'New additions and bug fixes',
    summary: 'Fixed duplicate predicates error, made UI changes to RDF structure page and enabled bulk upload.',
    sections: [
      {
        title: 'New',
        items: ['Users can manually and automatically bulk upload records.'],
      },
      {
        title: 'Improved',
        items: ['UI changes to RDF structure page.'],
      },
      {
        title: 'Fixed',
        items: ['Error message when trying to add or edit records due to duplicate predicates has been fixed.'],
      },
    ],
  },
  {
    version: 'v0.0.3',
    date: '09-06-2026',
    title: 'Multiple updates',
    summary: 'Improved rdf structure configuration and added report functionalities.',
    sections: [
      {
        title: 'New',
        items: ['Users can customise, compile, edit, and download reports.'],
        items: ['Users can create, load, import and delete presets.'],
        items: ['Global presets are available to all organisations.'],
      },
      {
        title: 'Improved',
        items: ['Classes can be imported into other classes rather than linking manually.'],
      },
      {
        title: 'Fixed',
        items: ['Issue fixed in this release.'],
      },
    ],
  },
  {
    version: 'v0.0.2',
    date: '23-05-2026',
    title: 'First update',
    summary: 'Small fixes and improvements.',
    sections: [
      {
        title: 'New',
        items: [
          'Organisation: owners can set a password to allow other users to join.',
          'Added search bar to find organisations in join panel.',
          'Added release notes.',
          'Added favicon.',
          'Added a leave button for organisations. Owners can only leave if at least one other owner remains.',
        ],
      },
      {
        title: 'Improved',
        items: [
          'Repository credentials are now visible to members of the organisation.',
          'Move "Create/join" organisation button to under organisation list',
          'Added encryption for repostitory passwords and organisation join passwords.',
          'Added organisation selector on dashboard.',
          'Added different allegrograph users for owners/member with members only having read access.',
          'Added link to allegrograph webview inside credentials tab.', 
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Organisation role setting inconsistencies. Owners can promote/demote members and guests to owner/member/guest. Members can promote guests to member.',
          'Class instances not showing in the items tab',
          'Reports stopped being visible when a report item added to it was deleted.',
          'Fixed various Apollo warnings and soon to be depreciated or required features.',
          'Fixed UI bug on rdf structure page.',
        ],
      },
    ],
  },
  {
    version: 'v0.0.1',
    date: '21-05-2026',
    title: 'Initial release',
    summary: 'FAIR Data Sphere is online.',
    sections: [
      {
        title: 'New',
        items: ['The FAIR Data Sphere application is launched.'],
      },
      {
        title: 'Improved',
        items: ['Nothing yet.'],
      },
      {
        title: 'Fixed',
        items: ['Nothing yet'],
      },
    ],
  }
];
