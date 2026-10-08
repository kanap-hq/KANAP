import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Plaid, asistente de IA para la gobernanza de TI',
    description:
      'Pregúntele a Plaid sobre sus datos de TI. Cree documentos, actualice tareas, conecte cualquier herramienta de IA vía MCP. Uso incluido en nube alojada. Open source.',
  },
  header: {
    eyebrow: 'Plaid · asistente de IA',
    title: 'Pregúntele a KANAP lo que sea sobre su TI.',
    lead: 'Plaid responde sobre su presupuesto, sus aplicaciones, sus proyectos y su documentación, y aplica cambios cuando usted se lo pide. Cada escritura se le muestra antes de ejecutarse. Úselo dentro de KANAP, o conéctelo a sus propias herramientas de IA a través de MCP.',
  },
  sections: [
    {
      title: 'Busque y consulte todo',
      body: 'Pregúntele a Plaid sobre sus aplicaciones, servidores, contratos, partidas presupuestarias, proyectos, tareas o documentos. Obtenga respuestas instantáneas con datos estructurados, no resúmenes vagos.',
      bullets: [
        'Búsqueda entre entidades en todos los módulos',
        'Consultas estructuradas con filtros y ordenación',
        'Agregaciones y estadísticas',
        'Búsqueda de texto completo en la base de conocimiento',
      ],
      shotAlt: 'Plaid respondiendo a una consulta entre módulos',
    },
    {
      title: 'Actúe con vista previa',
      body: 'Plaid no solo lee, también escribe. Puede crear y actualizar contenido por usted, y cada operación de escritura se previsualiza antes de aplicarse.',
      bullets: [
        'Cree y edite documentos con markdown',
        'Redacte briefings y resúmenes de proyecto',
        'Actualice tareas: estado, asignaciones, comentarios',
        'Previsualice los cambios antes de aplicarlos',
      ],
      shotAlt: 'Plaid mostrando una vista previa de actualizaciones de tareas',
    },
    {
      title: 'MCP, use KANAP desde cualquier herramienta de IA',
      body: 'KANAP expone un servidor MCP (Model Context Protocol) completo. Conecte Claude Desktop, Cursor, Windsurf o cualquier herramienta compatible con MCP, y consulte sus datos de gobernanza de TI sin salir de su flujo de trabajo.',
      bullets: [
        'Protocolo MCP estándar, funciona con cualquier cliente compatible',
        'Autenticación segura con clave API y alcance granular',
        'Las mismas consultas de lectura que el chat integrado (MCP es de solo lectura)',
        'Conserve sus flujos de IA actuales y añada el contexto de KANAP',
      ],
      shotAlt: 'Configuración MCP con alcance de clave API',
    },
    {
      title: 'Control y cumplimiento totales',
      body: 'Plaid respeta las reglas de su organización. Cada acción se rige por los permisos del usuario. Los administradores tienen control total sobre lo que Plaid puede y no puede hacer.',
      bullets: [
        'Respeto pleno de los permisos del usuario en cada consulta',
        'Claves API seguras con alcance granular de MCP',
        'La búsqueda web se puede activar o desactivar de forma independiente',
        'Vista previa y confirmación para todas las operaciones de escritura',
        'Acceso de solo lectura mediante roles para despliegues prudentes',
      ],
      shotAlt: 'Controles de administración de Plaid con matriz de permisos',
    },
  ],
  more: {
    title: 'Lo que puede preguntarle a Plaid',
    items: [
      { title: '«¿Cuál es el estado del Proyecto Atlas?»', body: 'Plaid recupera el proyecto, sus tareas, el cronograma y el equipo, y le entrega un briefing de estado conciso con bloqueos y próximos hitos.' },
      { title: '«Lista las aplicaciones en AWS sin responsable»', body: 'Consulta estructurada sobre su paisaje de TI. Resultados filtrados y ordenados a partir de datos en vivo.' },
      { title: '«Redacta una política de seguridad de acceso remoto»', body: 'Plaid crea un nuevo documento en su base de conocimiento, con metadatos correctos y contenido markdown.' },
      { title: '«¿Qué contratos expiran en 90 días?»', body: 'Respuesta instantánea con nombres de proveedores, importes y fechas de renovación. Sin navegar por paneles.' },
    ],
  },
  crossLinks: {
    label: 'Explore la plataforma',
    links: [
      { label: 'Agentes, para el trabajo que se ejecuta solo', href: '/features/agents' },
      { label: 'Seguridad', href: '/security' },
      { label: 'Gestión de presupuesto', href: '/features/budget' },
      { label: 'Paisaje de TI', href: '/features/it-landscape' },
      { label: 'Gestión de portafolio', href: '/features/portfolio' },
      { label: 'Conocimiento', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: 'La gobernanza de TI con IA empieza aquí.',
    body: 'Plaid está incluido en cada workspace de KANAP, con un uso generoso en la nube alojada. Autoaloje gratis, o pruebe la nube alojada.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
