import { COMPANY_NAME, PRODUCT_NAME } from '../../config/product';

export const en = {
  common: {
    htmlLang: 'en',
    footer: {
      managePreferencesLink: 'Manage notification preferences',
      managePreferencesText: 'Manage notification preferences: {{url}}',
      poweredBy: `Powered by ${PRODUCT_NAME}`,
    },
    itemTypes: {
      request: { label: 'Request', lower: 'request', view: 'View Request' },
      project: { label: 'Project', lower: 'project', view: 'View Project' },
      task: { label: 'Task', lower: 'task', view: 'View Task' },
      contract: { label: 'Contract', lower: 'contract', view: 'View Contract' },
      opex: { label: 'OPEX Item', lower: 'OPEX item', view: 'View OPEX Item' },
      capex: { label: 'CAPEX Item', lower: 'CAPEX item', view: 'View CAPEX Item' },
      asset: { label: 'Asset', lower: 'asset', view: 'View Asset' },
      application: { label: 'Application', lower: 'application', view: 'View Application' },
      location: { label: 'Location', lower: 'location', view: 'View Location' },
      connection: { label: 'Connection', lower: 'connection', view: 'View Connection' },
      interface: { label: 'Interface', lower: 'interface', view: 'View Interface' },
      document: { label: 'Document', lower: 'document', view: 'View Document' },
    },
    labels: {
      openDocument: 'Open Document',
      openDocumentText: 'Open document: {{url}}',
      viewText: 'View: {{url}}',
      titleHtml: 'Title: <strong>{{value}}</strong>',
      titleText: 'Title: {{value}}',
      dueDateHtml: 'Due date: <strong>{{value}}</strong>',
      dueDateText: 'Due: {{value}}',
      noCommentContentHtml: '<p>(No comment content)</p>',
      messageText: 'Message: "{{message}}"',
      greetingHello: 'Hello,',
      greetingHelloName: 'Hello {{name}},',
    },
    buttons: {
      openWorkspace: 'Open {{organisation}}',
      activateWorkspace: 'Activate my workspace',
      resetPassword: 'Reset password',
      setPassword: 'Set your password',
    },
  },
  taskActions: {
    respondAndSetInProgress: 'Respond & Set In Progress',
    markDone: 'Mark Done',
    approve: 'Approve',
    setInProgress: 'Set In Progress',
    reopen: 'Reopen',
    viewTask: 'View Task',
  },
  notifications: {
    statusChange: {
      subject: '{{itemType}} "{{itemName}}" status updated',
      heading: '{{itemType}} Status Update',
      updatedHtml: 'The {{itemTypeLower}} <strong>{{itemName}}</strong> has been updated.',
      statusChangedHtml: 'Status changed from <strong>{{oldStatus}}</strong> to <strong>{{newStatus}}</strong>.',
      text: '{{itemType}} "{{itemName}}" status changed from {{oldStatus}} to {{newStatus}}.',
    },
    statusChangeWithComment: {
      subject: '{{itemType}} "{{itemName}}": status changed to {{newStatus}}',
      commentIntroHtml: '<strong>{{authorName}}</strong> added a comment:',
      textComment: '{{authorName}} commented: "{{commentPreview}}".',
    },
    teamAdded: {
      subject: `You've been added to {{itemType}} "{{itemName}}"`,
      heading: `You've Been Added to a {{itemType}}`,
      bodyHtml: 'You have been added as <strong>{{role}}</strong> on <strong>{{itemName}}</strong>.',
      text: `You've been added as {{role}} on {{itemType}} "{{itemName}}".`,
    },
    teamMemberAdded: {
      subject: 'New team member on {{itemType}} "{{itemName}}"',
      heading: 'New Team Member',
      bodyHtml: '<strong>{{addedUserName}}</strong> has been added as <strong>{{role}}</strong> on {{itemTypeLower}} <strong>{{itemName}}</strong>.',
      text: '{{addedUserName}} has been added as {{role}} on {{itemType}} "{{itemName}}".',
    },
    comment: {
      subject: 'New comment on {{itemType}} "{{itemName}}"',
      heading: 'New Comment',
      introHtml: '<strong>{{authorName}}</strong> commented on {{itemTypeLower}} <strong>{{itemName}}</strong>:',
      text: '{{authorName}} commented on {{itemType}} "{{itemName}}": "{{commentPreview}}".',
    },
    share: {
      subject: '{{senderName}} shared {{itemType}} "{{itemName}}" with you',
      heading: '{{itemType}} Shared With You',
      introHtml: '<strong>{{senderName}}</strong> shared the {{itemTypeLower}} <strong>{{itemName}}</strong> with you.',
      text: '{{senderName}} shared {{itemType}} "{{itemName}}" with you.',
    },
    taskAssigned: {
      subject: 'Task assigned: "{{taskTitle}}"',
      heading: 'Task Assigned to You',
      introHtml: '<strong>{{assignerName}}</strong> assigned you the task <strong>{{taskTitle}}</strong>.',
      text: '{{assignerName}} assigned you the task "{{taskTitle}}".',
      dueTextSuffix: ' Due: {{dueDate}}.',
    },
    expirationWarning: {
      warningTypes: {
        expiration: {
          label: 'expiration',
          heading: 'Expiration',
        },
        cancellation_deadline: {
          label: 'cancellation deadline',
          heading: 'Cancellation Deadline',
        },
      },
      subject: '{{itemType}} "{{itemName}}" {{warningLabel}} in {{daysRemaining}} days',
      heading: '{{itemType}} {{warningHeading}} Warning',
      bodyHtml: 'The {{itemTypeLower}} <strong>{{itemName}}</strong> has a {{warningLabel}} coming up on <strong>{{expirationDate}}</strong> ({{daysRemaining}} days remaining).',
      text: '{{itemType}} "{{itemName}}" {{warningLabel}} on {{expirationDate}} ({{daysRemaining}} days).',
    },
    vulnerabilities: {
      subject: 'New vulnerabilities on your technologies ({{count}})',
      heading: 'New vulnerabilities on your technologies',
      intro: `${PRODUCT_NAME} found vulnerabilities on technologies you own for IT ({{count}}): critical or high, or known to be exploited. Review them and set their state.`,
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
      view: 'Open vulnerabilities',
      more: 'And {{count}} more: open the page to see them all.',
    },
    weeklyReview: {
      subject: 'Your {{organisation}} Weekly Review - Week of {{weekLabel}}',
      introHtml: `Hi {{userName}}, here's your summary for the week of <strong>{{weekLabel}}</strong>.`,
      introText: `Hi {{userName}}, here's your summary for the week of {{weekLabel}}.`,
      empty: 'No activity to report this week. Keep up the good work!',
      stats: {
        completed: 'Completed',
        statusChanges: 'Status Changes',
        openTasks: 'Open Tasks',
      },
      sections: {
        tasksCompleted: 'Tasks You Completed',
        projectStatusChanges: 'Project Status Changes',
        tasksCompletedOnProjects: 'Tasks Completed on Your Projects',
        topTasks: 'Your Top Priority Tasks',
        projectsLead: 'Projects You Lead',
        projectsContribute: 'Projects You Contribute To',
        newRequests: 'New Requests',
      },
      dueLabel: 'Due: {{dueDate}}',
    },
  },
  knowledge: {
    requested: {
      subjectReview: 'Review requested: {{documentRef}} {{documentTitle}}',
      subjectApproval: 'Approval requested: {{documentRef}} {{documentTitle}}',
      headingReview: 'Document Review Requested',
      headingApproval: 'Document Approval Requested',
      introReviewHtml: '<strong>{{requesterName}}</strong> requested a review for document <strong>{{documentRef}}</strong>.',
      introApprovalHtml: '<strong>{{requesterName}}</strong> requested an approval for document <strong>{{documentRef}}</strong>.',
      introReviewText: '{{requesterName}} requested a review for {{documentRef}}.',
      introApprovalText: '{{requesterName}} requested an approval for {{documentRef}}.',
    },
    approved: {
      subject: 'Document approved: {{documentRef}} {{documentTitle}}',
      heading: 'Document Approved',
      bodyHtml: 'The review workflow for <strong>{{documentRef}}</strong> has been approved and the document is now published.',
      text: 'The review workflow for {{documentRef}} has been approved and the document is now published.',
    },
    changesRequested: {
      subject: 'Changes requested: {{documentRef}} {{documentTitle}}',
      heading: 'Changes Requested',
      introHtml: '<strong>{{actorName}}</strong> requested changes for document <strong>{{documentRef}}</strong>.',
      text: '{{actorName}} requested changes for {{documentRef}}.',
      commentText: 'Comment: {{comment}}',
    },
    cancelled: {
      subject: 'Review cancelled: {{documentRef}} {{documentTitle}}',
      heading: 'Review Cancelled',
      introHtml: '<strong>{{actorName}}</strong> cancelled the active review workflow for document <strong>{{documentRef}}</strong>.',
      text: '{{actorName}} cancelled the active review workflow for {{documentRef}}.',
    },
  },
  auth: {
    ssoUserProvisioned: {
      subject: 'New user waiting for access',
      heading: 'A new user is waiting for access',
      bodyHtml: '<strong>{{userName}}</strong> ({{userEmail}}) signed in with Microsoft Entra and was added automatically. This person cannot use KANAP until you assign them a role.',
      text: '{{userName}} ({{userEmail}}) signed in with Microsoft Entra and was added automatically. This person cannot use KANAP until you assign them a role. Manage users: {{url}}',
      cta: 'Open user management',
    },
    activation: {
      subject: `Confirm your ${PRODUCT_NAME} workspace`,
      intro: `Thanks for your interest in ${PRODUCT_NAME}. Confirm your email address to create your workspace: the link below is valid for 48 hours. While your workspace is being created, we prepare a complete sample company; when you first open it, you will choose to explore it or start with your own data.`,
      copyPaste: 'If the button above does not work, copy and paste this link into your browser:',
      expires: "If you did not request this trial, you can ignore this message.",
      textIntro: `Thanks for your interest in ${PRODUCT_NAME}. Confirm your email address to create your workspace: the link below is valid for 48 hours. While your workspace is being created, we prepare a complete sample company; when you first open it, you will choose to explore it or start with your own data.`,
      textAction: 'Activate your workspace: {{url}}',
    },
    passwordReset: {
      subject: 'Reset your {{organisation}} password',
      intro: 'We received a request to reset the password associated with this email address.',
      copyPaste: 'If the button above does not work, copy and paste this link into your browser:',
      expires: 'This link will expire in approximately {{minutes}} minutes. If you did not request a password reset, you can safely ignore this email.',
      textAction: 'Reset your password: {{url}}',
    },
    userInvite: {
      subject: 'You are invited to {{organisation}}',
      intro: 'You have been invited{{inviterPart}} to join {{organisation}}{{rolePart}}.',
      inviterPart: ' by {{inviterEmail}}',
      rolePart: ' as {{roleName}}',
      copyPaste: 'If the button above does not work, copy and paste this link into your browser:',
      expires: 'This link will expire in approximately {{minutes}} minutes. Once complete, you can sign in using your email and new password.',
      textAction: 'Set your password: {{url}}',
    },
  },
  workspace: {
    reset: {
      subject: 'Your {{organisation}} workspace was reset',
      heading: 'Workspace reset to its starting state',
      bodyHtml: '<strong>{{actorName}}</strong> erased all the content of the workspace <strong>{{workspaceName}}</strong> on {{date}}. The workspace is back to its starting state. User accounts and their roles, the subscription and the audit log were kept.',
      text: '{{actorName}} erased all the content of the workspace {{workspaceName}} on {{date}}. The workspace is back to its starting state. User accounts and their roles, the subscription and the audit log were kept. Open the workspace: {{url}}',
      cta: 'Open the workspace',
    },
  },
  // The trial e-mails (email/trial-mails, doc/trial-mails.md). `{{name}}` placeholders that hold a
  // link are filled with an anchor in the HTML and with the address in the text version.
  trialMails: {
    signOff: 'Best regards,',
    signature: 'Friedrich',
    angleChosen: {
      budget: 'the IT budget',
      cartography: 'the IT landscape map',
      portfolio: 'projects and requests',
    },
    pathNames: {
      budget: 'the IT budget',
      cartography: 'the IT landscape map',
      portfolio: 'projects and requests',
    },
    guideTitles: {
      budget: `Your IT budget in ${PRODUCT_NAME} in ten minutes`,
      cartography: `Your information system in ${PRODUCT_NAME} in ten minutes`,
      portfolio: `Your portfolio in ${PRODUCT_NAME} in ten minutes`,
    },
    billingPath: 'Administration › Billing',
    footer: {
      reason: `You are receiving this message because you are trying ${PRODUCT_NAME}.`,
      unsubscribe: 'Stop receiving these messages',
      unsubscribeText: 'Stop receiving these messages: {{url}}',
    },
    j0: {
      subject: `Welcome to your ${PRODUCT_NAME} workspace`,
      ready: `Your workspace {{workspace}} is ready. I'm Friedrich, the founder of ${COMPANY_NAME}. A CIO by trade, I built this tool out of my own struggles: Excel files scattered everywhere and a different tool for every facet of the information system.`,
      angle: 'You chose to start with {{angle}}. To explore on your own, the "Your first five steps" list on your home page takes ten minutes, and its detailed guide is here: {{guide}}. You can also try the other two paths: {{other1}}, {{other2}}.',
      noAngle: 'I suggest three ten-minute paths to follow on your own, depending on what brings you here: {{budget}}, {{cartography}}, {{portfolio}}. Each one starts from the "Your first five steps" list on your home page.',
      call: 'To talk it over, book a thirty-minute discovery call with me by video, at a time that suits you. We will look at your situation and your goals, and I will answer your questions. It is free and with no commitment.',
      button: 'Book a discovery call',
      reply: 'You can also simply reply to this message: I read every reply.',
    },
    j5: {
      upcoming: {
        subject: 'How are your tests going?',
        body: 'Our discovery call is set for {{date}}. Until then, how are your tests going? If you prepare two or three questions, and the files you plan to import, we will make the most of those thirty minutes.',
        reply: 'For a quick question in the meantime, simply reply to this message.',
      },
      past: {
        subject: 'After our call',
        body: 'Thank you for our call on {{date}}. How have your tests gone since? If a question was left open, or a new one has come up, simply reply to this message: I will get back to you quickly.',
      },
      none: {
        subject: 'Five days into your trial: where do you stand?',
        question: `Five days into your trial is the right time to ask yourself a question: does ${PRODUCT_NAME} answer what brought you here?`,
        paths: 'The three ten-minute paths on your home page are the quickest way to find out: {{budget}}, {{cartography}}, {{portfolio}}.',
        call: 'If you would rather talk it over, book a thirty-minute discovery call, free and with no commitment: {{call}}.',
        available: 'I remain at your disposal.',
      },
    },
    j12: {
      subject: 'Your trial ends in two days',
      end: 'Your trial ends on {{date}}. Your workspace will then become read-only: your data will remain viewable and exportable for thirty days, then the workspace will be deleted.',
      options: 'To continue, two options:',
      hostedLabel: 'The hosted version',
      hosted: '{{label}}: {{monthly}} per month or {{annual}} per year, to activate in Administration › Billing.',
      onPremiseLabel: 'Installing it yourself',
      onPremise: `{{label}}: ${PRODUCT_NAME} is open source, so it is free ({{install}}). Support and help getting started are offered as options: {{offer}}.`,
      button: 'Activate the subscription',
      closing: `I would be delighted to count you among the users of ${PRODUCT_NAME}, and I remain at your disposal for any question.`,
    },
    ended: {
      subject: `Your ${PRODUCT_NAME} trial has ended`,
      body: `Your trial has ended and your workspace is now read-only. It will be permanently deleted on {{date}}, with all its data. Until then, you can reactivate your workspace ({{billing}}), export your data from each list, or install ${PRODUCT_NAME} yourself for free ({{install}}).`,
      question: `One last question: what was missing for you to continue? Not the right time, a need ${PRODUCT_NAME} does not cover, a detail that stopped you: your answer, even in one line, helps me a lot.`,
      thanks: `Thank you for trying ${PRODUCT_NAME}.`,
    },
    thanks: {
      subject: 'Thank you for your trust',
      body: 'Your subscription is recorded and your workspace {{workspace}} is active; everything you entered during the trial is kept.',
      help: 'Thank you for your trust. A question, a problem, or the wish to speed up your start? Write to {{support}}: our team will answer you and can support you. For anything else, simply reply to this message.',
      button: `Open ${PRODUCT_NAME}`,
    },
    unsubscribe: {
      title: 'Trial messages',
      question: `Stop receiving the ${PRODUCT_NAME} trial messages for the workspace {{workspace}}?`,
      confirm: 'Stop the messages',
      done: 'Done: you will no longer receive the trial messages for the workspace {{workspace}}.',
      invalid: 'This link is not valid.',
    },
  },
} as const;

type DeepStringShape<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly DeepStringShape<U>[]
    : { [K in keyof T]: DeepStringShape<T[K]> };

export type EmailStrings = DeepStringShape<typeof en>;
