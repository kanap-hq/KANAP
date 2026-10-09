import type { SecurityContent } from './types';

const content: SecurityContent = {
  meta: {
    title: 'Seguridad',
    description:
      'Cómo KANAP protege sus datos: row-level security, contraseñas con hash, secretos cifrados, RBAC, un registro de auditoría de seguridad, gobernanza de agentes, SSO, una cadena de compilación transparente y open source. Autoalojado o en nube.',
  },
  header: {
    eyebrow: 'Seguridad',
    title: 'Seguridad que respeta sus datos.',
    lead: 'Controles a la altura de la gobernanza desde el primer día. La misma plataforma se ejecuta en nuestra nube y en sus propios servidores, con el mismo aislamiento, control de acceso, auditabilidad y gobernanza sobre lo que los agentes pueden hacer.',
  },
  overview: {
    title: 'Principios',
    intro:
      'KANAP está diseñado para departamentos de TI que manejan datos sensibles. Tratamos sus datos como queremos que los proveedores de TI traten los nuestros: transparentes, aislados y a su alcance cuando los necesita.',
    pillars: [
      {
        title: 'Transparente por defecto',
        body: 'Todo el código fuente está en GitHub bajo AGPL v3. Su equipo de seguridad lo lee, lo audita o lo bifurca. Nada queda oculto tras binarios propietarios.',
      },
      {
        title: 'Aislado por diseño',
        body: 'El row-level security de la propia base de datos impone el aislamiento de tenants en cada consulta que ejecuta la aplicación.',
      },
      {
        title: 'Exportable, siempre',
        body: 'Sus datos son suyos. Exportación CSV en las listas principales, exportación de documentos a PDF, DOCX y ODT. Sin tasa de extracción.',
      },
    ],
  },
  tenancy: {
    title: 'Aislamiento de tenants',
    body:
      'KANAP es multi-tenant a nivel de base de datos. Cada fila de cada tabla compartida lleva un `tenant_id`, y las políticas de Row-Level Security de PostgreSQL imponen el filtro en cada lectura y escritura. La política es parte del esquema de la base de datos, así que se aplica a cada consulta de la aplicación.',
    bullets: [
      'Políticas RLS de PostgreSQL en cada tabla que contiene datos de tenant, todas forzadas',
      'Filtrado por `tenant_id` aplicado a nivel de base de datos, no solo en la app',
      'El tenant actual se fija al inicio de cada transacción de base de datos, y las políticas lo leen',
      'El rol de base de datos de la aplicación no tiene derechos de superusuario ni de omisión, y la aplicación se niega a arrancar si los tuviera',
      'Una tabla con datos de tenant sin su política de aislamiento hace fallar las pruebas de CI',
      'Pruebas de aislamiento de tenants en cada ejecución de CI',
    ],
  },
  dataProtection: {
    title: 'Protección de datos',
    body:
      'Prácticas estándar, aplicadas con rigor. Hash robusto de contraseñas, secretos cifrados, tokens con hash y HTTPS en cada conexión a la nube.',
    bullets: [
      'Nube: HTTPS en cada conexión entre los usuarios y la plataforma, con HTTP redirigido a HTTPS y Cloudflare terminando TLS delante de nuestros servidores. Autoalojado: usted termina TLS con sus propios certificados',
      'Hash de contraseñas con Argon2id (64 MiB de memoria) y salts por usuario',
      'Secretos gestionados vía entorno, no incluidos en el código',
      'Sus propias claves de proveedor de IA y credenciales de integración (GLPI, Netbox) cifradas en reposo con AES-256-GCM',
      'Tokens MCP y tokens de renovación de sesión almacenados con hash, y revocables',
      'Token de acceso en memoria en el navegador, token de renovación en una cookie HttpOnly',
    ],
  },
  access: {
    title: 'Control de acceso',
    body:
      'Permisos granulares por módulo, por rol. Cada feature gate y cada consulta de entidad respeta la misma matriz RBAC, incluidos Plaid y MCP.',
    bullets: [
      'Niveles lector, colaborador, miembro y administrador por módulo',
      'Rol de administrador a nivel de workspace separado de los administradores de módulo',
      'SSO vía Microsoft Entra ID (OIDC) tanto en nube como en autoalojado',
      'Autenticación local con contraseña usando Argon2 + flujos opcionales de restablecimiento de contraseña',
      'Los intentos de inicio de sesión se limitan por dirección de cliente: 5 intentos con contraseña y 60 solicitudes de inicio de sesión con Microsoft por minuto. Detrás de un proxy inverso, el límite sigue la dirección real de cada persona',
      'Los tokens de sesión solo se aceptan con el único algoritmo de firma con el que KANAP los emite',
      'Plaid y MCP aplican el mismo RBAC que la interfaz, sin escalada de privilegios',
      'Tokens API ligados a usuarios individuales, revocables en cualquier momento',
    ],
  },
  audit: {
    title: 'Registro de auditoría',
    body:
      'Cada cambio relevante queda registrado, y también los eventos de seguridad que lo rodean. Quién cambió qué y cuándo, quién inició sesión, quién no lo logró, quién exportó datos. Los administradores lo ven todo en la app.',
    bullets: [
      'Cronología de actividad por entidad (tareas, proyectos, documentos, etc.)',
      'Altas, modificaciones y desactivaciones registradas con el usuario, la marca de tiempo y los valores de antes y después',
      'Cambios de roles y permisos registrados con quién los hizo y los valores de antes y después',
      'Inicios de sesión, inicios fallidos, cierres de sesión, renovaciones de sesión rechazadas, restablecimientos de contraseña e inicios con Microsoft registrados con la dirección del equipo y el navegador. Las contraseñas y los tokens nunca se escriben en el registro',
      'Exportaciones generadas por el servidor registradas con quién exportó qué',
      'Eventos de acceso y de sesión conservados 365 días',
      'Los administradores consultan y filtran el registro de auditoría en la app, y lo exportan a CSV en un formato fijo que las herramientas de recopilación de registros leen tal cual (hasta 100 000 entradas por archivo)',
      'Los cambios hechos con Plaid se registran en el mismo registro, con su origen. Los agentes llevan su propio historial de actividad, con las fuentes que utilizó cada agente',
    ],
  },
  agentGovernance: {
    title: 'Gobernanza de agentes',
    body:
      'Los agentes actúan bajo los mismos controles que todo lo demás, más límites específicos del trabajo autónomo. Cada acción de un agente queda registrada y acotada a lo que usted permitió, y puede detener un agente en cualquier momento. Cada agente empieza con todos sus tipos de acción sujetos a su aprobación. Usted decide cuándo un tipo se ejecuta de forma automática, con el historial del agente (propuestas revisadas, tasa de aceptación, días de actividad) a la vista junto a esa decisión.',
    bullets: [
      'Los agentes actúan solo a través de operaciones definidas, sin acceso directo a la base de datos ni al shell',
      'Cada agente acotado a las operaciones que usted permite. Quién puede configurar los agentes o revisar su trabajo sigue los mismos roles que el resto de la aplicación',
      'Cada acción del agente registrada en el historial de actividad del agente, conservado 30 días por defecto y configurable de 7 a 90 días',
      'Las respuestas llevan las fuentes que utilizó el agente, para que una decisión se pueda comprobar',
      'Pause cualquier agente de inmediato, uno a uno o todos a la vez',
      'Los límites de gasto por agente mantienen acotado el coste de operación',
      'Las funciones de IA están desactivadas por defecto. En la nube, el modelo integrado no recibe ningún dato hasta que el workspace haya aceptado su proveedor y su lugar de tratamiento, ambos indicados en la aplicación. Un administrador los confirma, y se pide una nueva confirmación si cambia cualquiera de los dos. Puede usar su propio proveedor de modelos en su lugar',
    ],
  },
  supplyChain: {
    title: 'Cadena de suministro de software',
    body:
      'Lo que se ejecuta en sus servidores se compila a partir del código fuente público, y la forma de compilarlo se comprueba en cada cambio. Puede verificar lo que se entrega.',
    bullets: [
      'La imagen de la API se compila en dos etapas: la imagen que se ejecuta contiene la aplicación compilada y sus dependencias de producción, sin código fuente ni herramientas de desarrollo',
      'Los contenedores se ejecutan con privilegios reducidos: la API corre como usuario sin privilegios, y los contenedores renuncian a las capacidades de Linux que no necesitan y no obtienen otras nuevas',
      'El contenedor web envía las cabeceras de seguridad habituales y no anuncia su versión de nginx',
      'Las imágenes base están fijadas a un digest concreto. Las actualizaciones llegan como pull requests que pasan las mismas comprobaciones que cualquier otro cambio',
      'Para cada versión publicada se generan un inventario de componentes (CycloneDX) del backend, el frontend y el sitio web, los paquetes de la imagen de la API y un archivo de avisos de terceros',
      'Las licencias de las dependencias de producción se comprueban en cada fusión, y una dependencia con una licencia no aceptada o ausente la bloquea',
      'Las acciones de CI están fijadas a hashes de commit completos, y el token de los workflows es de solo lectura por defecto',
    ],
  },
  deployment: {
    title: 'Despliegue y operaciones',
    body:
      'Los despliegues en nube se ejecutan en hosts Linux en Alemania, dentro de la Unión Europea, con Cloudflare por delante. Los despliegues autoalojados se ejecutan donde usted elija. Ambos llevan el mismo modelo de seguridad.',
    bullets: [
      'Alojamiento en la nube en Hetzner Online GmbH, en Núremberg, Alemania (UE), con Cloudflare por delante para CDN, terminación de TLS y protección',
      'Autoalojado: el código fuente completo es público, y usted lo construye y lo ejecuta con Docker Compose',
      'Autoalojado: ninguna llamada saliente obligatoria para las funciones básicas, así que KANAP puede funcionar sin acceso a internet',
      'Autoalojado: usted decide dónde se ejecuta y cómo se respalda',
      'Autoalojado: las funciones de IA usan solo el proveedor de modelos que configura su administrador',
      'Autoalojado: al arrancar, KANAP avisa cuando el secreto de firma es corto o la contraseña del primer administrador sigue siendo un valor de ejemplo',
      'Autoalojado: la salud de los contenedores de la API y web aparece en la salida de docker ps, y los registros de Docker se limitan a unos 50 MB por contenedor',
    ],
  },
  disclosure: {
    title: 'Divulgación responsable',
    body:
      'Si encuentra un problema de seguridad, queremos saberlo. Infórmenos en privado, de preferencia mediante el reporte privado de vulnerabilidades de GitHub, o por correo. Denos un plazo razonable para corregirlo y le daremos crédito en el aviso, salvo que prefiera permanecer anónimo.',
    emailLabel: 'security@kanap.net',
    email: 'security@kanap.net',
  },
  cta: {
    title: '¿Preguntas sobre seguridad?',
    body: 'Compartimos con gusto detalles de arquitectura, repasamos un modelo de amenazas con su equipo de seguridad.',
    primary: 'Hablar con nosotros',
    secondary: 'Autoaloje y audite el código',
  },
};

export default content;
