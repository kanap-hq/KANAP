# Vista de la administración

La Vista de la administración muestra quién administra qué. Lista sus zonas de administración con sus tecnologías y sus servidores, y después sus dominios con su bosque, sus confianzas y sus controladores de dominio. Sigue la vista de la administración de la guía de cartografía del sistema de información de la ANSSI, y ayuda a responder a las preguntas de una revisión NIS2 sobre el acceso privilegiado.

Ábrala desde **Panorama IT > Vista de la administración**, en el grupo **Infraestructura**. Necesita `infrastructure:reader`.

## Antes de empezar

La vista lee lo que usted registra en otros lugares:

1. Defina sus zonas de administración y complete sus dominios en **Panorama IT > Configuración**. Consulte [Zonas de administración](it-ops-settings.md#zonas-de-administracion) y [Dominios](it-ops-settings.md#dominios).
2. Sitúe cada tecnología en su zona con el campo **Zona de administración** de su panel de propiedades. Consulte [Tecnologías](technologies.md#panel-de-propiedades).
3. Vincule las tecnologías a los servidores que las llevan. Consulte [Vincular una tecnología a un servidor](technologies.md#vincular-una-tecnologia-a-un-servidor).

## Zonas de administración

Un bloque por zona, por nombre. Cada bloque muestra:

- El **Grupo de administradores**, el **Nivel de privilegios** y los **Secretos** (dónde se guardan sus secretos) de la zona.
- **Servicios de directorio**: las tecnologías de la familia **Directorio e identidad** situadas en la zona.
- Una tabla de sus tecnologías: **Ref.**, **Tecnología**, **Familia** y **Servidores**. Los servidores son los que llevan la tecnología, directamente o a través del servidor en el que se ejecutan («a través de» ese servidor).

Las tecnologías sin zona van al final, en **Sin zona**. Un aviso en la parte superior de la página las cuenta: abra cada una e indique su zona.

Las tecnologías retiradas y los servidores retirados quedan fuera. Una zona marcada con **Dejar de proponer** en la configuración se sigue mostrando mientras haya tecnologías situadas en ella. Una zona eliminada de la configuración que algunas tecnologías aún nombran se muestra como **Zona desconocida**, con su código.

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

## Exportación

**Exportar las zonas** y **Exportar los dominios** descargan cada lista como archivo CSV.

## Consejos

- **Empiece por el tier 0**: sitúe primero el directorio, sus controladores y las herramientas que los administran. Son los más expuestos.
- **Nombre los secretos**: la **Ubicación de los secretos** de una zona responde a la primera pregunta de una auditoría: ¿dónde se guardan las contraseñas de administración?
- **Revise los controladores**: un dominio sin controlador, o con uno inesperado, suele revelar un servidor al que le faltan el dominio o las tecnologías.
