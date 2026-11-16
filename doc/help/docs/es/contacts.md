# Contactos

Los Contactos documentan las personas con las que trabaja: gestores de cuenta de proveedores, ingenieros de soporte, consultores y otras partes interesadas externas. Vincule contactos a proveedores para crear un directorio de contactos de proveedores, y referencíelos desde aplicaciones y ubicaciones para información de soporte.

## Primeros pasos

Navegue a **Datos maestros > Contactos** para ver su directorio de contactos. Haga clic en **Nuevo** para crear su primera entrada.

**Campos obligatorios**:
- **Correo electrónico**: La dirección de correo del contacto (se usa como identificador único)

**Muy recomendados**:
- **Nombre** / **Apellido**: El nombre del contacto
- **Proveedor**: Para qué proveedor trabaja este contacto
- **Tipo de contacto**: El rol del contacto en el proveedor (Comercial, Técnico, Soporte u Otro). Elegir un proveedor lo fija en Comercial; cámbielo si es necesario.

**Opcionales pero útiles**:
- **Puesto de trabajo**: Su cargo o posición
- **Teléfono** / **Móvil**: Números de teléfono, introducidos con un código de país
- **País**: Ubicación (código de país ISO)

**Consejo**: Vincule primero los contactos a los proveedores, luego referencíelos desde aplicaciones y ubicaciones para información de soporte consistente.

---

## Trabajar con la lista

La cuadrícula de Contactos proporciona un directorio buscable de todos los contactos externos. Cada celda de una fila es un enlace clicable que abre la página del contacto.

**Columnas predeterminadas**:
- **Referencia**: La referencia que asigna Kadratis (`CTCT-3`)
- **Apellido** / **Nombre**: Nombre del contacto
- **Proveedor**: El proveedor para el que trabaja
- **Correo electrónico**: Dirección de correo
- **Activo**: Si el contacto está actualmente activo (Sí / No)

**Columnas adicionales** (mediante el selector de columnas):
- **Puesto de trabajo**: Su cargo
- **Teléfono** / **Móvil**: Números de teléfono
- **País**: Ubicación
- **Creado**: Cuándo se creó el registro

**Ordenación predeterminada**: Por apellido, alfabético.

**Búsqueda rápida**: escriba una referencia, como `CTCT-3`, para encontrar ese contacto. Las cifras solas buscan en el texto.

**Filtros de columna**: el filtro **Referencia** acepta `CTCT-3` o `3`.

**Acciones**:
- **Nuevo**: Crear un nuevo contacto (requiere `contacts:member`)
- **Importar**: Importación masiva de contactos (requiere `contacts:admin`)
- **Exportar**: Exportar a un archivo CSV o un libro de Excel (requiere `contacts:admin`)
- **Eliminar seleccionados**: Eliminar los contactos seleccionados (requiere `contacts:admin`). Se quitan de los proveedores, líneas presupuestarias, contratos, aplicaciones, activos, ubicaciones, proyectos y solicitudes que los mencionan; esos elementos se conservan

---

## La página del contacto

Haga clic en una fila para abrir la página del contacto. Cada cambio se guarda solo: no hay botón de guardar. El botón **Historial** de la cabecera abre el historial del contacto en un panel lateral. Vea [Historial de los registros](record-history.md).

**Título**: el nombre del contacto. Haga clic en él para editar el nombre y el apellido uno al lado del otro; el cambio se guarda al salir de los dos campos o al pulsar Intro, y Escape lo cancela. Un contacto sin nombre muestra su correo electrónico en su lugar.

**Referencia**: la referencia del contacto (`CTCT-4`) aparece antes del nombre. Haga clic en ella para copiarla.

**Dirección de la página**: la dirección de la página usa la referencia, por ejemplo `/master-data/contacts/CTCT-4/overview`. La dirección anterior de la página de un contacto la sigue abriendo y se sustituye por la nueva.

**Encabezado**, bajo el nombre:
- **Proveedor**: el proveedor para el que trabaja este contacto, como enlace a su página. Un contacto sin proveedor muestra **Sin proveedor**: haga clic para abrir las propiedades y elegir uno.
- **Tipo de contacto**: el rol del contacto en el proveedor: Comercial, Técnico, Soporte u Otro. Haga clic para elegir otro. Aparece en cuanto el contacto tiene un proveedor.
- **Estado**: **Activo** o **Inactivo**. Haga clic para cambiarlo.
- **Usado en**: cuántos proveedores, líneas presupuestarias, contratos y otros elementos están vinculados al contacto. Haga clic para ir a la sección **Usado en**.

**Propiedades** (el panel de la derecha, que se abre con su pestaña o la tecla `P`):
- **Proveedor**: elija el proveedor en la lista, o escriba su nombre o su referencia (`SUP-12`). Un contacto con proveedor siempre tiene un tipo de contacto: elegir un proveedor para un contacto sin tipo le da **Comercial**, que puede cambiar enseguida. Quitar el proveedor quita también el tipo de contacto.
- **Tipo de contacto**: la misma elección que en el encabezado.
- **Correo electrónico**: obligatorio y único entre sus contactos.
- **Cargo**: su rol o puesto.
- **Teléfono** / **Móvil**: un prefijo y un número. Elija el prefijo en la lista o escríbalo. Si el contacto aún no tiene país, el prefijo lo establece.
- **País**: lista de países con búsqueda.

Los campos de texto se guardan al salir de ellos o al pulsar Intro, las listas en cuanto elige. Un valor que Kadratis no puede aceptar (un correo no válido o que ya usa otro contacto, un teléfono que no es un prefijo seguido de un número de 7 a 15 dígitos en total) muestra su mensaje bajo el campo y no se guarda.

**Notas**: notas libres (hasta 2.000 caracteres), bajo el encabezado. Se guardan un momento después de dejar de escribir y al salir del campo.

Pulse **Escape** o haga clic en el botón de cerrar para volver a la lista.

**Eliminar**, un icono de papelera arriba a la derecha, se muestra a los administradores de contactos (`contacts:admin`). Tras una confirmación, el contacto se elimina y se quita de los proveedores, líneas presupuestarias, contratos, aplicaciones, activos, ubicaciones, proyectos y solicitudes que lo mencionan; esos elementos se conservan. Vuelve a la lista.

### Usado en

La sección **Usado en**, bajo las notas, lista todo aquello a lo que está vinculado el contacto, una lista por tipo, cada una con su número: proveedores, líneas presupuestarias (OPEX y CAPEX, con su referencia `BL-`), contratos (`CTR-`), aplicaciones, activos, ubicaciones, proyectos (`PRJ-`) y solicitudes (`REQ-`). Cada fila muestra el rol del contacto: el tipo de contacto para proveedores, líneas presupuestarias y contratos, el rol escrito en la aplicación, el activo o la ubicación.

Haga clic en una fila para abrir su página. Una lista muestra hasta 50 elementos e indica cuántos hay en total. Solo ve las listas que tiene permiso para leer. Un contacto sin vínculos muestra una línea que lo indica.

### Crear un contacto

Haga clic en **Nuevo** en la lista. Se abre la página del contacto nuevo. Escriba el nombre y los apellidos uno junto al otro en el encabezado, y después el correo electrónico. El contacto se crea al salir del campo de correo con un correo válido. Los números de teléfono también deben ser válidos. Elegir un proveedor fija el tipo de contacto en **Comercial**, que puede cambiar. Un contacto con proveedor necesita un tipo. Todas sus pestañas quedan entonces disponibles, y los demás campos se guardan automáticamente. Pulse Escape mientras el nombre está vacío para salir sin crear nada.

Mientras el contacto se está creando, el encabezado muestra **Crear** y **Cancelar** hasta que salga de la página. **Crear** conserva el contacto y le lleva de vuelta al punto de partida: la lista, la pantalla anterior o el proveedor desde el que empezó. Si aún falta un campo obligatorio, se marca en su lugar. **Cancelar** sale sin conservar nada. En un contacto ya creado, lo elimina. Si introdujo algo más que lo necesario para crearlo, una confirmación enumera lo que se eliminará. Puede cancelar su propia creación sin el derecho a eliminar contactos. Si sale de la página de otra forma, el contacto se conserva.

---

## Dónde se usan los contactos

Los contactos aparecen en varios lugares de Kadratis. La sección **Usado en** de la página del contacto los lista todos.

### Contactos de proveedor

Cada proveedor tiene una pestaña de **Contactos** que muestra todos los contactos vinculados a ese proveedor. Puede crear un nuevo contacto directamente desde el espacio de trabajo del proveedor:

1. Abra el espacio de trabajo del proveedor y vaya a la pestaña **Contactos**.
2. Haga clic en **Nuevo contacto** junto a un tipo de contacto.
3. Complete los datos del contacto: el proveedor y el tipo de contacto están prerrellenados.
4. Haga clic en **Crear**: vuelve a la pestaña **Contactos** del proveedor.

### Soporte de aplicaciones

En el espacio de trabajo de Aplicaciones, la pestaña **Técnico y soporte** referencia contactos para la escalación del soporte.

### Soporte de tecnologías

En el espacio de trabajo de Tecnologías, la pestaña **Operaciones** lista los contactos de soporte de una tecnología. Consulte [Tecnologías](technologies.md#operaciones). En la sección **Usado en** del contacto, una tecnología retirada aparece al final, marcada como **Desactivado**.

### Contactos de ubicación

Las ubicaciones pueden tener contactos de soporte (gestores de instalaciones, contactos del NOC, etc.).

---

## Importación/exportación CSV

La exportación escribe un archivo CSV o un libro de Excel (`.xlsx`): elija en **Formato** en el diálogo. La importación lee los dos. Consulte [Archivos CSV y Excel](csv-files.md).

Gestione contactos de forma masiva usando archivos CSV o libros de Excel.

**Exportar**: Descarga los contactos que muestra la lista con su referencia y sus detalles. Elija **Todo el registro** en el diálogo para todos los contactos.

**Importar**:
- Utilice la **Verificación previa** para validar antes de aplicar
- Puede crear nuevos contactos o actualizar los existentes
- **Emparejamiento por referencia**: una `reference` rellenada (`CTCT-4` o `4`) designa el contacto que la fila actualiza, aunque su correo electrónico haya cambiado. El contacto toma el nombre y el correo electrónico de la fila. La verificación previa señala cada contacto que cambiará de nombre o de dirección de correo electrónico
- **Emparejamiento por correo electrónico**: cuando `reference` está vacía, o el archivo no tiene esa columna, la fila se empareja por la dirección de correo electrónico
- **Referencia desconocida**: una referencia que su espacio de trabajo no conoce rechaza la fila: «“CTCT-999” no es una referencia de este espacio de trabajo. Deje la celda vacía para importar la fila sin ella.» Es el caso de un archivo exportado desde otro espacio de trabajo
- **Cambio de correo electrónico**: un correo electrónico que ya tiene otro contacto se rechaza, y el mensaje da la referencia de ese contacto: «“ana@acme.example” ya pertenece a CTCT-7.»
- **Una fila por contacto**: dos filas que actualizan el mismo contacto se rechazan: «Esta fila actualiza CTCT-7, como la fila 3. Deje una sola fila por registro.» Dos filas que crean el mismo contacto (mismo correo electrónico, sin distinguir mayúsculas y minúsculas) también se rechazan: «Mismos valores en email que en la fila 3.»

**Campos obligatorios**: Correo electrónico

**Campos opcionales**: `reference`, `first_name`, `last_name`, `job_title`, `phone`, `mobile`, `country`, `notes`, `active`

**Notas**:
- Consulte [Archivos CSV y Excel](csv-files.md) para la codificación, el separador y los dos pasos de importación

---

## Consejos

- **Siempre establezca un proveedor**: Vincular contactos a proveedores los hace más fáciles de encontrar y gestionar.
- **Establezca el tipo de contacto**: Una vez vinculado un proveedor, elija si el contacto es Comercial, Técnico, Soporte u Otro. Esto ayuda al consultar contactos desde el espacio de trabajo del proveedor.
- **Use nomenclatura consistente**: Introduzca nombres en un formato consistente (p. ej., siempre "Nombre Apellido").
- **Marque contactos inactivos**: Cuando alguien deja un proveedor, márquelo como inactivo en lugar de eliminarlo. Esto preserva el registro de auditoría.
- **Incluya puestos de trabajo**: Los puestos de trabajo ayudan a identificar el contacto adecuado para diferentes necesidades (ventas vs. soporte vs. gestión de cuenta).
