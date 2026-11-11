import { AGENT_NAME, PRODUCT_NAME } from '../../config/product';

// The e-mail texts. In the notification sentences, `{{itemName}}`, `{{document}}`, `{{userName}}`
// and the other names are filled in bold in the HTML and between quotes in the text version
// (`common.labels.quoted`); the subjects take them as they are.
export const en = {
  common: {
    htmlLang: 'en',
    footer: {
      managePreferencesLink: 'Manage notification preferences',
      managePreferencesText: 'Manage notification preferences: {{url}}',
      poweredBy: `Powered by ${PRODUCT_NAME}`,
    },
    // `the`: the record in a sentence ("shared the application X"), `view`: its button.
    itemTypes: {
      request: { label: 'Request', the: 'the request', view: 'View the request' },
      project: { label: 'Project', the: 'the project', view: 'View the project' },
      task: { label: 'Task', the: 'the task', view: 'View the task' },
      contract: { label: 'Contract', the: 'the contract', view: 'View the contract' },
      opex: { label: 'Budget line', the: 'the budget line', view: 'View the budget line' },
      capex: { label: 'Budget line', the: 'the budget line', view: 'View the budget line' },
      asset: { label: 'Asset', the: 'the asset', view: 'View the asset' },
      application: { label: 'Application', the: 'the application', view: 'View the application' },
      location: { label: 'Location', the: 'the location', view: 'View the location' },
      connection: { label: 'Connection', the: 'the connection', view: 'View the connection' },
      interface: { label: 'Interface', the: 'the interface', view: 'View the interface' },
      document: { label: 'Document', the: 'the document', view: 'View the document' },
    },
    // The labels of the application (frontend `portfolio.json`, `common.json`).
    statuses: {
      task: { open: 'Open', in_progress: 'In progress', pending: 'Pending', in_testing: 'In testing', done: 'Done', cancelled: 'Cancelled' },
      project: { waiting_list: 'Waiting list', planned: 'Planned', in_progress: 'In progress', in_testing: 'In testing', on_hold: 'On hold', done: 'Done', cancelled: 'Cancelled' },
      request: { pending_review: 'Pending review', candidate: 'Candidate', approved: 'Approved', on_hold: 'On hold', rejected: 'Rejected', converted: 'Converted' },
      lifecycle: { enabled: 'Enabled', disabled: 'Disabled' },
    },
    priorities: { blocker: 'Blocker', high: 'High', normal: 'Medium', low: 'Low', optional: 'Optional' },
    teamRoles: {
      business_sponsor: 'Business sponsor',
      business_lead: 'Business lead',
      it_sponsor: 'IT sponsor',
      it_lead: 'IT lead',
    },
    /** A team in a sentence: "joins the IT team of the project X". */
    teams: {
      business_team: 'business team',
      it_team: 'IT team',
    },
    labels: {
      openDocument: 'Open the document',
      /** A button in the text version. */
      linkText: '{{label}}: {{url}}',
      quoted: '“{{value}}”',
      copyLink: 'If the button does not work, copy this link into your browser:',
      dueDate: 'Due date: {{value}}',
      noCommentContentHtml: '<p>(No comment content)</p>',
      message: 'Message: {{message}}',
      greetingHello: 'Hello,',
      greetingHelloName: 'Hello {{name}},',
      inDays: 'in {{count}} days',
      tomorrow: 'tomorrow',
      minutes: '{{count}} minutes',
      oneHour: '1 hour',
      hours: '{{count}} hours',
      oneDay: '1 day',
      days: '{{count}} days',
    },
    buttons: {
      openWorkspace: 'Open {{organisation}}',
      activateWorkspace: 'Activate my workspace',
      resetPassword: 'Choose a new password',
      setPassword: 'Set my password',
    },
  },
  taskActions: {
    respondAndSetInProgress: 'Respond and set in progress',
    markDone: 'Mark done',
    approve: 'Approve',
    setInProgress: 'Set in progress',
    reopen: 'Reopen',
    viewTask: 'View the task',
  },
  notifications: {
    statusChange: {
      subject: '{{itemName}}: status changed to {{newStatus}}',
      heading: 'Status changed to {{newStatus}}',
      sentences: {
        request: 'The request {{itemName}} moved from {{oldStatus}} to {{newStatus}}.',
        project: 'The project {{itemName}} moved from {{oldStatus}} to {{newStatus}}.',
        task: 'The task {{itemName}} moved from {{oldStatus}} to {{newStatus}}.',
        contract: 'The contract {{itemName}} moved from {{oldStatus}} to {{newStatus}}.',
        opex: 'The budget line {{itemName}} moved from {{oldStatus}} to {{newStatus}}.',
        capex: 'The budget line {{itemName}} moved from {{oldStatus}} to {{newStatus}}.',
      },
    },
    statusChangeWithComment: {
      commentLabel: 'Comment from {{authorName}}',
      commentText: '{{authorName}} commented: {{comment}}',
    },
    teamAdded: {
      subjects: {
        request: 'You join the request {{itemName}}',
        project: 'You join the project {{itemName}}',
      },
      sentences: {
        request: 'You join the request {{itemName}} as {{role}}.',
        project: 'You join the project {{itemName}} as {{role}}.',
      },
      teamSentences: {
        request: 'You join the {{team}} of the request {{itemName}}.',
        project: 'You join the {{team}} of the project {{itemName}}.',
      },
    },
    teamMemberAdded: {
      subjects: {
        request: '{{addedUserName}} joins the request {{itemName}}',
        project: '{{addedUserName}} joins the project {{itemName}}',
      },
      sentences: {
        request: '{{addedUserName}} joins the request {{itemName}} as {{role}}.',
        project: '{{addedUserName}} joins the project {{itemName}} as {{role}}.',
      },
      teamSentences: {
        request: '{{addedUserName}} joins the {{team}} of the request {{itemName}}.',
        project: '{{addedUserName}} joins the {{team}} of the project {{itemName}}.',
      },
    },
    comment: {
      heading: 'New comment',
      subjects: {
        request: '{{authorName}} commented on the request {{itemName}}',
        project: '{{authorName}} commented on the project {{itemName}}',
        task: '{{authorName}} commented on the task {{itemName}}',
      },
      intros: {
        request: '{{authorName}} commented on the request {{itemName}}:',
        project: '{{authorName}} commented on the project {{itemName}}:',
        task: '{{authorName}} commented on the task {{itemName}}:',
      },
    },
    share: {
      subject: '{{senderName}} shared {{theItem}} {{itemName}} with you',
      heading: 'Shared by {{senderName}}',
      sentence: '{{senderName}} shared {{theItem}} {{itemName}} with you.',
    },
    taskAssigned: {
      subject: '{{assignerName}} assigned you the task {{taskTitle}}',
      heading: 'Task assigned to you',
      sentence: '{{assignerName}} assigned you the task {{taskTitle}}.',
    },
    expirationWarning: {
      cancellation: {
        badge: 'Cancellation deadline',
        subject: '{{itemName}}: cancellation deadline {{when}}',
        heading: 'Cancellation deadline {{when}}',
        sentence: 'The contract {{itemName}} can be cancelled until {{date}}.',
      },
      contractEnd: {
        badge: 'End of contract',
        subject: '{{itemName}}: end of contract {{when}}',
        heading: 'End of contract {{when}}',
        sentence: 'The contract {{itemName}} ends on {{date}}.',
      },
      budgetLineEnd: {
        badge: 'End of validity',
        subject: '{{itemName}}: end of validity {{when}}',
        heading: 'End of validity {{when}}',
        sentence: 'The budget line {{itemName}} reaches its end of validity on {{date}}.',
      },
    },
    vulnerabilities: {
      subjectOne: '1 new vulnerability on your technologies',
      subject: '{{count}} new vulnerabilities on your technologies',
      heading: 'New vulnerabilities on your technologies',
      introOne: '1 new vulnerability concerns technologies you own for IT: critical, high or known to be exploited. Review it and set its state.',
      intro: '{{count}} new vulnerabilities concern technologies you own for IT: critical, high or known to be exploited. Review them and set their state.',
      severities: {
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
        none: 'None',
        unknown: 'Not rated',
      },
      exploited: 'Known to be exploited',
      nowExploited: 'Now known to be exploited',
      versions: 'Versions: {{versions}}',
      unknownVersion: 'version not recorded (potentially concerned)',
      view: 'Open the vulnerabilities',
      more: 'And {{count}} more: open the page to see them all.',
    },
    weeklyReview: {
      subject: 'Your week {{range}} on {{organisation}}',
      heading: 'Your week {{range}}',
      intro: 'Hello {{userName}}, here is your summary of the week.',
      introNoName: 'Hello, here is your summary of the week.',
      /** The week: its first day and its last one. */
      range: {
        sameMonth: 'from {{startDay}} to {{endDay}} {{month}}',
        twoMonths: 'from {{start}} to {{end}}',
      },
      stats: {
        completed: 'Completed',
        statusChanges: 'Status changes',
        openTasks: 'Open tasks',
      },
      sections: {
        tasksCompleted: 'Tasks you completed',
        projectStatusChanges: 'Project status changes',
        tasksCompletedOnProjects: 'Tasks completed on your projects',
        topTasks: 'Your top priority tasks',
        projectsLead: 'Projects you lead',
        projectsContribute: 'Projects you contribute to',
        newRequests: 'New requests',
      },
      dueLabel: 'Due date: {{dueDate}}',
    },
  },
  knowledge: {
    requested: {
      subjectReview: 'Review requested: {{documentRef}} {{documentTitle}}',
      subjectApproval: 'Approval requested: {{documentRef}} {{documentTitle}}',
      headingReview: 'Review requested',
      headingApproval: 'Approval requested',
      sentenceReview: '{{requesterName}} asks you to review the document {{document}}.',
      sentenceApproval: '{{requesterName}} asks you to approve the document {{document}}.',
    },
    approved: {
      subject: 'Document published: {{documentRef}} {{documentTitle}}',
      heading: 'Document published',
      sentence: 'The review of the document {{document}} is complete: it is approved and published.',
    },
    changesRequested: {
      subject: 'Changes requested: {{documentRef}} {{documentTitle}}',
      heading: 'Changes requested',
      intro: '{{actorName}} requests changes to the document {{document}}:',
    },
    cancelled: {
      subject: 'Review cancelled: {{documentRef}} {{documentTitle}}',
      heading: 'Review cancelled',
      sentence: '{{actorName}} cancelled the review of the document {{document}}. You have nothing left to do on this document.',
    },
  },
  auth: {
    ssoUserProvisioned: {
      subject: '{{userName}} is waiting for access',
      sentence: '{{userName}} ({{userEmail}}) has just signed in with Microsoft Entra. Their account was created without any access, until you assign them a role.',
      cta: 'Open the users',
    },
    activation: {
      subject: `Activate your ${PRODUCT_NAME} workspace`,
      intro: `Thank you for your interest in ${PRODUCT_NAME}. The button below confirms your address and creates your workspace; it remains valid for 48 hours.`,
      sample: 'While it is being created, we will prepare a complete sample company: when you first open it, you will choose to explore it or to start with your own data.',
      ignore: 'If you did not request this trial, ignore this message.',
    },
    passwordReset: {
      subject: 'Reset your password on {{organisation}}',
      intro: 'We received a request to reset your password. The button below lets you choose a new one; it remains valid for {{duration}}.',
      ignore: 'If you did not make this request, ignore this message: your current password remains valid.',
    },
    userInvite: {
      subject: 'Invitation to join {{organisation}}',
      intro: '{{inviterName}} invites you to join {{place}}.',
      introNoInviter: 'You can now join {{place}}.',
      placeWorkspace: `the {{organisation}} workspace on ${PRODUCT_NAME}`,
      placeProduct: PRODUCT_NAME,
      password: 'Choose your password to activate your account; this link remains valid for {{duration}}.',
      signIn: 'You will then sign in with your email address and this password.',
    },
    userInviteMicrosoft: {
      subject: 'Invitation to join {{organisation}}',
      intro: '{{inviterName}} invites you to join {{place}}.',
      introNoInviter: 'You are invited to join {{place}}.',
      placeWorkspace: `the {{organisation}} workspace on ${PRODUCT_NAME}`,
      placeProduct: PRODUCT_NAME,
      signIn: 'Sign in with your Microsoft account: on the sign-in page, choose "Sign in with Microsoft".',
      address: 'Workspace address:',
      textAction: 'Open {{organisation}}: {{url}}',
    },
  },
  workspace: {
    reset: {
      subject: 'Your {{organisation}} workspace was reset',
      sentence: `{{actorName}} erased all the content of the workspace {{workspaceName}} on {{date}}. The accounts and their roles, the subscription, the ${AGENT_NAME} settings and the audit log are kept.`,
      cta: 'Open the workspace',
    },
  },
  // The trial e-mails (email/trial-mails, doc/trial-mails.md). `{{name}}` placeholders that hold a
  // link are filled with an anchor in the HTML and with the address in the text version.
  trialMails: {
    signOff: 'Best regards,',
    signature: 'Friedrich',
    angleChosen: {
      budget: 'managing the IT budget',
      cartography: 'mapping the IT landscape',
      portfolio: 'tracking projects and requests',
    },
    pathNames: {
      budget: 'the IT budget',
      cartography: 'the IT landscape map',
      portfolio: 'projects and requests',
    },
    billingPath: 'Administration › Billing',
    installGuide: 'installation guide',
    footer: {
      reason: `You are receiving this message because you started a trial of ${PRODUCT_NAME}.`,
      unsubscribe: 'Stop receiving these messages',
      unsubscribeText: 'Stop receiving these messages: {{url}}',
    },
    j0: {
      subject: `Welcome to your ${PRODUCT_NAME} workspace`,
      ready: 'Your workspace {{workspace}} is ready.',
      founder: `I'm Friedrich, the founder of ${PRODUCT_NAME}. A CIO by trade, I built this tool out of my own struggles: Excel files scattered all over the place and a different tool for every facet of the information system. ${PRODUCT_NAME} brings all of this together in a single workspace.`,
      angle: 'What brings you here first is {{angle}}. To explore on your own, follow the “Your first five steps” guide on your home page. Each step is detailed in {{guide}}. I also invite you to try the other two paths: {{other1}}, {{other2}}.',
      // The titles of the first-steps pages, quoted: in the text version the address follows the quote.
      guideTitles: {
        budget: `“Your IT budget in ${PRODUCT_NAME} in ten minutes”`,
        cartography: `“Your IT landscape in ${PRODUCT_NAME} in ten minutes”`,
        portfolio: `“Your portfolio in ${PRODUCT_NAME} in ten minutes”`,
      },
      noAngle: `To explore on your own, three ten-minute paths are waiting for you: {{budget}}, {{cartography}}, {{portfolio}}. Choose one in “About ${PRODUCT_NAME}”: its five steps then appear on your home page.`,
      call: `To talk it over, book a thirty-minute discovery call by video, at a time that suits you. We will look at your situation, your goals and what ${PRODUCT_NAME} can bring you. It is free and with no commitment.`,
      button: 'Book a discovery call',
      reply: 'You can also simply reply to this message: I will get back to you quickly.',
      replyAlone: 'You can simply reply to this message: I will get back to you quickly.',
    },
    j5: {
      subject: 'Five days into your trial: where do you stand?',
      question: 'It has been five days since you activated your workspace {{workspace}}. Are you finding what you were looking for?',
      angle: 'The “Your first five steps” guide on your home page is the quickest way to find out. Each step is detailed in {{guide}}.',
      noAngle: `The three ten-minute paths are the quickest way to find out: {{budget}}, {{cartography}}, {{portfolio}}. Choose one in “About ${PRODUCT_NAME}”: its five steps then appear on your home page.`,
      call: 'If you would rather talk it over, book a thirty-minute discovery call, free and with no commitment: {{call}}',
      reply: 'You can simply reply to this message: I will get back to you quickly.',
    },
    j12: {
      subject: 'Your trial ends in two days',
      end: 'Your trial ends on {{date}}. Your workspace will then become read-only: your data will remain viewable and exportable for thirty days, then the workspace will be deleted.',
      options: 'To continue, two options:',
      hostedLabel: 'The hosted version',
      hosted: '{{label}}: {{monthly}} per month or {{annual}} per year, to activate in Administration › Billing.',
      onPremiseLabel: 'Installing it yourself',
      onPremise: '{{label}}: free, on your own servers, with all your data ({{install}}). Support and help getting started are offered as options: {{offer}}.',
      offer: 'see the offer',
      button: 'Activate the subscription',
      closing: `I would be delighted to count you among the users of ${PRODUCT_NAME}, and I remain at your disposal for any question.`,
    },
    ended: {
      subject: `Your ${PRODUCT_NAME} trial has ended`,
      body: `Your trial has ended and your workspace is now read-only. It will be permanently deleted on {{date}}, with all its data. Until then, you can reactivate your workspace ({{billing}}), export your data from each list, or install ${PRODUCT_NAME} yourself for free ({{install}}).`,
      question: `One last question: what was missing for you to continue? Not the right time, a need ${PRODUCT_NAME} does not cover, a blocking detail: your answer, even in one line, would help me a lot!`,
      thanks: `Thank you for trying ${PRODUCT_NAME}.`,
    },
    thanks: {
      subject: 'Thank you for your trust',
      body: 'Your subscription is recorded and your workspace {{workspace}} is active; everything you entered during the trial is kept.',
      help: 'A question, a problem, or the wish to speed up your start? Write to {{support}}: our team will answer you and can support you. For anything else, simply reply to this message.',
      button: `Open ${PRODUCT_NAME}`,
    },
    unsubscribe: {
      title: 'Trial messages',
      question: `Stop receiving the ${PRODUCT_NAME} trial messages for the workspace {{workspace}}?`,
      confirm: 'Stop the messages',
      done: 'Done: you will no longer receive the trial messages for the workspace {{workspace}}.',
      invalid: 'This link is no longer valid.',
    },
  },
} as const;

type DeepStringShape<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly DeepStringShape<U>[]
    : { [K in keyof T]: DeepStringShape<T[K]> };

export type EmailStrings = DeepStringShape<typeof en>;
