// Copy this shape into RELEASE_NOTES and replace the placeholder values.
export const RELEASE_NOTE_TEMPLATE = {
  version: 'v0.0.0',
  date: '01-01-2026',
  title: 'Release title',
  summary: 'Short summary of the update.',
  sections: [
    {
      title: 'New',
      items: ['Feature added in this release.'],
    },
    {
      title: 'Improved',
      items: ['Workflow or behavior that changed.'],
    },
    {
      title: 'Fixed',
      items: ['Issue fixed in this release.'],
    },
  ],
};

export const RELEASE_NOTES = [
  {
    version: 'v0.0.2',
    date: '23-05-2026',
    title: 'First update',
    summary: 'Small fixes and improvements.',
    sections: [
      {
        title: 'New',
        items: ['Organisation: owners can set a password to allow other users to join.'],
        items: ['Added search bar to find organisations in join panel.'],
        items: ['Added release notes.'],
        items: ['Added favicon.'],
        items: ['Added a leave button for organisations. Owners can only leave if at least one other owner remains.'],
      },
      {
        title: 'Improved',
        items: ['Repository credentials are now visible to members of the organisation.'],
        items: ['Move "Create/join" organisation button to under organisation list'],
        items: ['Added encryption for repostitory passwords and organisation join passwords.'],
        items: ['Added organisation selector on dashboard.'],
        items: ['Added different allegrograph users for owners/member with members only having read access.'],
      },
      {
        title: 'Fixed',
        items: ['Organisation role setting inconsistencies. Owners can promote/demote members and guests to owner/member/guest. Members can promote guests to member.'],
        items: ['Class instances not showing in the itemss tab'],
        items: ['Reports stopped being visible when a report item added to it was deleted.'],
        items: ['Fixed various Apollo warnings and soon to be depreciated or required features.'],
        items: ['Fixed UI bug on rdf structure page.'],
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
