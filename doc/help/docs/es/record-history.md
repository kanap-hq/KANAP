# Historial de los registros

El historial de un registro lista los cambios que se le han hecho: quién cambió qué, y cuándo. Responde a preguntas habituales, como «¿quién subió este importe?» o «¿cuándo se desvinculó este contrato?», sin pasar por el registro de auditoría.

## Dónde encontrarlo

- **Pestaña Historial**, la última pestaña del registro: líneas presupuestarias (vea [Líneas presupuestarias](budget-lines.md#historial)), contratos, empresas, departamentos, proveedores, ubicaciones, conexiones, interfaces, aplicaciones, activos, tecnologías, incidentes, proyectos, solicitudes y tareas.
- **Botón Historial** en la cabecera, que abre el historial en un panel lateral: cuentas, centros de coste, calendarios laborales, procesos de negocio, dimensiones y valores analíticos, y contactos.
- **Pestaña Historial** en el panel derecho de un documento de la base de conocimiento.

Un incidente conserva también su pestaña **Diario**. El diario cuenta lo que ocurrió durante el incidente. El historial lista los cambios del registro.

El flujo de actividad de un proyecto, una solicitud o una tarea solo muestra los comentarios y las decisiones. Los cambios del registro están en su historial. En una tarea, un comentario escrito al cambiar el estado muestra ese cambio.

## Quién puede verlo

- Cualquier persona que pueda abrir el registro puede leer su historial. No se necesita ningún permiso adicional.
- Con un acceso a los datos limitado a ciertas empresas o centros de coste, una persona solo ve el historial de los registros incluidos en su acceso. Vea [Acceso a los datos](data-access.md).
- Un incidente restringido sigue oculto para quien no puede verlo, y también el historial de sus tareas.

## Qué muestra una entrada

El historial lista una entrada por cambio, la más reciente arriba. Cada entrada muestra:

- la fecha y la hora del cambio;
- su autor: una persona, **Sistema** para los cambios que Kadratis hace por sí mismo, **Importación** para los cambios cargados desde un archivo, o **Kad para** una persona cuando el asistente hizo el cambio en su nombre;
- para el registro en sí, el evento: **Creado**, **Actualizado** o **Eliminado**; para sus partes, el título o el evento de la parte;
- cada campo cambiado, con su valor antes y después (`antes → después`).

Un cambio de importe indica el año, la columna y los valores antes y después.

Un cambio hecho por Kad deja las mismas entradas que el mismo cambio hecho en la pantalla, marcadas **Kad para** la persona que lo aprobó. Cuando pide a Kad que deshaga un cambio, la reversión deja sus entradas de la misma manera.

Los historiales largos se cargan por páginas: haga clic en **Cargar más** al final de la lista para ver los cambios más antiguos.

## Cambios en los elementos de un registro

El historial también lista los cambios en los elementos de un registro. En una línea presupuestaria, por ejemplo:

- los importes, por año y columna de presupuesto;
- las dimensiones analíticas;
- las asignaciones;
- los enlaces y los archivos adjuntos;
- los contactos;
- las aplicaciones, tecnologías y activos vinculados;
- las tareas.

En una columna de presupuesto construida con **Cantidad y precio**, la entrada de una introducción de importes también indica qué cambió en el cálculo, justo encima del cambio de importes:

- cada propiedad modificada de una línea valorada: calendario, cantidad, unidad, precio unitario, precio por, frecuencia, días por mes o periodo. La línea se nombra por su descripción, o por su número cuando no tiene. Por ejemplo: «Línea valorada Consultor, calendario: Francia → Alemania»;
- los días laborables de un calendario, por calendario y año, cuando usa de nuevo las líneas tras un cambio en el calendario. Por ejemplo: «Días laborables de Francia 2027: 218 → 217»;
- los calendarios que una copia de columna no pudo conservar, con las palabras de la vista previa de la copia.

Una columna restaurada los lista de la misma forma. Las entradas más antiguas también los muestran.

En los demás registros, el historial lista del mismo modo los vínculos y los elementos que contienen: líneas presupuestarias, aplicaciones, activos, contratos, miembros del equipo, contactos, dependencias, enlaces web, documentos integrados, archivos adjuntos, tareas, despliegues y puntuaciones por criterio.

Un vínculo entre un proyecto y una aplicación, un activo o una línea presupuestaria, o entre una aplicación y una línea presupuestaria, aparece en el historial de ambos registros, sea cual sea aquel al que se añadió o del que se quitó. Un cambio de varios vínculos a la vez da a cada registro vinculado su propia entrada.

## Registros que no puede leer

Una entrada puede nombrar otro registro, por ejemplo un contrato vinculado a la línea. Si no puede abrir ese registro, la entrada lo nombra solo por su tipo, por ejemplo «un contrato». Un registro eliminado desde entonces aparece como «un contrato eliminado».

En un contrato, un proyecto o una solicitud, una persona con acceso a los datos limitado ve las líneas presupuestarias fuera de su acceso como un recuento, sin sus nombres: «y 2 líneas fuera de su acceso».

## Valores que el historial no muestra

- Un cambio del correo, del teléfono, del móvil o de las notas de un contacto se lee **Correo modificado**, **Teléfono modificado**, **Móvil modificado** o **Notas modificadas**. El valor queda fuera del historial.
- Para un contenido largo, la entrada indica solo que ha cambiado: **Contenido modificado** para el cuerpo de un documento de la base de conocimiento, **Días laborables modificados** para los días de un calendario laboral, **Descripción modificada**, **Objetivo modificado** o **Situación actual modificada** para los textos largos de los demás registros.

## Preguntar al asistente

[Kad](ai-assistant.md#tool-calls) lee el historial de un registro con los mismos derechos que su página. Pregunte, por ejemplo: «¿Quién cambió los importes de BL-12?» o «¿Qué cambió en TEC-3 este año?» Kad responde solo a partir de la pestaña Historial: para un registro que no la tiene, indica que Kadratis no guarda historial de él.

## El registro de auditoría completo

El historial se limita a lo que necesita un lector. El registro técnico completo de cada cambio, en todo el espacio de trabajo, sigue en **Administración > Registro de auditoría**. Vea [Registro de auditoría](admin.md#registro-de-auditoria).
