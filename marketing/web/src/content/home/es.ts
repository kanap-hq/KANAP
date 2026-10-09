import type { HomeContent } from './types';

const content: HomeContent = {
  meta: {
    title: 'Presupuesto, sistemas y proyectos de TI, open source',
    description:
      'Presupuesto de TI, mapa de aplicaciones, portafolio de proyectos y documentación en un solo repositorio, con un agente de IA integrado. Open source.',
  },

  hero: {
    eyebrow: 'Open source · diseñada por un CIO, para los CIO',
    title: 'El presupuesto, los sistemas y los proyectos de TI, en un solo repositorio.',
    lead: 'El presupuesto de TI sale de la hoja de cálculo y se vincula a lo que lo justifica: aplicaciones, contratos, proyectos. Mapa de sistemas, portafolio y documentación comparten los mismos datos, y Plaid, el agente de IA integrado, responde sobre todo ello. Open source, gratis en autoalojamiento.',
    primaryCta: 'Probar con datos de ejemplo',
    secondaryCta: 'Desplegar gratis',
    trialNote: 'Prueba de la versión alojada · datos de ejemplo cargados en un minuto · AGPL v3, código fuente completo en GitHub.',
  },

  layers: {
    eyebrow: 'Presupuesto de TI',
    title: 'El presupuesto de TI, fuera de Excel.',
    intro:
      'OPEX y CAPEX plurianuales, en columnas que usted nombra: presupuesto, revisión, cierre previsto. Cada versión se copia, se compara y se congela. Se acabaron las pestañas copiadas y las fórmulas rotas.',
    items: [
      {
        title: 'Cierre previsto y presupuesto del año siguiente',
        body: 'Afiance el cierre previsto línea por línea, cópielo al presupuesto del año siguiente, ajuste en cantidad × precio y congele la versión aprobada. Los tipos de cambio quedan fijados con ella.',
      },
      {
        title: 'Repercusión de costes y análisis',
        body: 'Reparta cada línea entre sociedades, departamentos y centros de coste, repercuta con reglas claras, analice por dimensión analítica y consolide sobre su plan de cuentas.',
      },
      {
        title: 'Plantilla y coste por FTE',
        body: 'Declare los FTE en las líneas que los llevan: KANAP deduce la plantilla mensual y el coste por FTE, en importe o en tarifa diaria, junto a los importes.',
      },
    ],
    outro: 'Y como cada línea está vinculada al resto del repositorio, el presupuesto deja de ser una lista de importes: es el mapa de lo que TI hace funcionar.',
  },

  pillars: {
    eyebrow: 'Todo está vinculado',
    title: 'Un solo repositorio en lugar de una hoja de cálculo, una wiki y una herramienta de proyectos.',
    items: [
      {
        title: 'Una línea de presupuesto lleva a lo que la justifica.',
        body: 'Cada partida OPEX o CAPEX está vinculada a sus aplicaciones, contratos, proveedores y proyectos. Sabe lo que paga, y por qué.',
      },
      {
        title: 'Una aplicación muestra lo que cuesta.',
        body: 'Su ficha reúne entornos, interfaces, servidores, contratos y gastos: suficiente para decidir una racionalización sobre hechos.',
      },
      {
        title: 'Un contrato muestra lo que compromete.',
        body: 'Importe anual, renovación automática, preaviso, fecha límite de rescisión calculada y líneas de presupuesto vinculadas: las renovaciones se preparan antes del plazo, no después.',
      },
    ],
  },

  modules: {
    eyebrow: 'Toda la gobernanza de TI',
    title: 'Cuatro pilares, un agente de IA, los mismos datos.',
    intro:
      'Cada módulo funciona por sí solo: empiece por el presupuesto y añada el mapa de sistemas, el portafolio o la documentación cuando esté listo. Todos trabajan sobre el mismo repositorio.',
    items: [
      {
        slug: '/features/budget',
        title: 'Presupuesto de TI',
        blurb:
          'Para el CIO y sus socios de finanzas. Presupuesto plurianual, cierre previsto y presupuesto del año siguiente, repercusión, consolidación, plantilla. Cifras que su director financiero puede verificar.',
        bullets: [
          'OPEX y CAPEX, columnas de presupuesto, revisión y cierre',
          'Copia y congelación de versiones',
          'Repercusión, dimensiones analíticas, consolidación',
          'Plantilla mensual y coste por FTE',
        ],
        ctaLabel: 'Descubrir el presupuesto',
      },
      {
        slug: '/features/it-landscape',
        title: 'Mapa de sistemas',
        blurb:
          'Para arquitectos, responsables de aplicaciones y equipos de infraestructura. Aplicaciones, interfaces y servidores documentados, y mapas que muestran el sistema de un vistazo.',
        bullets: [
          'Aplicaciones e instancias por entorno',
          'Interfaces, flujos y middleware',
          'Servidores e infraestructura, importación desde NetBox',
          'Mapas interactivos de interfaces y conexiones',
        ],
        ctaLabel: 'Descubrir el mapa',
      },
      {
        slug: '/features/portfolio',
        title: 'Portafolio de proyectos',
        blurb:
          'Para jefes de proyecto y responsables de TI. Puntúe las solicitudes, construya una hoja de ruta que respete la capacidad y siga los proyectos hasta la entrega.',
        bullets: [
          'Puntuación de solicitudes con criterios ponderados',
          'Hoja de ruta planificada según la capacidad',
          'Análisis de cuellos de botella y de carga',
          'Proyectos, hitos y tareas',
        ],
        ctaLabel: 'Descubrir el portafolio',
      },
      {
        slug: '/features/knowledge',
        title: 'Documentación',
        blurb:
          'Para todo el equipo, primero soporte y operaciones. Procedimientos, decisiones y notas de arquitectura, revisados, versionados y vinculados a las aplicaciones y proyectos que describen.',
        bullets: [
          'Editor markdown con circuito de revisión',
          'Bibliotecas, carpetas, tipos de documento',
          'Versiones y exportación PDF, DOCX, ODT',
          'Vínculos a aplicaciones, proyectos, activos, tareas',
        ],
        ctaLabel: 'Descubrir la documentación',
      },
      {
        slug: '/features/ai',
        title: 'Plaid, el agente de IA integrado',
        blurb:
          'Para cada rol. Haga una pregunta en lenguaje natural sobre el presupuesto, los sistemas o los proyectos: Plaid responde a partir de todo el repositorio y prepara los cambios, que usted valida.',
        bullets: [
          'Preguntas en lenguaje natural sobre todos los módulos',
          'Cambios preparados como vista previa, aplicados tras validación',
          'Servidor MCP de solo lectura para sus clientes de IA',
          'Uso incluido en la versión alojada, o su propia clave',
        ],
        ctaLabel: 'Descubrir Plaid',
      },
      {
        slug: '/features/agents',
        title: 'Agente de helpdesk',
        blurb:
          'Para los equipos de soporte. El agente lee cada ticket de su centro de servicios (hoy GLPI) a la luz de sus aplicaciones y su documentación, y propone una respuesta, una nota interna o una actualización del ticket.',
        bullets: [
          'Razona sobre su repositorio real',
          'Cada tipo de acción empieza con validación',
          'Paso a automático cuando el historial lo justifica',
          'Cada acción registrada, autonomía revocable',
        ],
        ctaLabel: 'Descubrir el agente',
      },
    ],
  },

  crossCutting: {
    eyebrow: 'Pensada para la empresa',
    title: 'Un solo sistema, bajo su control.',
    intro:
      'Los módulos comparten los mismos datos: eso da a TI una gobernanza real y permite que la IA ayude sin poner en riesgo su entorno.',
    items: [
      {
        title: 'Relaciones completas',
        body: 'Costes vinculados a aplicaciones, aplicaciones a contratos, proyectos y servidores, documentación a todo.',
      },
      {
        title: 'Informes y paneles',
        body: 'Informes de presupuesto listos para usar, tendencias, comparación de versiones, exportación CSV y PNG.',
      },
      {
        title: 'Multisociedad y multidivisa',
        body: 'Varias sociedades, varias divisas, tipos fijados al congelar el presupuesto y consolidación sobre su plan de cuentas.',
      },
      {
        title: 'Control de acceso por rol',
        body: 'Permisos detallados por módulo: lector, colaborador, miembro, administrador.',
      },
      {
        title: 'Registro de auditoría completo',
        body: 'Cada cambio registrado, incluidos los hechos con Plaid, con el antes y el después. Las acciones del agente tienen su propio historial.',
      },
      {
        title: 'SSO con Microsoft Entra ID',
        body: 'Inicio de sesión único para la empresa: una sola identidad para toda la organización.',
      },
    ],
  },

  vision: {
    eyebrow: 'IA sobre un repositorio completo',
    title: 'Una IA útil, porque todo está en el mismo sitio.',
    body: 'Un asistente de IA solo vale lo que valen los datos que ve. En KANAP ve a la vez el presupuesto, las aplicaciones, los contratos, los proyectos y la documentación, así que puede responder a «¿por qué se desvía el cierre previsto en infraestructura?» o «¿qué aplicaciones dependen de este contrato?».\nPrepara los cambios, usted los valida. Nada cambia sin usted, y todo queda registrado.',
  },

  cta: {
    title: 'Gestione su departamento de TI en un sistema que le pertenece.',
    body: 'Pruebe la versión alojada con datos de ejemplo, o despliegue KANAP gratis en sus propios servidores. El mismo producto, sin funciones recortadas.',
    primary: 'Probar con datos de ejemplo',
    secondary: 'Desplegar gratis',
  },
};

export default content;
