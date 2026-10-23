import type { FeaturesHubContent } from '../features/types';

const content: FeaturesHubContent = {
  meta: {
    title: 'Cómo usan KANAP los equipos de TI de verdad',
    description:
      'Seis escenarios de las personas que operan TI cada día, desde el CIO hasta soporte y el responsable de operaciones de TI. Vea cómo se combinan los módulos y cómo los agentes asumen ahora la carga repetitiva.',
  },
  header: {
    eyebrow: 'Por rol',
    title: 'Cómo usan KANAP los equipos de TI de verdad.',
    lead: 'Seis escenarios de personas que operan TI cada día. Se apoyan en un único repositorio, lo trabajan con Plaid en lenguaje natural y ahora confían las partes repetitivas a un agente. Vea cómo se combinan los módulos, no solo lo que hace cada uno por separado.',
  },
  modulesUsedLabel: 'Módulos combinados',
  personas: [
    {
      role: 'CIO / director de TI',
      headline: 'Defienda el presupuesto de TI ante el comité de dirección.',
      body:
        'Su CFO pregunta por qué los costes de TI subieron un 12 %. Usted entra con los números: un informe de repercusión por empresa y departamento, OPEX y CAPEX lado a lado, por dimensión analítica, la tendencia plurianual. Cada línea se rastrea hasta un contrato o un proyecto. Sin gimnasia de hojas de cálculo, sin «ya le respondo».',
      outcome: 'Entre a la revisión presupuestaria con las respuestas.',
      modules: [
        { slug: 'budget', label: 'Presupuesto' },
        { slug: 'it-landscape', label: 'Panorama IT' },
      ],
      shotAlt: 'Las 10 mayores líneas OPEX del presupuesto 2026, en gráfico circular',
    },
    {
      role: 'Arquitecto de empresa',
      headline: 'Planifique una migración sin sorpresas.',
      body:
        'Va a retirar el CRM heredado. Antes de comprometer fechas, necesita saber qué depende de él: qué interfaces, qué aplicaciones aguas abajo, qué proyectos ya lo tocan. El mapa de interfaces muestra el grafo de dependencias de un vistazo. Su plan de migración enumera cada responsable de interfaz al que llamar, cada proyecto que debe estar al tanto. El conocimiento ata las decisiones a las aplicaciones que describen. Su yo futuro sabrá por qué.',
      outcome: 'Migre con los ojos abiertos en lugar de con los dedos cruzados.',
      modules: [
        { slug: 'it-landscape', label: 'Panorama IT' },
        { slug: 'knowledge', label: 'Conocimiento' },
        { slug: 'portfolio', label: 'Portafolio' },
      ],
      shotAlt: 'Mapa de interfaces que muestra el grafo de dependencias del CRM a retirar',
    },
    {
      role: 'Responsable de PMO / jefe de proyecto de TI',
      headline: 'Haga la planificación trimestral con cifras de capacidad.',
      body:
        'Veinte solicitudes entrantes, ocho equipos, un trimestre. Puntúe cada solicitud con criterios ponderados y genere una hoja de ruta consciente de la capacidad. Los cuellos de botella son visibles antes de comprometerse. Las fechas no son ilusiones. Son aritmética. Cuando el comité de seguimiento revisa, usted puede explicar por qué este proyecto cae en Q3 y no en Q1: capacidad del equipo de plataforma.',
      outcome: 'Comprométase con fechas que realmente puede defender.',
      modules: [
        { slug: 'portfolio', label: 'Portafolio' },
        { slug: 'budget', label: 'Presupuesto' },
      ],
      shotAlt: 'Hoja de ruta consciente de la capacidad con mapa de calor de cuellos de botella',
    },
    {
      role: 'Operaciones de TI / soporte',
      headline: 'Encuentre la causa raíz en segundos, no en horas.',
      body:
        'La gestión de pedidos en producción está lenta. Le pregunta a Plaid: «¿Qué aplicaciones consumen la API order-management?» Cinco segundos después, una lista. «¿Cuáles se han actualizado esta semana?» Una coincidencia. «¿Quién es el responsable?» Email y usuario de Teams. Del síntoma al responsable sin abrir cinco herramientas. Los tickets de primer nivel que se repiten cada semana van ahora a un agente, así su equipo solo se ocupa de lo que necesita a una persona.',
      outcome: 'Resuelva incidencias desde un solo lugar, mientras un agente despeja los tickets repetitivos.',
      modules: [
        { slug: 'it-landscape', label: 'Panorama IT' },
        { slug: 'knowledge', label: 'Conocimiento' },
        { slug: 'ai', label: 'Plaid' },
        { slug: 'agents', label: 'Agentes' },
      ],
      shotAlt: 'Plaid respondiendo a una consulta de investigación de incidencia con resultados estructurados',
    },
    {
      role: 'Responsable de TI / responsable de infraestructura',
      headline: 'Identifique qué retirar, qué renovar y qué consolidar.',
      body:
        '¿Cuántas aplicaciones SaaS estamos pagando? ¿Cuáles se solapan? ¿Quién es el responsable cuando toca renegociar? Cada aplicación lleva su línea OPEX, su contrato, su fecha de renovación y su clasificación de datos. Ordene por coste, por solapamiento, por uso. Tenga la conversación con finanzas con los hechos delante.',
      outcome: 'Deje de renovar lo que nadie usa.',
      modules: [
        { slug: 'it-landscape', label: 'Panorama IT' },
        { slug: 'budget', label: 'Presupuesto' },
        { slug: 'knowledge', label: 'Conocimiento' },
      ],
      shotAlt: 'Portafolio de aplicaciones ordenado por coste OPEX con fechas de renovación',
    },
    {
      role: 'Responsable de operaciones de TI',
      headline: 'Confíe los tickets repetitivos a un agente.',
      body:
        'Su cola de primer nivel está llena de las mismas solicitudes cada semana: reinicios de acceso, incidencias recurrentes, clasificación rutinaria. Un agente toma cada una, la lee contra sus datos de TI y propone o aplica la solución según la autonomía que usted defina. Trabaja supervisado al principio y gana más independencia a medida que su historial se mantiene. Su gente deja de dedicar el día a la carga repetitiva.',
      outcome: 'Su equipo dedica su tiempo a los problemas difíciles mientras el agente despeja los rutinarios.',
      modules: [
        { slug: 'agents', label: 'Agentes' },
        { slug: 'it-landscape', label: 'Panorama IT' },
        { slug: 'knowledge', label: 'Conocimiento' },
      ],
      shotAlt: 'Un agente trabajando una cola de tickets de primer nivel',
    },
  ],
  cta: {
    title: '¿Listo para ver su rol en la plataforma?',
    body:
      'Empiece gratis con autoalojamiento, o pruebe la nube alojada.\nTodas las funcionalidades en cada plan, en la nube o autoalojado.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
