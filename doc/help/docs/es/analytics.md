# Dimensiones analíticas

Las dimensiones analíticas clasifican su presupuesto de TI para los informes, fuera de su estructura contable. Usted elige sus propias formas de leer el presupuesto, como la naturaleza del gasto o el programa al que sirve, sin rehacer empresas, departamentos, cuentas ni centros de coste.

## Dimensiones y valores

Una **dimensión** es una forma de clasificar las líneas de presupuesto, por ejemplo **Nature** o **Program**. Sus **valores** son las opciones que ofrece, por ejemplo **Licenses**, **Cloud** y **Services** para Nature.

- Cada dimensión tiene su propia lista de valores.
- Cada línea OPEX y CAPEX puede tener un valor por dimensión. Una línea puede ser **Licenses** en Nature y **Workplace** en Program al mismo tiempo.
- Una línea también puede no tener valor en una dimensión. Los informes muestran estas líneas como "Sin asignar".

Por ejemplo:

```
Nature          Program
  Licenses        Workplace
  Cloud           ERP
  Services        Security
```

### La dimensión por defecto

Cada espacio de trabajo empieza con una dimensión, la dimensión por defecto. Mientras no le dé un nombre, se muestra como **Dimensión analítica**, en el idioma de cada persona. Si su espacio de trabajo ya tenía valores analíticos, pertenecen a esta dimensión y cada línea conserva su valor.

La dimensión por defecto tiene un papel especial:

- No se puede desactivar ni eliminar. Su espacio de trabajo no tiene botón **Eliminar**, y una línea bajo **Ciclo de vida** explica el motivo: "Esta dimensión no se puede desactivar ni eliminar: los archivos antiguos y las preguntas a la IA la usan."
- Los archivos CSV antiguos y las preguntas a Plaid sobre la categoría analítica la usan. Consulte [Importación/exportación CSV](#importacionexportacion-csv) y [Dimensiones analíticas en Plaid](#dimensiones-analiticas-en-plaid).
- Sigue siendo la dimensión por defecto cuando cambia su nombre, su código o su orden.
- Su etiqueta está reservada: ninguna otra dimensión puede llamarse "Dimensión analítica", en ninguno de los idiomas de la aplicación.

---

## Primeros pasos

Navegue a **Datos maestros > Dimensiones analíticas** (en la sección **Clasificación**).

1. **Dé un nombre a la dimensión por defecto** si "Dimensión analítica" no le conviene: haga clic en el botón de edición junto a su chip y escriba un nombre en su espacio de trabajo, por ejemplo **Nature**.
2. **Añada sus valores**: haga clic en **Nuevo valor**.
3. **Añada una dimensión** cuando necesite otra forma de leer el presupuesto: haga clic en **Nueva dimensión** y añada sus valores.

**Consejo**: Empiece con una o dos dimensiones y de 5 a 10 valores en cada una. Una denominación coherente hace que las listas sean más fáciles de recorrer.

---

## La página Dimensiones analíticas

### Chips de dimensión

Bajo el título, una línea de chips muestra sus dimensiones en orden. Una dimensión desactivada aparece marcada como **Desactivado**.

- Haga clic en un chip para listar los valores de esa dimensión. La dirección de la página conserva su elección, de modo que un enlace guardado se abre en la misma dimensión. Sin elección, la página se abre en la dimensión por defecto.
- El chip seleccionado tiene un botón de edición (icono de lápiz). Haga clic en él para abrir el espacio de trabajo de la dimensión.
- **Nueva dimensión**, al final de la línea, crea una dimensión (requiere `analytics:member`).

Con una sola dimensión, la página muestra un chip y sus valores.

### Lista de valores

La lista muestra los valores de la dimensión seleccionada.

**Columnas**:

| Columna | Qué muestra |
|---|---|
| **Nombre** | El nombre del valor |
| **Descripción** | Lo que abarca el valor |
| **Estado** | **Activado** o **Desactivado** |
| **Actualizado** | Fecha y hora del último cambio |

Haga clic en cualquier celda para abrir el espacio de trabajo del valor.

**Filtrado**:

- **Búsqueda rápida**: busca en el nombre y la descripción
- **Filtro de estado**: un filtro de casillas en la columna **Estado**. Si hace clic en **Limpiar** dentro del filtro, o desmarca ambos valores, la lista no muestra nada, sea cual sea la opción de **Mostrar**
- **Ámbito de estado**: el selector **Mostrar: Todos / Activos / Desactivados** sobre la lista. La lista muestra por defecto los valores activados

**Acciones**:

- **Nuevo valor**: crear un valor en la dimensión seleccionada (requiere `analytics:member`). Mientras la dimensión seleccionada está desactivada, el botón está desactivado y su información emergente indica "Active esta dimensión para añadir valores."
- **Importar CSV**: cargar valores desde un archivo (requiere `analytics:admin`)
- **Exportar CSV**: descargar los valores de todas las dimensiones (requiere `analytics:admin`)
- **Eliminar selección**: eliminar los valores seleccionados (requiere `analytics:admin`). Los valores que usan líneas de presupuesto se conservan

---

## Dimensiones

### Crear una dimensión

Haga clic en **Nueva dimensión**, complete los campos y haga clic en **Crear**. Se abre el espacio de trabajo de la nueva dimensión. Una dimensión nueva está activada.

- **Nombre** es obligatorio.
- **Código** se propone a partir del nombre: en minúsculas, sin acentos y con los espacios sustituidos por `-`. Puede cambiarlo antes de crear la dimensión.
- **Orden** se propone para que la nueva dimensión quede la última.
- **Descripción** es opcional.

Después vuelva a la página para añadir los valores de la nueva dimensión.

### El espacio de trabajo de la dimensión

Ábralo con el botón de edición del chip seleccionado.

- **Encabezado**: el nombre de la dimensión. Haga clic en él para cambiar el nombre de la dimensión. **Ant.** / **Sig.** recorren las dimensiones en orden, y el botón de cierre vuelve a la página en esta dimensión
- **Zona principal**: una línea de uso, por ejemplo "12 valores. Uso: 27 líneas OPEX y 2 líneas CAPEX.", y después la **Descripción**
- **Panel Propiedades** a la derecha: **Nombre**, **Código**, **Orden** y **Ciclo de vida**

**Guardado automático**: Cada cambio se guarda por sí solo. No hay botón Guardar. Los campos de texto se guardan al salir de ellos (en **Nombre**, **Código** y **Orden**, pulse Intro para guardar de inmediato); el ciclo de vida se guarda en cuanto lo cambia. Cuando se rechaza un cambio, el motivo aparece bajo el campo que lo causó, por ejemplo un código duplicado bajo **Código**. Un nombre rechazado en el encabezado se muestra en la parte superior de la página.

### Campos de la dimensión

| Campo | Qué introducir |
|---|---|
| **Nombre** | Hasta 200 caracteres. Los nombres son únicos sin distinguir mayúsculas y minúsculas. Obligatorio, salvo en la dimensión por defecto: déjelo vacío en ella para mostrar "Dimensión analítica" en el idioma de cada persona. La etiqueta de la dimensión por defecto está reservada en todos los idiomas de la aplicación ("Analytics dimension", "Dimension analytique", "Analysedimension", "Dimensión analítica"), sin distinguir mayúsculas y minúsculas: otra dimensión con uno de estos nombres se rechaza con "This name is reserved for the default dimension." |
| **Código** | De 1 a 40 caracteres: letras minúsculas, dígitos, `-` o `_`, empezando por una letra o un dígito. Cada código es único. El código da nombre a la columna de la dimensión en los archivos CSV de OPEX y CAPEX, de modo que cambiarlo cambia el nombre de esa columna. Las líneas de presupuesto conservan sus valores cuando cambia el código |
| **Orden** | Un número entero. Las dimensiones se listan según este número, de menor a mayor: en esta página, en las líneas de presupuesto, en los filtros de los informes y en el selector de dimensión del informe |
| **Descripción** | Para qué sirve la dimensión, de modo que sus compañeros clasifiquen las líneas de la misma manera |
| **Ciclo de vida** | El interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida). Bloqueado en la dimensión por defecto, con una línea debajo: "Esta dimensión no se puede desactivar ni eliminar: los archivos antiguos y las preguntas a la IA la usan." |

### Eliminar una dimensión

El botón **Eliminar** del encabezado elimina la dimensión de inmediato (requiere `analytics:admin`). Mientras la dimensión tenga valores, el botón está desactivado y una línea bajo la línea de uso explica el motivo: "Para eliminar esta dimensión, elimine primero sus valores."

La dimensión por defecto no tiene botón **Eliminar**: no se puede eliminar.

Para conservar los valores en las líneas, desactive la dimensión en su lugar.

---

## Valores

### Crear un valor

Haga clic en **Nuevo valor**. El campo **Dimensión** empieza en la dimensión seleccionada en la página y solo ofrece las dimensiones activadas. Introduzca el **Nombre** y, si lo desea, una **Descripción**, y haga clic en **Crear**. Se abre el espacio de trabajo del nuevo valor. Un valor nuevo está activado.

### El espacio de trabajo del valor

- **Encabezado**: el nombre del valor. Haga clic en él para cambiar el nombre del valor. **Ant.** / **Sig.** recorren los valores de la misma dimensión, en el orden y con los filtros actuales de la lista. El botón de cierre vuelve a la lista
- **Zona principal**: una línea como "Usado por 3 líneas OPEX y 1 línea CAPEX." cuando hay líneas de presupuesto que usan el valor, y después la **Descripción**
- **Panel Propiedades** a la derecha: **Dimensión** (solo lectura) y **Ciclo de vida**

Los cambios se guardan por sí solos, como en el espacio de trabajo de la dimensión. Un nombre rechazado en el encabezado se muestra en la parte superior de la página.

### Reglas de los valores

- **Una lista por dimensión**: los nombres son únicos dentro de una dimensión, sin distinguir mayúsculas y minúsculas. Dos dimensiones pueden tener cada una un valor llamado "Other". Un duplicado se rechaza, por ejemplo "A value named Licenses already exists in Nature."
- **Un valor se queda en su dimensión**: la dimensión se fija al crear el valor y no puede cambiar. Para mover un valor, créelo en la otra dimensión, cambie las líneas y después elimine el valor antiguo.
- **Cambiar el nombre conserva las líneas**: las líneas apuntan al propio valor, de modo que el nuevo nombre aparece de inmediato en las listas y los informes.
- **Eliminar**: el botón **Eliminar** del encabezado elimina el valor de inmediato (requiere `analytics:admin`). Está desactivado cuando hay líneas de presupuesto que usan el valor, con el motivo, por ejemplo "Usado por 3 líneas OPEX y 1 línea CAPEX. Desactívelo en su lugar." Quite antes el valor de esas líneas, o desactívelo.

---

## Estado y ciclo de vida

Las dimensiones y los valores tienen cada uno un estado (**Activado** o **Desactivado**) y un **Fin de validez** opcional. Úselos para retirar una dimensión o un valor sin eliminarlo.

- **Fin de validez**: la fecha en que termina. Déjelo en blanco para mantenerlo activo. También puede programar una fecha futura.
- Pasar a **Desactivado** sin fecha fija el fin de validez en hoy. Volver a **Activado** borra la fecha.

**Un valor desactivado**:

- No se puede elegir para una línea, ni en la aplicación, ni en un archivo CSV, ni mediante Plaid.
- Se mantiene en las líneas que ya lo tienen y sigue contando en los informes. En la lista del campo aparece marcado como **Desactivado**.

**Una dimensión desactivada**:

- Desaparece de los formularios de las partidas, de las listas OPEX y CAPEX, de los filtros de los informes, del selector de dimensión del informe, de las exportaciones CSV de OPEX y CAPEX y de Plaid. Solo la página Dimensiones analíticas la muestra, marcada como **Desactivado**.
- Conserva sus valores en las líneas. Vuelva a activar la dimensión y se muestran de nuevo.
- No admite valores nuevos. **Nuevo valor** está desactivado mientras la dimensión está seleccionada, y los archivos CSV no pueden añadir ni cambiar sus valores.

La dimensión por defecto no se puede desactivar.

**Prefiera desactivar a eliminar**: desactivar mantiene la coherencia de los informes y a la vez mantiene las listas limpias.

---

## Valores en las líneas de presupuesto

En el panel **Propiedades** de una partida OPEX o CAPEX, y al crear una, cada dimensión activada tiene su propio campo, con el nombre de la dimensión, en el orden de las dimensiones. La dimensión por defecto se muestra como **Dimensión analítica** hasta que le dé un nombre.

- Elija un valor, o vacíe el campo para dejar la línea sin valor en esa dimensión. El cambio se guarda de inmediato.
- El campo lista los valores activados de su dimensión. Un valor desactivado sigue mostrándose en las líneas que lo tienen.
- El campo no puede crear un valor. Cree los valores en la página Dimensiones analíticas, o deje que los cree una importación CSV de OPEX o CAPEX.
- Un valor se aplica a toda la línea, en todos los años.
- Si las dimensiones no se pueden cargar, una línea sustituye a estos campos: "No se pudieron cargar las dimensiones."

Las listas OPEX y CAPEX tienen una columna por dimensión activada, oculta por defecto, con filtros de casillas. Consulte [OPEX](opex.md) y [CAPEX](capex.md).

---

## Informes

El informe **Dimensiones analíticas** (en **Informes**) muestra cómo se reparte el presupuesto de sus líneas OPEX o CAPEX entre los valores de una dimensión. Consulte [Informes](reports.md#dimensiones-analiticas) para la descripción completa.

- **Tipo de partida**: OPEX o CAPEX
- **Dimensión**: la dimensión por la que agrupa el informe. Aparece cuando tiene dos o más dimensiones activadas, y empieza en la dimensión por defecto
- **Rango de años**: un solo año (gráfico circular o de barras) o varios años (gráfico de líneas)
- **Métrica**: cualquier columna presupuestaria que muestre su organización, con su nombre. Empieza en la columna por defecto
- **Excluir valores**: deje fuera algunos valores para centrarse en los demás

Los siete informes presupuestarios también se pueden limitar a un valor de una dimensión, con un filtro por dimensión. Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](reports.md#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas).

---

## Dimensiones analíticas en Plaid

- Plaid puede filtrar y agrupar las líneas OPEX y CAPEX por cualquier dimensión activada.
- Una pregunta sobre la categoría analítica usa la dimensión por defecto, sea cual sea su nombre u orden.
- Plaid solo puede cambiar el valor de una línea en la dimensión por defecto. Defina las demás dimensiones en la aplicación o con un archivo CSV.

---

## Importación/exportación CSV

Cargue o actualice los valores de todas las dimensiones desde un solo archivo. Las dimensiones se crean en la página.

Para definir valores en las líneas de presupuesto desde un archivo, use los archivos CSV de OPEX y CAPEX. En esos archivos, la columna `analytics_category` contiene la dimensión por defecto, y una columna `analytics:<code>` contiene cada una de las demás dimensiones. Consulte [OPEX](opex.md#importacionexportacion-csv) y [CAPEX](capex.md#importacionexportacion-csv).

**Exportar**: haga clic en **Exportar CSV** y después en **Exportar datos**. El archivo lista los valores de todas las dimensiones, activados o desactivados, dimensión por dimensión. Para un archivo vacío solo con los encabezados, use **Descargar plantilla** en el diálogo de importación.

**Estructura CSV**:

- Delimitador: punto y coma `;`
- Codificación: UTF-8 (guarde como "CSV UTF-8" en Excel)
- Encabezados: `axis_code;name;description;status;disabled_at`

| Columna | Contenido |
|---|---|
| `axis_code` | El código de la dimensión del valor, sin distinguir mayúsculas y minúsculas. Vacía significa la dimensión por defecto |
| `name` | Obligatoria. El nombre del valor |
| `description` | Texto libre |
| `status` | `enabled` o `disabled`. Vacía significa `enabled` |
| `disabled_at` | El fin de validez: una fecha (`2026-12-31`) o una fecha y hora completas. Vacía si no hay fin |

Solo `name` es una columna obligatoria. Cuando falta la columna `description`, `status` o `disabled_at`, los valores existentes conservan lo que tienen almacenado para ella, y los valores nuevos quedan activados y sin descripción. Un archivo sin `axis_code` coloca todas las filas en la dimensión por defecto.

**Importar**:

1. Haga clic en **Importar CSV** en la página
2. Elija su archivo
3. Haga clic en **Verificación previa**. El informe indica el número de filas, los valores que se crearán y actualizarán, y las filas que no cambian nada
4. Si la verificación previa no muestra errores, haga clic en **Cargar**

**Cómo funciona la importación**:

- **Todo el archivo se comprueba antes de escribir nada.** Un archivo con cualquier error no carga nada: corrija las filas y vuelva a ejecutar la verificación previa.
- **Emparejamiento por dimensión y nombre**: una fila cuyo nombre existe en su dimensión actualiza ese valor; cualquier otra fila crea uno. Cada celda sustituye el valor almacenado, de modo que una `description` vacía lo borra. Un nombre escrito con otras mayúsculas encuentra el valor almacenado y no le cambia el nombre. Para cambiar el nombre de un valor, hágalo en la página.
- **Filas sin cambios**: una fila idéntica al valor almacenado no cambia nada. Exportar e importar el mismo archivo indica todas las filas como sin cambios.
- **Dimensiones desactivadas**: una fila de una dimensión desactivada se acepta cuando no cambia nada, de modo que un archivo exportado se importa tal cual. Una fila que crearía o cambiaría un valor en ella se rechaza.
- **Los valores que faltan en el archivo** se dejan como están. La importación nunca elimina.

**Errores frecuentes**:

- **"Unknown dimension '...'."**: la celda `axis_code` no corresponde a ninguna dimensión. Compruebe el código en el espacio de trabajo de la dimensión, o cree antes la dimensión.
- **"The ... dimension is disabled. Enable it or leave it out."**: una fila crea o cambia un valor en una dimensión desactivada. Active la dimensión o quite la fila.
- **"... is already on row N."**: dos filas llevan el mismo nombre para la misma dimensión. Conserve una.
- **"Invalid status '...'. Use 'enabled' or 'disabled'."**: corrija la celda `status`.
- **"Header mismatch"**: descargue una plantilla nueva.

---

## Permisos

| Nivel | Qué permite |
|---|---|
| `analytics:reader` | Ver la página Dimensiones analíticas y abrir las dimensiones y los valores |
| `analytics:member` | Crear dimensiones y valores, y editarlos |
| `analytics:admin` | Todo lo anterior, más la importación y exportación CSV y la eliminación |

El rol integrado Administrador de presupuesto es admin, Miembro de presupuesto es member y Lector de presupuesto es reader. Cualquier persona que pueda leer OPEX, CAPEX o los informes ve las dimensiones y sus valores en las líneas de presupuesto, en las listas y en los informes, sin acceso a esta página.

---

## Consejos

- **Manténgalo simple**: unas pocas dimensiones con 5 a 10 valores amplios cada una suelen revelar más que docenas de valores detallados.
- **Una pregunta por dimensión**: cada dimensión debe responder a una pregunta sobre el gasto, como "¿qué tipo de gasto es?" o "¿a qué programa sirve?".
- **Documente con descripciones**: una breve descripción ayuda mucho a un uso coherente entre equipos.
- **Deje huecos cuando haga falta**: "Sin asignar" es un estado válido. Evite valores genéricos y vagos solo para llenar el hueco.
- **Desactive, no elimine**: retirar un valor mantiene la exactitud de los informes.
- **Use los informes para afinar**: ejecute de vez en cuando el informe Dimensiones analíticas. Si un valor recoge demasiado o demasiado poco gasto, divídalo o fusiónelo.

---

## Preguntas frecuentes

**¿Puede una línea tener varios valores analíticos?**
Sí, uno por dimensión. Una línea puede ser **Licenses** en Nature y **Workplace** en Program. Dentro de una dimensión, una línea tiene un valor o ninguno.

**¿Afectan las dimensiones analíticas a las asignaciones o a la contabilidad?**
No. Solo sirven para los informes y no tienen ningún efecto en las asignaciones de costes ni en la contabilidad formal.

**¿Cuántos valores debo crear?**
Empiece con 5 a 10 por dimensión. Más de 20 suele significar que la dimensión intenta responder a demasiadas preguntas: divídala en dos dimensiones.

**¿Cuál es la diferencia entre dimensiones analíticas, departamentos y centros de coste?**
Los **departamentos** son unidades organizativas formales con criterios de asignación precisos. Los **centros de coste** indican quién es responsable del gasto y responde de él. Las **dimensiones analíticas** son clasificaciones libres y opcionales para los informes, sin asignación ni responsabilidad asociadas.

**¿Por qué algunas líneas muestran "Sin asignar"?**
En el informe Dimensiones analíticas, las líneas sin valor en la dimensión elegida aparecen como "Sin asignar". Es lo esperado: los valores son opcionales.

**¿Qué ocurre con las líneas cuando cambio el nombre de un valor o de una dimensión?**
Nada cambia en las líneas. Las listas y los informes muestran el nuevo nombre de inmediato.
