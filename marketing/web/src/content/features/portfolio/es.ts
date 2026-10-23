import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Gestión de portafolio',
    description:
      'Puntuación de solicitudes, generación automática de hoja de ruta, planificación consciente de la capacidad, seguimiento del ciclo de vida del proyecto. Open source. Autoaloje gratis o elija la nube alojada.',
  },
  header: {
    eyebrow: 'Gestión de portafolio',
    title: 'De la solicitud a la entrega, con planificación automática de la hoja de ruta.',
    lead: 'Gestione su embudo de proyectos con puntuación inteligente, generación de hoja de ruta consciente de la capacidad y seguimiento del ciclo de vida. Simule escenarios antes de comprometer fechas.',
  },
  sections: [
    {
      title: 'Puntuación y evaluación de solicitudes',
      body: 'Evalúe las solicitudes entrantes con criterios de puntuación configurables. Pondere valor de negocio, ROI, riesgo y urgencia para calcular una puntuación de prioridad. Soporte para reglas de bypass obligatorio y override manual con justificación.',
      bullets: [
        'Criterios de puntuación configurables con pesos personalizados',
        'Criterios por defecto: valor, alineación, costes, ROI, riesgo, urgencia',
        'Escalas invertidas para coste/riesgo (más alto = puntuación más baja)',
        'Reglas de bypass obligatorio para solicitudes críticas',
        'Override manual con justificación requerida',
      ],
      shotAlt: 'Editor de puntuación de solicitudes con criterios ponderados',
    },
    {
      title: 'Ciclo de vida de la solicitud',
      body: 'Siga las solicitudes desde el envío inicial hasta la aprobación y la conversión en proyectos. Los estados de flujo integrados, el historial de actividad y el registro de decisiones del CAB mantienen a todos alineados sobre el estado de cada solicitud.',
      bullets: [
        'Flujo de estados: En revisión, Candidata, Aprobada, Convertida',
        'Rutas alternativas: En espera, Rechazada',
        'Historial de actividad con comentarios y cambios de estado',
        'Registro de decisiones del CAB con seguimiento formal de la aprobación',
        'Conversión en un clic de solicitud aprobada a proyecto',
      ],
      shotAlt: 'Workspace de solicitud con línea de tiempo de actividad',
    },
    {
      title: 'Seguimiento del ciclo de vida del proyecto',
      body: 'Gestione los proyectos desde la planificación hasta la ejecución y la finalización. Siga fechas previstas frente a reales, capture baselines y monitorice el esfuerzo. Soporte para proyectos estándar, mandatos fast-track y trabajo legacy.',
      bullets: [
        'Flujo de estados: Lista de espera, Planificado, En curso, En pruebas, Finalizado',
        'Captura de baseline al entrar en la fase de ejecución',
        'Fechas previstas frente a reales para análisis de desviación',
        'Seguimiento de esfuerzo: estimado frente a real, de TI y de negocio',
        'Seguimiento del origen: Estándar, Fast-track, Legacy',
      ],
      shotAlt: 'Workspace de proyecto con fechas de baseline frente a reales',
    },
    {
      title: 'Planificación automática de la hoja de ruta',
      body: 'Genere escenarios de entrega a partir del esfuerzo restante, las dependencias y la capacidad de los colaboradores. Detecte cuellos de botella y ocupación antes de aplicar las fechas a los proyectos en producción. Estos datos de puntuación y hoja de ruta forman parte de lo que un agente razona cuando asume el trabajo relacionado.',
      bullets: [
        'Planificación semanal consciente de la capacidad a partir de las asignaciones reales de esfuerzo',
        'El alcance por defecto cubre Lista de espera, Planificado, En curso, En pruebas',
        'Recálculo opcional de proyectos ya planificados o simulación con plan congelado',
        'Análisis de sensibilidad a cuellos de botella por impacto del colaborador',
        'Vistas mensuales de ocupación por colaborador y equipo',
        'Aplicación selectiva y transaccional de las fechas planificadas generadas',
      ],
      shotAlt: 'Hoja de ruta generada con mapa de calor de capacidad',
    },
  ],
  more: {
    title: 'Más en portafolio',
    items: [
      { title: 'Gestión de equipos', body: 'Asigne sponsors, leads y miembros de negocio y de TI. Controle contactos externos.' },
      { title: 'Enlace con presupuesto', body: 'Vincule proyectos a ítems OPEX y CAPEX. Entienda el coste real de su portafolio.' },
      { title: 'Dependencias', body: 'Siga las dependencias de solicitudes y proyectos. Los enlaces bloqueantes alimentan la secuenciación de la hoja de ruta.' },
      { title: 'Informes de portafolio', body: 'Mapas de calor de capacidad, análisis de cuellos de botella, analíticas de ocupación.' },
    ],
  },
  crossLinks: {
    label: 'Explore la plataforma',
    links: [
      { label: 'Agentes', href: '/features/agents' },
      { label: 'Plaid, asistente de IA', href: '/features/ai' },
      { label: 'Gestión de presupuesto', href: '/features/budget' },
      { label: 'Panorama IT', href: '/features/it-landscape' },
      { label: 'Conocimiento', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: '¿Listo para tomar el control de su embudo de proyectos?',
    body: 'Autoaloje gratis o pruebe la nube alojada. Todas las funcionalidades en cada plan.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
