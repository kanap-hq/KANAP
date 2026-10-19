import type { AboutContent } from './types';

const content: AboutContent = {
  meta: {
    title: 'Acerca de',
    description:
      'KANAP es un proyecto open source de gobierno de TI creado por Friedrich Eva, CIO interino: por qué existe, por qué es open source y cómo se financia.',
  },
  header: {
    eyebrow: 'Acerca de',
    title: 'Creado por un CIO para los CIO',
    lead:
      'KANAP es un proyecto open source nacido sobre el terreno: el de las idas y vueltas del presupuesto, los mapas de aplicaciones y la documentación que faltan la víspera de una auditoría, los arbitrajes entre las peticiones de negocio.',
  },
  founder: {
    name: 'Friedrich Eva',
    role: 'fundador',
    jobTitle: 'CIO interino, fundador de KANAP',
    photoAlt: 'Friedrich Eva, fundador de KANAP',
    paragraphs: [
      'Soy CIO interino. Mi oficio: retomar o reconstruir un departamento de TI, situarlo en el centro de un programa ERP, integrar los sistemas de información de una empresa adquirida o, simplemente, asegurar una transición productiva y eficaz. Llevo más de veinte años en informática, ocho de ellos como CIO de dos medianas empresas internacionales, primero en la distribución y después en la industria. Tengo las certificaciones CISSP e ISO 27001 Lead Implementer, y trabajo en francés, inglés y alemán.',
    ],
    linkedinLabel: 'Mi perfil de LinkedIn',
  },
  sections: [
    {
      title: 'Por qué KANAP',
      paragraphs: [
        'A menudo me he encontrado con los mismos problemas: el presupuesto repartido en varios archivos de Excel, uno o varios mapas de aplicaciones empezados y rara vez mantenidos, los proyectos en otro sitio, los contratos dispersos entre compras, jurídico y TI. Y antes de cada comité, horas conciliándolo todo a mano.',
        'Por eso empecé KANAP: para reunir en un mismo lugar las herramientas esenciales del gobierno de TI. Primero el presupuesto, después la cartera de proyectos, el mapa de aplicaciones, los contratos, la documentación. Luego llegaron las necesidades de reporting y, por último, un agente de IA integrado que facilita la búsqueda y la síntesis de la información. Hoy, KANAP es una plataforma modular para pymes y medianas empresas: se puede usar un solo módulo o varios, según el contexto y las necesidades.',
      ],
    },
    {
      title: 'Un laboratorio que llega a producción',
      paragraphs: [
        'KANAP es también mi laboratorio. Allí construyo la herramienta que me habría gustado encontrar al llegar a cada departamento de TI, y pruebo lo que la IA cambia de verdad en el día a día. Vale para el desarrollo del propio KANAP, que se acelera con los avances de la IA, y también para el gobierno de TI: agentes que proponen y actúan bajo control humano, un servidor MCP para consultar sus datos desde Claude o ChatGPT. Cada función de KANAP parte de una necesidad real, encontrada sobre el terreno.',
      ],
    },
    {
      title: 'Por qué open source',
      paragraphs: [
        'Una herramienta de gobierno contiene lo más sensible de un departamento de TI: sus costes, sus contratos, sus proveedores, los puntos débiles de sus sistemas de información. Usted debe poder leerla, alojarla en sus propios servidores y no quedar nunca atrapado en ella.',
        'Por eso KANAP se publica bajo la licencia AGPL v3: el código es público, puede instalarlo en sus propios servidores y modificarlo, y sus datos siguen siendo suyos. Si confía la operación a KANAP, la aplicación se aloja en Alemania en servidores dedicados, sus datos se pueden exportar en CSV y siempre es posible volver a sus propios servidores.',
      ],
    },
    {
      title: 'Un proyecto independiente',
      paragraphs: [
        'KANAP lo edita la sociedad KANAP, una empresa francesa unipersonal (EURL) con sede en Obernai, en Alsacia. El proyecto se desarrolla con fondos propios, en paralelo a mi actividad como CIO. Así sigue siendo totalmente independiente.',
        'Como software open source, KANAP es totalmente gratuito. Los servicios de pago son opcionales y sirven para ahorrarle tiempo, asegurar el uso o adaptar la aplicación: soporte, alojamiento, acompañamiento y desarrollo a medida. Ese acompañamiento se lo ofrezco yo mismo, con la mirada de un CIO. <a href="/es/offer">Ver la oferta</a>',
        'En cualquier caso, la <a href="https://doc.kanap.net/es/">ayuda en línea</a> completa, en cuatro idiomas, le guía desde los primeros pasos hasta el uso experto.',
      ],
    },
  ],
  cta: {
    title: 'Probar KANAP',
    body: '14 días, todas las funciones, sin tarjeta.',
    primary: 'Probar KANAP 14 días',
    secondary: 'Contactar',
  },
};

export default content;
