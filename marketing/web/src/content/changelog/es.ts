import type { ChangelogContent } from './types';

const content: ChangelogContent = {
  meta: {
    title: 'Changelog',
    description:
      'Notas de versión de Kadratis: lo que cada versión aporta a quienes la usan. La lista técnica de cambios está en GitHub.',
  },
  header: {
    eyebrow: 'Changelog',
    title: 'Novedades en Kadratis.',
    lead:
      'Kadratis publica una versión aproximadamente una vez al mes. Las notas de versión de abajo explican lo que cada una aporta a su equipo. Cada versión tiene además su release en GitHub, con la lista completa de cambios.',
  },
  empty: 'Las primeras notas de versión llegarán pronto.',
  github: {
    label: 'Detalles técnicos',
    body: 'Cada versión tiene su release en GitHub, con todos los cambios, los pasos de actualización de las instalaciones autoalojadas y el inventario de componentes.',
    cta: 'Ver releases en GitHub',
    href: 'https://github.com/kanap-hq/KANAP/releases',
  },
};

export default content;
