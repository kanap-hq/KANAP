# Toda la configuración

La página Toda la configuración reúne, en una sola pantalla, cada página de configuración que usted puede abrir: su propia cuenta, la configuración de cada módulo, la administración de su organización y, según su instalación, las páginas de la instalación o de la plataforma. Úsela cuando sepa qué quiere cambiar pero no dónde se encuentra.

## Dónde encontrarla

- Desde el menú de la cuenta (el icono de persona arriba a la derecha): **Toda la configuración**, encima de la entrada de su cuenta. Toda persona que haya iniciado sesión la tiene.
- En el menú **Administración**: **Toda la configuración**, la última entrada, aparte, debajo de las demás secciones. Aparece cuando ve otras páginas de ese menú. En el host de la plataforma, la entrada está solo en el menú de la cuenta.
- Ruta: `/admin/all-settings`

## Cómo se organiza la lista

Las páginas se agrupan en este orden:

- **Mi cuenta**: su perfil, las notificaciones, la apariencia, las aplicaciones conectadas y la disposición de su página de inicio.
- **Un grupo por módulo**: Agentes IA, Portafolio, Panorama IT, Base de conocimiento y Gestión presupuestaria, en el orden de la barra superior.
- **Administración**: usuarios, roles, acceso a los datos, registro de auditoría, facturación, autenticación, personalización, IA e integraciones.
- **Instalación**: las páginas que configuran la propia instalación, como las tareas programadas. En una instalación en sus propios servidores, se muestran al rol Administrador; en el servicio en la nube, al administrador de la plataforma, en el host de la plataforma.
- **Plataforma**: en el host de la plataforma del servicio en la nube, las páginas de administración de la plataforma.

Cada línea indica el nombre de la página y, en gris, la ruta de menú que lleva a ella. Haga clic en el nombre para abrir la página. Cuando la página tiene pestañas y la pestaña forma parte de su dirección, el enlace abre directamente esa pestaña (por ejemplo **Notificaciones** o **Netbox**). Un parámetro que se define en un cuadro de diálogo, como el plazo de decisión de los contratos o los tipos de documento de la base de conocimiento, abre la página que contiene ese cuadro de diálogo.

## Búsqueda

Escriba en el campo de búsqueda para filtrar la lista. La búsqueda tiene en cuenta los nombres de las páginas y los nombres de sus parámetros principales, en su idioma. Las mayúsculas y los acentos no importan.

Por ejemplo, **moneda de reporting** encuentra la página **Monedas** de Gestión presupuestaria, porque la moneda de reporting se define allí. Varias palabras acotan la lista: cada palabra debe aparecer.

Cuando nada coincide, la página lo indica en una línea.

## Lo que la lista le muestra

La lista muestra solo las páginas que usted puede abrir con sus roles, exactamente como los menús:

- Una página que puede leer pero no modificar aparece en la lista. Se abre en solo lectura.
- Una página que no puede abrir no aparece, y tampoco un grupo que queda vacío.
- Las páginas que dependen de una funcionalidad solo aparecen cuando esa funcionalidad está activa: la facturación en la nube, **Autenticación** cuando el inicio de sesión con Microsoft está configurado, las páginas de IA cuando la IA está habilitada.
- Con un acceso a los datos limitado, la administración del presupuesto y las páginas del acceso a los datos no aparecen en la lista.
- En una instalación en sus propios servidores, las páginas exclusivas de la nube (facturación, datos de ejemplo) no aparecen en la lista. El grupo **Instalación** se muestra al rol Administrador con acceso a todos los datos.
- En el host de la plataforma, la lista solo contiene las páginas de la instalación y de la plataforma.

Desde esta página no se modifica nada: solo lleva a las páginas donde se define la configuración.
