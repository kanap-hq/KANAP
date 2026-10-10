import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Presupuesto de TI: cierre, año siguiente, reparto',
    description:
      "Presupuesto de TI open source: OPEX y CAPEX, cierre y año siguiente, repercusión, consolidación, coste por FTE, cada línea vinculada a sus aplicaciones.",
  },
  header: {
    eyebrow: 'Presupuesto de TI',
    title: 'El presupuesto de TI, del cierre previsto al año siguiente, vinculado a sus aplicaciones.',
    lead: 'OPEX y CAPEX plurianuales, cierre previsto y presupuesto del año siguiente, repercusión a sociedades y departamentos, plantilla y coste por FTE. Cada línea está vinculada a sus aplicaciones, contratos y proyectos: sabe lo que paga, y por qué.',
  },
  sections: [
    {
      title: 'Del cierre previsto al presupuesto del año siguiente',
      body: 'Las columnas estándar (presupuesto, revisión, real, cierre previsto) se renombran y se ocultan según su práctica, de A-2 a A+2, con entrada anual o mensual. Afiance el cierre línea por línea, cópielo al presupuesto del año siguiente y congele la versión aprobada.',
      bullets: [
        'OPEX y CAPEX en listas dedicadas',
        'Columnas de presupuesto, revisión, real y cierre, renombrables',
        'Importes en cantidad × precio, o repartidos por mes',
        'Copia de columnas con simulación previa',
        'Congelación de versiones: la versión aprobada no se mueve',
      ],
      shotAlt: 'Lista OPEX con los importes de 2026 y la fila de totales',
    },
    {
      title: 'Una repercusión que todos entienden',
      body: 'Reparta cada línea entre las sociedades y los departamentos que se benefician de ella, con seis métodos de reparto. Los porcentajes siguen a la plantilla o a la facturación cuando cambian, y cada reparto sigue siendo legible línea por línea.',
      bullets: [
        'Según la plantilla (por defecto)',
        'Según los usuarios de TI o la facturación',
        'Selección manual de sociedades o departamentos',
        'Porcentajes introducidos a mano',
        'Un método por año y por línea',
      ],
      shotAlt: 'Una línea de presupuesto repartida entre cuatro sociedades por plantilla',
    },
    {
      title: 'Multisociedad, multidivisa, consolidación',
      body: 'Cada línea conserva su divisa, y todo se consolida en una divisa de reporting. Los tipos proceden del Banco Mundial y se fijan al congelar el presupuesto. Planes de cuentas y un plan de consolidación sitúan sus cifras en la estructura que usa finanzas.',
      bullets: [
        'Una divisa de reporting para todos los totales',
        'Tipos de cambio automáticos, fijados al congelar',
        'Lista de divisas autorizadas',
        'Planes de cuentas por país y plan de consolidación',
        'Centros de coste y responsables presupuestarios',
      ],
      shotAlt: 'Configuración de divisas: divisa de reporting, divisas permitidas y tipos de cambio',
    },
    {
      title: 'Un informe para cada pregunta',
      body: 'Repercusión global y por sociedad, tendencias, mayores subidas y bajadas, comparación de dos versiones, dimensiones analíticas, cuentas de consolidación, plantilla mensual y coste por FTE. Cada fila de un informe abre la lista filtrada correspondiente, y Plaid responde a las mismas preguntas en lenguaje natural.',
      bullets: [
        'Repercusión global y por sociedad',
        'Comparación de columnas y tendencias OPEX y CAPEX',
        'Dimensiones analíticas y cuentas de consolidación',
        'Plantilla mensual, coste por FTE y tarifa diaria',
        'Exportación CSV e imágenes de los gráficos',
      ],
      shotAlt: 'Las 10 mayores partidas OPEX del presupuesto 2026, en gráfico circular',
    },
  ],
  more: {
    title: 'Y además',
    items: [
      { title: 'Vinculado a aplicaciones y proyectos', body: 'Cada gasto lleva a sus aplicaciones, proyectos y proveedores. La ficha de una aplicación muestra lo que cuesta.' },
      { title: 'Contratos y plazos', body: 'Importe anual, renovación automática, preaviso y fecha límite de rescisión calculada, vinculados a las líneas de presupuesto.' },
      { title: 'Ida y vuelta con la hoja de cálculo', body: 'Exporte las líneas, edítelas en Excel o LibreOffice y vuelva a importar el archivo: KANAP solo escribe las celdas que han cambiado.' },
      { title: 'Datos de ejemplo', body: 'Una prueba se llena en un minuto con el presupuesto de Fromage & Co, cuatro sociedades ficticias, para verlo todo antes de introducir el suyo.' },
      { title: 'Plantilla y coste por FTE', body: 'Una línea de personal externo en personas o días declara sus FTE. Los informes muestran la plantilla mes a mes y el coste por FTE, o la tarifa diaria, por proveedor o por centro de coste.' },
      { title: 'Sus propios ejes de análisis', body: 'Cree tantas dimensiones analíticas como pidan sus preguntas (dominio, naturaleza de coste, programa), cada una con sus valores, para OPEX, CAPEX o ambos. Los informes de presupuesto se filtran por ellas, y varios agrupan por dimensión.' },
    ],
  },
  crossLinks: {
    label: 'Explore la plataforma',
    links: [
      { label: 'Mapa de sistemas', href: '/features/it-landscape' },
      { label: 'Portafolio de proyectos', href: '/features/portfolio' },
      { label: 'Documentación', href: '/features/knowledge' },
      { label: 'Plaid, el agente de IA integrado', href: '/features/ai' },
      { label: 'Agente de helpdesk', href: '/features/agents' },
    ],
  },
  cta: {
    title: 'Pruebe KANAP con un presupuesto de TI completo.',
    body: 'Pruebe la versión alojada con datos de ejemplo, o despliegue KANAP gratis en sus propios servidores.',
    primary: 'Desplegar gratis',
    secondary: 'Probar con datos de ejemplo',
  },
};

export default content;
