# Empresas

Las Empresas son la base de sus datos maestros. Representan las entidades legales a las que asigna el gasto IT y para las que reporta contracargos. Cada asignación, línea de coste y muchos informes hacen referencia a una empresa, por lo que mantener estos datos actualizados es importante.

Cuando se crea su espacio de trabajo, comienza con una empresa nombrada según su organización. Su país es el que seleccionó durante el registro de prueba, y se asignará automáticamente al plan de cuentas predeterminado para ese país cuando esté disponible. Puede renombrarla o añadir más.

## Primeros pasos

Navegue a **Datos maestros > Empresas** para abrir la lista.

**Campos obligatorios**:

- **Nombre**: una etiqueta única que sus equipos reconozcan
- **País**: código de país ISO (búsqueda por nombre o código)
- **Ciudad**: ciudad donde tiene sede la empresa
- **Moneda base**: código de moneda ISO (búsqueda por nombre o código)

**Nombres únicos**: cada empresa tiene su propio nombre, sin distinguir mayúsculas y minúsculas (`Acme` y `acme` son el mismo nombre). Un nombre que ya tiene otra empresa se rechaza, con un mensaje bajo el nombre.

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
| **Facturación (año)** | Facturación para el año seleccionado, en millones de la moneda base de la empresa, por ejemplo `35 M USD` (haga clic para abrir la pestaña Detalles) |
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
- **Alcance de estado**: el selector **Mostrar: Todos / Activos / Desactivados** sobre la lista controla qué empresas aparecen. La lista muestra por defecto las empresas activadas

**Selector de año**: utilice el campo **Año** en la barra de herramientas para cambiar las métricas de qué año se muestran. La fila inferior muestra los **totales** de Plantilla, Usuarios IT y Facturación de todas las empresas visibles (filtradas).

**Valores de las métricas**:

- Una métrica que nunca se introdujo para el año muestra **—**. Un cero introducido muestra **0**
- Los números siguen el idioma de KANAP: coma decimal en español, francés y alemán, punto decimal en inglés
- La facturación de cada fila está en la moneda base de la empresa. La fila **Total** está en la moneda de reporte: cada facturación se convierte a los tipos del año. Cuando la columna presupuestaria por defecto del año está congelada, son los tipos que fijó. Si no, son los tipos actuales (consulte [Configuración de monedas](currencies.md))
- Cuando una moneda no tiene tipo para el año, la facturación de las empresas en esa moneda queda fuera del total, y el total indica la moneda y el número de empresas excluidas. KANAP obtiene el tipo que falta en segundo plano. Un [tipo manual](currencies.md#tipos-manuales) lo corrige al momento

**Acciones**:

- **Nuevo**: crear una empresa (requiere `companies:member`)
- **Importar**: importación masiva de empresas desde un archivo CSV (requiere `companies:admin`)
- **Exportar**: exportar empresas y sus métricas a CSV (requiere `companies:admin`)
- **Eliminar seleccionadas**: eliminar una o más empresas seleccionadas (requiere `companies:admin`; solo es posible si nada referencia a la empresa)

**Contexto de búsqueda**: cuando abre un espacio de trabajo de empresa desde la lista, su búsqueda actual, filtros, orden y año se preservan. Al volver a la lista se restaura su vista anterior.

## Permisos

| Acción | Nivel requerido |
|--------|-----------------|
| Ver la lista y los espacios de trabajo | `companies:reader` |
| Crear o editar empresas | `companies:member` |
| Importar, exportar o eliminar | `companies:admin` |

## El espacio de trabajo de la empresa

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo de la empresa. Tiene dos pestañas: **Visión general** y **Detalles**. Las personas que gestionan el acceso a los datos ven además una pestaña **Acceso**, con las personas que ven toda la empresa y las que ven una parte. Vea [Acceso a los datos](data-access.md#the-access-tab-of-companies-and-cost-centers).

- **Encabezado**: el nombre de la empresa. Haga clic en él para cambiar el nombre de la empresa. Las flechas con «N de M» permiten moverse entre empresas en el orden y con los filtros de la lista, sin volver a ella. El enlace de retorno, **Empresas**, vuelve a la lista con su contexto de búsqueda intacto
- **Estado**, bajo el nombre: **Activado** o **Desactivado**. Haga clic para cambiarlo. Elegir **Desactivado** desactiva la empresa de inmediato: el fin de validez pasa a ser la hora actual
- **Panel Propiedades** a la derecha: **País**, **Moneda base**, **Plan de cuentas** y **Ciclo de vida**. Use el botón situado junto al panel para plegarlo o volver a abrirlo

- **Eliminar**, un icono de papelera arriba a la derecha: visible para los administradores de empresas (`companies:admin`). Consulte [Eliminar una empresa](#eliminar-una-empresa)

**Guardado automático**: Cada cambio se guarda por sí solo al salir del campo. No hay botones Guardar, Restablecer ni Cerrar. Puede seguir trabajando mientras se guarda un cambio. La parte superior de la página muestra **Guardando…** mientras guarda y luego **Guardado** durante un momento. Cuando se rechaza un cambio, el campo vuelve a mostrar su valor anterior y el motivo aparece debajo. El mensaje se mantiene hasta que vuelva a escribir en el campo.

---

### Panel Propiedades

- **País** (obligatorio): código de país ISO, búsqueda por nombre o código. Al cambiar el país, el **Plan de cuentas** también pasa al predeterminado del nuevo país, pero solo si el plan actual pertenece a otro país. Un plan de cuentas global se mantiene
- **Moneda base** (obligatorio): código de moneda ISO, búsqueda por nombre o código
- **Plan de cuentas**: el plan de cuentas vinculado a esta empresa (ver [Plan de cuentas](#plan-de-cuentas)). En una empresa existente puede elegir otro plan, pero no puede vaciar el campo, porque volvería el predeterminado del país
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta indica el estado actual (**Activada** o **Desactivada**), y la fecha de **Fin de validez**. Ver [Estado y ciclo de vida](#estado-y-ciclo-de-vida)

---

### Visión general

La pestaña Visión general contiene la dirección, los datos de registro y las notas. El nombre, el país, la moneda, el plan de cuentas y el ciclo de vida están en el encabezado y en el panel **Propiedades**.

**Qué puede editar**:

- Sección **Dirección**:
    - **Dirección, línea 1**, **Dirección, línea 2**: líneas de dirección
    - **Código postal**: código postal
    - **Ciudad** (obligatorio): nombre de la ciudad. Una ciudad vacía se rechaza con «Introduzca una ciudad.»
    - **Provincia o región**: provincia o región
- Sección **Registro**:
    - **Número de registro**: número de registro de la empresa
    - **Número de IVA**: número de identificación de IVA
- **Notas**: notas de texto libre

**Crear una empresa**: **Nuevo** abre un único formulario con el nombre, **País**, **Moneda base**, **Plan de cuentas**, **Ciudad**, los demás campos de dirección, los campos de registro y **Notas**. Al elegir un país se rellena el **Plan de cuentas** por usted: el plan predeterminado del país si existe, y si no un plan global. Puede cambiarlo antes de guardar. Haga clic en **Crear** para guardar la empresa. La pestaña **Detalles** estará disponible después de crear la empresa.

---

### Detalles

La pestaña Detalles gestiona las **métricas anuales**. Use las pestañas de año en la parte superior para cambiar de año (año en curso más dos años antes y después).

**Qué puede editar**:

- **Plantilla** (obligatorio): número total de empleados del año, debe ser un número entero de 0 o más
- **Usuarios IT** (opcional): número de usuarios IT, debe ser un número entero de 0 o más
- **Facturación** (opcional): facturación en millones de la moneda base de la empresa, hasta 3 decimales. La etiqueta nombra la moneda, por ejemplo **Facturación (M USD)**

**Cómo funciona**:

- Cada valor se guarda para el año seleccionado al salir del campo (o al pulsar Intro). Un valor no válido muestra un mensaje bajo el campo, por ejemplo «Introduzca un número entero, 0 o más.» El campo vuelve al valor guardado, y el mensaje se mantiene hasta que vuelva a escribir
- Los números siguen el idioma de KANAP: escriba `12,5` en español, francés o alemán, y `12.5` en inglés
- Cada año se guarda por separado: al cambiar de año se cargan los valores de ese año
- Si las cifras de la empresa para el año están **congeladas**, los campos quedan bloqueados y un aviso indica que un administrador de presupuesto puede descongelarlas (**Gestión presupuestaria > Administración > Congelar datos maestros**)
- Necesita `companies:member` para editar las métricas

## Plan de cuentas

Cada empresa puede vincularse a un **Plan de cuentas** (CoA), que define el conjunto de cuentas disponibles al registrar líneas OPEX o CAPEX para esa empresa.

**Cómo funciona**:

- Cuando crea una empresa, se asigna automáticamente al CoA predeterminado para su país (si existe). Si no existe un predeterminado para el país, se utiliza el plan que tiene el rol **Predeterminado para otros países**.
- Puede cambiar la asignación de CoA en el panel **Propiedades** usando el selector de **Plan de cuentas**. El selector muestra los CoA que coinciden con el país de la empresa más cualquier CoA de alcance global.
- Cuando cambia el país de la empresa, el CoA lo sigue si el actual pertenece a otro país: pasa al predeterminado del nuevo país. Un CoA global se mantiene.
- En una empresa existente, el CoA no se puede vaciar. Solo puede sustituirlo por otro.
- El CoA que seleccione determina qué cuentas aparecen en el desplegable de cuentas al crear o editar líneas de gasto para esta empresa.

**Qué significa para su flujo de trabajo**:

- **Empresas con un CoA**: al registrar OPEX/CAPEX, solo puede seleccionar cuentas que pertenezcan al plan de cuentas de esa empresa. Esto garantiza la consistencia contable.
- **Empresas sin CoA** (legado): pueden usar cuentas que no pertenecen a ningún plan de cuentas. Esto soporta la migración gradual al sistema CoA.
- **Cambio de CoA**: si cambia una empresa a un CoA diferente, las líneas de gasto existentes conservan sus cuentas actuales (con una advertencia si no coinciden con el nuevo CoA), pero los nuevos elementos usarán cuentas del nuevo CoA.

**Configurar planes de cuentas**: vaya a **Datos maestros > Planes de cuentas** para ver, crear o gestionar sus conjuntos de CoA. Puede crear CoA desde cero o cargarlos desde plantillas de la plataforma (conjuntos de cuentas estándar por país). Cada país puede tener un CoA predeterminado (**Plan predeterminado del país ({country})**), que se propone al crear una empresa en ese país. Las empresas de un país sin predeterminado usan el plan **Predeterminado para otros países**. Consulte [Roles de los planes](chart-of-accounts.md#roles-de-los-planes).

**Consejo**: si ve una advertencia de "cuenta obsoleta" al editar líneas OPEX/CAPEX, significa que la cuenta no pertenece al plan de cuentas actual de la empresa. Actualice la cuenta a una del CoA correcto para resolver esto.

## Estado y ciclo de vida

Utilice el **Fin de validez** para controlar cuándo una empresa deja de estar activa.

- Las empresas están **Activadas** por defecto. Deje el **Fin de validez** en blanco para que la empresa permanezca activa indefinidamente, o programe una fecha futura.
- Pasar a **Desactivado** fija el fin de validez en este momento: la desactivación es inmediata. Mientras haya una fecha futura, el interruptor muestra **Activo hasta el** y esa fecha.
- Cuando pasa el fin de validez, el estado cambia a **Desactivado** por sí solo en el plazo de una hora.
- Después del fin de validez:
    - La empresa ya no aparece en las listas de selección para nuevas asignaciones y se excluye de los informes de años estrictamente posteriores.
    - Los datos históricos permanecen intactos; la empresa sigue apareciendo en informes que cubren años en los que estaba activa.
- **Prefiera desactivar en lugar de eliminar.** Una empresa que aún se usa no se puede eliminar: líneas presupuestarias (como empresa pagadora o en sus asignaciones), contratos, centros de coste, departamentos, usuarios, las ubicaciones que opera, tareas, aplicaciones, interfaces, proyectos y solicitudes del portafolio, y miembros del equipo cuya empresa predeterminada es. El mensaje cuenta lo que la usa, por ejemplo "Esta empresa se usa en 2 departamentos y 14 usuarios". Desactívela en su lugar. Sus métricas anuales se eliminan con ella. En la lista, la confirmación nombra las empresas que se conservan así, con lo que las usa, antes de eliminar nada.
- **Para eliminar una empresa de todos modos**, quite primero lo que la usa. Indique otra empresa en sus usuarios, líneas presupuestarias y sus asignaciones, contratos, centros de coste, las ubicaciones que opera, tareas, aplicaciones, interfaces, proyectos y solicitudes del portafolio, y miembros del equipo. Mueva sus departamentos a otra empresa, o elimínelos al final, cuando nada los use. Después elimine la empresa.

## Eliminar una empresa

Un administrador de empresas (`companies:admin`) puede eliminar una empresa desde su página con **Eliminar**, o varias desde la lista con **Eliminar seleccionadas**.

- KANAP comprueba primero. Cuando algo usa la empresa, el diálogo dice qué, por ejemplo «Esta empresa se usa en 2 departamentos y 14 usuarios. Desactívela en lugar de eliminarla.», y solo ofrece **Cerrar**. Desactive entonces la empresa (consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida))
- Si no, el diálogo pide confirmación: «Esta acción no se puede deshacer.» **Eliminar** elimina la empresa con sus métricas anuales y vuelve a la lista
- Una empresa eliminada sale del mosaico **Vistos recientemente** de [Mi panel de control](my-dashboard.md#vistos-recientemente)

## Métricas anuales

Muchas partes de la aplicación son conscientes del año. Las empresas tienen métricas por año:

- **Plantilla** (obligatorio para el año)
- **Usuarios IT** (opcional)
- **Facturación** (opcional, en millones de la moneda base de la empresa)

**Dónde es importante**:

- Las asignaciones pueden usar Plantilla, Usuarios IT o Facturación para distribuir costes entre empresas para un año determinado. Las facturaciones en monedas distintas se convierten primero a la moneda de reporte. Una empresa cuya moneda no tiene tipo para el año no recibe ninguna parte de un reparto por facturación. Consulte [Asignaciones](budget-lines.md#asignaciones).
- Los informes utilizan estas métricas para KPI y ratios.
- Solo las empresas activas para un año se consideran para la asignación e informes de ese año.

**Congelación y copia**:

- Puede **congelar** un año una vez finalizado para prevenir ediciones.
- Utilice **Copiar indicadores anuales** en **Gestión presupuestaria > Administración** para copiar métricas de un año a otro (elija qué métricas copiar). Los años congelados no pueden sobrescribirse.

## Importación/exportación CSV

La exportación escribe un archivo CSV o un libro de Excel (`.xlsx`): elija en **Formato** en el diálogo. La importación lee los dos. Consulte [Archivos CSV y Excel](csv-files.md).

**Exportar** descarga las empresas que muestra la lista (o, a petición en el diálogo, todas las empresas) con sus métricas. **Importar** vuelve a leer un archivo. El diálogo de importación incluye también **Descargar plantilla**: un archivo con los encabezados y una fila de ejemplo, una empresa ficticia con métricas para el año de la lista. Sustitúyala por sus propias filas.

Las columnas, en este orden. Las columnas de métricas siguen el año seleccionado en la barra de herramientas de la lista: el año anterior, ese año y el siguiente.

| Columna | Contenido |
|---|---|
| `name` | Obligatoria. El nombre de la empresa. Las filas se emparejan por este nombre |
| `country_iso` | Obligatoria. Dos letras |
| `address1`, `address2` | Líneas de dirección |
| `postal_code`, `state` | Datos de dirección |
| `city` | Obligatoria. La ciudad |
| `reg_number`, `vat_number` | Número de registro y número de IVA |
| `base_currency` | Obligatoria. Tres letras |
| `status` | `enabled` o `disabled` |
| `disabled_at` | El fin de validez: una fecha (`2026-12-31`) o una fecha y una hora completas. La exportación escribe solo la fecha. Importada de nuevo, esa fecha conserva el fin de validez guardado |
| `notes` | Texto libre |
| `headcount_<año>` | Un número entero. Obligatoria cuando la fila lleva alguna métrica de ese año |
| `it_users_<año>` | Un número entero |
| `turnover_<año>` | Hasta 3 decimales, en millones de la moneda base de la empresa |

**Importación**:

- Empiece por la **Verificación previa**. Valida los encabezados, la codificación, los campos obligatorios, los duplicados y las métricas. Si la comprobación es correcta, **Cargar** aplica las inserciones y las actualizaciones. Después, el diálogo cuenta las empresas creadas, actualizadas y sin cambios, por ejemplo «2 creadas, 5 actualizadas, 30 sin cambios»
- **Emparejamiento**: por el `name` de la empresa, sin distinguir mayúsculas y minúsculas. La grafía guardada se mantiene: una fila `ACME` actualiza `Acme`, y la verificación previa indica «ACME» se ha asociado a «Acme»
- **Una fila por empresa**: un nombre que aparece dos veces en el archivo, sin distinguir mayúsculas y minúsculas, se rechaza ya en la verificación: «“Acme” ya figura en la fila 4. Deje una sola fila por empresa.»
- **Campos obligatorios**: `name`, `country_iso`, `city` y `base_currency`. Una ciudad vacía se rechaza ya en la verificación, tanto para una empresa nueva como para una actualización
- **Estado y fin de validez**: la exportación escribe el estado deducido del fin de validez. Una empresa nueva se activa salvo que la fila indique `disabled`. En una actualización, un `status` vacío y un `disabled_at` vacío conservan los valores guardados. `enabled` con una fecha vacía borra el fin de validez. `disabled` con una fecha vacía conserva una fecha ya pasada y, si no, finaliza la empresa hoy
- Una fila cuyo estado contradice su fecha se rechaza con un error de fila: "Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again." o "Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."
- **Años leídos**: el diálogo nombra los años que lee, por ejemplo «Indicadores leídos: 2025, 2026, 2027, según el año de la lista. Cada año es opcional.»
- **Cada año es opcional**: un año es un bloque de tres columnas, `headcount_<año>`, `it_users_<año>` y `turnover_<año>`. Si omite el bloque entero, las métricas guardadas de ese año no cambian. Una columna de un año fuera de los tres años leídos se ignora, y la verificación la lista con las columnas ignoradas
- **Un año va completo**: un archivo con una o dos columnas de un año sin las demás se rechaza en la línea **Encabezado**, que nombra las columnas que faltan
- **Métricas**: si una fila lleva alguna métrica de un año, `headcount_<año>` es obligatoria para ese año. `it_users_<año>` y `turnover_<año>` pueden quedar vacías
- **Años congelados**: una fila con métricas de un año cuyas métricas de empresas están congeladas se rechaza ya en la verificación: «Los indicadores de 2025 están congelados. Un administrador de presupuesto puede descongelarlos.» Omita las columnas de ese año, o descongele antes el año (consulte [Congelar datos maestros](master-data-operations.md))

**Notas**:

- Consulte [Archivos CSV y Excel](csv-files.md) para la codificación, el separador, los formatos de fecha e importe y los dos pasos de importación
- La lista se actualiza automáticamente tras una carga correcta

## Consejos

- **Desactive en lugar de eliminar**: mantenga el historial consistente y los informes significativos.
- **Plan de cuentas**: asigne CoA a las empresas para garantizar un uso consistente de cuentas en las líneas OPEX/CAPEX.
- **Facturación**: introduzca valores en millones de la moneda base de la empresa (p. ej., 2,5 = 2,5 millones en esa moneda).
- **Plantilla** es el factor de asignación más común; manténgalo actualizado para el año en curso.
- **Métricas congeladas**: aún puede revisarlas, pero las ediciones están bloqueadas hasta que un administrador de presupuesto descongele el año en **Gestión presupuestaria > Administración > Congelar datos maestros**.
- **Selector de columnas**: utilícelo para mostrar u ocultar columnas como Ciudad, Dirección, Estado/Provincia o Creado para adaptarse a su flujo de trabajo.
- **Las columnas de métricas enlazan con Detalles**: hacer clic en un valor de Plantilla, Usuarios IT o Facturación abre la pestaña Detalles directamente para esa empresa.
