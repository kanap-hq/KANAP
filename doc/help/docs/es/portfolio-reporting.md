# Informes del portafolio

Los Informes del portafolio proporcionan análisis centrados en la carga de trabajo, capacidad y señales de entrega.

## Primeros pasos

Navegue a **Portafolio > Informes** para abrir el centro de informes.

**Permisos**:
- Necesita al menos `portfolio_reports:reader` para acceder a los informes del portafolio.

Si no ve Informes en el menú, solicite a su administrador que le otorgue acceso.

---

## Página de informes

La página de Informes del portafolio lista los informes disponibles como tarjetas, en tres filas que se leen por horizonte. Haga clic en una tarjeta para abrir el informe.

**Lo que ha pasado**
- **Balance del periodo**: solicitudes, proyectos y tareas creadas, modificadas y cerradas en un periodo.
- **Actividad por persona**: la misma página, abierta en su lectura de las tareas por persona.
- **Tiempo registrado**: a dónde van los días registrados, mes a mes: proyectos u otro trabajo, equipo por equipo.

**Lo que está en curso**
- **Flujo y antigüedad**: lo que entra y lo que se cierra semana tras semana, la antigüedad del trabajo abierto y el tiempo que lleva cerrar.
- **Puntos de atención por colaborador**: las tareas abiertas, atrasadas y sin movimiento, equipo por equipo y persona por persona.

**Lo que viene**
- **Próximamente**: las tareas que vencen, los finales e inicios de proyecto previstos, las solicitudes que esperan revisión desde hace demasiado tiempo y las entregas solicitadas.
- **Mapa de calor de capacidad**: el esfuerzo esperado frente a la capacidad, para colaboradores y equipos.

---

## Pilotaje

La primera franja encima de las tarjetas de informes es la vista de pilotaje diario. Responde a dos preguntas: qué se ha movido últimamente y qué espera a alguien.

### El periodo

La cabecera muestra el periodo en uso y permite cambiar entre los últimos 7, 30 y 90 días. El periodo termina siempre hoy y se lee en su propia zona horaria. Su elección se recuerda en este navegador.

### Flujo

Una línea por entidad se lee así: **14 creadas · 9 cerradas · 52 abiertas (+5)**.

- **Creadas**: elementos creados durante el periodo y todavía presentes hoy.
- **Cerradas**: elementos que el último cambio de estado del periodo dejó cerrados. La creación cuenta como cambio de estado: un elemento creado ya terminado cuenta como cerrado. Cerrado significa Hecho o Cancelado para tareas y proyectos, Rechazado o Convertido para solicitudes.
- **Abiertas**: elementos abiertos ahora mismo, pase lo que pase durante el periodo. Esta cifra es un enlace a la lista correspondiente.
- **(+5)**: la variación neta, visible solo cuando no es cero. Es creadas, más reabiertas, menos cerradas. Los elementos reabiertos son los que volvieron de un estado cerrado a uno abierto. Pase el cursor sobre la cifra para ver la fórmula.

Creadas y cerradas proceden del historial de cambios, así que cubren todas las formas de escribir un elemento: la aplicación, una importación CSV y los agentes. Ningún filtro de lista reproduce ese historial, por eso esas dos cifras abren el **Balance del periodo** en los mismos días. Sus listas de creadas y cerradas muestran exactamente los elementos contados aquí. Un cero no es un enlace.

### Qué tareas cuentan

Cada cifra de tareas cuenta solo las tareas independientes y las tareas de proyecto. Las tareas vinculadas a un contrato, a una línea de gasto, a una línea CAPEX o a un incidente pertenecen a esos procesos y quedan fuera en toda la franja.

### Requiere atención

La última línea aparece solo cuando algo necesita una decisión:
- **Tareas vencidas**: tareas abiertas cuya fecha de vencimiento es anterior a hoy. La cifra abre la lista de tareas filtrada por los mismos elementos.
- **Tareas sin responsable**: tareas abiertas que nadie asume. La lista de tareas no tiene filtro para un responsable vacío, por eso esta cifra no es un enlace.
- **Proyectos sin actividad desde hace 30 días**: proyectos en curso o en pruebas donde no ha pasado nada desde hace un mes. Al hacer clic se abre una lista breve de esos proyectos con la fecha de su última actividad, y cada nombre abre el proyecto.

La actividad se lee en sentido amplio. Un proyecto cuenta como activo en cuanto algo cambia en él o en una de sus tareas, en cuanto alguien escribe en su diario, o en cuanto se registra tiempo en el proyecto o en una de sus tareas. Un proyecto solo aparece aquí cuando todo eso es más antiguo que 30 días.

---

## Por clasificar

Encima de las tarjetas de informes, una franja compacta muestra cuánto de su trabajo abierto sigue sin un valor de clasificación. Úsela como ayuda de pilotaje diario: vea la brecha, haga clic y corríjala.

### Qué cuenta

Una línea por entidad, solo para elementos abiertos:
- **Tareas**: estado distinto de Hecho y Cancelado.
- **Solicitudes**: estado distinto de Rechazado y Convertido.
- **Proyectos**: estado distinto de Hecho y Cancelado.

Cada línea indica cuántos de esos elementos no tienen Origen, ni Categoría, ni Línea. Las tareas indican además cuántas no tienen Tipo de tarea.

### Qué tareas se excluyen

Solo se cuentan las tareas independientes y las tareas de proyecto. Las tareas vinculadas a un contrato, a una línea de gasto, a una línea CAPEX o a un incidente nunca llevan clasificación. Contarlas señalaría una brecha que nadie puede cerrar.

Una tarea de proyecto sin clasificación propia hereda la de su proyecto, y la lista de tareas muestra ese valor heredado. Los recuentos siguen la misma regla, así que una cifra nunca le lleva a una lista donde la columna ya está rellenada.

### Líneas

Una Línea ausente solo se cuenta cuando el elemento ya tiene una Categoría y esa Categoría ofrece al menos una línea activa. Muchas categorías no ofrecen ninguna línea. Un elemento sin categoría ya se cuenta bajo Categoría.

### Abrir la lista

Cada cifra mayor que cero es un enlace. Al hacer clic se abre la lista correspondiente, ya filtrada exactamente por los elementos detrás de la cifra, en todo el espacio de trabajo. El total de la lista coincide con la cifra en la que hizo clic. Los ceros se muestran como contexto pero no son enlaces.

Cuando no falta nada, la franja muestra una sola línea confirmando que todo lo abierto está clasificado.

---

## Próximamente

Use este informe para ver lo que vence pronto y lo que lleva demasiado tiempo esperando. Es el único informe que mira hacia delante: el balance del periodo lee el pasado, el informe de flujo y los bloques de atención leen el presente.

### Qué muestra

La página tiene cinco secciones. Cada una indica cuántos elementos contiene, una tabla ordenada por fecha y un horizonte que puede cambiar a la derecha de su título.

- **Finales de proyecto previstos**: proyectos abiertos cuyo fin previsto cae entre hoy y el final del horizonte. Horizonte: 30 (por defecto), 60 o 90 días. Los proyectos que ya superaron su fin previsto se quedan en el informe de flujo; una línea indica su número y lo abre.
- **Inicios de proyecto previstos**: proyectos aún en Lista de espera o Planificado cuyo inicio previsto cae en el mismo horizonte.
- **Solicitudes pendientes de revisión**: solicitudes aún en Pendiente de revisión, creadas hace al menos 14, 30 (por defecto) o 60 días. Las solicitudes Candidata, Aprobada y En pausa ya recibieron una decisión, por lo que no aparecen aquí.
- **Entregas solicitadas**: solicitudes abiertas (Pendiente de revisión, Candidata, Aprobada, En pausa) cuya fecha de entrega solicitada cae en el horizonte de proyectos.
- **Tareas que vencen**: tareas abiertas (Abierta, En curso, Pendiente, En pruebas) que vencen entre hoy y el final del horizonte, ambos días incluidos. Horizonte: 7, 14 (por defecto) o 30 días. Solo cuentan las tareas independientes y las tareas de proyecto, como en los demás informes. Una línea bajo el título indica el número de tareas ya vencidas, con un enlace a ellas.

El horizonte de proyectos es compartido: cambiarlo en una de las tres secciones que lo usan lo cambia en las tres. La página recuerda sus horizontes y las secciones que ha plegado.

### Filtros

- **Proyecto**: las tareas de esos proyectos, los propios proyectos y las solicitudes vinculadas a ellos.
- **Equipo**: las tareas asignadas a un miembro del equipo, y los proyectos y solicitudes en los que participa alguno.

### Abrir la lista

Cada cifra mayor que cero es un enlace. Abre la lista de tareas, proyectos o solicitudes filtrada exactamente en los elementos de la sección, con los mismos filtros de proyecto y equipo, de modo que el total de la lista coincide con la cifra. El informe no tiene exportación: las listas ya se exportan.

---

## Informe de mapa de calor de capacidad

Use este informe para comprender la carga de trabajo actual, la presión de capacidad y el trabajo sin asignar.

### Qué muestra
- **Esfuerzo restante** (IT + Negocio), ajustado por progreso de ejecución.
- **Capacidad** por colaborador (histórica o teórica).
- **Meses de trabajo** (días restantes / días de capacidad por mes).
- **Trabajo sin asignar** cuando el esfuerzo no está completamente asignado.
- **Las personas sin ficha de colaborador** asignadas a un proyecto. Aparecen al final de la lista con sus días restantes y sin capacidad, para que su carga siga siendo visible. Cree su ficha de colaborador para asignarles una capacidad.

### Filtros
- **Equipos** (selección múltiple, incluye **Sin equipo**)
- **Estado** (predeterminado: Lista de espera, Planificado, En progreso, En pruebas, En espera)
- **Modo de capacidad**: Histórica (predeterminado) o Teórica
- **Agrupar por**: Colaboradores (predeterminado) o Equipos

### Escala de color
Las celdas en la columna **Meses de trabajo** están codificadas por color:

| Rango | Color |
|-------|-------|
| <= 1 mes | Verde |
| 1-3 meses | Amarillo |
| 3-6 meses | Naranja |
| 6-12 meses | Rojo |
| > 12 meses | Violeta |
| Sin datos | Gris (N/D) |

### Tarjetas de resumen
La fila de resumen incluye:
- **Total de colaboradores**
- **Media de meses de trabajo** (solo colaboradores con capacidad)
- **Trabajo sin asignar** (total de días sin asignar y recuento de proyectos)

Haga clic en **Trabajo sin asignar** para expandir los detalles.

### Desglose detallado
Haga clic en una fila de colaborador para abrir un desglose por proyecto:
- Cada fila muestra esfuerzo restante, % de asignación y sus días.
- Los nombres de proyecto son clicables y abren la pestaña **Progreso** del proyecto.

### Exportaciones
- **CSV**: Exportar la tabla del mapa de calor
- **PNG**: Captura del informe
- **Imprimir**: Imprimir o guardar como PDF

---

## Balance del periodo

Utilice este informe para ver qué ha ocurrido con las solicitudes, los proyectos y las tareas durante un periodo. El informe sigue el embudo del portafolio: primero las solicitudes, después los proyectos y después las tareas.

### Qué muestra

Cada una de las tres secciones contiene las mismas tres listas.

- **Creaciones**: elementos creados durante el periodo.
- **Modificaciones**: elementos modificados durante el periodo sin haber sido creados ni cerrados en él.
- **Cierres**: elementos cuyo último cambio de estado del periodo los deja en un estado de cierre.

Un elemento creado y cerrado dentro del mismo periodo aparece en ambas listas, con su propia fecha en cada una. Nunca aparece en Modificaciones: Modificaciones es lo que queda una vez contabilizadas las creaciones y los cierres.

La creación cuenta como un cambio de estado. Una importación CSV o un agente puede crear una tarea ya terminada, o una solicitud ya rechazada. Ese elemento figura como creado y como cerrado el mismo día, aunque nadie haya cambiado su estado después.

El cierre se apoya en estados distintos según el tipo:

- **Solicitudes**: convertida o rechazada. Una solicitud no tiene estado cancelado.
- **Proyectos**: terminado o cancelado.
- **Tareas**: terminada o cancelada.

Cada lista indica su recuento en el título. Una lista vacía ocupa una sola línea, de modo que un informe con poca actividad se mantiene corto.

### Qué tareas cuentan

La sección Tareas cubre solo las tareas del portafolio: las tareas independientes y las tareas asociadas a un proyecto. Las tareas asociadas a un contrato, a una línea de gasto, a una línea CAPEX o a un incidente quedan fuera. Es más restrictivo que en versiones anteriores del informe, que contaban todas las tareas.

### De dónde viene un proyecto

La lista de proyectos creados incluye una columna **Procedencia**.

- Un proyecto convertido a partir de una solicitud muestra esa solicitud, por ejemplo `REQ-12 Cave climate digital twin`. Haga clic para abrir la solicitud.
- Un proyecto creado sin solicitud muestra cómo entró en el portafolio, con las palabras que KANAP utiliza en todas partes: **Fast-track**, **Histórico** o **Solicitud**.

### Plegar una sección

Cada título de sección lleva un galón. Haga clic en la línea del título para plegar la sección y vuelva a hacer clic para abrirla. Una sección plegada conserva sus recuentos junto al título, así que sigue viendo lo que contiene.

Su elección se recuerda en este navegador, sección por sección. La impresión no se ve afectada: un informe impreso siempre lleva las tres secciones completas.

### Qué ha cambiado

Las listas de Modificaciones incluyen una columna **Cambios**. Lee la pista de auditoría del periodo y muestra:

- el cambio de estado, cuando el estado ha cambiado, como `En curso -> En pruebas`;
- después los campos modificados, en lenguaje claro, separados por comas.

La redacción coincide con el historial del propio elemento. Los campos que se reescriben en cada guardado, como la marca de tiempo técnica de actualización, quedan excluidos.

### Filtros

- **Fecha de inicio** y **Fecha de fin** (por defecto, los últimos 7 días)
- **Origen** (selección múltiple)
- **Categoría** (selección múltiple)
- **Línea** (selección múltiple; limitada a las categorías seleccionadas)
- **Tipos de tarea** (selección múltiple; se aplica a la sección Tareas)
- **Estado alcanzado** (selección múltiple, agrupada por solicitudes, proyectos y tareas)

Los filtros se aplican a las nueve listas y a la lectura por persona.

**Estado alcanzado** conserva los elementos cuyo último cambio de estado del periodo los dejó en uno de los estados seleccionados. La creación cuenta como un cambio de estado: un elemento creado durante el periodo y que no se ha movido después alcanzó el estado con el que se creó. Un elemento cuyo estado no cambió durante el periodo no coincide con ningún estado, así que desaparece en cuanto se selecciona un estado. El estado que muestra la columna Estado es el que el elemento tiene hoy, y puede ser distinto: una tarea cerrada durante el periodo y reabierta después alcanzó **Completada** y muestra **Abierta**.

Un estado compartido por varios tipos, como Completado o En pausa, es una sola opción: si lo marca en Tareas, también queda marcado en Proyectos.

### Columnas de la tabla

Cada lista empieza por la referencia de negocio (`REQ-12`, `PRJ-3`, `T-4`) y el nombre. Al hacer clic en el nombre se abre el elemento.

**Solicitudes**: Referencia, Nombre de la solicitud, Origen, Categoría, Línea, Empresa, Estado, fecha del evento.

**Proyectos**: Referencia, Nombre del proyecto, Procedencia (lista de creaciones), Prioridad, Origen, Categoría, Línea, Empresa, Esfuerzo, Estado, fecha del evento.

**Tareas**: Referencia, Nombre de la tarea, Tipo de tarea, Prioridad, Origen, Categoría, Línea, Empresa, Estado, fecha del evento.

Una tarea sin empresa propia muestra la empresa de su proyecto, igual que la lista de tareas.

La columna de fecha lleva el día de creación en las listas de creaciones, el día del último cambio en las listas de modificaciones y el día de cierre en las listas de cierres. Los días se leen en su propia zona horaria.

Las listas de cierres llevan dos fechas: **Creado el** y después **Cerrado el**. El día de creación se muestra siempre, incluso cuando el elemento se creó mucho antes del periodo. Indica de un vistazo cuánto tiempo ha llevado el elemento.

Las listas de modificaciones añaden la columna **Cambios** al final.

### Exportaciones

- **CSV**: nueve bloques en el orden de la página, cada uno con su propio título y su fila de encabezado.
- **XLSX**: tres hojas, Requests, Projects y Tasks. Las filas van de las creaciones a las modificaciones y después a los cierres, con una columna **Event** inicial que indica de qué lista procede cada fila. La celda del nombre enlaza con el elemento.

Ambas exportaciones llevan la referencia, la empresa, la procedencia de un proyecto, los cambios de una fila modificada y la fecha del evento. Las filas de cierre llevan además el día de creación.

## Tiempo registrado

Días registrados mes a mes, en proyectos o en otro trabajo, equipo por equipo y persona por persona. Muestra cómo se reparte la carga de trabajo, no quién registra más: los equipos conservan su orden configurado y las personas aparecen por orden alfabético.

### De dónde salen los días

El informe lee todos los registros de tiempo: el tiempo registrado en tareas y el tiempo registrado directamente en un proyecto. Un día equivale a 8 horas, y las cifras llevan un decimal. Cada registro cae en el mes de su fecha, en su propia zona horaria.

- **Días de proyecto**: tiempo registrado en una tarea que pertenece a un proyecto, o directamente en un proyecto.
- **Otros días**: todo el resto del tiempo, por ejemplo las tareas independientes.

Elija **6 meses** o **12 meses**. El mes en curso es siempre el último. La página recuerda su elección.

### Qué muestra

- **Mosaicos**: días de proyecto, otros días, el total, la parte de proyecto y el número de colaboradores que no registraron nada en el periodo. El trabajo fuera de proyectos suele registrarse menos que el trabajo de proyecto, y este último mosaico lo recuerda.
- **Gráfico**: días de proyecto y otros días apilados, mes a mes.
- **Tabla**: una fila por equipo, una columna por mes. Cada celda muestra los días registrados, con días de proyecto / otros días debajo. Despliegue un equipo para ver sus personas. Un colaborador que no registró nada aparece igualmente, con celdas vacías. Las personas sin equipo se agrupan en **Sin equipo**. El tiempo registrado sin persona aparece ahí como **Usuario desconocido**.

El informe solo muestra días. Nunca muestra las notas de un registro.

### Filtros

- **Equipo**: las personas de los equipos seleccionados.
- **Proyecto**: solo el tiempo registrado en los proyectos seleccionados, en sus tareas o directamente. Los otros días valen entonces cero.

### Exportaciones

- **CSV**: una línea por persona y mes, con el equipo, la persona, el mes, los días de proyecto, los otros días y el total.
- **PNG**: el gráfico.

## Consejos
- **Mantenga los perfiles de colaboradores actualizados**: La capacidad se basa en la disponibilidad de colaboradores y estadísticas históricas de tiempo.
- **Use filtros de equipo**: Limite el alcance del informe a un departamento o función.
- **Revise el trabajo sin asignar**: Ayuda a detectar proyectos con asignaciones faltantes o responsables ausentes.
- **Balance del periodo para reuniones de seguimiento**: Exporte el Balance del periodo como XLSX y compártalo con los interesados para reuniones de estado.
