export const en = {
  common: {
    htmlLang: 'en',
    footer: {
      managePreferencesLink: 'Manage notification preferences',
      managePreferencesText: 'Manage notification preferences: {{url}}',
      poweredBy: 'Powered by KANAP',
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
      goToKanap: 'Go to KANAP',
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
    weeklyReview: {
      subject: 'Your KANAP Weekly Review - Week of {{weekLabel}}',
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
      subject: 'Confirm your KANAP workspace',
      intro: 'Thanks for your interest in KANAP. Please confirm your email to provision your tenant.',
      copyPaste: 'If the button above does not work, copy and paste this link into your browser:',
      expires: 'The link expires in 48 hours. If you did not request this trial you can ignore this message.',
      textIntro: 'Thanks for your interest in KANAP. Confirm your email to provision your tenant.',
      textAction: 'Activate your workspace: {{url}}',
    },
    passwordReset: {
      subject: 'Reset your KANAP password',
      intro: 'We received a request to reset the password associated with this email address.',
      copyPaste: 'If the button above does not work, copy and paste this link into your browser:',
      expires: 'This link will expire in approximately {{minutes}} minutes. If you did not request a password reset, you can safely ignore this email.',
      textAction: 'Reset your password: {{url}}',
    },
    userInvite: {
      subject: 'You are invited to KANAP',
      intro: 'You have been invited{{inviterPart}} to join KANAP{{rolePart}}.',
      inviterPart: ' by {{inviterEmail}}',
      rolePart: ' as {{roleName}}',
      copyPaste: 'If the button above does not work, copy and paste this link into your browser:',
      expires: 'This link will expire in approximately {{minutes}} minutes. Once complete, you can sign in using your email and new password.',
      textAction: 'Set your password: {{url}}',
    },
  },
  workspace: {
    reset: {
      subject: 'Your KANAP workspace was reset',
      heading: 'Workspace reset to its starting state',
      bodyHtml: '<strong>{{actorName}}</strong> erased all the content of the workspace <strong>{{workspaceName}}</strong> on {{date}}. The workspace is back to its starting state. User accounts and their roles, the subscription and the audit log were kept.',
      text: '{{actorName}} erased all the content of the workspace {{workspaceName}} on {{date}}. The workspace is back to its starting state. User accounts and their roles, the subscription and the audit log were kept. Open the workspace: {{url}}',
      cta: 'Open the workspace',
    },
  },
} as const;

type DeepStringShape<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly DeepStringShape<U>[]
    : { [K in keyof T]: DeepStringShape<T[K]> };

export type EmailStrings = DeepStringShape<typeof en>;
