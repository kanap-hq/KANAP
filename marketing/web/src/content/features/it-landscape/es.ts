import type { FeatureContent } from '../types';

const content: FeatureContent = {
  meta: {
    title: 'Panorama IT',
    description:
      'Aplicaciones, tecnologías, interfaces y servidores en un repositorio. Vulnerabilidades y fin de soporte hasta la aplicación de negocio. Open source.',
  },
  header: {
    eyebrow: 'Panorama IT',
    title: 'Documente todo su sistema de información.',
    lead: 'Aplicaciones, tecnologías, interfaces e infraestructura en un solo lugar. Siga el fin de soporte y las vulnerabilidades hasta la aplicación de negocio, y visualice su arquitectura en mapas interactivos.',
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
        'Si este servidor cae: aplicaciones, clústeres y procesos afectados',
      ],
      shotAlt: 'Registro de servidores agrupado por ubicación',
    },
    {
      title: 'Tecnologías y fin de soporte',
      body: 'Las tecnologías enlazan sus aplicaciones con sus servidores: bases de datos, middleware, sistemas operativos, directorios, servicios en la nube. Cada una lleva sus versiones y sus fechas de fin de soporte, que el catálogo mantiene al día.',
      bullets: [
        'Catálogo de 192 productos, una tecnología creada con un clic',
        'Fechas de soporte seguidas en endoflife.date y en los fabricantes, con su fuente',
        'El sistema operativo de cada servidor, con su versión',
        'Informe de fin de soporte: lo que vence y a qué afecta',
        'Enlaces con servidores y aplicaciones, importables en CSV',
      ],
      shotAlt: 'Ficha de una tecnología con sus versiones y sus fechas de fin de soporte',
    },
    {
      title: 'Vulnerabilidades',
      body: 'KANAP cruza las vulnerabilidades publicadas con sus tecnologías, versión por versión, y muestra los servidores y las aplicaciones de negocio afectados. Las vulnerabilidades explotadas van primero.',
      bullets: [
        'Dos fuentes cada 6 horas: la NVD y las fichas de los fabricantes en CVE.org',
        'Señales de explotación: catálogos de la CISA y de la Unión Europea, puntuación EPSS',
        'En las listas y fichas de servidores y aplicaciones, y en el panel',
        'Por tratar, tratada, no afectada: con una nota y el registro de auditoría',
        'Correo a los responsables de TI para vulnerabilidades graves o explotadas',
      ],
      shotAlt: 'Página Vulnerabilidades, las explotadas primero',
    },
    {
      title: 'Mapas de arquitectura interactivos',
      body: 'Dos visualizaciones basadas en D3 le ayudan a entender su arquitectura de un vistazo. Filtre por entorno, ciclo de vida o nodos raíz específicos. Exporte a SVG o PNG para su documentación. Este panorama es también el mapa que leen sus agentes, para saber a qué aplicación afecta un problema, quién es su responsable y qué tan crítica es.',
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
    title: 'Más en Panorama IT',
    items: [
      { title: 'Derivación de riesgo', body: 'Riesgo de conexión calculado a partir de las interfaces vinculadas. Criticidad, clase de datos y PII se derivan automáticamente.' },
      { title: 'Zonas de administración', body: 'Quién administra qué, según el modelo por niveles. Se señalan las brechas de aislamiento entre zonas.' },
      { title: 'Enlace con costes', body: 'Vincule aplicaciones, servidores y tecnologías a líneas presupuestarias y contratos. Vea el coste real de su portafolio.' },
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
