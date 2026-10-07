import type { ChangelogContent } from './types';

const content: ChangelogContent = {
  meta: {
    title: 'Changelog',
    description:
      'Cambios relevantes en KANAP. Nuevas funcionalidades, mejoras y correcciones a medida que se publican. Los usuarios autoalojados siguen la misma cronología.',
  },
  header: {
    eyebrow: 'Changelog',
    title: 'Novedades en KANAP.',
    lead:
      'Lo destacado de lo que se publica entre versiones. Para el registro técnico completo, siga el repositorio de GitHub.',
  },
  subscribe: {
    label: 'Siga el ritmo',
    body: 'Las nuevas versiones llegan con regularidad. Marque el repositorio con una estrella o siga las releases en GitHub para estar al día.',
    githubCta: 'Ver releases en GitHub',
    githubHref: 'https://github.com/kanap-hq/kanap/releases',
  },
  entries: [
    {
      date: '2026-06-26',
      title: 'Personas de agente y contexto compartido.',
      summary:
        'Ahora se puede dar a los agentes una persona, su misión, cómo deben responder y cuándo escalar, y se apoyan en un contexto compartido a nivel de tenant para que cada agente trabaje con la misma información de fondo sobre su organización.',
      sections: [
        {
          label: 'Entregado',
          items: [
            'Persona por agente: misión, instrucciones, estilo de respuesta y reglas de escalado',
            'Perfiles de contexto compartido a nivel de tenant en los que puede apoyarse cada agente',
            'Vista previa del prompt efectivo, para que vea exactamente qué se le indica a un agente',
            'Una página dedicada para gestionar el contexto compartido',
          ],
        },
      ],
    },
    {
      date: '2026-06-24',
      title: 'Agentes autónomos, en marcha en una mesa de servicio real.',
      summary:
        'El runtime de agentes autónomos publicó su primera iteración en producción. Un agente trabaja ahora una mesa de servicio real, leyendo cada ticket contra sus datos de TI, redactando una respuesta con las fuentes citadas y actuando según la autonomía que usted concede.',
      sections: [
        {
          label: 'Entregado',
          items: [
            'Runtime de agentes autónomos con autonomía medida y por agente',
            'Primer conector: un agente de mesa de servicio en producción trabajando tickets reales',
            'Respuestas compuestas por IA fundamentadas en sus propios registros, con las fuentes citadas',
            'Aprobación y revisión mientras un agente aún está ganando autonomía, registro de auditoría completo',
          ],
        },
      ],
    },
    {
      date: '2026-04-24',
      title: 'Nuevo sitio de marketing.',
      summary:
        'El sitio de marketing se ha rediseñado por completo para alinearse con la nueva estética de la app KANAP. El open source es ahora el eje principal, con el autoalojamiento como ciudadano de primera clase.',
      sections: [
        {
          label: 'Entregado',
          items: [
            'Renovación visual completa, paleta teal + neutros, modo oscuro obligatorio, densidad de nivel Linear',
            'Página de autoalojamiento / on-premise como análisis dedicado en profundidad',
            'Nuevas páginas de changelog y seguridad',
            'Build estático con Astro 5, URLs limpias, enrutado i18n correcto',
            'Multilingüe desde el primer día: inglés, francés, alemán, español',
          ],
        },
      ],
    },
    {
      date: '2026-04-01',
      title: 'Renovación de diseño en toda la app.',
      summary:
        'La aplicación KANAP se ha rediseñado en torno a una carta de «densidad refinada»: solo Inter 400/500, teal para los elementos interactivos, neutro para todo lo demás, modo oscuro obligatorio en cada superficie.',
      sections: [
        {
          label: 'Cambiado',
          items: [
            'Design tokens unificados en `kanapPalette` con modos claro y oscuro',
            'Las primitivas PropertyRow / PropertyGroup reemplazan todo uso de MUI FormControl',
            'Las páginas de workspace (tareas, proyectos, solicitudes) siguen un layout de detalle compartido',
            'Overrides personalizados de AG Grid protegen el texto de las celdas del teal invasivo',
            'Autoguardado en todas las ediciones in-place; envíos explícitos reservados a creaciones y composers',
          ],
        },
      ],
    },
  ],
};

export default content;
