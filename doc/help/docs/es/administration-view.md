# Vista de la administración

La Vista de la administración muestra quién administra qué. Lista sus zonas de administración con los activos que abarcan, después sus dominios con su bosque, sus confianzas y sus controladores de dominio, y después los puntos que corregir. Sigue la vista de la administración de la guía de cartografía del sistema de información de la ANSSI, y ayuda a responder a las preguntas de una revisión NIS2 sobre el acceso privilegiado.

Ábrala desde **Panorama IT > Vista de la administración**, en el grupo **Infraestructura**. Necesita `infrastructure:reader`.

## Antes de empezar

La vista lee lo que usted registra en otros lugares:

1. Defina sus zonas de administración y complete sus dominios en **Panorama IT > Configuración**. Ponga las zonas en orden: la primera es la más sensible. Consulte [Zonas de administración](it-ops-settings.md#zonas-de-administracion) y [Dominios](it-ops-settings.md#dominios).
2. Sitúe cada activo en su zona con el campo **Zona de administración** de su panel de propiedades. Consulte [Activos](assets.md#panel-de-propiedades-panel-derecho).
3. Vincule las tecnologías de directorio, como Active Directory, a los servidores que las llevan. Consulte [Vincular una tecnología a un servidor](technologies.md#vincular-una-tecnologia-a-un-servidor).
4. Un servicio de directorio que no se ejecuta en ninguno de sus servidores, como Entra ID, toma su zona del campo **Zona de administración** de su panel de propiedades. Consulte [Tecnologías](technologies.md#panel-de-propiedades).

## Por qué importan las zonas

En el modelo por tiers de la ANSSI, todo lo que puede actuar sobre un elemento de una zona sensible forma parte de esa zona. El hipervisor que ejecuta un controlador de dominio puede tomar su control, así que también es Tier 0. Los puntos de control al final de la página encuentran los activos que incumplen esta regla.

## Zonas de administración

Un bloque por zona, en el orden de la configuración, con el número de sus activos. Cada bloque muestra:

- El **Grupo de administradores** de la zona y su descripción.
- Su alcance: el número de activos de cada tipo, y el número de aplicaciones alojadas en esos activos. Solo cuentan las aplicaciones y las instancias en servicio.
- Una tabla de sus activos: **Ref.**, **Nombre** y **Tipo**. Haga clic en una fila para abrir el activo.
- **Servicios de directorio**: las tecnologías de la familia **Directorio e identidad** situadas en la zona. Haga clic en una fila para abrir la tecnología.

Los activos retirados y las tecnologías retiradas quedan fuera. Una zona marcada con **Dejar de proponer** en la configuración se sigue mostrando mientras haya activos o servicios de directorio situados en ella. Una zona eliminada de la configuración que algunos activos o servicios de directorio aún nombran se muestra después de las demás como **Zona desconocida**, con su código.

Si todavía no existe ninguna zona, la página lo indica y, si puede leer la configuración, enlaza con ella.

## Dominios

Una fila por dominio, salvo las entradas integradas **Workgroup** y **N/A**:

| Columna | Qué muestra |
|---|---|
| **Dominio** | El nombre del dominio. Un dominio que ya no se propone aparece marcado como tal |
| **Sufijo DNS** | El sufijo del nombre de sus equipos |
| **Bosque** | El bosque de Active Directory al que pertenece |
| **Confianzas** | Los dominios con los que tiene una relación de confianza, y la dirección de cada una |
| **Cuentas**, **Equipos** | Los números registrados en la configuración |
| **Controladores de dominio** | Los servidores deducidos como controladores del dominio |

**Confianzas** lista también, en solo lectura, las confianzas declaradas en otro dominio hacia este, con la dirección vista desde este dominio: una confianza saliente de A hacia B se lee como entrante en B. Las direcciones significan:

- **Saliente**: este dominio confía en el otro. Las cuentas del otro dominio pueden acceder a los recursos de este.
- **Entrante**: el otro dominio confía en este.
- **Bidireccional**: ambos.

Los **Controladores de dominio** no se introducen a mano. KANAP toma los servidores del dominio (el campo **Dominio** de la pestaña Técnico del activo) que no están retirados y que:

- llevan una tecnología de la familia **Directorio e identidad** que no está retirada, como Active Directory, o
- están asignados con el rol de servidor **Controlador de dominio** a una aplicación en servicio.

Cada servidor aparece una vez. «Ninguno encontrado» significa que ningún servidor del dominio cumple una u otra regla.

## Puntos de control

Los puntos de control enumeran lo que hay que corregir. La primera zona de la configuración que no está marcada con **Dejar de proponer** es la zona más sensible, y la página la nombra. Cada punto de control muestra su número y una tabla. Haga clic en una fila para abrir la ficha que corregir.

| Punto de control | Qué enumera |
|---|---|
| **Activos sin zona de administración** | Los activos que no están retirados y no tienen zona |
| **Controladores de dominio fuera de la zona más sensible** | Los activos asignados con el rol de servidor **Controlador de dominio** a una aplicación en servicio, cuando su zona es otra |
| **Activos que llevan un servicio de directorio fuera de la zona más sensible** | Los activos en los que hay instalada una tecnología de directorio, como Active Directory, cuando su zona es otra |
| **Lo que ejecuta un activo está en una zona menos sensible** | Un activo contenido en una zona más sensible que su contenedor (una máquina virtual del tier 0 en un host del tier 1, por ejemplo), o un miembro de clúster en una zona menos sensible que su clúster (un host ESX del tier 1 miembro de un clúster del tier 0, por ejemplo). Cada fila muestra el activo, su zona, la relación (**Se ejecuta en** o **Miembro del clúster**) y el activo del que depende, con su zona. La fila abre el activo de la zona menos sensible: sitúelo en una zona al menos igual de sensible |
| **Aplicaciones alojadas en la zona más sensible** | Cada aplicación alojada en un activo de esa zona, con el activo. Compruebe que debe estar ahí |

Para esta comprobación de la confianza, KANAP lee las relaciones **Contiene** de los activos y los miembros de los clústeres. Lo que ejecuta un activo debe estar en una zona al menos igual de sensible. Se ignora una zona marcada con **Dejar de proponer** o ausente de la configuración. Un activo sin zona interrumpe la comprobación de la cadena: KANAP no lo compara con los activos vinculados, y el primer punto de control lo señala.

Sin ninguna zona en la configuración, solo se ejecuta el primer punto de control, y la página le pide que añada una zona.

## Exportación

**Exportar las zonas** y **Exportar los dominios** descargan cada lista como archivo CSV.

El archivo de las zonas tiene una columna **Record** que indica qué es cada fila:

- **zone**: una fila por zona, con su grupo de administradores, su descripción, su número de aplicaciones alojadas y, en **Note**, su número de activos de cada tipo.
- **asset** y **directory**: los activos y los servicios de directorio de la zona nombrada en **Zone**.
- **control**: una fila por hallazgo de los puntos de control, con el título del punto de control en **Zone**. **Note** indica la zona del activo, o el activo que aloja una aplicación. Para la comprobación de la confianza, **Type** indica la relación (**Runs on** o **Member of cluster**), y **Note** indica la zona del activo y después el activo del que depende, con su zona. Un punto de control sin hallazgos no tiene fila.

## Consejos

- **Empiece por el tier 0**: sitúe primero el directorio, sus controladores, los hipervisores que los ejecutan y las herramientas que los administran. Son los más expuestos.
- **Nombre a los administradores**: el **Grupo de administradores** de una zona responde a la primera pregunta de una auditoría: ¿quién tiene los derechos de administración?
- **Revise los controladores**: un dominio sin controlador, o con uno inesperado, suele revelar un servidor al que le faltan el dominio, el rol o las tecnologías.
