# Historial de los registros

La pestaña **Historial** de un registro lista los cambios que se le han hecho: quién cambió qué, y cuándo. Responde a preguntas habituales, como «¿quién subió este importe?» o «¿cuándo se desvinculó este contrato?», sin pasar por el registro de auditoría.

!!! note "Dónde está disponible"
    Hoy la pestaña **Historial** está en las líneas presupuestarias (vea [Líneas presupuestarias](budget-lines.md#historial)). Los demás registros la tendrán más adelante.

## Quién puede verlo

- Cualquier persona que pueda abrir el registro puede leer su historial. No se necesita ningún permiso adicional.
- Con un acceso a los datos limitado a ciertas empresas o centros de coste, una persona solo ve el historial de los registros incluidos en su acceso. Vea [Acceso a los datos](data-access.md).

## Qué muestra una entrada

La pestaña lista una entrada por cambio, la más reciente arriba. Cada entrada muestra:

- la fecha y la hora del cambio;
- su autor: una persona, **Sistema** para los cambios que KANAP hace por sí mismo, **Importación** para los cambios cargados desde un archivo, o **Plaid para** una persona cuando el asistente hizo el cambio en su nombre;
- para el registro en sí, el evento: **Creado**, **Actualizado** o **Eliminado**; para sus partes, el título o el evento de la parte;
- cada campo cambiado, con su valor antes y después (`antes → después`).

Un cambio de importe indica el año, la columna y los valores antes y después.

Los historiales largos se cargan por páginas: haga clic en **Cargar más** al final de la lista para ver los cambios más antiguos.

## Cambios en los elementos de un registro

El historial de una línea presupuestaria también lista los cambios en sus elementos:

- los importes, por año y columna de presupuesto;
- las dimensiones analíticas;
- las asignaciones;
- los enlaces y los archivos adjuntos;
- los contactos;
- las aplicaciones, tecnologías y activos vinculados;
- las tareas.

## Registros que no puede leer

Una entrada puede nombrar un registro de otro módulo, por ejemplo un contrato vinculado a la línea. Si no puede leer ese módulo, o si el registro se ha eliminado desde entonces, la entrada lo nombra solo por su tipo, por ejemplo «un contrato».

## El registro de auditoría completo

El historial se limita a lo que necesita un lector. El registro técnico completo de cada cambio, en todo el espacio de trabajo, sigue en **Administración > Registro de auditoría**. Vea [Registro de auditoría](admin.md#registro-de-auditoria).
