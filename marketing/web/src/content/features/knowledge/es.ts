import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Gestión del conocimiento',
    description:
      'Editor markdown con bibliotecas, carpetas, flujos de revisión, historial de versiones y exportación a PDF / DOCX / ODT. Enlaces profundos a aplicaciones, proyectos, activos, tareas. Open source.',
  },
  header: {
    eyebrow: 'Conocimiento',
    title: 'Su documentación de TI, conectada con todo.',
    lead: 'Gobernanza documental basada en markdown con bibliotecas estructuradas, flujos de revisión e integración profunda con sus aplicaciones, activos, proyectos y tareas.',
  },
  sections: [
    {
      title: 'Editor markdown con gobernanza',
      body: 'Escriba y mantenga su documentación de TI con un editor markdown completo. Los bloqueos de edición evitan modificaciones concurrentes y el guardado automático asegura que nada se pierda. Incruste imágenes en línea y dé formato con el soporte markdown completo.',
      bullets: [
        'Editor markdown completo con vista previa en vivo',
        'Bloqueos de edición para evitar modificaciones concurrentes',
        'Guardado automático con opción de guardado manual',
        'Soporte para imágenes en línea',
        'Markdown completo: títulos, listas, tablas, bloques de código',
      ],
      shotAlt: 'Editor markdown con indicador de bloqueo de edición',
    },
    {
      title: 'Bibliotecas, carpetas y tipos de documento',
      body: 'Organice su documentación en bibliotecas, navegue por carpetas, clasifique por tipo. Use plantillas para arrancar nuevos documentos con estructura y contenido predefinidos.',
      bullets: [
        'Múltiples bibliotecas para distintos dominios de conocimiento',
        'Jerarquía de carpetas para una organización lógica',
        'Tipos de documento para clasificación y gobernanza',
        'Plantillas agrupadas por tipo',
        'Navegue, busque y filtre entre todos los documentos',
      ],
      shotAlt: 'Árbol de biblioteca con carpetas y tipos de documento',
    },
    {
      title: 'Flujos de revisión y aprobación',
      body: 'Asigne responsables, autores, revisores y aprobadores a los documentos. Envíe documentos a revisión, recoja notas de decisión y siga el estado de aprobación. La edición se bloquea durante la revisión para mantener la integridad.',
      bullets: [
        'Roles: responsable, autor, revisor, aprobador',
        'Envío a revisión con un clic',
        'Notas de decisión de revisores y aprobadores',
        'Edición bloqueada durante una revisión activa',
        'Seguimiento e historial del estado de aprobación',
      ],
      shotAlt: 'Panel de revisión de documento con chips de estado',
    },
    {
      title: 'Documentación conectada',
      body: 'Vincule documentos con aplicaciones, activos, proyectos, solicitudes y tareas. Acceda a documentos gestionados desde otros workspaces y distinga entre contenido vinculado y relacionado para una trazabilidad total. La base de conocimiento es también lo que citan sus agentes: la fuente en la que se apoya un agente y a la que apunta cuando responde.',
      bullets: [
        'Relaciones con aplicaciones, activos, proyectos, solicitudes y tareas',
        'Documentos gestionados accesibles desde otros workspaces',
        'Distinción entre vinculado y relacionado',
        'Navegación bidireccional entre documentos y entidades',
        'Registro de auditoría completo de los cambios en las relaciones',
      ],
      shotAlt: 'Documento con barra lateral de entidades vinculadas',
    },
  ],
  more: {
    title: 'Más en conocimiento',
    items: [
      { title: 'Historial de versiones', body: 'Cada guardado crea una versión. Explore el historial y vuelva a cualquier estado anterior.' },
      { title: 'Exportación', body: 'Exporte a PDF, DOCX y ODT. Comparta documentación fuera de KANAP.' },
      { title: 'Plantillas', body: 'Plantillas reutilizables agrupadas por tipo. Arranque nuevos documentos rápidamente.' },
      { title: 'Importación', body: 'Importe desde Word y PDF. Traiga su documentación existente a KANAP con un solo clic.' },
    ],
  },
  crossLinks: {
    label: 'Explore la plataforma',
    links: [
      { label: 'Agentes', href: '/features/agents' },
      { label: 'Plaid, asistente de IA', href: '/features/ai' },
      { label: 'Gestión de presupuesto', href: '/features/budget' },
      { label: 'Panorama IT', href: '/features/it-landscape' },
      { label: 'Gestión de portafolio', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: '¿Listo para gobernar su documentación de TI?',
    body: 'Autoaloje gratis o pruebe la nube alojada. Todas las funcionalidades en cada plan.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
