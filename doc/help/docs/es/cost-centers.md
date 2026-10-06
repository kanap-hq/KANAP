# Centros de coste

Un centro de coste indica quién es responsable de una línea de presupuesto: el equipo o la unidad que responde del gasto. Cada línea OPEX y CAPEX puede llevar un centro de coste. Los centros de coste se organizan en un árbol de grupos, de modo que puede leer el presupuesto de toda una división con la misma facilidad que el de un solo equipo.

## En qué se diferencian los centros de coste de otros datos maestros

| Datos maestros | Qué responde | En una línea de presupuesto |
|---|---|---|
| **Empresas** | Qué entidad jurídica paga | La **Empresa pagadora** |
| **Departamentos** | Qué unidades de una empresa consumen TI, con su plantilla | Usados por las asignaciones y el contracargo |
| **Centros de coste** | Quién es responsable del gasto y responde de él | El **Centro de coste** |
| **Dimensiones analíticas** | Clasificaciones libres para los informes | Un campo por dimensión, por ejemplo **Nature** |

Un departamento pertenece a una sola empresa y determina las asignaciones mediante su plantilla. Un centro de coste lleva un código, una empresa, un responsable del presupuesto y un lugar en un árbol, y los grupos de centros de coste pueden abarcar varias empresas. Los centros de coste no modifican las asignaciones ni el contracargo.

---

## Grupos y centros de coste

El árbol contiene dos tipos de elementos:

- **Grupo**: contiene centros de coste y otros grupos. Un grupo no tiene empresa, por lo que puede reunir centros de coste de varias empresas. Un grupo no se puede asignar a una línea de presupuesto.
- **Centro de coste**: pertenece a una empresa y no tiene elementos hijos. Solo los centros de coste se asignan a las líneas de presupuesto.

Ambos tipos pueden situarse en el nivel superior, sin elemento superior. Por ejemplo:

```
IT division (group)
  Infrastructure (group)
    IT-100  Data centers        Company A
    IT-110  Network             Company B
  IT-200  Business applications  Company A
IT-300  Workplace               Company B
```

Aquí el grupo **IT division** reúne centros de coste de dos empresas. Filtrar un informe por este grupo abarca IT-100, IT-110 e IT-200.

---

## Primeros pasos

Navegue a **Datos maestros > Centros de coste** (en la sección **Organización**) para abrir la lista. Haga clic en **Nuevo** para crear su primer elemento.

**Campos obligatorios**:

- **Código**: el código que usa su equipo de finanzas
- **Nombre**: el nombre con el que se conoce
- **Tipo**: **Grupo** o **Centro de coste**
- **Empresa**: solo para un centro de coste

**Opcional pero útil**:

- **Grupo superior**: su lugar en el árbol. Déjelo vacío para el nivel superior
- **Responsable del presupuesto**: la persona que rinde cuentas de esta partida presupuestaria en la revisión del presupuesto. Cada línea OPEX y CAPEX del centro de coste muestra a esta persona
- **Descripción**: lo que abarca el centro de coste

**Consejo**: Si su equipo de finanzas ya mantiene la lista de centros de coste, impórtela desde un archivo CSV. Las filas pueden venir en cualquier orden.

---

## Trabajar con la lista

Cuando el espacio de trabajo aún no tiene ningún centro de coste, una línea bajo el título lo indica: "Los centros de coste indican quién es responsable de cada línea de presupuesto. Cree uno o importe un archivo."

**Columnas**:

- **Código**: el código del centro de coste
- **Nombre**: con sangría por nivel cuando la lista está en orden de árbol
- **Tipo**: **Grupo** o **Centro de coste**
- **Superior**: el grupo al que pertenece
- **Empresa**: la empresa de un centro de coste (vacía para un grupo)
- **Responsable del presupuesto**: la persona que rinde cuentas del presupuesto del centro de coste
- **Estado**: **Activado** o **Desactivado** (oculta por defecto, añádala desde el selector de columnas)

Haga clic en cualquier celda para abrir el espacio de trabajo.

**Ordenación**: La lista se abre en orden de árbol: cada grupo va seguido de lo que contiene. Haga clic en el encabezado de una columna para ordenar por esa columna. La sangría solo se muestra en orden de árbol.

**Filtrado**:

- **Búsqueda rápida**: busca en el código, el nombre y la ruta completa. Buscar el nombre de un grupo también encuentra todo lo que contiene
- **Filtros de columna**: **Tipo**, **Superior**, **Empresa** y **Estado** usan filtros de casillas. Si hace clic en **Limpiar** en el filtro **Estado**, o desmarca ambos valores, la lista no muestra nada, sea cual sea la opción de **Mostrar**
- **Ámbito de estado**: el selector **Mostrar: Todos / Activos / Desactivados** sobre la lista. La lista muestra por defecto los elementos activados

**Acciones**:

- **Nuevo**: crear un grupo o un centro de coste (requiere `cost_centers:member`)
- **Importar CSV**: cargar el árbol desde un archivo (requiere `cost_centers:admin`)
- **Exportar CSV**: descargar todos los elementos (requiere `cost_centers:admin`)
- **Eliminar selección**: eliminar los elementos seleccionados (requiere `cost_centers:admin`). Los elementos que no se pueden eliminar se conservan y se listan con el motivo. El contenido se elimina antes que su grupo, de modo que seleccionar un grupo junto con todo lo que contiene lo elimina todo

---

## Crear un centro de coste

Haga clic en **Nuevo**. Complete los campos y haga clic en **Crear**. Un elemento nuevo está activado.

El **Tipo** empieza en **Centro de coste**. Elija **Grupo** para crear un grupo: el campo **Empresa** desaparece entonces.

Tras **Crear**, se abre el espacio de trabajo del nuevo elemento.

---

## El espacio de trabajo del centro de coste

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo.

- **Encabezado**: el código como referencia, con un botón para copiarlo, y el nombre. Haga clic en el nombre para cambiarlo. **Ant.** / **Sig.** recorren la lista en su orden y con sus filtros actuales, y el botón de cierre vuelve a la lista
- **Zona principal**: una línea como "Usado por 3 líneas OPEX y 1 línea CAPEX." cuando hay líneas de presupuesto que usan el elemento, y después la **Descripción**
- **Panel Propiedades** a la derecha: **Código**, **Tipo**, **Grupo superior**, **Empresa** (solo centros de coste), **Responsable del presupuesto** y **Ciclo de vida**

**Guardado automático**: Cada cambio se guarda por sí solo. No hay botón Guardar. Los campos de texto se guardan al salir de ellos (pulse Intro en **Código** para guardar de inmediato); las listas y los interruptores se guardan en cuanto elige un valor. Puede seguir trabajando mientras se guarda un cambio. Cuando se rechaza un cambio, el motivo aparece bajo el campo que lo causó, por ejemplo un código duplicado bajo **Código**. Un nombre rechazado se muestra en la parte superior de la página.

### Campos

| Campo | Qué introducir | Dónde encontrar este valor |
|---|---|---|
| **Código** | Hasta 50 caracteres. Los códigos son únicos sin distinguir mayúsculas y minúsculas: `IT-100` e `it-100` son el mismo código | El código que usa su equipo de finanzas para este centro de coste, tal como figura en su sistema contable o su referencial presupuestario |
| **Nombre** | Hasta 200 caracteres | El nombre usado en sus revisiones presupuestarias |
| **Tipo** | **Grupo** o **Centro de coste** | Un grupo reúne; un centro de coste se asigna a las líneas de presupuesto |
| **Grupo superior** | Un grupo, o vacío para el nivel superior. Un elemento no puede moverse bajo sí mismo ni bajo algo que contiene, por lo que estos no aparecen en la lista | Su organigrama o el árbol de centros de coste de su equipo de finanzas |
| **Empresa** | Una empresa activada. Solo centros de coste | La entidad jurídica que paga los costes de este centro de coste. Es una de sus empresas en **Datos maestros > Empresas** |
| **Responsable del presupuesto** | Un usuario activo | La persona que rinde cuentas de esta partida presupuestaria en la revisión del presupuesto. La indicación bajo el campo lo recuerda |
| **Ciclo de vida** | El interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez** | Indique una fecha futura para programar el fin, o desactive el interruptor para desactivarlo hoy |

### Responsable del presupuesto en las líneas de presupuesto

Cada línea OPEX y CAPEX con un centro de coste muestra el responsable del presupuesto de ese centro de coste en su barra de metadatos, después de **Responsable de TI** y **Responsable de negocio**. Pase el cursor por encima para ver de qué centro de coste procede.

- **Leído del centro de coste**: el responsable del presupuesto no se almacena en la línea. Cámbielo aquí y cada línea del centro de coste muestra de inmediato a la nueva persona. Solo cambia en una línea cuando usted cambia el centro de coste de la línea.
- **Solo se muestra si está definido**: una línea sin centro de coste, o cuyo centro de coste no tiene responsable del presupuesto, no muestra nada.
- **Un rol distinto**: el **Responsable de TI** y el **Responsable de negocio** de una línea se mantienen tal cual, definidos en cada línea. También cubren los espacios de trabajo que no usan centros de coste.
- **En las listas**: las listas OPEX y CAPEX tienen una columna **Responsable del presupuesto**, oculta por defecto, con un filtro de casillas.

### Cambiar el tipo

- **De centro de coste a grupo**: se quita la empresa. Se rechaza mientras haya líneas de presupuesto que usen el centro de coste.
- **De grupo a centro de coste**: elija **Centro de coste** en **Tipo** y después elija la empresa. El cambio se guarda una vez definida la empresa. Un grupo que contiene elementos no puede convertirse en centro de coste, por lo que **Tipo** no lo ofrece.

### Eliminar

El botón **Eliminar** del encabezado elimina el elemento de inmediato (requiere `cost_centers:admin`). Está desactivado, con el motivo en una línea, cuando hay líneas de presupuesto que usan el centro de coste (por ejemplo "Usado por 3 líneas OPEX. Desactívelo en su lugar.") o cuando el grupo aún contiene elementos (por ejemplo "Contiene 2 elementos."). En su lugar, desactive el elemento: se mantiene en sus líneas y en los informes.

---

## Reglas que encontrará

- **Un centro de coste usado por líneas de presupuesto no puede convertirse en grupo ni eliminarse.** Desactívelo en su lugar. El mensaje indica las líneas, por ejemplo "IT-300 is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."
- **Un grupo que contiene elementos no puede eliminarse ni convertirse en centro de coste.** Mueva o elimine antes su contenido. El mensaje indica el número, por ejemplo "Infrastructure still contains 4 nodes. Move or delete them first."
- **Solo un grupo puede ser superior.** Un centro de coste no tiene elementos hijos.
- **Sin bucles.** Un grupo no puede moverse bajo sí mismo ni bajo uno de sus propios grupos.
- **Los elementos desactivados se quedan donde están.** Un centro de coste desactivado se mantiene en las líneas de presupuesto que ya lo tienen y sigue contando en los informes. En los selectores aparece marcado como **Desactivado** y no se puede elegir para una línea nueva. Desactivar un grupo no cambia lo que contiene, y un grupo desactivado todavía puede recibir elementos.
- **Los códigos son únicos sin distinguir mayúsculas y minúsculas.** Un código duplicado se rechaza: "A cost center with code IT-100 already exists."
- **Cambiar un código conserva las líneas.** Las líneas de presupuesto apuntan al propio centro de coste, de modo que un código nuevo no cambia nada en ellas. Tras el cambio, las listas y los informes muestran el nuevo código. El cambio queda registrado en el registro de auditoría.
- **No se puede elegir una empresa desactivada ni un usuario inactivo** para un centro de coste.
- **No se puede eliminar una empresa a la que pertenecen centros de coste.** Cambie su empresa o desactive la empresa en su lugar.

---

## Centros de coste en las líneas de presupuesto

- **OPEX y CAPEX**: el campo **Centro de coste** del panel **Propiedades** muestra el árbol. Los grupos se muestran para ayudarle a orientarse y no se pueden elegir. Cuando crea una línea y la empresa pagadora está vacía, elegir un centro de coste la completa con la empresa del centro de coste, y la empresa sigue al centro de coste hasta que usted elija una empresa o una cuenta. Cuando las dos empresas difieren, se conservan ambas y una indicación lo señala. Consulte [OPEX](opex.md) y [CAPEX](capex.md).
- **Listas**: las columnas y filtros **Centro de coste** y **Run o build** de las listas OPEX y CAPEX.
- **Informes**: los informes presupuestarios se pueden filtrar por un centro de coste o un grupo. Consulte [Filtros de centro de coste, de Run o build y de dimensiones analíticas](reports.md#filtros-de-centro-de-coste-de-run-o-build-y-de-dimensiones-analiticas).

---

## Importación/exportación CSV

Cargue o actualice todo el árbol desde un archivo.

**Exportar**: haga clic en **Exportar CSV** y después en **Exportar datos**. El archivo lista todos los elementos, activados o desactivados, en orden de árbol. Para un archivo vacío solo con los encabezados, use **Descargar plantilla** en el diálogo de importación.

**Estructura CSV**:

- Encabezados: `code`, `kind`, `name`, `parent_code`, `company_name`, `owner_email`, `description`, `status`, `disabled_at`
- La exportación escribe el separador del idioma de la pantalla. Consulte [Archivos CSV](csv-files.md) para la codificación, el separador, los formatos de fecha y los dos pasos de importación

| Columna | Contenido |
|---|---|
| `code` | Obligatoria. El código del elemento. Las filas se emparejan con los elementos existentes por código, sin distinguir mayúsculas y minúsculas |
| `kind` | Obligatoria. `group` o `cost_center` |
| `name` | Obligatoria |
| `parent_code` | El código del grupo superior, del mismo archivo o ya existente en KANAP. Vacía para el nivel superior |
| `company_name` | Obligatoria para un `cost_center`, vacía para un `group`. Se empareja por nombre de empresa, sin distinguir mayúsculas y minúsculas |
| `owner_email` | El correo electrónico del responsable del presupuesto, un usuario activo. Vacía para ningún responsable del presupuesto |
| `description` | Texto libre |
| `status` | `enabled` o `disabled`. Vacía significa `enabled` para un nodo nuevo y conserva el estado guardado en una actualización |
| `disabled_at` | Columna opcional. El fin de validez: una fecha (`2026-12-31`) o una fecha y hora completas. Vacía si no hay fin. En una actualización, un `status` vacío y un `disabled_at` vacío conservan los valores guardados. `enabled` con una fecha vacía borra el fin de validez. `disabled` con una fecha vacía conserva una fecha ya pasada y, si no, termina el nodo hoy |

**Importar**:

1. Haga clic en **Importar CSV** en la lista
2. Elija su archivo
3. Haga clic en **Verificación previa**. El informe indica el número de filas, los elementos que se crearán y actualizarán, y las filas que no cambian nada
4. Si la verificación previa no muestra errores, haga clic en **Cargar**

**Cómo funciona la importación**:

- **Filas en cualquier orden**: un elemento hijo puede aparecer antes que su grupo superior. Los superiores se resuelven con todo el archivo y con los elementos ya existentes en KANAP.
- **Todo el archivo se comprueba antes de escribir nada**: cada fila, después los superiores y después las reglas del árbol (un centro de coste tiene empresa, un grupo no, solo los grupos son superiores, sin bucles, un centro de coste usado por líneas sigue siendo centro de coste). Un archivo con cualquier error no carga nada: corrija las filas y vuelva a ejecutar la verificación previa. Cada error indica su fila con el número de línea del archivo tal como lo muestra un editor de texto, incluidas las líneas vacías y las celdas que ocupan varias líneas.
- **Emparejamiento por código**: una fila cuyo código existe actualiza ese elemento; cualquier otra fila crea uno. Cada celda sustituye el valor almacenado, de modo que un `owner_email` o una `description` vacíos lo borran.
- **Filas sin cambios**: una fila idéntica al elemento almacenado no cambia nada. Exportar e importar el mismo archivo indica todas las filas como sin cambios.
- **Los elementos que faltan en el archivo** se dejan como están. La importación nunca elimina.

**Errores frecuentes**:

- **"Unknown company '...'"**: cree la empresa en **Datos maestros > Empresas** o corrija el nombre.
- **"Unknown parent code '...'"**: añada el grupo superior al archivo o corrija el código.
- **"Unknown budget holder email '...'."** o **"Budget holder '...' is not an active user."**: la celda `owner_email` designa al responsable del presupuesto. Use el correo electrónico de un usuario activo o deje la celda vacía.
- **"Code ... is already used on row N."**: dos filas llevan el mismo código. Conserve una.
- **"Type must be 'group' or 'cost_center'."**: corrija la celda `kind`.
- **"Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again."**: la fila está activada con una fecha ya pasada. Un archivo exportado antes de esa fecha todavía indica `enabled`: vuelva a exportar o corrija la celda.
- **"Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."**: la fila está desactivada con una fecha aún por llegar. Corrija la celda `status` o `disabled_at`.
- **"Header mismatch"**: descargue una plantilla nueva.

---

## Permisos

| Nivel | Qué permite |
|---|---|
| `cost_centers:reader` | Ver la lista y abrir los centros de coste |
| `cost_centers:member` | Crear centros de coste y grupos, y editarlos |
| `cost_centers:admin` | Todo lo anterior, más la importación y exportación CSV y la eliminación |

Cada rol empieza con el nivel que tiene en departamentos, salvo el rol integrado Administrador de presupuesto, que recibe admin. Así, Administrador de presupuesto y Administrador de datos maestros son administradores, Miembro de presupuesto y Miembro de datos maestros son miembros, y los roles de lectura pueden leer. Cualquier persona que pueda leer OPEX, CAPEX o los informes puede elegir un centro de coste en una línea o en un filtro de informe sin acceso a esta página.

---

## Consejos

- **Refleje su referencial financiero**: use los mismos códigos que su sistema contable para que las líneas de presupuesto y el realizado coincidan.
- **Agrupe por responsabilidad**: construya los grupos en torno a las personas que responden del presupuesto, entre varias empresas si es necesario.
- **Desactive, no elimine**: cuando un centro de coste se cierre, desactívelo. Sus líneas lo conservan y los informes siguen siendo coherentes.
- **Nombre un responsable del presupuesto**: un responsable del presupuesto en cada centro de coste aparece en cada una de sus líneas, para que todos sepan a quién preguntar por una línea.
