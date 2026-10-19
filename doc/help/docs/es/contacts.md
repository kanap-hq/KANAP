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

**Acciones**:
- **Nuevo**: Crear un nuevo contacto (requiere `contacts:member`)
- **Importar CSV**: Importación masiva de contactos (requiere `contacts:admin`)
- **Exportar CSV**: Exportar a CSV (requiere `contacts:admin`)
- **Eliminar seleccionados**: Eliminar los contactos seleccionados (requiere `contacts:admin`). Se quitan de los proveedores, líneas presupuestarias, contratos, aplicaciones, activos, ubicaciones, proyectos y solicitudes que los mencionan; esos elementos se conservan

---

## La página del contacto

Haga clic en una fila para abrir la página del contacto. Cada cambio se guarda solo: no hay botón de guardar.

**Título**: el nombre del contacto. Haga clic en él para editar el nombre y el apellido uno al lado del otro; el cambio se guarda al salir de los dos campos o al pulsar Intro, y Escape lo cancela. Un contacto sin nombre muestra su correo electrónico en su lugar.

**Encabezado**, bajo el nombre:
- **Proveedor**: el proveedor para el que trabaja este contacto, como enlace a su página. Un contacto sin proveedor muestra **Sin proveedor**: haga clic para abrir las propiedades y elegir uno.
- **Tipo de contacto**: el rol del contacto en el proveedor: Comercial, Técnico, Soporte u Otro. Haga clic para elegir otro. Aparece en cuanto el contacto tiene un proveedor.
- **Estado**: **Activo** o **Inactivo**. Haga clic para cambiarlo.
- **Usado en**: cuántos proveedores, líneas presupuestarias, contratos y otros elementos están vinculados al contacto. Haga clic para ir a la sección **Usado en**.

**Propiedades** (el panel de la derecha, que se abre con su pestaña o la tecla `P`):
- **Proveedor**: elija el proveedor en la lista. Un contacto con proveedor siempre tiene un tipo de contacto: elegir un proveedor para un contacto sin tipo le da **Comercial**, que puede cambiar enseguida. Quitar el proveedor quita también el tipo de contacto.
- **Tipo de contacto**: la misma elección que en el encabezado.
- **Correo electrónico**: obligatorio y único entre sus contactos.
- **Cargo**: su rol o puesto.
- **Teléfono** / **Móvil**: un prefijo y un número. Elija el prefijo en la lista o escríbalo. Si el contacto aún no tiene país, el prefijo lo establece.
- **País**: lista de países con búsqueda.

Los campos de texto se guardan al salir de ellos o al pulsar Intro, las listas en cuanto elige. Un valor que KANAP no puede aceptar (un correo no válido o que ya usa otro contacto, un teléfono que no es un prefijo seguido de un número de 7 a 15 dígitos en total) muestra su mensaje bajo el campo y no se guarda.

**Notas**: notas libres (hasta 2.000 caracteres), bajo el encabezado. Se guardan un momento después de dejar de escribir y al salir del campo.

Pulse **Escape** o haga clic en el botón de cerrar para volver a la lista.

### Usado en

La sección **Usado en**, bajo las notas, lista todo aquello a lo que está vinculado el contacto, una lista por tipo, cada una con su número: proveedores, líneas presupuestarias (OPEX y CAPEX, con su referencia `BL-`), contratos, aplicaciones, activos, ubicaciones, proyectos (`PRJ-`) y solicitudes (`REQ-`). Cada fila muestra el rol del contacto: el tipo de contacto para proveedores, líneas presupuestarias y contratos, el rol escrito en la aplicación, el activo o la ubicación.

Haga clic en una fila para abrir su página. Una lista muestra hasta 50 elementos e indica cuántos hay en total. Solo ve las listas que tiene permiso para leer. Un contacto sin vínculos muestra una línea que lo indica.

### Crear un contacto

Haga clic en **Nuevo** en la lista. Indique el correo electrónico (obligatorio) y los demás campos, y haga clic en **Crear**. Elegir un proveedor fija el tipo de contacto en **Comercial**, que puede cambiar antes de crear. Vuelve a la lista una vez creado el contacto.

---

## Dónde se usan los contactos

Los contactos aparecen en varios lugares de KANAP. La sección **Usado en** de la página del contacto los lista todos.

### Contactos de proveedor

Cada proveedor tiene una pestaña de **Contactos** que muestra todos los contactos vinculados a ese proveedor. Puede crear un nuevo contacto directamente desde el espacio de trabajo del proveedor:

1. Abra el espacio de trabajo del proveedor y vaya a la pestaña **Contactos**.
2. Haga clic en **Nuevo contacto** junto a un tipo de contacto.
3. Complete los datos del contacto: el proveedor y el tipo de contacto están prerrellenados.
4. Haga clic en **Crear**: vuelve a la pestaña **Contactos** del proveedor.

### Soporte de aplicaciones

En el espacio de trabajo de Aplicaciones, la pestaña **Técnico y soporte** referencia contactos para la escalación del soporte.

### Soporte de tecnologías

En el espacio de trabajo de Tecnologías, la pestaña **Operación** lista los contactos de soporte de una tecnología. Consulte [Tecnologías](technologies.md#operacion). En la sección **Usado en** del contacto, una tecnología retirada aparece al final, marcada como **Desactivado**.

### Contactos de ubicación

Las ubicaciones pueden tener contactos de soporte (gestores de instalaciones, contactos del NOC, etc.).

---

## Importación/exportación CSV

Gestione contactos de forma masiva usando CSV.

**Exportar**: Descarga los contactos que muestra la lista con sus detalles. Elija **Todo el registro** en el diálogo para todos los contactos.

**Importar**:
- Utilice **Verificación previa** para validar antes de aplicar
- Coincidencia por dirección de correo electrónico
- Puede crear nuevos contactos o actualizar los existentes

**Campos obligatorios**: Correo electrónico

**Campos opcionales**: `first_name`, `last_name`, `job_title`, `phone`, `mobile`, `country`, `notes`, `active`

**Notas**:
- Consulte [Archivos CSV](csv-files.md) para la codificación, el separador y los dos pasos de importación

---

## Consejos

- **Siempre establezca un proveedor**: Vincular contactos a proveedores los hace más fáciles de encontrar y gestionar.
- **Establezca el tipo de contacto**: Una vez vinculado un proveedor, elija si el contacto es Comercial, Técnico, Soporte u Otro. Esto ayuda al consultar contactos desde el espacio de trabajo del proveedor.
- **Use nomenclatura consistente**: Introduzca nombres en un formato consistente (p. ej., siempre "Nombre Apellido").
- **Marque contactos inactivos**: Cuando alguien deja un proveedor, márquelo como inactivo en lugar de eliminarlo. Esto preserva el registro de auditoría.
- **Incluya puestos de trabajo**: Los puestos de trabajo ayudan a identificar el contacto adecuado para diferentes necesidades (ventas vs. soporte vs. gestión de cuenta).
