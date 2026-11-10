---
title: "Los clústeres en la cartografía de Kadratis"
description: "Un SQL Server Always On, una granja vSphere: describa el clúster una sola vez. Dónde colocar sus aplicaciones según el tipo de clúster, qué heredan los miembros y vistas de impacto que cuentan bien."
date: 2026-11-02
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: server-clusters-kanap-mapping
---

Un SQL Server Always On de dos nodos, una granja vSphere de seis hosts. En una hoja de cálculo o una CMDB mantenida a mano, cada aplicación y cada flujo de red se copia en cada nodo. El séptimo host, añadido el año pasado, no ha recibido nada.

El día de una avería, la pregunta «¿qué cae con este host?» recibe entonces una respuesta falsa, y las vulnerabilidades del nodo olvidado no aparecen en ninguna parte.

En Kadratis, usted describe el clúster una sola vez. Sus miembros heredan lo que lleva, y todas las vistas que cuentan servidores cuentan bien. Aún hay que saber dónde colocar cada aplicación: la respuesta depende del tipo de clúster.

## Dos tipos de clústeres, dos reglas

Un clúster se crea con **Añadir clúster**, o activando el conmutador **Clúster** en un activo existente. Sus miembros se gestionan en la parte superior de su pestaña **Operaciones**.

Después viene la pregunta de la que depende todo lo demás: ¿dónde asignar las aplicaciones?

- **Un clúster de conmutación por error**, como SQL Server Always On, ejecuta la aplicación en cada nodo. Asigne la aplicación al clúster: cada miembro en servicio la aloja, con el rol de la asignación.
- **Un clúster de virtualización**, como vSphere, ejecuta máquinas virtuales que pasan de un host a otro. Coloque las máquinas en la sección **Contiene** del clúster, en su pestaña **Dependencias**, y asigne cada aplicación a su máquina virtual. Solo la plataforma misma, vSphere con el rol de virtualización, se asigna al clúster.

Algunas reglas evitan las incoherencias. Un clúster con miembros no tiene sistema operativo: cada miembro tiene el suyo. Un miembro no se convierte en clúster, y un clúster no es miembro de otro.

![La pestaña Operaciones de un clúster SQL Server: sus dos servidores miembros y las aplicaciones asignadas al clúster.](/screenshots/clusters-operations-2026-11-02.png)

## Una sola entrada, herencia para el resto

Lo que lleva el clúster se transmite a sus miembros. Un nodo añadido el año que viene aloja enseguida las aplicaciones del clúster; un nodo retirado deja de alojarlas. Un servidor retirado del parque no hereda nada.

El error más frecuente sigue siendo asignar la aplicación a un solo nodo. Cuando elige un miembro, Kadratis pregunta **¿Asignar al clúster?**. La pregunta nombra a los miembros cuya asignación propia será sustituida por la del clúster, que conserva la fecha de puesta en servicio más antigua y sus notas. **Solo este servidor** sigue siendo posible, para la excepción real.

Los flujos siguen la misma lógica. Una conexión puede salir de un clúster, llegar a él o atravesarlo: se aplica a cada miembro en servicio. La pestaña **Red** de un miembro lista las conexiones de su clúster, y el mapa de conexiones dibuja los miembros.

![La pregunta «¿Asignar al clúster?»: PAR-SQL-01 forma parte de PAR-SQL-CL01, y sus dos miembros alojarán la aplicación.](/screenshots/clusters-assign-2026-11-02.png)

## Vistas exactas

La ventaja se ve el día en que cae un servidor. En la ficha de un miembro, la pestaña **Dependencias** se abre en **Si este servidor cae** (**Si este activo cae** para una máquina virtual). El clúster aparece allí como **Degradado**, con el número de miembros caídos, y sus aplicaciones siguen funcionando en los otros nodos. Solo pasa a **Caído** cuando ningún miembro sigue en pie: sus aplicaciones y sus máquinas virtuales caen entonces con él.

Allí donde Kadratis busca dónde se ejecuta una aplicación, cuenta los miembros:

- **Las vulnerabilidades y el fin de soporte** de una aplicación tienen en cuenta cada nodo. Un clúster muestra las vulnerabilidades de sus miembros en servicio junto con las suyas.
- **Las tecnologías** de los miembros aparecen en el clúster, una fila por versión, con los miembros que la llevan.
- **Las zonas de administración, las ubicaciones y los contratos** cuentan las aplicaciones de los miembros.
- **El asistente Kad y Conocimiento** responden con las mismas reglas.

En el propio clúster, la pestaña **Dependencias** pliega los activos de los que dependen sus miembros bajo una fila **A través de los miembros**.

![La vista de impacto de un miembro: PAR-SQL-CL01 está degradado, uno de sus dos miembros caído.](/screenshots/clusters-impact-2026-11-02.png)

## Importar en lugar de teclear

Kadratis no descubre sus clústeres: los describe. Si su inventario ya está en Netbox, la sincronización asocia cada clúster de Netbox con un clúster de Kadratis y coloca sus máquinas virtuales en **Contiene**, con las mismas reglas. Consulte [Su inventario de hardware ya existe, y está en Netbox](/es/blog/su-inventario-ya-esta-en-netbox).

La importación CSV de activos tiene una columna `cluster`: crea pertenencias reales, que volverá a encontrar en la exportación. La verificación previa rechaza un nombre de clúster desconocido o ambiguo antes de escribir nada.

Por último, eliminar un miembro no se hace a ciegas: la confirmación indica qué clústeres abandona y qué relaciones se van con él.

## Por dónde empezar

1. Cree sus clústeres y vincule a ellos sus miembros, desde la pestaña **Operaciones**.
2. Para un clúster de conmutación por error, asigne las aplicaciones al clúster. Para un clúster de virtualización, coloque las máquinas virtuales en el clúster y deje las aplicaciones en sus máquinas.
3. Abra la pestaña **Dependencias** de un miembro y compruebe que la respuesta es correcta.

Para ver cómo las tecnologías vinculan estos servidores con sus aplicaciones, lea [Tecnologías: el vínculo entre servidores y aplicaciones](/es/blog/tecnologias-el-vinculo-entre-servidores-y-aplicaciones). Kadratis es de código abierto y se puede probar gratis, en línea o en sus propios servidores.
