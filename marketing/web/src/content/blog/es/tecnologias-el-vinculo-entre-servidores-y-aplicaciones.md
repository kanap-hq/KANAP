---
title: "Tecnologías: el vínculo entre servidores y aplicaciones"
description: "SQL Server, vSphere, Active Directory, Entra ID: lo que se ejecuta entre sus aplicaciones y sus servidores falta en la mayoría de los inventarios de TI. Con un catálogo ya rellenado, KANAP lo convierte en el eslabón que une fines de soporte, vulnerabilidades, accesos privilegiados y costes."
date: 2026-10-30
topic: compliance
features: [it-landscape]
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: technologies-link-servers-applications
---

Se decide dejar atrás SQL Server 2016. Primera pregunta: ¿quién depende de él? La lista de aplicaciones no lo dice. La de servidores da el sistema operativo y ahí se queda. Solo queda preguntar a los equipos, uno por uno, y esperar que nadie olvide una base de datos instalada hace seis años.

La misma pregunta vuelve de otras formas. Entra ID cae: ¿en qué aplicaciones ya no pueden iniciar sesión los usuarios? El contrato de vSphere llega a su renovación: ¿cuánto nos cuesta, y para qué servidores?

Lo que se ejecuta entre los servidores y las aplicaciones es el eslabón que falta en la mayoría de los inventarios de TI. Así es como KANAP lo mantiene, sin una introducción de datos tediosa, y estos son los beneficios que se pueden obtener.

## Lógica de clasificación

KANAP describe el sistema de información con tres tipos de objetos:

- **Las aplicaciones**: aquello con lo que trabajan las áreas de negocio. El ERP, el CRM, la nómina, la intranet.
- **Las tecnologías**: lo que TI ejecuta o contrata para que esas aplicaciones funcionen. SQL Server, vSphere, Active Directory, Entra ID, Tomcat.
- **Los activos**: dónde se ejecuta todo ello. Servidores, máquinas virtuales, clústeres, bases de datos en la nube.

El criterio es, por tanto, sencillo: una tecnología es un producto con el que nadie trabaja, pero cuya avería hace caer o deja expuestas otras aplicaciones. Entra ID no se ejecuta en ninguno de sus servidores, Active Directory se ejecuta en sus controladores de dominio, SQL Server tiene una línea por versión en servicio: las tres son tecnologías.

## Un catálogo de 192 productos, siempre al día

![La ventana del catálogo de tecnologías, con una búsqueda en curso.](/screenshots/technologies-catalog-2026-10-29.png)

Crear una tecnología empieza por el catálogo. Se busca el producto y se hace clic: KANAP crea la tecnología con su fabricante, su familia, su tipo de alojamiento, sus versiones y sus fechas de fin de soporte, y le añade sus vulnerabilidades conocidas y una breve descripción en su idioma.

Las fechas proceden de endoflife.date, la referencia abierta de los ciclos de vida. Para los productos que no cubre, como Cisco NX-OS, Juniper Junos, Dell PowerStore o WebLogic, KANAP toma las fechas de las páginas oficiales de los fabricantes. Cada versión muestra entonces su fuente y el día en que se comprobó la fecha.

Una tecnología adoptada se mantiene al día. Cada día, KANAP consulta el catálogo: una nueva versión publicada se añade, una fecha desplazada por el fabricante se actualiza. Lo que usted ha introducido a mano se conserva, y una versión que usted ha eliminado no se vuelve a crear. En una instalación propia, cada versión de KANAP trae las actualizaciones del catálogo, lo que no le impide activar la actualización diaria desde Internet.

Un producto que no está en el catálogo puede crearse a mano; bastan cuatro campos.

## Las versiones y su estado

![El resumen de una tecnología: sus versiones, sus fechas de fin de soporte y su estado.](/screenshots/technologies-versions-2026-10-29.png)

Una tecnología lleva una línea por versión, con el fin del soporte estándar y el fin del soporte extendido. KANAP deduce de ello un estado: con soporte, finaliza pronto cuando el soporte estándar termina en los próximos 12 meses, soporte extendido, sin soporte o fecha desconocida.

Basta una línea por versión principal: 2019 y 2022 para SQL Server, 8.0 para vSphere. En estas líneas se apoyan los servidores, las aplicaciones y todo lo que sigue. El informe de fin de soporte, que presentaremos en un próximo artículo, parte de ahí.

## Crear los vínculos

![La pestaña Aplicaciones de una tecnología, con líneas alojadas en servidores y una línea declarada.](/screenshots/technologies-applications-2026-10-29.png)

Una tecnología se introduce allí donde está instalada: en el host para un hipervisor, en cada controlador de dominio para Active Directory, en el servidor de base de datos para SQL Server. El resto se gestiona automáticamente.

- **Las máquinas que la heredan indirectamente** la reciben sin más introducción de datos. SQL Server instalado en un clúster aparece en cada uno de sus miembros.
- **Las aplicaciones alojadas** en esos servidores también la reciben: KANAP las deduce de sus despliegues.
- **Los servicios en línea** no se ejecutan en ninguno de sus servidores. Entra ID se declara entonces en las aplicaciones que utilizan el servicio.

El sistema operativo de un servidor también es una tecnología. El catálogo ofrece catorce: Windows Server, las principales distribuciones Linux, AIX, IBM i y Solaris. Aparece en la cabecera de la ficha del servidor, con su versión y sus fechas de soporte.

## Para empezar

Sus tecnologías pueden introducirse sobre la marcha o de forma masiva.

**Con un archivo CSV.** La lista de tecnologías importa y exporta los vínculos: servidores y tecnologías por un lado, aplicaciones y tecnologías por otro. Una comprobación previa enumera lo que haría la carga, línea por línea, y no se carga nada si una línea tiene un error. Una importación añade o actualiza vínculos, nunca los elimina. Una versión que usted aún no seguía se crea de paso.

**Netbox.** Si su inventario ya está allí, KANAP asocia cada plataforma de Netbox a un sistema operativo: «Debian 12» pasa a ser Debian, versión 12. Las máquinas virtuales se unen a su clúster y reciben las tecnologías instaladas en él. Vea el artículo [Su inventario de hardware ya existe, y está en Netbox](/es/blog/su-inventario-ya-esta-en-netbox).

## Una entrada, cuatro respuestas

Una vez vinculadas las tecnologías, las preguntas de la introducción encuentran su respuesta sin más trabajo.

- **Los fines de soporte**: el informe nombra los servidores y las aplicaciones que usan una versión cuyo soporte termina, en el horizonte que usted elija.
- **Las vulnerabilidades**: las vulnerabilidades publicadas se relacionan versión por versión, hasta las aplicaciones de negocio. Es el tema del artículo [Vulnerabilidades: de la CVE a la aplicación de negocio](/es/blog/vulnerabilidades-de-la-cve-a-la-aplicacion-de-negocio).
- **Los accesos privilegiados**: un servicio de directorio como Entra ID se sitúa en una zona de administración, por ejemplo el nivel 0. La vista de zonas señala los servidores que alojan un directorio fuera de la zona más sensible.
- **El coste**: la pestaña Relaciones de una tecnología reúne sus contratos, con su vencimiento y su importe anual, y sus líneas presupuestarias, con su total. Lo que cuesta vSphere se lee en su ficha, junto a los servidores que lo alojan.

![La pestaña Relaciones de vSphere: su línea presupuestaria y su contrato.](/screenshots/technologies-relations-vsphere-2026-10-29.png)

La ficha nombra también a los responsables de TI de la tecnología y a sus contactos de soporte, con sus datos de contacto. Y Plaid, el asistente integrado en KANAP, o su propia herramienta de IA conectada por MCP, responde directamente: «¿Qué servidores siguen ejecutando SQL Server 2016?»

## Por dónde empezar

1. **Adopte sus tecnologías desde el catálogo**, empezando por los sistemas operativos, las bases de datos y los hipervisores.
2. **Vincúlelas a los servidores**, en el host o el clúster cuando proceda, a mano, con un archivo CSV o mediante Netbox.
3. **Declare los servicios en línea** en las aplicaciones que los utilizan.
4. **Nombre a los responsables de TI** de cada tecnología.

KANAP no descubre el software instalado en sus servidores ni gestiona las licencias: los vínculos vienen de usted, de un archivo o de Netbox.

Para verlo todo en acción, una prueba gratuita de 14 días de nuestra versión alojada da acceso a los datos de ejemplo del grupo ficticio Fromage & Co, cargados en un minuto. KANAP es totalmente de código abierto: también puede instalarse gratis en sus propios servidores.
