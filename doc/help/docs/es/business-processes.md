# Procesos de negocio

Los Procesos de negocio le permiten construir y mantener un catálogo centralizado de los procesos centrales de extremo a extremo de su organización, como Pedido a cobro, Compra a pago o Contratación a jubilación. Al mantener nombres de procesos, sus tipos, sus responsables y su jerarquía en un solo lugar, crea un punto de referencia único al que el resto de KANAP puede vincularse para propiedad, informes y auditorías.

## Primeros pasos

Navegue a **Datos maestros > Procesos de negocio** para abrir la lista.

**Campos obligatorios**:

- **Nombre**: el nombre del proceso, idealmente incluyendo un código corto (p. ej., "Pedido a cobro (O2C)").

**Permisos**:

- Ver: `business_processes:reader`
- Crear / editar: `business_processes:member`
- Eliminar, importar y exportar: `business_processes:admin`

Si la página no aparece o los campos son de solo lectura, solicite a su administrador del espacio de trabajo que ajuste sus permisos de rol.

---

## Trabajar con la lista

La lista muestra todos los procesos de negocio de su espacio de trabajo.

**Columnas predeterminadas**:

- **Nombre**: el nombre del proceso. Haga clic para abrir el espacio de trabajo. Sangrado por nivel cuando la lista está en el orden del árbol.
- **Tipo**: **Estratégico**, **Operativo** o **Apoyo**, o vacío.
- **Proceso padre**: el proceso bajo el que se encuentra, o vacío para un proceso de primer nivel.
- **Responsable del proceso**: el usuario responsable del proceso.

**Columnas adicionales** (ocultas por defecto; actívelas con el selector de columnas):

- **Estado**: `habilitado` o `deshabilitado`.
- **Actualizado**: cuándo se modificó el proceso por última vez.

**Filtrado y ordenación**:

- La búsqueda rápida filtra en todas las columnas visibles.
- Use el selector **Mostrar: Todos / Activos / Desactivados** sobre la lista para elegir qué procesos aparecen. La lista muestra por defecto los procesos activados.
- **Tipo** y **Proceso padre** usan filtros con casillas. El filtro del padre lista los procesos que tienen subprocesos.
- La lista se abre en el orden del árbol: cada proceso va seguido de sus subprocesos. Haga clic en un encabezado de columna para ordenar por esa columna. El sangrado solo aparece en el orden del árbol.

**Acciones** (barra de herramientas superior derecha):

- **Nuevo** (`business_processes:member`): crear un nuevo proceso de negocio. Consulte [Crear un proceso de negocio](#creating-a-business-process).
- **Importar** (Admin): importación masiva de procesos desde un archivo CSV o un libro de Excel.
- **Exportar** (Admin): exportar los procesos que muestra la lista, o todos los procesos, a un archivo CSV o un libro de Excel.
- **Eliminar seleccionados** (Admin): eliminar una o más filas seleccionadas. Un proceso que usan aplicaciones o interfaces no se puede eliminar: desactívelo en su lugar. Un proceso que tiene subprocesos tampoco se puede eliminar: muévalos o elimínelos primero. Antes de eliminar nada, la confirmación lista los procesos que se conservan, con el motivo. Las solicitudes vinculadas a un proceso eliminado se conservan, sin el vínculo.

---

## Crear un proceso de negocio { #creating-a-business-process }

1. Haga clic en **Nuevo** en la lista. La página del proceso se abre con un título vacío en el encabezado. El resto de la página aparece atenuado.
2. Escriba el nombre del proceso, idealmente con su código corto (p. ej., "Order-to-Cash (O2C)").
3. Pulse Intro o haga clic fuera del título. KANAP crea el proceso de inmediato, activado, y se abren todas las pestañas.

Pulse Escape en el título vacío para salir sin crear nada. Dos procesos no pueden tener el mismo nombre, sin distinguir mayúsculas de minúsculas: un nombre ya usado se rechaza, con un mensaje bajo el título.

Mientras el proceso se está creando, su encabezado muestra **Crear** y **Cancelar**. Permanecen hasta que salga del proceso.

- **Crear** conserva el proceso y lo cierra. Vuelve al punto de partida: la lista o la pantalla anterior. Con el título vacío, no se cierra nada y el título pide uno.
- **Cancelar** cierra sin conservar nada. En un proceso ya creado, lo elimina, con los vínculos a aplicaciones que haya añadido. Si introdujo algo más que el nombre, una confirmación enumera lo que se eliminará. Puede cancelar su propia creación sin el derecho a eliminar procesos.

Si sale del proceso de otra forma, este se conserva.

---

## El espacio de trabajo de Procesos de negocio

Haga clic en cualquier fila de la lista para abrir el espacio de trabajo. Cada cambio se guarda solo: una lista o un selector cuando elige un valor, un texto cuando sale de él. **Guardado** aparece un momento en el encabezado.

El encabezado contiene:

- **Procesos de negocio** (flecha de retroceso): volver a la lista, manteniendo sus filtros y su ordenación.
- El **nombre**: haga clic en él para renombrar el proceso.
- Las flechas **anterior / siguiente**: recorrer los procesos en el orden actual de la lista.
- **Estado**: **Activado** o **Desactivado**. Los procesos activados aparecen en los selectores de toda la aplicación. Desactive un proceso para retirarlo sin eliminarlo, para que las referencias históricas permanezcan intactas.
- **Eliminar** (icono de papelera, Admin): eliminar el proceso y volver a la lista. Un proceso que usan aplicaciones o interfaces no se puede eliminar: el mensaje los cuenta. Desactívelo en su lugar. Un proceso que tiene subprocesos tampoco se puede eliminar: el mensaje los cuenta. Muévalos o elimínelos primero.

Sin `business_processes:member`, la página se abre en solo lectura.

### Propiedades

El panel de propiedades, a la derecha, contiene:

- **Tipo**: el tipo de proceso ISO 9001, opcional. Un proceso **Estratégico** orienta y dirige la organización. Un proceso **Operativo** aporta valor a los clientes. Un proceso de **Apoyo** proporciona recursos a los demás. Un subproceso no hereda el tipo de su padre.
- **Proceso padre**: el proceso bajo el que se encuentra este. Los procesos forman un árbol sin límite de profundidad. El selector muestra el árbol con sangría y busca en la ruta completa. El propio proceso y sus subprocesos no se ofrecen. Déjelo vacío para el primer nivel. Un proceso no puede ser su propio padre ni pasar bajo uno de sus propios subprocesos.
- **Responsable del proceso**: el usuario responsable último del proceso. Se muestra en la lista.
- **Responsable IT**: el usuario responsable de los sistemas y herramientas IT que respaldan el proceso.
- **Ciclo de vida**: el interruptor de estado y la fecha de fin de validez. Un proceso cuyo fin de validez ha pasado queda desactivado.

### Vista general

- **Descripción**: lo que cubre el proceso, idealmente desde su inicio hasta su punto final (p. ej., "Desde el pedido del cliente hasta la entrega, la facturación y el cobro").
- **Notas**: información interna como enlaces a mapas de procesos, procedimientos, notas de alcance o planes de mejora.

### Relaciones

La sección **Aplicaciones** lista las aplicaciones que respaldan el proceso, con su referencia, su criticidad y su responsable IT. **Añadir** abre una búsqueda; un vínculo se guarda al instante. Pase el ratón por una fila y haga clic en su cruz para quitar el vínculo. La aplicación muestra el mismo vínculo en la sección **Procesos de negocio** de su pestaña Relaciones.

Necesita `business_processes:member` para cambiar los vínculos. La pestaña solo aparece si puede leer las aplicaciones. Un Business Contributor solo ve y vincula las aplicaciones de su ámbito.

### Historial

Los cambios del proceso, como su tipo o su padre, y de sus vínculos con aplicaciones. Vea [Historial de los registros](record-history.md).

---

## Importación/exportación CSV

La exportación escribe un archivo CSV o un libro de Excel (`.xlsx`): elija en **Formato** en el diálogo. La importación lee los dos. Consulte [Archivos CSV y Excel](csv-files.md).

Utilice la importación y exportación para la incorporación masiva o edición fuera de línea de su catálogo de procesos. Ambas requieren acceso **Admin**.

### Exportar

Haga clic en **Exportar** en la página de la lista. El archivo contiene los procesos que muestra la lista, con su búsqueda, sus filtros y su orden, o todos los procesos si elige **Todo el registro** en el diálogo. Para un archivo vacío solo con los encabezados, use **Descargar plantilla** en el diálogo de importación.

El separador sigue el idioma de su pantalla. Consulte [Archivos CSV y Excel](csv-files.md) para la codificación, el separador y los dos pasos de importación.

**Columnas**: `name`, `process_type`, `parent_name`, `description`, `notes`, `status`.

- `process_type`: `management`, `core` o `support`, o vacío.
- `parent_name`: el nombre del proceso padre, o vacío para el primer nivel.

### Importar

Haga clic en **Importar** en la página de la lista, luego:

1. Suba su archivo CSV o su libro de Excel con los títulos de columna de la plantilla. En un archivo CSV, funcionan tanto las comas como los puntos y coma.
2. Ejecute la **Verificación previa**: valida encabezados y datos, y muestra cuántas filas se crearán vs. actualizarán.
3. Si la verificación previa es correcta, haga clic en **Cargar** para aplicar los cambios.

**Reglas de coincidencia**:

- Las filas se emparejan por **Nombre**, sin distinguir mayúsculas y minúsculas. Un nombre coincidente actualiza el proceso existente y conserva la grafía guardada (la verificación previa indica con qué proceso se asoció la fila); un nombre nuevo crea un proceso nuevo.
- `parent_name` se empareja por nombre, sin distinguir mayúsculas y minúsculas: un proceso del mismo archivo o uno que ya existe en KANAP. Si existen ambos, prevalece el archivo. Las filas pueden ir en cualquier orden: los padres se crean antes que sus hijos.
- Un nombre de padre desconocido, un proceso bajo sí mismo o un bucle se rechazan, con el número de fila.
- El archivo no tiene columna de fin de validez. En una actualización, un `status` vacío, o igual al estado actual del proceso, conserva su fin de validez. Un estado distinto se aplica: `enabled` borra el fin de validez, y `disabled` termina el proceso hoy, salvo que su fin de validez ya haya pasado. Un proceso nuevo está habilitado salvo que la fila indique `disabled`.

**Consejo**: exporte sus datos actuales primero, modifique el archivo y vuelva a importar. Esto evita duplicados accidentales y garantiza que esté trabajando desde el estado más reciente.

---

## Consejos

- **Convención de nomenclatura**: siga el formato "Nombre descriptivo (CÓDIGO)" (p. ej., "Pedido a cobro (O2C)") para que los procesos sean fáciles de buscar y reconocibles de un vistazo.
- **Retire, no elimine**: desactive los procesos que ya no utilice en lugar de eliminarlos. Esto preserva las referencias históricas y los registros de auditoría.
- **Responsable del proceso desde el principio**: asignar un responsable del proceso ahora significa que los datos de propiedad ya están en su lugar cuando futuras funcionalidades como notificaciones y enrutamiento de tareas entren en funcionamiento.
