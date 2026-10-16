# Tareas programadas

La página Tareas programadas lista cada trabajo recurrente en segundo plano que KANAP ejecuta en una programación cron: limpiezas, sincronizaciones periódicas, correos de resumen, aplicación de retención, etc. Desde aquí puede pausar un trabajo, cambiar cuándo se ejecuta, dispararlo bajo demanda e inspeccionar el historial de cada ejecución reciente.

## Dónde encontrarlo

- Espacio de trabajo: **Administración** (sección Plataforma)
- Ruta: **Administración → Tareas programadas**
- Ruta: `/admin/scheduled-tasks`
- Acceso: **Administrador de plataforma** o **Administrador global** en un despliegue de inquilino único (local). Otros roles ven una página Prohibido.

## La lista de tareas

La página es una única tabla que se actualiza automáticamente cada 15 segundos, de modo que puede dejarla abierta mientras observa cómo se completa un trabajo.

**Columnas**:

- **Nombre**: el identificador interno de la tarea (por ejemplo `purge-stale-conversations`)
- **Descripción**: un breve resumen legible de lo que hace la tarea
- **Programación**: la expresión cron. Los patrones comunes se traducen a lenguaje claro ("Diariamente a las 3 AM", "Cada 15 minutos", "Domingos a las 4 AM"); pase el ratón sobre la etiqueta para ver la expresión sin procesar. Haga clic en el icono de lápiz para editarla en línea.
- **Habilitada**: alternar la tarea encendido o apagado sin cambiar la programación
- **Última ejecución**: cuándo se inició la tarea por última vez
- **Duración**: cuánto duró la última ejecución (`ms`, `s` o `m` según la duración)
- **Estado**: indicador de color para la última ejecución: **Éxito**, **Fallida**, **En ejecución** o **Nunca ejecutada**
- **Acciones**: controles por fila (vea más abajo)

### Editar una programación

Haga clic en el icono de lápiz junto a cualquier programación para abrir un editor en línea.

- Escriba una expresión cron estándar de 5 campos (`minuto hora día-del-mes mes día-de-la-semana`).
- Pulse **Enter** para guardar, **Escape** para cancelar.
- Las expresiones inválidas se rechazan con una notificación de error en la parte inferior de la pantalla. La tarea conserva su programación anterior.

Cuando la nueva expresión coincide con un patrón conocido, la tabla muestra inmediatamente la etiqueta amistosa.

### Habilitar y deshabilitar una tarea

Mueva el conmutador **Habilitada** para pausar o reanudar una tarea. Las tareas deshabilitadas dejan de ejecutarse en la programación cron pero aún pueden activarse manualmente desde la columna Acciones.

### Ejecutar una tarea bajo demanda

La acción **Ejecutar ahora** (icono de reproducción) activa la tarea inmediatamente, independientemente de la programación. Aparece una confirmación en la parte inferior de la pantalla y la fila se actualiza en cuanto la ejecución empieza y termina.

Este es el control adecuado para:

- Validar una corrección que acaba de desplegar
- Forzar una sincronización tras una importación de datos
- Hacer una prueba rápida de un trabajo antes de volver a habilitarlo

### Ver el historial de ejecuciones

La acción **Ver historial** (icono de reloj) abre un panel lateral con las ejecuciones recientes de esa tarea.

Cada fila de ejecución muestra:

- **Iniciado**: cuándo comenzó la ejecución
- **Estado**: Éxito, Fallida o En ejecución
- **Duración**: cuánto duró la ejecución
- **Detalles**: un breve resumen estructurado en caso de éxito, o el mensaje de error en caso de fallo. Los mensajes de error largos se truncan en la tabla; el texto completo se preserva en el registro subyacente.

Aparece paginación bajo la lista cuando hay más de 20 ejecuciones. El panel puede cerrarse con el icono X de su encabezado o haciendo clic fuera de él.

## Consejos

- **Pause antes de depurar**: cuando una tarea se comporta mal, deshabilítela primero para que deje de re-ejecutarse mientras investiga. Use **Ejecutar ahora** para probar correcciones sin esperar al siguiente tic programado.
- **Lea los detalles de la ejecución**: los fallos a menudo incluyen suficiente contexto (conteos de registros, mensajes de error) para apuntar a la causa raíz sin tener que sumergirse en los registros del servidor. Abra el historial de ejecuciones antes de hacer SSH a un servidor.
- **Use comprobaciones en lenguaje claro**: si una etiqueta de programación no coincide con lo que espera, la expresión cron probablemente esté mal. La traducción amistosa solo se activa para patrones conocidos, así que una etiqueta poco familiar es una útil comprobación de cordura sobre lo que ha tecleado.
