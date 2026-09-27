# Empresas

Las Empresas son la base de sus datos maestros. Representan las entidades legales a las que asigna el gasto IT y para las que reporta contracargos. Cada asignación, partida de coste y muchos informes hacen referencia a una empresa, por lo que mantener estos datos actualizados es importante.

Cuando se crea su espacio de trabajo, comienza con una empresa nombrada según su organización. Su país es el que seleccionó durante el registro de prueba, y se asignará automáticamente al plan de cuentas predeterminado para ese país cuando esté disponible. Puede renombrarla o añadir más.

## Primeros pasos

Navegue a **Datos maestros > Empresas** para abrir la lista.

**Campos obligatorios**:

- **Nombre**: una etiqueta única que sus equipos reconozcan
- **País**: código de país ISO (búsqueda por nombre o código)
- **Ciudad**: ciudad donde tiene sede la empresa
- **Moneda base**: código de moneda ISO (búsqueda por nombre o código)

**Consejo**: Mantenga nombres únicos para evitar confusión en importaciones y listas de selección.

## Trabajar con la lista

La lista muestra todas las empresas de su espacio de trabajo. Utilícela para revisar información clave de un vistazo, encontrar empresas rápidamente y abrir espacios de trabajo para editar.

**Columnas predeterminadas**:

| Columna | Qué muestra |
|---------|-------------|
| **Nombre** | Nombre de la empresa (haga clic para abrir el espacio de trabajo) |
| **País** | Código de país ISO |
| **Moneda** | Código de moneda base |
| **Plantilla (año)** | Plantilla para el año seleccionado (haga clic para abrir la pestaña Detalles) |
| **Usuarios IT (año)** | Usuarios IT para el año seleccionado (haga clic para abrir la pestaña Detalles) |
| **Facturación (año)** | Facturación para el año seleccionado (haga clic para abrir la pestaña Detalles) |
| **Estado** | Habilitada o Deshabilitada |

**Columnas adicionales** (ocultas por defecto, añádalas desde el selector de columnas):

| Columna | Qué muestra |
|---------|-------------|
| **Ciudad** | Ciudad |
| **Código postal** | Código postal |
| **Dirección 1** | Línea de dirección principal |
| **Dirección 2** | Línea de dirección secundaria |
| **Estado/Provincia** | Estado o provincia |
| **Notas** | Notas de texto libre |
| **Creado** | Fecha y hora de creación del registro |

**Filtrado**:

- **Búsqueda rápida**: búsqueda de texto libre en todas las columnas visibles
- **Filtros de columna**: haga clic en cualquier encabezado de columna para filtrar por valor; las columnas numéricas (Plantilla, Usuarios IT, Facturación) admiten filtros numéricos
- **Alcance de estado**: alterne entre **Habilitadas**, **Deshabilitadas** y **Todas** para controlar qué empresas aparecen

**Selector de año**: utilice el campo **Año** en la barra de herramientas para cambiar las métricas de qué año se muestran. La fila inferior muestra los **totales** de Plantilla, Usuarios IT y Facturación de todas las empresas visibles (filtradas).

**Acciones**:

- **Nuevo**: crear una empresa (requiere `companies:manager`)
- **Importar CSV**: importación masiva de empresas desde un archivo CSV (requiere `companies:admin`)
- **Exportar CSV**: exportar empresas y sus métricas a CSV (requiere `companies:admin`)
- **Eliminar seleccionadas**: eliminar una o más empresas seleccionadas (requiere `companies:admin`; solo es posible si nada referencia a la empresa)

**Contexto de búsqueda**: cuando abre un espacio de trabajo de empresa desde la lista, su búsqueda actual, filtros, orden y año se preservan. Al volver a la lista se restaura su vista anterior.

## Permisos

| Acción | Nivel requerido |
|--------|-----------------|
| Ver la lista y los espacios de trabajo | `companies:reader` |
| Crear o editar empresas | `companies:manager` |
| Importar, exportar o eliminar | `companies:admin` |

## El espacio de trabajo de la empresa

Haga clic en el nombre de una empresa en la lista para abrir su espacio de trabajo. El espacio de trabajo tiene dos pestañas dispuestas verticalmente a la izquierda: **Visión general** y **Detalles**.

Utilice **Anterior** / **Siguiente** para moverse entre empresas sin volver a la lista. Haga clic en **Cerrar** (X) para volver a la lista con su contexto de búsqueda intacto.

Si tiene cambios sin guardar, la aplicación le solicitará que guarde antes de cambiar de pestaña, navegar a otra empresa o cambiar de año.

---

### Visión general

La pestaña Visión general contiene la información general de la empresa.

**Qué puede editar**:

- **Nombre** (obligatorio): el nombre visible de la empresa
- **País** (obligatorio): código de país ISO, búsqueda por nombre o código
- **Plan de cuentas**: el CoA vinculado a esta empresa (ver más abajo)
- **Dirección 1**, **Dirección 2**: líneas de dirección
- **Código postal**: código postal / ZIP
- **Ciudad** (obligatorio): nombre de la ciudad
- **Estado/Provincia**: estado o provincia
- **N.º de registro**: número de registro mercantil
- **N.º de IVA**: número de identificación fiscal
- **Moneda base** (obligatorio): código de moneda ISO, búsqueda por nombre o código
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida)
- **Notas**: notas de texto libre

---

### Detalles

La pestaña Detalles gestiona las **métricas anuales**. Utilice las pestañas de año en la parte superior para alternar entre años (año actual más dos años antes y después).

**Qué puede editar**:

- **Plantilla** (obligatorio): conteo total de empleados para el año, debe ser un entero no negativo
- **Usuarios IT** (opcional): número de usuarios IT, debe ser un entero no negativo
- **Facturación** (opcional): ingresos en millones de la moneda base de la empresa, hasta 3 decimales

**Cómo funciona**:

- Cada guardado se aplica solo al año seleccionado actualmente
- Si las métricas del año están **congeladas**, los campos son de solo lectura; descongélelos desde **Administración de datos maestros** para realizar cambios
- Necesita `companies:manager` para editar métricas

## Plan de cuentas

Cada empresa puede vincularse a un **Plan de cuentas** (CoA), que define el conjunto de cuentas disponibles al registrar partidas OPEX o CAPEX para esa empresa.

**Cómo funciona**:

- Cuando crea una empresa, se asigna automáticamente al CoA predeterminado para su país (si existe). Si no existe un predeterminado para el país, se utiliza el CoA predeterminado global.
- Puede cambiar la asignación de CoA en la pestaña **Visión general** de la empresa usando el selector de **Plan de cuentas**. El selector muestra los CoA que coinciden con el país de la empresa más cualquier CoA de alcance global.
- El CoA que seleccione determina qué cuentas aparecen en el desplegable de cuentas al crear o editar partidas de gasto para esta empresa.

**Qué significa para su flujo de trabajo**:

- **Empresas con un CoA**: al registrar OPEX/CAPEX, solo puede seleccionar cuentas que pertenezcan al plan de cuentas de esa empresa. Esto garantiza la consistencia contable.
- **Empresas sin CoA** (legado): pueden usar cuentas que no pertenecen a ningún plan de cuentas. Esto soporta la migración gradual al sistema CoA.
- **Cambio de CoA**: si cambia una empresa a un CoA diferente, las partidas de gasto existentes conservan sus cuentas actuales (con una advertencia si no coinciden con el nuevo CoA), pero los nuevos elementos usarán cuentas del nuevo CoA.

**Configurar planes de cuentas**: vaya a **Datos maestros > Planes de cuentas** para ver, crear o gestionar sus conjuntos de CoA. Puede crear CoA desde cero o cargarlos desde plantillas de la plataforma (conjuntos de cuentas estándar por país). Cada país puede tener un CoA predeterminado que se asigna automáticamente a las nuevas empresas de ese país.

**Consejo**: si ve una advertencia de "cuenta obsoleta" al editar partidas OPEX/CAPEX, significa que la cuenta no pertenece al plan de cuentas actual de la empresa. Actualice la cuenta a una del CoA correcto para resolver esto.

## Estado y ciclo de vida

Utilice el **Fin de validez** para controlar cuándo una empresa deja de estar activa.

- Las empresas están **Activadas** por defecto. Deje el **Fin de validez** en blanco para que la empresa permanezca activa indefinidamente, o programe una fecha futura.
- Si cambia la empresa a **Desactivado** sin fecha, el fin de validez se fija en hoy.
- Después del fin de validez:
    - La empresa ya no aparece en las listas de selección para nuevas asignaciones y se excluye de los informes de años estrictamente posteriores.
    - Los datos históricos permanecen intactos; la empresa sigue apareciendo en informes que cubren años en los que estaba activa.
- **Prefiera desactivar en lugar de eliminar.** La eliminación solo es posible si nada referencia a la empresa (sin asignaciones, gasto ni centros de coste). Una empresa a la que pertenecen centros de coste se rechaza con un mensaje como "Company A is used by 3 cost centers. Change their company or disable it instead."

## Métricas anuales

Muchas partes de la aplicación son conscientes del año. Las empresas tienen métricas por año:

- **Plantilla** (obligatorio para el año)
- **Usuarios IT** (opcional)
- **Facturación** (opcional, en millones de la moneda base de la empresa)

**Dónde es importante**:

- Las asignaciones pueden usar Plantilla, Usuarios IT o Facturación para distribuir costes entre empresas para un año determinado.
- Los informes utilizan estas métricas para KPI y ratios.
- Solo las empresas activas para un año se consideran para la asignación e informes de ese año.

**Congelación y copia**:

- Puede **congelar** un año una vez finalizado para prevenir ediciones.
- Utilice **Administración de datos maestros** para copiar métricas de un año a otro (elija qué métricas copiar). Los años congelados no pueden sobrescribirse.

## Importación/exportación CSV

Mantenga grandes conjuntos sincronizados con sus sistemas de origen usando CSV (separado por punto y coma `;`).

**Exportar**:

- **Plantilla**: archivo solo con encabezados que puede rellenar (incluye columnas dinámicas para A-1, A, A+1 basadas en el año seleccionado)
- **Datos**: empresas actuales más sus métricas para A-1 / A / A+1

**Importar**:

- Comience con **Verificación previa** (valida encabezados, codificación, campos obligatorios, duplicados y métricas)
- Si la verificación previa es correcta, **Cargar** aplicará inserciones y actualizaciones
- La coincidencia es por **nombre** de empresa (dentro de su espacio de trabajo). Los duplicados en el archivo se deduplicar por nombre (gana la primera ocurrencia)
- **Campos obligatorios**: Nombre, País (2 letras), Moneda base (3 letras), Ciudad
- **Campo opcional**: `coa_code` (referencia un plan de cuentas; si se omite, se usa el CoA predeterminado para el país)
- **Métricas**: si proporciona alguna métrica para un año, Plantilla es obligatoria para ese año; Usuarios IT y Facturación son opcionales. La facturación admite hasta 3 decimales y debe expresarse en millones de la moneda base de la empresa

**Notas**:

- Utilice codificación **UTF-8** y **puntos y coma** como separadores
- La lista se actualiza automáticamente después de una carga exitosa
- Si importa con `coa_code`, asegúrese de que el plan de cuentas exista primero en su espacio de trabajo

## Consejos

- **Desactive en lugar de eliminar**: mantenga el historial consistente y los informes significativos.
- **Plan de cuentas**: asigne CoA a las empresas para garantizar un uso consistente de cuentas en las partidas OPEX/CAPEX.
- **Facturación**: introduzca valores en millones de la moneda base de la empresa (p. ej., 2,5 = 2,5 millones en esa moneda).
- **Plantilla** es el factor de asignación más común; manténgalo actualizado para el año en curso.
- **Métricas congeladas**: aún puede revisarlas, pero las ediciones están bloqueadas hasta que descongele desde Administración.
- **Selector de columnas**: utilícelo para mostrar u ocultar columnas como Ciudad, Dirección, Estado/Provincia o Creado para adaptarse a su flujo de trabajo.
- **Las columnas de métricas enlazan con Detalles**: hacer clic en un valor de Plantilla, Usuarios IT o Facturación abre la pestaña Detalles directamente para esa empresa.
