# Planificación del portafolio

La Planificación del portafolio le ayuda a planificar y actualizar las fechas de los proyectos a nivel de portafolio. Combina una vista de cronograma manual con un generador automático de hoja de ruta que programa proyectos basándose en el esfuerzo restante, dependencias y capacidad de los colaboradores.

## Primeros pasos

Navegue a **Portafolio > Planificación**.

**Permisos**:
- Necesita `portfolio_projects:reader` para acceder a la página de Planificación y datos del cronograma.
- Necesita `portfolio_reports:reader` para generar escenarios de hoja de ruta.
- Necesita `portfolio_projects:contributor` para arrastrar las fechas de los proyectos, cambiar el modo de planificación de un proyecto y aplicar las fechas generadas.

Si no ve Planificación en el menú, solicite a su administrador que le otorgue el acceso requerido.

---

## Modos de planificación

Use el selector de modo en la parte superior de la página:
- **Cronograma**: Planificación manual de fechas en el diagrama Gantt
- **Generador de hoja de ruta**: Simulación automática de programación y aplicación selectiva

---

## Modo Cronograma

Use el modo Cronograma para ediciones directas de planificación.

### Qué puede hacer
- Ver proyectos, dependencias y hitos opcionales
- Filtrar por categoría y estado
- Elegir ventana de tiempo: 1 mes, 3 meses, 6 meses o 1 año
- Moverse hacia atrás/adelante en el tiempo o restablecer a **Hoy**
- Arrastrar barras de proyecto para actualizar las fechas planificadas de inicio y fin. Esto requiere `portfolio_projects:contributor`. Con `portfolio_projects:reader`, las barras permanecen en su sitio y un doble clic abre el proyecto.

### Comportamiento de visualización
- El gráfico se centra alrededor de hoy con aproximadamente **25% pasado / 75% futuro** al restablecer al período actual.
- Los hitos se muestran pero no son arrastrables.

---

## Modo Generador de hoja de ruta

El Generador de hoja de ruta calcula las fechas propuestas del proyecto a partir del alcance seleccionado y los parámetros de planificación.

### Controles del escenario
- **Fecha de inicio**
- **Estados** (predeterminado: Lista de espera, Planificado, En progreso, En pruebas)
- **Modo de capacidad**: Teórica o Histórica
- **Límite de paralelismo**: máximo de proyectos concurrentes por colaborador
- **Modo de optimización**: Enfocado en prioridad o Enfocado en completitud
- **Recalcular proyectos ya programados** (habilitado por defecto)
- **Programación colaborativa** (deshabilitada por defecto)
- **Penalización por cambio de contexto** y **tolerancia de cambio de contexto**

**Importante**: cuando **Recalcular proyectos ya programados** está habilitado, los proyectos que ya tienen fechas planificadas pueden moverse en el escenario generado.

### Pestaña Programación

Después de la generación, la pestaña Programación muestra las fechas propuestas del proyecto.

- Los títulos de proyecto son clicables y abren la pestaña **Progreso** del proyecto.
- Las casillas de verificación definen el alcance del escenario.
- Un filtro de **Categoría (Vista previa)** permite filtrar la visualización Gantt de la hoja de ruta sin cambiar la programación generada.
- Deseleccionar un proyecto regenera inmediatamente el escenario:
  - el proyecto deseleccionado se excluye completamente,
  - ya no consume ninguna capacidad en cuellos de botella/ocupación/programación.
- **Seleccionar visibles** / **Borrar selección visible** solo actúan sobre proyectos actualmente visibles en la vista previa Gantt filtrada.
- Los proyectos no programables se listan con un motivo.

### Pestaña Cuellos de botella

Muestra colaboradores clasificados por impacto en la fecha de fin de la hoja de ruta (`impactDays`) usando re-ejecuciones de sensibilidad.
- Cada fila de colaborador tiene una flecha de expandir/contraer para abrir una tabla desglosada por proyecto.
- El desglose incluye solo proyectos del escenario generado actual donde el colaborador tiene asignación.
- El desglose se ordena por fecha de inicio del proyecto y muestra:
  - Nombre del proyecto
  - Fecha de inicio del proyecto
  - Fecha de fin del proyecto
  - Contribución total (días)
  - Tiempo ya dedicado (días)
- `Contribución total` y `Tiempo ya dedicado` se derivan de la carga generada del colaborador más el progreso de ejecución del proyecto.

### Pestaña Ocupación

Muestra mapas de calor de ocupación semanal:
- Vista por colaborador: una fila por colaborador, agrupada por equipo, con columnas de semana ISO
- Vista por equipo: una fila por equipo, con columnas de semana ISO
- Las etiquetas de equipo se muestran como celdas combinadas de múltiples filas en la vista por colaborador para evitar repetición
- Cada celda muestra la ocupación semanal redondeada (%) con intensidad de color de acento basada en la carga
- **Exportar la tabla** ofrece **CSV** y **Excel (.xlsx)** para el escenario en pantalla. El CSV contiene la vista en pantalla, colaboradores o equipos. El archivo Excel contiene las dos, una hoja cada una, con la ocupación en porcentajes, y una hoja **Parámetros**. **Exportar la ocupación a PNG** guarda el mapa de calor como imagen

### Comportamiento de la vista previa Gantt

El Gantt de la hoja de ruta es de solo lectura y:
- mantiene la misma lógica de visualización 25/75 centrada en hoy que el modo Cronograma,
- se extiende automáticamente lo suficiente en el futuro para alcanzar la última fecha de completitud programada,
- muestra cada barra de proyecto con su progreso de ejecución actual,
- se dimensiona verticalmente automáticamente basándose en las filas visibles para que escenarios más grandes puedan mostrar muchos proyectos sin scroll vertical interno.

---

## Aplicar fechas generadas

Haga clic en **Aplicar fechas** para escribir las fechas planificadas generadas en los proyectos seleccionados.

### Reglas de aplicación
- Solo los proyectos seleccionados que actualmente son visibles en la vista previa Gantt de la hoja de ruta se aplican.
- La aplicación es **transaccional** (todo o nada):
  - si un proyecto falla la validación, no se actualiza ninguna fecha de proyecto.

---

## Comportamiento de proyectos iniciados

Para proyectos ya iniciados en el pasado:
- la fecha de inicio histórica se preserva (`Inicio real`, o respaldo de `Inicio planificado` elegible),
- la programación usa el trabajo restante desde hoy en adelante para calcular la fecha de fin proyectada.

Esto mantiene el contexto del cronograma histórico mientras se recalcula una completitud realista.

---

## Razones comunes de no programabilidad

- **Sin esfuerzo restante**
- **Sin colaboradores**
- **Capacidad de colaborador faltante**
- **Fecha de bloqueo faltante**
- **Dependencia cíclica**
- **Capacidad insuficiente**

Si los proyectos no son programables, verifique las asignaciones de colaboradores, la disponibilidad de colaboradores, los datos de dependencias y el alcance de estados.

---

## Cómo funciona el programador

El Generador de hoja de ruta simula la ejecución del proyecto semana a semana. Cada semana decide qué proyectos reciben trabajo y cuánto esfuerzo quema cada colaborador. La simulación se ejecuta desde la **Fecha de inicio** en adelante hasta que todos los proyectos se completan o se alcanza el límite del horizonte.

### Capacidad

Cada colaborador tiene una capacidad mensual (configurada en **Colaboradores**). El programador la convierte a un valor semanal: `mensual * 12 / 52`.

- El **modo teórico** usa la capacidad configurada directamente.
- El **modo histórico** usa datos reales de seguimiento de tiempo de meses recientes como línea base de capacidad.

### Reservas

Los proyectos que **no se recalculan** (cuando **Recalcular proyectos ya programados** está desactivado, o proyectos con bloqueos externos) mantienen sus fechas planificadas existentes. Sus cargas de colaboradores se comprometen previamente en el libro de capacidad antes de que comience la programación de candidatos. Esto significa que los proyectos reservados consumen tiempo de colaborador en las semanas que abarcan, reduciendo la disponibilidad para otros proyectos.

### Dependencias

Un proyecto no puede comenzar hasta que todos sus predecesores de dependencia hayan terminado. Si un predecesor es un candidato en la ejecución actual, el proyecto dependiente espera hasta que pase la fecha de fin calculada del predecesor. Si un predecesor está fuera del conjunto de candidatos (p. ej., excluido o en un estado diferente), se usa su fecha de fin planificada/real conocida.

### Clasificación de proyectos

Cada semana, los proyectos listos (no bloqueados, no completados) se ordenan para determinar la prioridad de programación. La clasificación depende del **Modo de optimización**.

El modo **Enfocado en prioridad** clasifica por **prioridad efectiva** (mayor primero):

- **Proyectos iniciados** (ya recibieron trabajo en una semana anterior): prioridad efectiva = `min(100, puntuaciónPrioridad + 5 * semanasDesdeInicio)`. Un proyecto iniciado gana 5 puntos de prioridad por semana de trabajo activo, hasta un máximo de 100. Esto asegura que los proyectos en curso suban constantemente en prioridad para que se terminen.
- **Proyectos en espera** (listos pero aún no iniciados): prioridad efectiva = `min(90, puntuaciónPrioridad + semanasEsperando)`. Cada semana que un proyecto listo espera sin recibir trabajo, gana 1 punto de prioridad, hasta 90. Esto previene el agotamiento indefinido pero un proyecto en espera nunca puede superar a un proyecto iniciado con prioridad moderada.
- **Otros proyectos** (aún no listos): usan su `puntuaciónPrioridad` bruta tal cual.

El modo **Enfocado en completitud** clasifica por **semanas de cuello de botella** (menor primero), luego `puntuaciónPrioridad` bruta (mayor primero). Las semanas de cuello de botella estiman cuántas semanas tomaría un proyecto si fuera el único proyecto programado, basándose en su colaborador más restringido. Este modo prioriza proyectos rápidos de completar.

**Desempates** (ambos modos): profundidad de dependencia descendente (los proyectos que bloquean más trabajo descendente van primero), luego ID de proyecto lexicográfico para determinismo.

### Regla de continuidad

Antes de considerar nuevos inicios de proyecto cada semana, el programador preasigna colaboradores a sus **proyectos en curso**. Un colaborador está "continuando" un proyecto si:

- El proyecto ya ha comenzado (recibió trabajo en una semana anterior).
- El proyecto está listo (no bloqueado por una dependencia).
- El colaborador tiene esfuerzo restante en él.
- El colaborador ya ha trabajado en él previamente.

Los proyectos en curso se procesan en orden de clasificación (mayor prioridad primero). Cada continuación preasignada consume una ranura de paralelización para ese colaborador.

**Efecto**: con **Límite de paralelismo = 1**, un colaborador trabajando en un proyecto debe terminarlo (o esperar a que se desbloquee) antes de iniciar algo nuevo. Con límites más altos, el trabajo en curso llena ranuras primero y las ranuras restantes quedan disponibles para nuevos proyectos.

La regla de continuidad se aplica tanto en modo colaborativo como no colaborativo, pero la verificación de viabilidad difiere:

- **Colaborativo**: todos los colaboradores que continúan en un proyecto deben tener ranuras libres para que el proyecto sea preseleccionado como un todo.
- **No colaborativo**: cada colaborador que continúa es preseleccionado individualmente si tiene una ranura libre.

### Programación colaborativa

El interruptor de **Programación colaborativa** controla cómo el programador selecciona proyectos y distribuye trabajo cada semana.

#### Colaborativa (interruptor ON)

Todos los colaboradores asignados a un proyecto deben tener una ranura de paralelización libre **y** capacidad disponible para que el proyecto sea seleccionado. Si incluso un colaborador está totalmente ocupado, todo el proyecto espera.

El trabajo se quema **proporcionalmente**: todos los colaboradores avanzan al ritmo del colaborador más restringido. Si el Colaborador A tiene 4 días disponibles y el Colaborador B tiene 1 día, el proyecto avanza a un ritmo limitado por la disponibilidad del Colaborador B. Esto mantiene a todos los colaboradores sincronizados pero significa que la capacidad disponible de los colaboradores más rápidos queda sin usar en ese proyecto.

Use la programación colaborativa cuando los proyectos genuinamente requieren que todos los miembros del equipo trabajen al mismo paso (p. ej., fases de desarrollo estrechamente acopladas, talleres o entregables conjuntos).

#### No colaborativa (interruptor OFF, predeterminado)

Un proyecto se selecciona si **cualquier** colaborador tiene una ranura de paralelización libre y capacidad disponible. Los colaboradores trabajan **independientemente**: cada uno quema esfuerzo a su propio ritmo, hasta su capacidad semanal disponible. Un proyecto puede avanzar incluso si algunos de sus colaboradores están ocupados con otro trabajo.

Este modo incluye una **protección de inicio mínimo** para nuevos proyectos: un proyecto solo comienza si la quema total esperada entre todos los colaboradores viables es al menos 0.5 días esa semana. Esto previene fechas de inicio optimistamente tempranas por quemas de goteo mínimas. La protección no se aplica a continuaciones (los proyectos ya iniciados siguen adelante vía la regla de continuidad independientemente de la capacidad semanal).

Use la programación no colaborativa (la predeterminada) cuando los colaboradores pueden trabajar en sus porciones independientemente, lo cual es típico para la mayoría de proyectos IT donde diferentes miembros del equipo manejan tareas separadas.

### Límite de paralelización

El **Límite de paralelismo** controla cuántos proyectos candidatos puede trabajar simultáneamente un solo colaborador en una semana dada. Las reservas (proyectos precomprometidos) también consumen ranuras.

Con un límite de 1, cada colaborador trabaja en como máximo un proyecto candidato por semana. Con un límite de 2 o 3, los colaboradores pueden dividir su tiempo entre múltiples proyectos.

### Penalización por cambio de contexto

Cuando un colaborador trabaja en más de un proyecto candidato en la misma semana (concurrencia > umbral de tolerancia), su capacidad efectiva se reduce por el porcentaje de **Penalización por cambio de contexto** por cada proyecto adicional más allá del conteo de tolerancia.

- **Penalización por cambio de contexto**: el porcentaje de capacidad perdida por proyecto concurrente adicional (predeterminado 10%).
- **Tolerancia de cambio de contexto**: el número de proyectos concurrentes antes de que la penalización entre en efecto (predeterminado 1).

Por ejemplo, con penalización del 10% y tolerancia de 1: trabajar en 2 proyectos cuesta 10% de capacidad, 3 proyectos cuesta 20%.

### Análisis de sensibilidad (cuellos de botella)

Después de la ejecución principal de programación, el programador re-ejecuta la simulación múltiples veces, cada vez dando a un colaborador +20% de capacidad mensual extra. La diferencia entre la fecha de fin de la hoja de ruta original y la fecha de fin de cada variante mide el **impacto en el cronograma** de ese colaborador. Los colaboradores se clasifican por este impacto en la pestaña **Cuellos de botella**.

Esto ayuda a identificar qué colaboradores son las mayores restricciones de programación. Añadir capacidad a colaboradores de alto impacto (mediante contratación, reasignación o reducción de carga de trabajo) mejoraría más el cronograma general del portafolio.
