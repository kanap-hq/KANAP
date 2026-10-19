import type { AboutContent } from './types';

const content: AboutContent = {
  meta: {
    title: 'About',
    description:
      'KANAP is an open source IT governance project built by Friedrich Eva, an interim CIO: why it exists, why it is open source, how it is funded.',
  },
  header: {
    eyebrow: 'About',
    title: 'Built by a CIO, for CIOs',
    lead:
      'KANAP is an open source project born in the field: the back and forth of budget rounds, the application maps and documentation missing on the eve of an audit, the trade-offs between business requests.',
  },
  founder: {
    name: 'Friedrich Eva',
    role: 'founder',
    jobTitle: 'Interim CIO, founder of KANAP',
    photoAlt: 'Friedrich Eva, founder of KANAP',
    paragraphs: [
      "I am an interim CIO. My job: taking over or rebuilding an IT department, putting it at the heart of an ERP program, integrating the information systems of an acquired company, or simply making sure a transition is productive and effective. I have spent more than twenty years in IT, eight of them as CIO of two international mid-sized companies, first in distribution, then in manufacturing. I am CISSP and ISO 27001 Lead Implementer certified, and I work in French, English and German.",
    ],
    linkedinLabel: 'My LinkedIn profile',
  },
  sections: [
    {
      title: 'Why KANAP',
      paragraphs: [
        'I have often run into the same pain points: the budget spread across several Excel files, one or two application maps started and rarely kept up to date, projects somewhere else, contracts scattered between purchasing, legal and IT. And before every committee meeting, hours spent reconciling it all by hand.',
        'So I started KANAP to bring the essential tools of IT governance together in one place. First the budget, then the project portfolio, the application map, contracts, documentation. Reporting needs came next, and finally a built-in AI agent that makes it easier to find and summarize information. Today, KANAP is a modular platform for small and mid-sized companies: you can use a single module or several, depending on your context and needs.',
      ],
    },
    {
      title: 'A lab that ships to production',
      paragraphs: [
        "KANAP is also my lab. I build the tool I wish I had found each time I joined an IT department, and I test what AI actually changes day to day. That holds for the development of KANAP itself, which speeds up as AI improves, as much as for IT governance: agents that propose and act under human control, an MCP server to query your data from Claude or ChatGPT. Every feature in KANAP starts from a real need, met in the field.",
      ],
    },
    {
      title: 'Why open source',
      paragraphs: [
        "A governance tool holds an IT department's most sensitive information: its costs, its contracts, its suppliers, the weak spots of its information system. You must be able to read it, host it yourself and never be locked in.",
        'That is why KANAP is released under the AGPL v3 license: the code is public, you can install it on your own servers, modify it, and your data stays yours. If you entrust the run to KANAP, the application is hosted in Germany on dedicated servers, your data can be exported to CSV, and you can always move back to your own servers.',
      ],
    },
    {
      title: 'An independent project',
      paragraphs: [
        'KANAP is published by KANAP, a single-member French company (EURL) based in Obernai, Alsace. The project is self-funded and developed alongside my work as a CIO. That keeps it fully independent.',
        'As open source software, KANAP is entirely free. Paid services are optional and are there to save you time, secure your use or adapt the application: support, hosting, guidance and custom development. I bring you that guidance myself, with a CIO\'s eye. <a href="/offer">See the offer</a>',
        'Either way, the complete <a href="https://doc.kanap.net/">online help</a>, in four languages, guides you from your first steps to expert use.',
      ],
    },
  ],
  cta: {
    title: 'Try KANAP',
    body: '14 days, every feature, no credit card.',
    primary: 'Try KANAP for 14 days',
    secondary: 'Contact us',
  },
};

export default content;
