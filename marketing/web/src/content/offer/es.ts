import type { OfferContent } from './types';

const content: OfferContent = {
  meta: {
    title: 'Oferta',
    description:
      'Gratis y open source. Autoaloje sin límites, añada soporte cuando lo necesite o elija KANAP alojado. Todas las funcionalidades en cada plan, agentes incluidos. AGPL v3.',
  },

  header: {
    eyebrow: 'Una oferta simple y transparente',
    title: 'Gratis y open source.\nAutoaloje, o déjenos operarlo.',
    lead: 'Todas las funcionalidades en cada plan. Sin feature gates, sin tasa por asiento, sin bloqueo. Pague solo por las operaciones y el soporte que no quiere llevar usted mismo.',
  },

  /* -------------------- Self-hosted (primary) -------------------- */
  selfHosted: {
    eyebrow: 'Elija su camino',
    title: 'Tres formas de usar KANAP',
    intro:
      'Empiece con la plataforma open source completa y autoalojada. Añada soporte si lo desea, cuando pase a producción, o elija la versión alojada si prefiere confiarnos la operación.',
    plans: [
      {
        name: 'Autoalojado',
        badge: 'Open source',
        target: 'Usuarios ilimitados · workspaces ilimitados',
        price: '0 €',
        period: '',
        subPrice: 'Gratis para siempre',
        features: [
          'Funcionalidad completa, sin límites',
          'Plaid y agentes incluidos, sin feature gate de IA',
          'Su propia clave LLM para Plaid y agentes',
          'Sus datos permanecen en su infraestructura',
          'Despliegue con Docker Compose en minutos',
          'Open source bajo AGPL v3',
          'Soporte comunitario vía GitHub issues',
        ],
        ctaLabel: 'Desplegar desde GitHub',
        ctaHref: 'https://github.com/kanap-hq/kanap',
        ctaVariant: 'primary',
      },
      {
        name: 'Soporte autoalojado',
        badge: 'On-prem con soporte de producción',
        target: 'Usuarios ilimitados · workspaces ilimitados',
        price: '2 490 €',
        period: '/año',
        subPrice: 'Facturación anual',
        features: [
          'Todo lo de Autoalojado',
          'Soporte por email prioritario',
          'Asistencia de instalación y actualización',
          'Línea directa con el equipo para problemas de producción',
          'Sesión inicial de 60 min con un experto de KANAP',
          'Más del 20 % de descuento en consultoría',
          'Apoya el proyecto open source',
        ],
        ctaLabel: 'Suscribirse',
        ctaHref: '#support-invoice',
        ctaVariant: 'primary',
      },
    ],
  },

  openSourceBanner: {
    title: 'Realmente open source, AGPL v3',
    body:
      'Todo el código fuente de KANAP está en GitHub. Léalo, audítelo, amplíelo, contribuya de vuelta. AGPL v3 garantiza que el código siga abierto, para todos. Sin forks propietarios, sin bloqueo.',
    linkLabel: 'Leer la licencia',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  /* -------------------- Cloud hosted (secondary) -------------------- */
  cloud: {
    eyebrow: 'Nube alojada · si prefiere que lo operemos nosotros',
    title: 'La misma plataforma, operada por nosotros.',
    intro:
      'KANAP alojado es la misma plataforma open source, operada por nosotros: alojamiento, actualizaciones, copias de seguridad, soporte prioritario y una sesión inicial de 60 minutos. Prueba de 14 días, sin tarjeta de crédito.',
    plans: [
      {
        name: 'KANAP alojado',
        badge: 'Totalmente gestionado',
        target: 'Usuarios ilimitados · workspaces ilimitados',
        price: '249 €',
        period: '/mes',
        subPrice: 'o 2 490 €/año (2 meses gratis)',
        features: [
          'Todo lo de Autoalojado',
          'Alojamos, actualizamos y respaldamos KANAP por usted',
          'Alojamiento en la UE para equipos europeos',
          '1 500 mensajes Plaid/mes incluidos, o su propia clave, sin límite',
          'Sesión inicial de 60 min con un experto de KANAP',
          'Soporte por email prioritario',
          'Más del 20 % de descuento en consultoría',
          'Apoya el proyecto open source',
        ],
        ctaLabel: 'Empezar prueba gratuita',
        ctaHref: '/trial/start',
        ctaVariant: 'primary',
      },
    ],
  },

  howToChoose: {
    title: 'Cómo elegir',
    intro: 'Elija según quién lleva las operaciones. Todos los planes incluyen todas las funcionalidades del producto.',
    items: [
      {
        title: 'Autoalojado · gratis',
        body: 'Tiene capacidad de TI y quiere el control total. Instálelo en su infraestructura y acceda a todas las funcionalidades. Soporte comunitario.',
      },
      {
        title: 'Autoalojado · con soporte',
        body: 'Necesita el modelo de despliegue autoalojado por soberanía, cumplimiento o privacidad, pero quiere soporte de producción y una línea directa para incidencias.',
      },
      {
        title: 'Nube alojada',
        body: 'Quiere el camino más rápido al valor sin operar infraestructura. El mismo producto, operado por KANAP.',
      },
    ],
  },

  services: {
    title: 'Experiencia y asesoría a su ritmo',
    intro: 'KANAP está diseñado para una adopción autoservicio. Si quiere ir más rápido, los planes de pago incluyen soporte prioritario y una tarifa de consultoría reducida.',
    support: {
      title: 'Soporte prioritario',
      subtitle: 'Incluido con cualquier plan de pago',
      body: 'Le garantizamos un soporte operativo de calidad, sin chatbot, formularios interminables ni centros de llamadas en el extranjero.',
      items: [
        'Bugs, errores, caídas, problemas de acceso',
        'Ayuda con la instalación on-prem',
        'Preguntas «¿es el comportamiento esperado?»',
        'Aclaraciones rápidas',
      ],
    },
    consulting: {
      title: 'Consultoría',
      subtitle: 'De pago · facturada por jornada',
      body: 'A cargo de un CIO experimentado, que conoce sus retos desde dentro. Ayuda opcional para sacar más valor de KANAP: llamadas programadas, trabajo más profundo, asesoramiento, funcionalidades a medida. Tarifa: 1 150 € la jornada, 900 € para clientes con contrato de soporte o alojamiento.',
      items: [
        'Instalación, configuración, onboarding, formación',
        'Diseño de flujos de trabajo y buenas prácticas',
        'Asesoramiento a CIO sobre su modelo de gobernanza de TI',
        'Desarrollo de funcionalidades específicas para sus necesidades',
        'Cualquier cosa que requiera una llamada programada',
      ],
    },
  },

  pilot: {
    title: 'Piloto guiado',
    subtitle: '2 900 € precio fijo',
    body: 'Un compromiso que pone a su equipo en marcha con KANAP: la instalamos con usted, traemos sus datos, formamos a su gente y su primer agente queda trabajando.',
    items: [
      'Instalación en sus servidores, o puesta en marcha alojada',
      'Le ayudamos a importar sus primeros datos clave',
      'Formación y onboarding de su equipo',
      'Configuración de Plaid y de los agentes',
      'Puesta en marcha de las integraciones (Entra ID, Claude o ChatGPT, NetBox…)',
    ],
    ctaLabel: 'Contáctenos',
    ctaHref: '/contact',
    note: 'Lo definimos juntos en una llamada de 30 minutos.',
  },

  supportInvoice: {
    title: 'Solicite su factura',
    eyebrow: 'Soporte autoalojado',
    body:
      'Crearemos su factura anual de Soporte autoalojado y la enviaremos a su email de facturación. Tras el pago, obtiene acceso a los servicios de soporte profesional.',
    companyLabel: 'Nombre de la empresa',
    contactLabel: 'Nombre del contacto',
    billingEmailLabel: 'Email de facturación',
    countryLabel: 'País',
    vatLabel: 'NIF-IVA',
    vatHelpEu: 'Obligatorio para una empresa de la Unión Europea.',
    address1Label: 'Dirección línea 1',
    address2Label: 'Dirección línea 2 (opcional)',
    cityLabel: 'Ciudad',
    postalCodeLabel: 'Código postal',
    termsAccept: 'Acepto las',
    termsLink: 'condiciones generales de venta',
    captchaLabel: 'Verificación de seguridad',
    submitLabel: 'Solicitar factura',
    submittingLabel: 'Preparando la solicitud de factura...',
    requiredHint: 'Los campos marcados con * son obligatorios.',
    doneTitle: 'Factura solicitada',
    doneSent: 'Hemos enviado la factura {number} a {email}.',
    doneSentNoNumber: 'Hemos enviado la factura a {email}.',
    doneOpen: 'También puede abrirla ahora.',
    successLinkLabel: 'Abrir factura',
    doneClose: 'Cerrar',
    errorGeneric: 'No pudimos enviar su solicitud de factura. Inténtelo de nuevo o contacte con support@kanap.net.',
    errorRequired: 'Complete todos los campos obligatorios.',
    errorVatRequired: 'Introduzca su NIF-IVA. Es obligatorio para una empresa de la Unión Europea.',
    errorVatInvalid: 'Este NIF-IVA no corresponde al formato del país seleccionado.',
    errorTerms: 'Acepte las condiciones generales de venta para solicitar la factura.',
    closeLabel: 'Cerrar formulario',
  },

  faqTeaser: {
    title: 'Preguntas frecuentes',
    body: 'Licencia, autoalojamiento, nube, Plaid, soporte y facturación. Todo respondido.',
    ctaLabel: 'Leer las FAQ',
  },

  cta: {
    title: '¿Listo para empezar?',
    body:
      'Despliegue KANAP usted mismo gratis, o pruebe la versión alojada si quiere que la operemos nosotros.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
