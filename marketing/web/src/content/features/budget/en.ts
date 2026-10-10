import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'IT budget: landing, next-year budget, chargeback',
    description:
      "Open source IT budgeting: OPEX and CAPEX, landing and next-year budget, chargeback, consolidation, cost per FTE, every line linked to your applications.",
  },
  header: {
    eyebrow: 'IT budget',
    title: 'Your IT budget, from landing to next year, linked to your applications.',
    lead: 'Multi-year OPEX and CAPEX, expected landing and next-year budget, chargeback to companies and departments, staffing and cost per FTE. Every line links to its applications, contracts and projects: you know what you pay for, and why.',
  },
  sections: [
    {
      title: 'From landing to next-year budget',
      body: 'The standard columns (budget, revision, actuals, expected landing) can be renamed and hidden to match your practice, from Y-2 to Y+2, with annual or monthly entry. Firm up the landing line by line, copy it into next year’s budget, then freeze the approved version.',
      bullets: [
        'OPEX and CAPEX in dedicated lists',
        'Budget, revision, actuals and landing columns, renamable',
        'Amounts as quantity × price, or spread by month',
        'Column copy with a dry run first',
        'Version freeze: the approved version stays put',
      ],
      shotAlt: 'OPEX budget grid with columns per year',
    },
    {
      title: 'Chargeback everyone understands',
      body: 'Split each line across the companies and departments that benefit from it, with six allocation methods. Percentages follow headcount or turnover as they change, and every allocation stays readable line by line.',
      bullets: [
        'By headcount (default)',
        'By IT users or by turnover',
        'Manual selection of companies or departments',
        'Percentages typed by hand',
        'One method per year and per line',
      ],
      shotAlt: 'Allocation editor of a budget line',
    },
    {
      title: 'Multi-company, multi-currency, consolidation',
      body: 'Each line keeps its currency, and everything rolls up into one reporting currency. Rates come from the World Bank and are fixed when the budget is frozen. Charts of accounts and a consolidation chart put your numbers in the structure finance uses.',
      bullets: [
        'One reporting currency for every total',
        'Automatic exchange rates, fixed at freeze',
        'List of allowed currencies',
        'Country charts of accounts and a consolidation chart',
        'Cost centers and budget holders',
      ],
      shotAlt: 'Currency settings with exchange rates',
    },
    {
      title: 'A report for every question',
      body: 'Global and per-company chargeback, trends, top increases and decreases, comparison of two versions, analytics dimensions, consolidation accounts, monthly staffing and cost per FTE. Every report row opens the matching filtered list, and Plaid answers the same questions in plain language.',
      bullets: [
        'Global and per-company chargeback',
        'Column comparison and OPEX and CAPEX trends',
        'Analytics dimensions and consolidation accounts',
        'Monthly staffing, cost per FTE and daily rate',
        'CSV export and chart images',
      ],
      shotAlt: 'Chargeback report by company',
    },
  ],
  more: {
    title: 'And also',
    items: [
      { title: 'Linked to applications and projects', body: 'Every spend item leads to its applications, projects and suppliers. An application record shows what it costs.' },
      { title: 'Contracts and deadlines', body: 'Yearly amount, auto-renewal, notice period and a computed cancellation deadline, linked to the budget lines.' },
      { title: 'Round trip with your spreadsheet', body: 'Export the lines, edit them in Excel or LibreOffice, import the file back: KANAP writes only the cells that changed.' },
      { title: 'Sample data', body: 'A trial fills up in a minute with the budget of Fromage & Co, four fictional companies, so you can see everything before entering yours.' },
    ],
  },
  crossLinks: {
    label: 'Explore the platform',
    links: [
      { label: 'Landscape', href: '/features/it-landscape' },
      { label: 'Project portfolio', href: '/features/portfolio' },
      { label: 'Documentation', href: '/features/knowledge' },
      { label: 'Plaid, the built-in AI agent', href: '/features/ai' },
      { label: 'Helpdesk agent', href: '/features/agents' },
    ],
  },
  cta: {
    title: 'Try KANAP on a complete IT budget.',
    body: 'Try hosted KANAP with sample data, or deploy it for free on your own servers.',
    primary: 'Deploy for free',
    secondary: 'Try it with sample data',
  },
};

export default content;
