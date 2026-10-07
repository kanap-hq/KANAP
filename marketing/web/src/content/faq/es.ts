import type { FaqContent } from './types';

const content: FaqContent = {
  meta: {
    title: 'FAQ',
    description:
      'Preguntas frecuentes sobre precios, licencia, autoalojamiento, nube alojada, Plaid, agentes, soporte y facturación de KANAP.',
  },
  header: {
    eyebrow: 'FAQ',
    title: 'Preguntas frecuentes.',
    lead:
      'Todo lo que necesita saber sobre KANAP, licencia, precios, alojamiento, Plaid y agentes. Si no encuentra su respuesta, escríbanos.',
  },
  groups: [
    {
      label: 'Licencia y open source',
      items: [
        {
          q: '¿Bajo qué licencia está KANAP?',
          a: 'KANAP se publica bajo licencia <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener" target="_blank">AGPL v3</a>, una licencia open source ampliamente reconocida y aprobada por la OSI. Puede usar, modificar y distribuir el software libremente. La cláusula copyleft de AGPL garantiza que quien ejecute una versión modificada como servicio debe compartir sus cambios. Esto protege a la comunidad y mantiene KANAP realmente abierto.',
        },
        {
          q: '¿Puedo usar KANAP comercialmente?',
          a: 'Sí. Uso interno, uso comercial, SaaS externo, todo está permitido. La cláusula copyleft solo le obliga a compartir modificaciones si ejecuta una versión modificada como servicio en red. El uso puramente interno no genera ninguna obligación.',
        },
        {
          q: '¿Puedo contribuir a KANAP?',
          a: 'Sí, por favor. Todo el código fuente está en <a href="https://github.com/kanap-hq/kanap" rel="noopener" target="_blank">GitHub</a>. Las issues, las pull requests y los debates son bienvenidos. Consulte CONTRIBUTING.md para conocer las pautas.',
        },
      ],
    },
    {
      label: 'Nube y prueba',
      items: [
        {
          q: '¿Cómo funciona la prueba gratuita?',
          a: 'KANAP alojado comienza con una prueba gratuita de 14 días. Sin tarjeta de crédito. Acceso completo a todas las funcionalidades, más una sesión de activación de 60 minutos gratuita por empresa si se reserva durante la prueba.',
        },
        {
          q: '¿Qué pasa cuando termina mi prueba?',
          a: 'Tras los 14 días de prueba debe elegir un plan de pago para continuar. Su tenant sigue disponible 30 días más con acceso limitado. Pasado ese periodo de 30 días, su tenant se elimina.',
        },
        {
          q: '¿Qué es la sesión de activación gratuita?',
          a: 'Cada prueba incluye una sesión de activación de 60 minutos gratuita por empresa. Tras la suscripción le enviamos un email para agendar la llamada. La sesión es una videollamada centrada en los primeros hitos de valor según sus objetivos principales.',
        },
        {
          q: '¿Cuál es la diferencia entre nube y autoalojado?',
          a: 'El alojamiento en nube significa que nosotros lo gestionamos todo por usted: alojamiento, actualizaciones, copias de seguridad, infraestructura y soporte prioritario. Autoalojado significa que usted ejecuta KANAP en sus propios servidores. El producto completo es gratuito para autoalojar; puede contratar Soporte autoalojado si quiere ayuda prioritaria manteniendo el control de su infraestructura.',
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
          a: 'Para suscriptores de pago: escríbanos por cualquier incidencia operativa. Aspiramos a responder en 24h y resolver su problema. Es best-effort, sin SLA, pero somos personas reales que leen y responden cada mensaje.',
        },
      ],
    },
    {
      label: 'Facturación',
      items: [
        {
          q: '¿Puedo pagar por factura?',
          a: 'El pago por factura (transferencia bancaria) está disponible para suscripciones anuales superiores a 1 000 € para clientes en EUR. Hoy esto significa las suscripciones anuales de Soporte autoalojado y de KANAP alojado. Las facturas son NET30.',
        },
        {
          q: '¿Puedo cambiar entre autoalojado y alojado?',
          a: 'Sí. KANAP es el mismo producto en ambos modos. Contáctenos si quiere pasar de autoalojado a alojado, o si necesita una exportación para operar la plataforma usted mismo.',
        },
        {
          q: '¿Puedo cancelar mi suscripción?',
          a: 'Por supuesto. Cancele desde su Centro de facturación cuando quiera, su suscripción sigue activa hasta el final del periodo de facturación actual, sin preguntas.',
        },
      ],
    },
    {
      label: 'Plaid (asistente de IA)',
      items: [
        {
          q: '¿Cuál es la diferencia entre los mensajes Plaid incluidos y Bring Your Own Key?',
          a: 'KANAP alojado incluye una cantidad generosa de mensajes Plaid, impulsados por un modelo intermedio que hemos seleccionado y probado con cuidado con KANAP. Para respuestas aún más capaces, la opción Bring Your Own Key le permite conectar modelos de última generación de OpenAI, Anthropic o cualquier proveedor compatible. BYOK también le da control total sobre cómo se procesan sus datos y elimina cualquier límite de mensajes.',
        },
        {
          q: '¿Cómo puedo controlar Plaid?',
          a: 'A nivel de plataforma, Plaid se puede desactivar por completo, activar en modo solo lectura o activar en modo lectura-escritura (con vista previa y confirmación para todos los cambios). La búsqueda web y MCP se activan o desactivan por separado. A nivel de usuario, usted controla quién accede a cada funcionalidad de Plaid mediante permisos por rol. El RBAC se aplica siempre, Plaid nunca ve más de lo que el usuario tiene permitido.',
        },
      ],
    },
    {
      label: 'Agentes (automatización con IA)',
      items: [
        {
          q: '¿Son autónomos los agentes?',
          a: 'Sí, por diseño. Un agente empieza supervisado: propone acciones y usted las revisa. A medida que KANAP mide con qué frecuencia acierta, usted le concede más autonomía, hasta que gestiona el trabajo rutinario por sí solo y solo escala lo que necesita a una persona. Usted decide hasta dónde llega eso.',
        },
        {
          q: '¿Cómo controlo lo que puede hacer un agente?',
          a: 'Usted define el nivel de autonomía de cada agente y lo acota a las operaciones que permite. Los agentes actúan solo a través de operaciones definidas, sin acceso directo a la base de datos ni al shell. Cada acción queda registrada, puede pausar cualquier agente de inmediato y puede limitar lo que un agente gasta en el LLM.',
        },
        {
          q: '¿Puedo confiar trabajo real a un agente?',
          a: 'Para eso están los controles. Un agente razona sobre sus propios datos de TI en lugar de adivinar, cita las fuentes que utilizó y registra cada acción en el mismo registro de auditoría que el resto de KANAP. Gana autonomía demostrándose en tareas reales, y usted puede detenerlo en cualquier momento.',
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
          a: 'Sí. Los agentes forman parte del producto open source bajo AGPL v3, sin feature gate de IA. Usted aporta su propia clave LLM, el mismo modelo que Plaid. Autoaloje la plataforma completa gratis, agentes incluidos.',
        },
        {
          q: '¿Cuánto cuesta ejecutar agentes?',
          a: 'Los agentes usan un LLM, así que usted aporta su propia clave y paga a su proveedor por lo que consumen. KANAP en sí es gratuito para autoalojar. Mantiene el coste previsible con un límite de gasto por agente.',
        },
        {
          q: '¿Las acciones de los agentes se quedan en mis propios servidores?',
          a: 'En un despliegue autoalojado, sí. El razonamiento y las acciones del agente ocurren dentro de su propio despliegue, y sus tickets y documentos nunca salen de él. La única llamada externa es al proveedor de LLM que usted elija.',
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
