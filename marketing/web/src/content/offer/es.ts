import type { OfferContent } from './types';

const content: OfferContent = {
  meta: {
    title: 'Precios',
    description:
      'Gratis y open source. Autoaloje sin límites, añada soporte cuando lo necesite o elija KANAP alojado. Todas las funcionalidades en cada plan, agentes incluidos. AGPL v3.',
  },

  header: {
    eyebrow: 'Precios simples y transparentes',
    title: 'Gratis y open source.\nAutoaloje, o déjenos operarlo.',
    lead: 'Todas las funcionalidades en cada plan. Sin feature gates, sin tasa por asiento, sin bloqueo. Pague solo por las operaciones y el soporte que no quiere llevar usted mismo.',
  },

  /* -------------------- Self-hosted (primary) -------------------- */
  selfHosted: {
    eyebrow: 'Elija su camino',
    title: 'El mismo producto.\nTres formas de ejecutarlo.',
    intro:
      'Empiece con la plataforma open source completa. Añada soporte de producción cuando la soberanía importe, o elija KANAP alojado cuando quiera que operemos por usted.',
    plans: [
      {
        name: 'Autoalojado',
        badge: 'Open source · gratis para siempre',
        target: 'Usuarios ilimitados · workspaces ilimitados',
        price: '0 €',
        period: '',
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
        note: 'Plaid y los agentes usan un LLM, así que usted aporta su propia clave y paga a su proveedor por el uso. Limite el gasto por agente para mantener previsible el coste de operación.',
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
          'Sus datos permanecen en su infraestructura',
          'Soporte por email prioritario',
          'Asistencia de instalación y actualización',
          'Línea directa con el equipo para problemas de producción',
          'Sesión inicial de 60 min con un experto de KANAP',
          'Consultoría a 900 € al día en lugar de 1 150 €',
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
          '2 500 mensajes Plaid/mes incluidos, o su propia clave, sin límite',
          'Agentes incluidos, con los mensajes incluidos o con su propia clave LLM',
          'Sesión inicial de 60 min con un experto de KANAP',
          'Soporte por email prioritario',
          'Consultoría a 900 € al día en lugar de 1 150 €',
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
        body: 'Tiene capacidad de TI y quiere el control total. La mejor relación calidad-precio, sin ataduras. Soporte comunitario.',
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
    title: 'Ayuda experta, cuando la quiera',
    intro: 'KANAP está diseñado para una adopción autoservicio. Si quiere ir más rápido, los planes de pago incluyen soporte prioritario y una tarifa de consultoría reducida.',
    support: {
      title: 'Soporte prioritario',
      subtitle: 'Incluido con cualquier plan de pago',
      body: 'Manténgalo funcionando con fluidez. Personas reales, tiempos de respuesta razonables, sin teatro de SLA.',
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
      body: 'Ayuda opcional para sacar más valor de KANAP: llamadas programadas, trabajo más profundo, asesoramiento. Tarifa: 1 150 € la jornada, 900 € para clientes con contrato de soporte o alojamiento, sin IVA.',
      items: [
        'Instalación, configuración, onboarding, formación',
        'Diseño de flujos de trabajo y buenas prácticas',
        'Asesoramiento a CIO sobre su modelo de gobernanza de TI',
        'Cualquier cosa que requiera una llamada programada',
      ],
    },
  },

  pilot: {
    title: 'Piloto guiado',
    subtitle: '2 900 € precio fijo · sin IVA',
    body: 'Un compromiso que pone a su equipo en marcha con KANAP: la instalamos con usted, traemos sus datos, formamos a su gente y su primer agente queda trabajando.',
    items: [
      'Instalación en sus servidores, o puesta en marcha alojada',
      'Le ayudamos a importar sus primeros datos clave',
      'Formación y onboarding de su equipo',
      'Su primer agente configurado',
    ],
    ctaLabel: 'Hable con nosotros',
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
    optionalSummary: 'Datos de facturación opcionales',
    vatLabel: 'VAT ID',
    address1Label: 'Dirección línea 1',
    address2Label: 'Dirección línea 2',
    cityLabel: 'Ciudad',
    postalCodeLabel: 'Código postal',
    captchaLabel: 'Verificación de seguridad',
    submitLabel: 'Solicitar factura',
    submittingLabel: 'Preparando la solicitud de factura...',
    successWithLink: 'Solicitud de factura enviada. La hemos enviado a su email de facturación.',
    successLinkLabel: 'Abrir factura',
    successNoLink: 'Solicitud de factura enviada. Revise su email de facturación para ver los detalles de la factura.',
    errorGeneric: 'No pudimos enviar su solicitud de factura. Inténtelo de nuevo o contacte con support@kanap.net.',
    errorRequired: 'Complete todos los campos obligatorios.',
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
