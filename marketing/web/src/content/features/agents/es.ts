import type { AgentsContent } from '../types';

const content: AgentsContent = {
  meta: {
    title: 'Agentes de IA autónomos para TI',
    description:
      'Los agentes de KANAP asumen tareas repetitivas de TI, razonan sobre sus propios datos de TI y actúan con una autonomía que usted controla y puede auditar. Hoy hay un conector de mesa de servicio activo, y el runtime está pensado para ampliarse. Open source, autoalojado.',
  },
  header: {
    eyebrow: 'Agentes autónomos para TI',
    title: 'Agentes de IA que liberan de trabajo a su equipo.',
    lead: 'Un agente de KANAP toma una tarea, la lee contra sus datos de TI y propone una acción o la lleva a cabo, según cuánta autonomía le haya concedido. Se ocupa de la carga repetitiva para que su gente se ocupe de los problemas difíciles.',
  },
  sections: [
    {
      title: 'Los agentes empiezan supervisados y se vuelven más autónomos.',
      body: 'Cada agente empieza bajo supervisión. Propone acciones, usted las revisa y KANAP registra con qué frecuencia acierta. A medida que ese historial se mantiene, usted le concede más autonomía, hasta que gestiona el trabajo rutinario por sí solo y solo le trae los casos que necesitan a una persona.',
      bullets: [
        'Empieza proponiendo acciones para su revisión',
        'KANAP mide con qué frecuencia acierta',
        'Usted concede más autonomía a medida que el historial se mantiene',
        'Acaba gestionando el trabajo rutinario por sí solo',
      ],
      shotAlt: 'El ajuste de autonomía de un agente',
    },
    {
      title: 'Razona sobre su entorno real.',
      body: 'Un agente no trabaja solo a partir del ticket. Lee la aplicación a la que afecta un problema, quién es su responsable, qué tan crítica es y la documentación que usted escribió sobre ella. Después enumera los registros y documentos que utilizó, para que usted pueda comprobar su razonamiento.',
      bullets: [
        'Lee la aplicación afectada, su responsable y su criticidad',
        'Incorpora el proyecto, el coste y la documentación relacionados',
        'Responde a partir de sus datos, no de conjeturas',
        'Enumera las fuentes que utilizó',
      ],
      shotAlt: 'Una propuesta de agente que muestra la clasificación, la acción redactada y las fuentes que utilizó',
    },
    {
      title: 'Un solo runtime, cualquier herramienta.',
      body: 'La decisión que toma un agente se mantiene separada de cómo se comunica con cada herramienta. El primer conector que se publica es el de mesa de servicio, trabajando tickets reales en producción. El mismo runtime está pensado para gobernar otros sistemas y, como el código es abierto, usted puede escribir un conector para la herramienta que necesite.',
      bullets: [
        'El razonamiento se mantiene separado del conector',
        'Hoy hay un conector de mesa de servicio en producción',
        'Pensado para gobernar monitorización, servicios de directorio y más',
        'Escriba su propio conector, el código es abierto',
      ],
      shotAlt: 'Los ajustes del agente para persona y segmentación',
    },
    {
      title: 'Un registro de todo lo que hizo.',
      body: 'Cada acción del agente queda registrada, acotada a lo que usted permitió, respaldada por las fuentes que utilizó y detenible en cualquier momento. Ese registro es lo que hace defendible confiar trabajo real a un agente. El historial se conserva 30 días por defecto y puede ajustarse de 7 a 90 días.',
      bullets: [
        'Cada acción registrada en el historial de actividad del agente',
        'Acotada a las operaciones que usted permite',
        'Cada respuesta respaldada por sus fuentes',
        'Pause cualquier agente de inmediato',
      ],
      shotAlt: 'La actividad del agente y el registro de auditoría',
    },
    {
      title: 'Suyo para ejecutar y modificar.',
      body: 'Los agentes forman parte del producto open source. Ejecútelos dentro de su propio despliegue, donde sus tickets y documentos permanecen, salvo el texto enviado al proveedor de LLM que usted elija, y cambie cómo funcionan porque dispone del código fuente completo. Use su propia clave LLM, igual que con Plaid.',
      bullets: [
        'Incluidos en el producto open source',
        'Se ejecuta dentro de su propio despliegue',
        'Tickets y documentos se quedan con usted, salvo lo que va al LLM',
        'Use su propia clave LLM',
      ],
      shotAlt: 'Un agente trabajando una cola de tareas',
    },
  ],
  more: {
    title: 'Más control donde lo necesita',
    items: [
      {
        title: 'Límites de gasto',
        body: 'Defina un límite por agente sobre lo que puede gastar en el LLM, para que el coste de operación siga siendo previsible.',
      },
      {
        title: 'Pausa de emergencia',
        body: 'Detenga cualquier agente de inmediato, uno a uno o todos a la vez, siempre que quiera intervenir.',
      },
      {
        title: 'Control de acceso por rol',
        body: 'Decida quién puede configurar agentes, conceder autonomía o revisar lo que hizo un agente.',
      },
      {
        title: 'Métricas de rendimiento',
        body: 'Vea con qué frecuencia acierta un agente y cuánto trabajo ha liberado a su equipo.',
      },
    ],
  },
  transparency: {
    eyebrow: 'En marcha hoy',
    title: 'Un agente en producción, un runtime pensado para ampliarse.',
    body: 'En marcha hoy: un agente autónomo trabajando una mesa de servicio real en producción. El runtime está pensado para ampliarse. Elija una herramienta, escriba un conector y el mismo agente la trabaja. Si necesita que construyamos uno, díganoslo.',
    ctaLabel: 'Solicitar un conector',
    ctaHref: '/contact',
  },
  crossLinks: {
    label: 'Vea cómo encaja todo',
    links: [
      { label: 'Paisaje de TI', href: '/features/it-landscape' },
      { label: 'Conocimiento', href: '/features/knowledge' },
      { label: 'Autoalojado', href: '/on-premise' },
      { label: 'Seguridad', href: '/security' },
      { label: 'Plaid, asistente de IA', href: '/features/ai' },
    ],
  },
  cta: {
    title: 'Ponga un agente al frente del trabajo repetitivo.',
    body: 'Los agentes están en el producto gratuito y autoalojado, con su propia clave LLM. Despliegue KANAP usted mismo, o hable con nosotros sobre alojamiento y conectores.',
    primary: 'Desplegar gratis',
    secondary: 'Hablar con nosotros',
  },
};

export default content;
