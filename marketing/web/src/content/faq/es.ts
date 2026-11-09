import type { FaqContent } from './types';

const content: FaqContent = {
  meta: {
    title: 'FAQ',
    description:
      'Preguntas frecuentes sobre precios, licencia, autoalojamiento, nube alojada, Kad, agentes, soporte y facturación de Kadratis.',
  },
  header: {
    eyebrow: 'FAQ',
    title: 'Preguntas frecuentes.',
    lead:
      'Todo lo que necesita saber sobre Kadratis, licencia, precios, alojamiento, Kad y agentes. Si no encuentra su respuesta, escríbanos.',
  },
  groups: [
    {
      label: 'Licencia y open source',
      items: [
        {
          q: '¿Bajo qué licencia está Kadratis?',
          a: 'Kadratis se publica bajo licencia <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener" target="_blank">AGPL v3</a>, una licencia open source ampliamente reconocida y aprobada por la OSI. Puede usar, modificar y distribuir el software libremente. La cláusula copyleft de AGPL garantiza que quien ejecute una versión modificada como servicio debe compartir sus cambios. Esto protege a la comunidad y mantiene Kadratis realmente abierto.',
        },
        {
          q: '¿Puedo usar Kadratis comercialmente?',
          a: 'Sí. Uso interno, uso comercial, SaaS externo, todo está permitido. La cláusula copyleft solo le obliga a compartir modificaciones si ejecuta una versión modificada como servicio en red. El uso puramente interno no genera ninguna obligación.',
        },
        {
          q: '¿Puedo contribuir a Kadratis?',
          a: 'Sí, por favor. Todo el código fuente está en <a href="https://github.com/kanap-hq/kanap" rel="noopener" target="_blank">GitHub</a>. Las issues, las pull requests y los debates son bienvenidos. Consulte CONTRIBUTING.md para conocer las pautas.',
        },
      ],
    },
    {
      label: 'Nube y prueba',
      items: [
        {
          q: '¿Cómo funciona la prueba gratuita?',
          a: "Kadratis Cloud empieza con una prueba gratuita de 14 días, sin tarjeta de crédito y con todas las funcionalidades. Empieza con datos de ejemplo o con un espacio de trabajo vacío; tres recorridos guiados le muestran el presupuesto, el mapa del SI y los proyectos, y Kad puede ayudarle a importar sus datos. También puede programar una llamada de descubrimiento de treinta minutos desde su espacio de trabajo.",
        },
        {
          q: '¿Qué pasa cuando termina mi prueba?',
          a: "Al terminar la prueba, su espacio de trabajo pasa a solo lectura: sus datos siguen consultables y exportables durante treinta días. Una suscripción contratada desde la página Facturación del espacio lo reactiva, con todo lo que haya introducido. Sin suscripción, el espacio se elimina definitivamente, con todos sus datos, treinta días después del final de la prueba.",
        },
        {
          q: "¿Qué es la llamada de descubrimiento?",
          a: "Una videollamada de treinta minutos, gratuita y sin compromiso, que puede programar cuando quiera desde su espacio de prueba. Revisamos su situación, sus objetivos y lo que Kadratis puede aportarles.",
        },
        {
          q: '¿Cuál es la diferencia entre nube y autoalojado?',
          a: 'El alojamiento en nube significa que nosotros lo gestionamos todo por usted: alojamiento, actualizaciones, copias de seguridad, infraestructura y soporte prioritario. Autoalojado significa que usted ejecuta Kadratis en sus propios servidores. El producto completo es gratuito para autoalojar; puede contratar Soporte autoalojado si quiere ayuda prioritaria manteniendo el control de su infraestructura.',
        },
      ],
    },
    {
      label: 'Autoalojamiento y soporte',
      items: [
        {
          q: '¿Qué es el Soporte autoalojado?',
          a: 'El Soporte autoalojado es un complemento de soporte profesional para instalaciones autoalojadas. Incluye soporte por email prioritario, ayuda con la instalación y las actualizaciones, y una tarifa de consultoría reducida (900 € al día en lugar de 1 150 €). Precio: 2 490 €/año.',
        },
        {
          q: '¿Cómo funciona el soporte prioritario?',
          a: 'Para suscriptores de pago: escriba a support@kadratis.com por cualquier incidencia operativa. Aspiramos a responder en 24h y resolver su problema. Es best-effort, sin SLA, pero somos personas reales que leen y responden cada mensaje.',
        },
      ],
    },
    {
      label: 'Facturación',
      items: [
        {
          q: '¿Puedo pagar por factura?',
          a: 'El pago por factura (transferencia bancaria) está disponible para suscripciones anuales superiores a 1 000 € para clientes en EUR. Hoy esto significa las suscripciones anuales de Soporte autoalojado y de Kadratis Cloud. Las facturas son NET30.',
        },
        {
          q: '¿Puedo cambiar entre autoalojado y alojado?',
          a: 'Sí. Kadratis es el mismo producto en ambos modos. Contáctenos si quiere pasar de autoalojado a alojado, o si necesita una exportación para operar la plataforma usted mismo.',
        },
        {
          q: '¿Puedo cancelar mi suscripción?',
          a: "Por supuesto. Cancele cuando quiera desde la página Facturación de su espacio de trabajo: su suscripción sigue activa hasta el final del periodo de facturación actual, sin preguntas.",
        },
      ],
    },
    {
      label: 'Kad (asistente de IA)',
      items: [
        {
          q: '¿Cuál es la diferencia entre los mensajes Kad incluidos y Bring Your Own Key?',
          a: 'Kadratis Cloud incluye 1 500 mensajes Kad al mes, con un modelo que hemos seleccionado y probado con Kadratis. Para respuestas aún más capaces, la opción Bring Your Own Key le permite conectar modelos de última generación de OpenAI, Anthropic o cualquier proveedor compatible. BYOK también le permite elegir el proveedor que procesa sus solicitudes y elimina cualquier límite de mensajes.',
        },
        {
          q: '¿Cómo puedo controlar Kad?',
          a: 'A nivel del espacio de trabajo, un administrador activa o desactiva Kad, y la búsqueda web y MCP se activan o desactivan por separado. A nivel de usuario, los permisos por rol deciden quién puede usar Kad y qué módulos puede leer. Hacer un cambio exige el nivel miembro en Kad y en el módulo, y cada cambio se muestra como vista previa que el usuario confirma. El acceso MCP es de solo lectura. El RBAC se aplica siempre, Kad nunca ve más de lo que el usuario tiene permitido.',
        },
        {
          q: '¿Cómo conecto Claude u otro asistente de IA a Kadratis?',
          a: 'A través del servidor MCP de Kadratis, de solo lectura, de dos maneras. Claude, Claude Desktop y Claude Code se conectan sin clave: pegue su dirección de Kadratis como conector personalizado, inicie sesión con su cuenta de Kadratis y haga clic en Autorizar. Cada persona lee entonces con sus propios derechos de acceso. Los demás asistentes, como Cursor o sus propios scripts, usan una clave API creada por un administrador. En una instalación autoalojada, la conexión sin clave desde Claude y Claude Desktop requiere que Kadratis sea accesible desde Internet por HTTPS. Claude Code y las claves API también funcionan en una red interna.',
        },
      ],
    },
    {
      label: 'Agentes (automatización con IA)',
      items: [
        {
          q: '¿Son autónomos los agentes?',
          a: 'Sí, por diseño. Un agente empieza supervisado: propone acciones y usted las revisa. A medida que Kadratis mide con qué frecuencia acierta, usted le concede más autonomía, hasta que gestiona el trabajo rutinario por sí solo y solo escala lo que necesita a una persona. Usted decide hasta dónde llega eso.',
        },
        {
          q: '¿Cómo controlo lo que puede hacer un agente?',
          a: 'Usted define el nivel de autonomía de cada agente y lo acota a las operaciones que permite. Los agentes actúan solo a través de operaciones definidas, sin acceso directo a la base de datos ni al shell. Cada acción queda registrada, puede pausar cualquier agente de inmediato y puede limitar lo que un agente gasta en el LLM.',
        },
        {
          q: '¿Puedo confiar trabajo real a un agente?',
          a: 'Para eso están los controles. Un agente razona sobre sus propios datos de TI en lugar de adivinar, cita las fuentes que utilizó y registra cada acción en su historial de actividad. Gana autonomía demostrándose en tareas reales, y usted puede detenerlo en cualquier momento.',
        },
        {
          q: '¿Con qué herramientas trabajan los agentes hoy?',
          a: 'Hoy, una mesa de servicio. Un agente autónomo trabaja una mesa de servicio real en producción, que es lo que valida el modelo. El runtime está pensado para gobernar otros sistemas, monitorización, virtualización, servicios de directorio y más, cada uno detrás de un conector.',
        },
        {
          q: '¿Puedo escribir mi propio agente o conector?',
          a: 'Sí. El código es abierto, y el razonamiento de un agente se mantiene separado de cómo se comunica con cada herramienta. Puede escribir un conector para el sistema que necesite, o cambiar cómo funciona un agente, porque dispone del código fuente completo. Si prefiere que construyamos un conector, contáctenos.',
        },
        {
          q: '¿Están los agentes incluidos en la versión gratuita open source?',
          a: 'Sí. Los agentes forman parte del producto open source bajo AGPL v3, sin feature gate de IA. Usted aporta su propia clave LLM, el mismo modelo que Kad. Autoaloje la plataforma completa gratis, agentes incluidos.',
        },
        {
          q: '¿Cuánto cuesta ejecutar agentes?',
          a: 'Los agentes usan un LLM, así que usted aporta su propia clave y paga a su proveedor por lo que consumen. Kadratis en sí es gratuito para autoalojar. Mantiene el coste previsible con un límite de gasto por agente.',
        },
        {
          q: '¿Las acciones de los agentes se quedan en mis propios servidores?',
          a: 'En un despliegue autoalojado, sí. El motor de los agentes y sus acciones ocurren dentro de su propio despliegue. El único contenido de tickets y documentos que sale es lo que el agente envía al proveedor de LLM que usted elija, y nada si ejecuta el modelo en sus propios servidores. Si activa la búsqueda web, consultas breves van al proveedor de búsqueda, sin referencias de elementos, identificadores ni direcciones de correo.',
        },
      ],
    },
  ],
  cta: {
    title: '¿Aún tiene dudas?',
    body: 'Escríbanos, leemos cada mensaje.',
    primary: 'Contáctenos',
    secondary: 'Empezar prueba gratuita',
  },
};

export default content;
