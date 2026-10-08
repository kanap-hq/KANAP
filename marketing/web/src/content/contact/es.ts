import type { ContactContent } from './types';

const content: ContactContent = {
  meta: {
    title: 'Contacto',
    description:
      'Póngase en contacto. Demos de producto, preguntas de despliegue, coordinación de compras, partenariados. Respondemos en un día hábil.',
  },
  header: {
    eyebrow: 'Contacto',
    title: 'Nos encantaría saber de usted.',
    lead: 'Demo, pregunta de despliegue, compras o partenariado, sea cual sea el motivo, leemos cada mensaje.',
  },
  responsePromise: 'Respuesta en un día hábil',
  highlightsLabel: 'En qué podemos ayudar',
  highlights: [
    'Demos de producto y orientación en el onboarding',
    'Solicitudes de conectores y agentes (díganos en qué sistema necesita que trabaje un agente)',
    'Coordinación de compras y facturación',
    'Consejo de instalación y actualización en autoalojado',
    'Consultas de partenariado e integración',
  ],
  form: {
    nameLabel: 'Nombre completo',
    emailLabel: 'Email profesional',
    companyLabel: 'Empresa',
    messageLabel: '¿En qué podemos ayudar?',
    messagePlaceholder: 'Cuéntenos brevemente qué busca.',
    captchaLabel: 'Verificación de seguridad',
    submitLabel: 'Enviar mensaje',
    submitting: 'Enviando…',
    successTitle: 'Mensaje enviado.',
    successBody: 'Le responderemos en un día hábil.',
    errorGeneric: 'Algo ha fallado. Inténtelo de nuevo o escriba directamente a support@kanap.net.',
  },
  alternate: {
    label: '¿Prefiere el email directo?',
    email: 'admin@kanap.net',
  },
};

export default content;
