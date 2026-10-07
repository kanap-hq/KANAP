import type { OnPremContent } from './types';

const content: OnPremContent = {
  meta: {
    title: 'Autoaloje KANAP, ciudadano de primera clase',
    description:
      'Ejecute KANAP en su propia infraestructura, bajo AGPL v3. Plataforma completa, incluidos los agentes de IA, usuarios ilimitados, sus datos nunca salen de su entorno. Despliegue en minutos con Docker Compose.',
  },

  header: {
    eyebrow: 'Autoalojado · ciudadano de primera clase',
    title: 'Ejecute KANAP usted mismo.\nSea dueño de cada capa.',
    lead: 'Open source bajo AGPL v3. Despliegue en su infraestructura, sea dueño de sus datos, actualice a su ritmo. La plataforma completa, usuarios ilimitados, todas las funcionalidades, en sus términos.',
    primaryCta: 'Desplegar desde GitHub',
    primaryHref: 'https://github.com/kanap-hq/kanap',
    secondaryCta: 'Leer la documentación de instalación',
    secondaryHref: 'https://doc.kanap.net/on-premise/',
  },

  why: {
    eyebrow: 'Por qué autoalojar',
    title: 'Control, cumplimiento y sin ataduras.',
    intro:
      'Autoalojar KANAP no es una versión recortada. Es la plataforma completa, con todas las funcionalidades, sin coste. Estos son los motivos por los que los equipos la eligen primero.',
    pillars: [
      {
        title: 'Sus datos se quedan donde están',
        body: 'Cifras de presupuesto, contratos de proveedores, paisaje de TI, todo. En sus servidores, en su red. Ningún encargado de tratamiento externo al que confiar sus datos de gobernanza. El razonamiento y las acciones de los agentes también se ejecutan ahí, lo que importa cuando un auditor pregunta.',
      },
      {
        title: 'Sin tasa por asiento',
        body: 'Usuarios ilimitados, workspaces ilimitados, Plaid y agentes con su propia clave LLM. Despliéguela a todo el departamento sin una hoja de cálculo de precios.',
      },
      {
        title: 'Listo para cumplimiento',
        body: 'El row-level security aísla los tenants. Hash de contraseñas con Argon2. HTTPS con certificados que usted controla. Su VPC, sus copias de seguridad, su SOC.',
      },
      {
        title: 'Audite el código',
        body: 'AGPL v3 significa que el código es abierto. Su equipo de seguridad lo lee, sus arquitectos lo amplían, su CISO duerme mejor.',
      },
      {
        title: 'Compatible con air-gap',
        body: 'El despliegue con Docker Compose se ejecuta en redes restringidas. Imágenes autocontenidas, sin llamadas salientes obligatorias para las funciones básicas.',
      },
      {
        title: 'Su ritmo',
        body: 'Fije la versión que ejecuta, pruebe una actualización, migre según el calendario de su ventana de cambios. Sin actualizaciones forzadas, sin caídas sorpresa.',
      },
    ],
  },

  license: {
    title: 'AGPL v3: apertura sin concesiones',
    body:
      'KANAP se publica bajo la GNU Affero General Public License v3. Obtiene todas las libertades clásicas del open source: usarla, leerla, modificarla, distribuirla. La cláusula copyleft significa que quien ejecute una versión modificada como servicio debe compartir sus cambios, que es como el proyecto se mantiene realmente abierto.',
    bullets: [
      'Úsela comercialmente, internamente o externamente, sin regalías, sin recuento de asientos',
      'Lea y audite el código completo, nada oculto',
      'Modifique y amplíe, el código es suyo para moldearlo',
      'Contribuya de vuelta, sus mejoras benefician a toda la comunidad',
    ],
    linkLabel: 'Leer la licencia AGPL v3',
    linkHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },

  deploy: {
    eyebrow: 'Instalación en minutos',
    title: 'Un solo prompt.\nQuince minutos.',
    intro:
      "Un agente de IA de programación lee nuestra documentación, instala todas las dependencias y configura toda la pila (Docker, PostgreSQL 16, MinIO, nginx, Let's Encrypt) sobre un servidor Ubuntu limpio. Usted pega un prompt, confirma los pasos e inicia sesión.",
    steps: [
      {
        title: 'Preparar un servidor limpio',
        body: "Un servidor Ubuntu 24.04 LTS recién aprovisionado con acceso sudo, un registro DNS A que apunte su hostname a él y acceso a Internet saliente para paquetes y Let's Encrypt. Instale su agente de IA de programación en el servidor (Claude Code, Codex o cualquier equivalente).",
      },
      {
        title: 'Conceder sudo sin contraseña temporalmente',
        body: 'Para que el agente no le pida la contraseña en cada paso. Lo revertirá al final.',
        code: 'echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd',
      },
      {
        title: 'Pegar el prompt de instalación',
        body: 'Abra su agente y pegue la plantilla de prompt de nuestra documentación, luego rellene su hostname, el email de administrador y (opcionalmente) su transporte de email (Resend o SMTP). El agente lee las páginas de instalación enlazadas, instala Docker, PostgreSQL 16 con las extensiones necesarias, MinIO, nginx y certbot, clona KANAP en /opt/kanap, genera credenciales fuertes, construye las imágenes y arranca los contenedores. También configura TLS y la renovación automática. El agente pide confirmación antes de ejecutar cada comando.',
      },
      {
        title: 'Iniciar sesión y reforzar',
        body: 'Inicie sesión en su hostname con las credenciales de administrador generadas, cambie la contraseña y elimine la entrada temporal de sudo sin contraseña. Listo. El log completo de instalación queda guardado en ~/kanap-install.md.',
      },
    ],
    docsCtaLabel: 'Guía de instalación asistida por IA',
    docsHref: 'https://doc.kanap.net/on-premise/installation-ai/',
    manualOption: {
      label: '¿Prefiere el control total?',
      title: 'Instalación manual: su stack, a su manera.',
      body: 'Traiga su propio PostgreSQL, su almacenamiento compatible con S3 y su reverse proxy. Ejecútelo en cualquier Linux con Docker. Encaje KANAP en la arquitectura que ya opera, con la configuración que se ajusta a su entorno. Misma plataforma, mismo código, cada decisión en sus manos.',
      ctaLabel: 'Guía de instalación manual',
      ctaHref: 'https://doc.kanap.net/on-premise/installation/',
    },
  },

  requirements: {
    title: 'Lo que necesitará',
    intro: 'Requisitos modestos para una plataforma que hace funcionar todo el departamento de TI.',
    items: [
      { label: 'SO', value: 'Cualquier Linux con Docker (Ubuntu 22+, Debian 12+, RHEL 9+ recomendados)' },
      { label: 'CPU', value: '2 vCPU mínimo · 4+ recomendadas para 50+ usuarios' },
      { label: 'RAM', value: '4 GB mínimo · 8 GB recomendados' },
      { label: 'Almacenamiento', value: '20 GB para la plataforma + lo que crezcan sus datos' },
      { label: 'Base de datos', value: 'PostgreSQL 15+ (incluida en el archivo compose, o use la suya)' },
      { label: 'Red', value: 'Terminador HTTPS (a su elección, nginx, Traefik, LB en nube)' },
      { label: 'Saliente (opcional)', value: 'API FX del Banco Mundial para tasas de cambio en vivo · proveedor de LLM para Plaid' },
    ],
  },

  operations: {
    title: 'Operar KANAP',
    intro: 'Pensada para operarse como cualquier otro servicio interno.',
    items: [
      {
        title: 'Actualizaciones en su calendario',
        body: 'Fije la versión que ejecuta, pruebe la actualización en pre-prod, aplíquela en su ventana de cambios. Las migraciones se ejecutan al arranque, idempotentes por diseño.',
      },
      {
        title: 'Copias de seguridad con sus propias herramientas',
        body: 'PostgreSQL y almacenamiento de archivos estándar. Cópielos con el pipeline que ya utiliza.',
      },
      {
        title: 'La observabilidad que ya tiene',
        body: 'Los contenedores escriben sus logs en stdout y exponen un endpoint de salud. Apunte su stack existente a ellos (Prometheus, Loki, Datadog, lo que ya ejecute).',
      },
      {
        title: 'Branding incluido',
        body: 'Suba su logo, ajuste su color primario. La página de branding de administración funciona igual en autoalojado que en nube.',
      },
      {
        title: 'SSO vía Entra ID',
        body: 'El SSO empresarial es parte de la plataforma central, no un upsell. Configúrelo desde la consola de administración.',
      },
      {
        title: 'Plaid y agentes, a su manera',
        body: 'Use su propia clave LLM tanto para Plaid como para sus agentes, OpenAI, Anthropic, Ollama o cualquier endpoint compatible con OpenAI. El razonamiento y las acciones de los agentes se ejecutan dentro de su propio despliegue, y lo único que sale es el prompt que usted envía al proveedor que eligió.',
      },
    ],
  },

  support: {
    title: '¿Necesita ayuda prioritaria?',
    body:
      'El plan de Soporte autoalojado añade soporte por email prioritario, ayuda con la instalación, desbloqueo de BYOK de Plaid y un 20 % de descuento en consultoría, sin cambiar el modelo de despliegue.',
    bullets: [
      'Soporte por email prioritario (personas reales, respuesta best-effort)',
      'Ayuda con la instalación y las actualizaciones',
      '20 % de descuento en todos los servicios de consultoría',
      '2 490 €/año, facturación anual',
    ],
    ctaLabel: 'Ver precios',
    ctaHref: '/offer',
  },

  cta: {
    title: '¿Listo para autoalojar?',
    body: 'Clone el repo y levante la pila en menos de diez minutos. Sin cuenta, sin cuenta atrás de prueba, solo open source.',
    primary: 'Desplegar desde GitHub',
    secondary: 'Hablar con nosotros',
  },
};

export default content;
