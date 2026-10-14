import type { ChangelogContent } from './types';

const content: ChangelogContent = {
  meta: {
    title: 'Changelog',
    description:
      'Release notes for KANAP: what each version brings to the people who use it. The technical list of changes is on GitHub.',
  },
  header: {
    eyebrow: 'Changelog',
    title: "What's new in KANAP.",
    lead:
      'KANAP publishes a version about once a month. The release notes below explain what each one brings to your team. Every version also has a GitHub release with the full list of changes.',
  },
  empty: 'The first release notes are on their way.',
  github: {
    label: 'Technical details',
    body: 'Every version has a GitHub release with all its changes, the upgrade steps for self-hosted installs and the component inventory.',
    cta: 'Watch releases on GitHub',
    href: 'https://github.com/kanap-hq/KANAP/releases',
  },
};

export default content;
