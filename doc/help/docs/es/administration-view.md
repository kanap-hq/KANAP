# Zonas de administración

La página Zonas de administración muestra quién administra qué. Sigue el modelo de administración por tiers, una buena práctica reconocida para administrar directorios como Active Directory: sus zonas de administración, los activos de cada una, los puntos que corregir, y después sus servicios de directorio y sus dominios. Ayuda a responder a las preguntas de una revisión NIS2 sobre los accesos privilegiados.

Ábrala desde **Panorama IT > Zonas de administración**, en el grupo **Infraestructura**. Necesita `infrastructure:reader` para leerla, e `infrastructure:member` para asignar zonas desde ella.

## Antes de empezar

La página lee lo que usted registra en otros lugares:

1. Defina sus zonas de administración y complete sus dominios en **Panorama IT > Configuración**. Ponga las zonas en orden: la primera es la más sensible. Consulte [Zonas de administración](it-ops-settings.md#zonas-de-administracion) y [Dominios](it-ops-settings.md#dominios).
2. Sitúe cada activo en su zona, aquí en bloque (consulte [Asignar una zona](#asignar-una-zona)) o con el campo **Zona de administración** del panel de propiedades del activo. Consulte [Activos](assets.md#panel-de-propiedades-panel-derecho).
3. Vincule las tecnologías de directorio, como Active Directory, a los servidores que las llevan. Consulte [Vincular una tecnología a un servidor](technologies.md#vincular-una-tecnologia-a-un-servidor).
4. Un servicio de directorio que no se ejecuta en ninguno de sus servidores, como Entra ID, toma su zona del campo **Zona de administración** de su panel de propiedades. Consulte [Tecnologías](technologies.md#panel-de-propiedades).

## Por qué importan las zonas

En el modelo de administración por tiers, todo lo que puede actuar sobre un elemento de una zona sensible pertenece a esa zona: el hipervisor que ejecuta un controlador de dominio puede tomar su control, así que también es tier 0. Los puntos de control encuentran los activos que incumplen esta regla.

## Pestañas

La página tiene dos pestañas, cada una con su recuento:

- **Activos**: las zonas, los puntos de control y la tabla de activos. Su recuento es el número de activos que no están retirados.
- **Directorios y dominios**: sus servicios de directorio y, después, sus dominios agrupados por bosque. Su recuento suma los servicios de directorio y los dominios.

La página se abre en **Activos**. La dirección de la página conserva la pestaña abierta y los filtros de la tabla, así que un enlace abre la misma vista. **Exportar activos** y **Exportar los dominios** permanecen en la parte superior de la página en ambas pestañas. **Asignar a una zona** aparece en la pestaña **Activos**.

## Zonas

La banda superior lista las zonas en el orden de la configuración, la más sensible primero, y después una fila **Sin zona**. Cada fila muestra:

- El nombre de la zona, con su descripción debajo.
- Su **Grupo de administradores**.
- El número de sus activos de cada tipo, el número de aplicaciones alojadas en esos activos y el número de servicios de directorio situados en la zona. Pase el cursor sobre los servicios de directorio para leer sus nombres. Solo cuentan las aplicaciones y las instancias en servicio.

Haga clic en una fila para mostrar solo sus activos en la tabla de abajo. Vuelva a hacer clic para mostrar todos los activos. La fila **Sin zona** indica el número de activos que aún no tienen zona.

Se excluyen los activos y las tecnologías retirados. Una zona marcada con **Dejar de proponer** en la configuración se sigue mostrando mientras haya activos o servicios de directorio situados en ella. Una zona eliminada de la configuración mientras activos o servicios de directorio aún la nombran aparece después de las demás como **Zona desconocida**, con su código.

Si aún no existe ninguna zona, la página lo indica y, si usted puede leer la configuración, enlaza con ella.

## Puntos de control

Bajo la banda, un botón por punto de control indica su nombre corto y su número de activos. Pase el cursor sobre él para leer el título completo y qué hacer. Haga clic para mostrar en la tabla solo los activos afectados, y de nuevo para mostrar todos los activos.

La zona más sensible es la primera zona de la configuración que no está marcada con **Dejar de proponer**.

| Punto de control | Activos que lista |
|---|---|
| **Sin zona asignada** | Los activos que no tienen zona |
| **Controlador de dominio fuera** | Los activos asignados con el rol de servidor **Controlador de dominio** a una aplicación en servicio, cuando su zona no es la más sensible |
| **Servicio de directorio fuera** | Los activos con una tecnología de directorio instalada, como Active Directory, cuando su zona no es la más sensible |
| **Host menos sensible** | Los activos que hay que elevar: un host que ejecuta un activo de una zona más sensible (un host tier 1 que ejecuta una máquina virtual tier 0, por ejemplo), o el miembro de un clúster de una zona más sensible (un host ESX tier 1 en un clúster tier 0, por ejemplo) |
| **Aplicación alojada** | Los activos de la zona más sensible que alojan una aplicación en servicio. Revise si cada aplicación debe estar ahí |

Para **Host menos sensible**, KANAP lee las relaciones **Contiene** de los activos y los miembros de los clústeres. Lo que ejecuta un activo debe estar en una zona al menos igual de sensible. Se ignora una zona marcada con **Dejar de proponer** o ausente de la configuración. Un activo sin zona interrumpe la comprobación de la cadena: KANAP no compara ni ese activo ni los activos vinculados a él, y **Sin zona asignada** lo lista.

Sin ninguna zona en la configuración, solo se muestra **Sin zona asignada**, y la página le pide que añada una zona.

## Activos

La tabla lista todos los activos que no están retirados, y carga más a medida que se desplaza. Haga clic en una fila para abrir el activo.

| Columna | Qué muestra |
|---|---|
| **Ref.**, **Nombre**, **Tipo** | El activo |
| **Zona** | Su zona de administración, o **Sin zona** |
| **Tecnologías** | Las tecnologías instaladas en el activo. Se muestran los dos primeros nombres y después el número de los demás; pase el cursor sobre la celda para ver la lista completa |
| **Aplicaciones** | Las aplicaciones en servicio alojadas en el activo, mostradas de la misma forma. Haga clic en un nombre para abrir la aplicación |
| **Controles** | Los puntos de control que afectan al activo. Pase el cursor sobre **Host menos sensible** para ver el motivo: **Ejecuta** nombra el activo más sensible que ejecuta, **Miembro del clúster** nombra el clúster más sensible, cada uno con su zona |

Busque por nombre o referencia. Filtre por **Tipo**, **Zona** (incluida **Sin zona**) y **Controles**, y ordene por **Ref.**, **Nombre**, **Tipo** o **Zona**. El orden por zona sigue el de la configuración, con los activos sin zona al final. La banda y los botones de los puntos de control aplican los mismos filtros que las columnas **Zona** y **Controles**.

## Asignar una zona

Con `infrastructure:member`, cada fila empieza con una casilla:

- Marque filas para elegirlas una a una.
- Marque la casilla del encabezado para elegir todos los activos del filtro actual, incluidos los que aún no se han cargado. Después puede desmarcar filas para dejarlas fuera.

Cambiar la búsqueda o los filtros borra la elección. **Asignar a una zona** abre un cuadro de diálogo en el que elige una zona, o **Sin zona** para quitarla. No se puede elegir una zona marcada con **Dejar de proponer**. Antes de que confirme, el cuadro de diálogo cuenta los activos cuya zona va a cambiar entre los activos elegidos. Una asignación abarca hasta 5.000 activos: por encima, acote los filtros.

Si entran activos en el filtro entre el recuento y la confirmación, KANAP rechaza el cambio y vuelve a contar: compruebe el nuevo número y confirme. Cada activo modificado recibe una entrada en el registro de auditoría, como cuando lo edita.

## Servicios de directorio y dominios

**Servicios de directorio** lista las tecnologías de la familia **Directorio e identidad**, con su zona y su número de servidores (los servidores que no están retirados y llevan directamente la tecnología). Haga clic en una fila para abrir la tecnología.

**Dominios** lista sus dominios, salvo las entradas integradas **Workgroup** y **N/A**, agrupados por bosque. Los dominios cuyo bosque se escribe con distintas mayúsculas y minúsculas comparten un grupo. Los dominios sin bosque van al final, bajo **Sin bosque**. Cada dominio muestra:

| Columna | Qué muestra |
|---|---|
| **Dominio** | El nombre del dominio. Un dominio que ya no se propone se marca como tal |
| **Sufijo DNS** | El sufijo de los nombres de sus equipos |
| **Confianzas** | Los dominios con los que tiene una confianza, y la dirección de cada una |
| **Cuentas**, **Equipos** | Los números registrados en la configuración. Un guion significa que no hay ninguno registrado |
| **Controladores de dominio** | Cuántos servidores deduce KANAP como controladores del dominio, y después sus nombres |

**Confianzas** también lista, en gris, las confianzas declaradas en otro dominio hacia este, con la dirección vista desde este dominio: una confianza saliente de A hacia B se lee como entrante en B. Las direcciones significan:

- **Saliente**: este dominio confía en el otro. Las cuentas del otro dominio pueden acceder a los recursos de este.
- **Entrante**: el otro dominio confía en este.
- **Bidireccional**: ambos.

Los **Controladores de dominio** no se introducen a mano. KANAP toma los servidores del dominio (el campo **Dominio** de la pestaña Técnico del activo) que no están retirados y que:

- llevan una tecnología de la familia **Directorio e identidad** que no está retirada, como Active Directory, o
- están asignados con el rol de servidor **Controlador de dominio** a una aplicación en servicio.

Cada servidor aparece una vez. «Ninguno encontrado» significa que ningún servidor del dominio cumple ninguna de las dos reglas.

## Exportación

**Exportar activos** descarga los activos de la tabla en un archivo CSV, con su búsqueda, sus filtros y su orden. Las columnas son **Zone**, **Reference**, **Name**, **Type**, **Technologies**, **Applications**, **Controls** y **Dependency**. **Dependency** indica, para **Host menos sensible**, cada activo más sensible que ejecuta el activo o cada clúster del que es miembro, con su zona. Una exportación contiene hasta 10.000 activos: por encima, acote los filtros.

**Exportar dominios** descarga cada dominio con su sufijo DNS, su bosque, sus confianzas (las suyas y las declaradas por otros dominios), sus números de cuentas y de equipos, y sus controladores de dominio.

## Consejos

- **Empiece por el tier 0**: sitúe primero el directorio, sus controladores, los hipervisores que los ejecutan y las herramientas que los administran. Son los más expuestos.
- **Parta de un punto de control**: haga clic en **Sin zona asignada**, marque la casilla del encabezado y asigne la zona de una vez, y después afine fila por fila.
- **Nombre a los administradores**: el **Grupo de administradores** de una zona responde a la primera pregunta de una auditoría: ¿quién tiene los derechos de administración?
- **Revise los controladores**: un dominio sin controlador, o con uno inesperado, suele revelar un servidor al que le faltan el dominio, el rol o las tecnologías.
