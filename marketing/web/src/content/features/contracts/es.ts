import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Contratos de TI: vencimientos, renovaciones, presupuesto',
    description:
      'Contratos de TI open source: plazos de rescisión calculados, decisión de renovación antes de cada uno, compromiso ante el presupuesto, registro de conformidad.',
  },
  header: {
    eyebrow: 'Contratos',
    title: 'No vuelva a perder una fecha límite de rescisión.',
    lead: 'Introduzca la fecha de inicio, la duración y el preaviso: KANAP calcula cada periodo y el último día para rescindir. El responsable tiene una decisión que tomar antes de ese día, y el contrato sigue vinculado a sus líneas presupuestarias, aplicaciones y activos.',
  },
  sections: [
    {
      title: 'Primero, los contratos por decidir',
      body: 'La lista se abre en el próximo vencimiento. Un filtro rápido muestra los contratos cuya ventana de rescisión se cierra dentro del plazo de decisión, noventa días por defecto. Cada fila indica en qué punto está el contrato: por decidir, renovado hasta una fecha, termina sin renovación o vencido.',
      bullets: [
        'Ordenada por próximo vencimiento, con los días restantes',
        'Filtros rápidos: por decidir, sin línea presupuestaria, infrapresupuestados',
        'Comprometido, presupuesto y diferencia del año, en su divisa de reporting',
        'Proveedor, empresa contratante, responsable, frecuencia de facturación',
        'Importación y exportación CSV',
      ],
      shotAlt: "Lista de contratos ordenada por próximo vencimiento, con el estado, el compromiso, el presupuesto y la diferencia",
    },
    {
      title: 'Vencimientos calculados para usted',
      body: 'Nada se introduce dos veces. A partir de la fecha de inicio, la duración y el preaviso, la ficha del contrato dibuja todos los periodos pasados, el actual y el siguiente, con el día de hoy y la fecha límite de rescisión en la misma línea.',
      bullets: [
        'Periodos, renovaciones y fecha límite de rescisión calculados, nunca almacenados',
        'Renovación tácita activada o no, con su propia confirmación',
        'Fin de validez para un contrato que termina definitivamente',
        'Notas y tareas de seguimiento en el contrato',
        'Recordatorios por correo electrónico al responsable 30, 14, 7 y 1 día antes del vencimiento',
      ],
      shotAlt: 'Contrato de mantenimiento SAP con sus periodos en una cronología y la fecha límite de rescisión',
    },
    {
      title: 'Una decisión antes del vencimiento',
      body: 'Cuando se abre la ventana de decisión, KANAP crea una tarea para el responsable del contrato. En el contrato, tres respuestas: renovar, renegociar o rescindir. Antes de confirmar una rescisión, KANAP muestra lo que cambia: la fecha de fin que permite el preaviso, el compromiso de este año y del siguiente, las aplicaciones y los activos que pierden el contrato.',
      bullets: [
        'Ventana de decisión configurable por tenant, 90 días por defecto',
        'Una tarea para el responsable, con el correo de asignación habitual',
        'Renovar, renegociar o rescindir, con una justificación libre',
        'Consecuencias visibles antes de confirmar',
        'Una decisión puede anularse hasta el vencimiento',
      ],
      shotAlt: 'Rescisión de un contrato con sus consecuencias en el compromiso y las aplicaciones',
    },
    {
      title: 'Compromiso frente a presupuesto',
      body: 'Un contrato compromete dinero, el presupuesto lo prevé. La pestaña Presupuesto lista las líneas OPEX y CAPEX vinculadas al contrato y las compara, año por año, con lo que el contrato compromete. Ve de inmediato si el contrato está cubierto, infrapresupuestado o sin presupuesto alguno.',
      bullets: [
        'Líneas presupuestarias vinculadas, importes por año y columna',
        'Compromiso prorrateado según los meses que cubre cada periodo',
        'Cobertura año por año: cubierto, infrapresupuestado, sin línea presupuestaria, presupuesto superior al contrato',
        'Contratos en otras divisas convertidos a sus tipos de cambio',
        'Visible solo para quienes pueden leer el presupuesto',
      ],
      shotAlt: 'Pestaña Presupuesto del contrato SAP: líneas vinculadas, compromiso y cobertura año por año',
    },
  ],
  more: {
    title: 'Más en Contratos',
    items: [
      { title: 'Registro de conformidad', body: 'Cinco cláusulas que seguir (contrato de encargado del tratamiento RGPD, ubicación de los datos, reversibilidad, plan de salida, derecho de auditoría), esperadas según las aplicaciones que cubre el contrato. Un registro que usted lleva, no una certificación.' },
      { title: 'Relaciones y contactos', body: 'Aplicaciones, activos y tecnologías cubiertos por el contrato, contactos del proveedor con su función, enlaces y archivos adjuntos.' },
      { title: 'Plaid y MCP', body: 'Pregúntele a Plaid qué contratos hay que decidir en los próximos 90 días. Los mismos datos están abiertos a sus propios clientes de IA a través del servidor MCP de solo lectura.' },
      { title: 'Permisos', body: 'Los lectores consultan, los miembros crean y deciden, los administradores importan, exportan y eliminan. Los importes del presupuesto siguen los permisos del presupuesto.' },
    ],
  },
  crossLinks: {
    label: 'Explore la plataforma',
    links: [
      { label: 'Presupuesto de TI', href: '/features/budget' },
      { label: 'Panorama IT', href: '/features/it-landscape' },
      { label: 'Incidentes', href: '/features/incidents' },
      { label: 'Plaid, el agente de IA integrado', href: '/features/ai' },
      { label: 'Portafolio de proyectos', href: '/features/portfolio' },
    ],
  },
  cta: {
    title: '¿Listo para sacar sus contratos de la hoja de cálculo?',
    body: 'Autoaloje gratis o pruebe la nube alojada. Todas las funcionalidades en cada plan.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
