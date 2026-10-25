import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Registro de incidentes: revisión, diario, auditoría',
    description:
      'Registro de incidentes open source para TI: incidentes numerados, revisión, diario inalterable, notificación RGPD y NIS2, aplicaciones y servidores vinculados.',
  },
  header: {
    eyebrow: 'Incidentes',
    title: 'Guarde un registro detallado de sus incidentes graves.',
    lead: 'KANAP guarda la memoria de los incidentes que importan: qué pasó, a qué afectó, por qué y qué cambió usted. Cada uno recibe un número, una revisión y un diario, y sigue vinculado a las aplicaciones y los servidores afectados.',
  },
  sections: [
    {
      title: 'El registro de incidentes',
      body: 'Cada incidente recibe una referencia permanente, INC-12, y la numeración nunca tiene huecos: un incidente cancelado conserva su número. Gravedad, categoría, responsable y fechas bastan para empezar, el resto llega cuando sepa más. Los incidentes pasados pueden introducirse con sus fechas reales.',
      bullets: [
        'Cuatro niveles de gravedad, categorías configurables',
        'Abierto, En curso, Resuelto, Cerrado: el estado solo avanza',
        'Reabrir o cancelar un incidente con un motivo obligatorio, solo los administradores del registro',
        'Búsqueda en títulos, descripciones y las aplicaciones y servidores vinculados',
        'Duración calculada una vez resuelto el incidente',
      ],
      shotAlt: 'Registro de incidentes con gravedad, estado, fechas de detección y de resolución',
    },
    {
      title: 'La revisión formal del incidente',
      body: 'Cada incidente tiene su revisión: un documento enriquecido creado a partir de una plantilla en cinco partes (descripción detallada, impacto, causa raíz, acciones correctivas, lecciones aprendidas) en el idioma de quien la escribe. Cada guardado crea una versión, y la revisión queda congelada al cerrar el incidente.',
      bullets: [
        'Plantilla editable por sus administradores de documentación',
        'Títulos, listas, tablas e imágenes pegadas',
        'Versionada, archivada en la biblioteca de documentación con su propia referencia',
        'Los permisos sobre incidentes bastan para redactarla',
        'El diario registra cada cambio, y ninguna entrada puede editarse ni eliminarse',
      ],
      shotAlt: 'Incidente cerrado con su descripción y su revisión: resumen, impacto, causa raíz, acciones',
    },
    {
      title: 'Pruebas para el auditor',
      body: '¿Se vieron afectados datos personales? ¿Había que notificar a la autoridad, y cuándo se hizo? ¿Quién fue informado? El incidente registra estos hechos con sus fechas, y los conserva: un incidente con hechos regulatorios no puede eliminarse.',
      bullets: [
        'Datos personales afectados, Requiere notificación a la autoridad, Notificado el, Partes informadas',
        'Informe PDF de un incidente, en el idioma de la pantalla',
        'El cierre bloquea todo: campos, revisión, diario, vínculos y archivos',
        'Incidentes confidenciales visibles solo para los administradores del registro, el declarante y el responsable',
        'Los hechos que el artículo 33.5 del RGPD y NIS2 piden documentar',
      ],
      shotAlt: 'Incidente con datos personales afectados y la autoridad notificada el 11 de julio',
    },
    {
      title: 'Vinculado a su panorama IT',
      body: 'Vincule un incidente a los servidores, aplicaciones y tecnologías a los que afectó. Cada uno de ellos muestra entonces sus incidentes, en solo lectura, en su propia ficha. Las acciones de seguimiento se convierten en tareas que llevan la referencia del incidente, y los documentos y archivos adjuntos se quedan con el incidente.',
      bullets: [
        'Activos, aplicaciones y tecnologías, con sugerencias a partir de lo ya vinculado',
        'Incidentes visibles en la ficha de cada aplicación, servidor y tecnología',
        'Tareas de seguimiento creadas desde el incidente',
        'Documentos de la base de conocimiento y archivos adjuntos',
        'Los vínculos respetan los permisos de lectura de cada persona',
      ],
      shotAlt: 'Relaciones de un incidente: tres servidores, dos aplicaciones SAP y VMware ESXi',
    },
  ],
  more: {
    title: 'Y además',
    items: [
      { title: 'Importación y exportación CSV', body: 'Traiga sus incidentes pasados desde una hoja de cálculo, revisiones incluidas, y exporte todo el registro.' },
      { title: 'Plaid y MCP', body: 'Pregúntele a Plaid cuántos incidentes graves se abrieron este año, o la ficha completa de uno, diario y revisión incluidos. Los incidentes confidenciales quedan fuera. Los mismos datos están abiertos a sus clientes de IA a través del servidor MCP de solo lectura.' },
      { title: 'Notas antedatadas', body: 'Las notas del diario llevan la hora en que ocurrió el hecho. La hora en que se guardaron se conserva aparte y no puede modificarse.' },
      { title: 'Permisos', body: 'Los lectores consultan, los colaboradores crean y redactan, los administradores del registro reabren, cancelan, eliminan y levantan una restricción.' },
    ],
  },
  crossLinks: {
    label: 'Explore la plataforma',
    links: [
      { label: 'Panorama IT', href: '/features/it-landscape' },
      { label: 'Contratos', href: '/features/contracts' },
      { label: 'Documentación', href: '/features/knowledge' },
      { label: 'Plaid, el agente de IA integrado', href: '/features/ai' },
      { label: 'Agente de helpdesk', href: '/features/agents' },
    ],
  },
  cta: {
    title: '¿Listo para desplegar un registro de incidentes completo y auditable?',
    body: 'Autoaloje gratis o pruebe la nube alojada. Todas las funcionalidades en cada plan.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
