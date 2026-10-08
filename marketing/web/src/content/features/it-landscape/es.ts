import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Paisaje de TI',
    description:
      'Documente aplicaciones, interfaces e infraestructura. Mapas de arquitectura interactivos, seguimiento del ciclo de vida, middleware de 3 tramos. Open source. Autoaloje gratis o elija la nube alojada.',
  },
  header: {
    eyebrow: 'Paisaje de TI',
    title: 'Documente todo su sistema de información.',
    lead: 'Aplicaciones, interfaces e infraestructura en un solo lugar. Visualice su arquitectura con mapas interactivos y siga el ciclo de vida desde la propuesta hasta la retirada.',
  },
  sections: [
    {
      title: 'Portafolio de aplicaciones',
      body: 'Mantenga un inventario completo de sus aplicaciones con instancias por entorno. Controle la propiedad, la criticidad, el estado de cumplimiento y la fase del ciclo de vida. Gestione el linaje de versiones a medida que las aplicaciones evolucionan.',
      bullets: [
        'Aplicaciones lógicas con instancias por entorno (prod, pre-prod, QA, dev)',
        'Seguimiento del linaje de versiones para su evolución',
        'Ciclo de vida: Propuesta, Activa, Obsoleta, Retirada',
        'Propiedad: responsables de TI, responsables de negocio, contactos de soporte',
        'Campos de cumplimiento: clase de datos, marca PII, residencia',
      ],
      shotAlt: 'Portafolio de aplicaciones con columnas de ciclo de vida',
    },
    {
      title: 'Documentación de interfaces',
      body: 'Documente las integraciones entre aplicaciones con definiciones de negocio y técnicas. Soporte para conexiones directas y patrones de middleware de 3 tramos (Extract / Transform / Load). Configure bindings por entorno con endpoints y autenticación.',
      bullets: [
        'Propósito de negocio, categoría de datos, vínculo con procesos',
        'Tipos de ruta: directa o vía middleware',
        'Soporte de 3 tramos: Extract, Transform, Load',
        'Configuración de binding por entorno y por tramo',
        'Definición funcional: objetos de negocio, casos de uso, identificadores',
      ],
      shotAlt: 'Detalle de interfaz con middleware de 3 tramos',
    },
    {
      title: 'Registro de infraestructura',
      body: 'Siga servidores, ubicaciones y conexiones en toda su infraestructura. Soporte para despliegues on-premise y en la nube. Documente la conectividad de red con topologías multiservidor y enrutamiento por capas.',
      bullets: [
        'Registro de servidores: VMs, bases de datos, colas, contenedores, funciones',
        'Ubicaciones: centros de datos, regiones cloud, zonas de disponibilidad',
        'Conexiones servidor a servidor y malla multiservidor',
        'Soporte de clústeres con agrupación de miembros',
        'Seguimiento del sistema operativo con fechas de soporte',
      ],
      shotAlt: 'Registro de servidores agrupado por ubicación',
    },
    {
      title: 'Mapas de arquitectura interactivos',
      body: 'Dos visualizaciones basadas en D3 le ayudan a entender su arquitectura de un vistazo. Filtre por entorno, ciclo de vida o nodos raíz específicos. Exporte a SVG o PNG para su documentación. Este paisaje es también el mapa que leen sus agentes, para saber a qué aplicación afecta un problema, quién es su responsable y qué tan crítica es.',
      bullets: [
        'Mapa de interfaces: aplicaciones como nodos, interfaces como aristas',
        'Mapa de conexiones: servidores y conectividad de red',
        'Vista de negocio (oculta el middleware) y vista técnica',
        'Filtro de profundidad: limita el grafo a N saltos desde los nodos seleccionados',
        'Exportación SVG y PNG en resolución 2x',
      ],
      shotAlt: 'Mapa de interfaces interactivo con filtros',
    },
  ],
  more: {
    title: 'Más en paisaje de TI',
    items: [
      { title: 'Derivación de riesgo', body: 'Riesgo de conexión calculado a partir de las interfaces vinculadas. Criticidad, clase de datos y PII se derivan automáticamente.' },
      { title: 'Contactos de soporte', body: 'Usuarios internos y contactos externos por aplicación con roles y notas.' },
      { title: 'Enlace con costes', body: 'Vincule aplicaciones a ítems OPEX / CAPEX. Vea el coste real de su portafolio.' },
      { title: 'Importación / exportación CSV', body: 'Importe aplicaciones y activos en masa. Exporte su inventario para análisis.' },
    ],
  },
  crossLinks: {
    label: 'Explore la plataforma',
    links: [
      { label: 'Agentes', href: '/features/agents' },
      { label: 'Plaid, asistente de IA', href: '/features/ai' },
      { label: 'Gestión de presupuesto', href: '/features/budget' },
      { label: 'Gestión de portafolio', href: '/features/portfolio' },
      { label: 'Conocimiento', href: '/features/knowledge' },
    ],
  },
  cta: {
    title: '¿Listo para documentar su sistema de información?',
    body: 'Autoaloje gratis o pruebe la nube alojada. Todas las funcionalidades en cada plan.',
    primary: 'Desplegar gratis',
    secondary: 'Probar nube alojada',
  },
};

export default content;
