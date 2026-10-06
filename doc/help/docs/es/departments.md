# Departamentos

Los Departamentos representan unidades organizativas dentro de sus empresas. Utilícelos para hacer seguimiento de la plantilla por año, asignar costes y definir audiencias para aplicaciones. Cada departamento pertenece a una empresa y lleva datos de plantilla año a año que alimentan los cálculos de contracargo y asignación.

Para registrar quién es responsable de cada línea de presupuesto, use [Centros de coste](cost-centers.md): a diferencia de los departamentos, se pueden agrupar entre varias empresas.

## Primeros pasos

Navegue a **Datos maestros > Departamentos** para ver su lista de departamentos. Haga clic en **Nuevo** para crear su primera entrada.

**Campos obligatorios**:
- **Nombre**: El nombre del departamento
- **Empresa**: A qué empresa pertenece este departamento

**Opcionales pero útiles**:
- **Descripción**: Descripción de texto libre del propósito o alcance del departamento
- **Plantilla**: Número de empleados, seguido por año (se configura en la pestaña Detalles después de la creación)

**Consejo**: Importe departamentos desde su sistema de RRHH para mantener su estructura organizativa alineada.

---

## Trabajar con la lista

La cuadrícula de Departamentos proporciona una visión general de todos los departamentos con su plantilla para un año determinado.

**Columnas predeterminadas**:
- **Nombre**: Nombre del departamento -- haga clic para abrir la pestaña Visión general del espacio de trabajo
- **Empresa**: Empresa matriz -- haga clic para abrir la pestaña Visión general del espacio de trabajo
- **Plantilla (Año)**: Conteo de empleados para el año seleccionado -- haga clic para ir directamente a la pestaña Detalles para editar

**Columnas adicionales** (mediante el selector de columnas):
- **Estado**: Habilitado o Deshabilitado
- **Creado**: Cuándo se creó el departamento

**Selector de año**: Utilice el campo **Año** en la barra de herramientas para cambiar el año de plantilla que se muestra. La cuadrícula se actualiza automáticamente al cambiar el año.

**Alcance de estado**: Utilice el selector **Mostrar: Todos / Activos / Desactivados** para filtrar por estado del departamento. La lista muestra por defecto solo departamentos habilitados.

**Búsqueda rápida**: La barra de búsqueda filtra por nombres de departamento.

**Enlace directo**: Cada celda de la cuadrícula es un enlace clicable. Nombre y Empresa abren la pestaña Visión general; Plantilla abre la pestaña Detalles. Cuando navega a un espacio de trabajo y luego vuelve, su orden de clasificación, consulta de búsqueda y filtros se preservan.

**Acciones**:
- **Nuevo**: Crear un nuevo departamento (requiere `departments:manager`)
- **Importar CSV**: Importación masiva de departamentos (requiere `departments:admin`)
- **Exportar CSV**: Exportar a CSV (requiere `departments:admin`)
- **Eliminar seleccionados**: Eliminar departamentos seleccionados (requiere `departments:admin`)

---

## El espacio de trabajo de Departamentos

Haga clic en cualquier fila para abrir el espacio de trabajo. Tiene dos pestañas: **Visión general** y **Detalles**.

- **Encabezado**: el nombre del departamento. Haga clic en él para cambiar el nombre del departamento. **Ant.** / **Sig.** permiten moverse entre departamentos en el orden y con los filtros de la lista sin volver a ella, y el botón de cierre vuelve a la lista
- **Panel Propiedades** a la derecha: **Empresa** y **Ciclo de vida**

**Guardado automático**: Cada cambio se guarda por sí solo. No hay botón Guardar. El nombre y la descripción se guardan al salir del campo; la empresa y el ciclo de vida se guardan en cuanto los cambia. Puede seguir trabajando mientras se guarda un cambio. Cuando se rechaza un cambio, el motivo aparece bajo el campo que lo causó, salvo para el nombre, cuyo rechazo se muestra en la parte superior de la página.

### Visión general

La pestaña Visión general contiene la descripción. Los demás campos están en el encabezado y en el panel **Propiedades**.

**Qué puede editar**:
- **Nombre**: Nombre del departamento (obligatorio), en el encabezado
- **Empresa**: Empresa matriz, vinculada a los datos maestros de Empresas (obligatorio). Una empresa que ya tiene un departamento con el mismo nombre se rechaza: "A department with this name already exists in the selected company."
- **Descripción**: Descripción de texto libre
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Deje la fecha en blanco para que el departamento permanezca activo indefinidamente, o fije una fecha futura para programar su fin. Si cambia el departamento a **Desactivado** sin fecha, el fin de validez se fija en hoy

**Crear un departamento**: **Nuevo** abre un formulario con **Nombre**, **Empresa** y **Descripción**. Haga clic en **Crear** para guardarlo. La pestaña Detalles está disponible después de crear el departamento.

---

### Detalles

La pestaña Detalles gestiona las métricas de plantilla año a año.

**Selector de año**: Elija qué año ver o editar usando las pestañas de año en la parte superior del panel. Hay cinco años disponibles: dos años antes del año actual hasta dos años después.

**Métricas por año**:
- **Plantilla**: Número total de empleados en este departamento para el año seleccionado

**Cómo funciona**:
- La plantilla se guarda para el año seleccionado al salir del campo (o al pulsar Intro). Cualquier valor que no sea un número entero igual o superior a cero muestra "Introduzca un número entero, 0 o más." bajo el campo
- La plantilla alimenta los cálculos de audiencia para aplicaciones
- Cada año se guarda por separado: cambiar de año carga el valor de ese año
- Si las métricas del año seleccionado han sido **congeladas** (por un administrador), el campo está bloqueado y un aviso indica que un administrador de presupuesto puede descongelarlas (**Gestión presupuestaria > Administración > Congelar datos maestros**)

**Consejo**: Actualice la plantilla anualmente durante su ciclo de planificación presupuestaria. Utilice las pestañas de año para revisar o prerellenar años futuros.

---

## Importación/exportación CSV

**Exportar CSV** descarga todos los departamentos con su empresa, su nombre, su descripción, su estado y su fin de validez. **Importar CSV** vuelve a leer un archivo. El diálogo de importación incluye también **Descargar plantilla**: un archivo solo con los encabezados.

Las columnas:

| Columna | Contenido |
|---|---|
| `company_name` | Obligatoria. La empresa a la que pertenece el departamento, por su nombre |
| `name` | Obligatoria. El nombre del departamento |
| `description` | Texto libre |
| `status` | `enabled` o `disabled` |
| `disabled_at` | El fin de validez: una fecha (`2026-12-31`) o una fecha y una hora completas |

**Importación**:

- Use la **Verificación previa** para validar el archivo antes de aplicarlo y después **Cargar**
- Emparejamiento por nombre de departamento y nombre de empresa: una fila actualiza el departamento que nombra, cualquier otra fila crea uno

**Celdas obligatorias**: `name` y `company_name`, una empresa existente

**Celdas opcionales**: `description`, `status`, `disabled_at`

**Columnas de ciclo de vida**:
- `status` es `enabled` o `disabled`, y `disabled_at` es el fin de validez, una fecha (`2026-12-31`) o una fecha y una hora completas. La exportación escribe el estado deducido del fin de validez. Un departamento nuevo se activa salvo que la fila indique `disabled`. En una actualización, un `status` vacío y un `disabled_at` vacío conservan los valores guardados. `enabled` con una fecha vacía borra el fin de validez. `disabled` con una fecha vacía conserva una fecha ya pasada y, si no, finaliza el departamento hoy
- Una fila cuyo estado contradice su fecha se rechaza con un error de fila: "Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again." o "Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."

**Notas**:
- Consulte [Archivos CSV](csv-files.md) para la codificación, el separador, los formatos de fecha y los dos pasos de importación
- La plantilla de personal no está en el archivo. Introdúzcala por año en la pestaña **Detalles** del departamento

## Consejos

- **Refleje su estructura organizativa**: Replique la jerarquía de departamentos de su sistema de RRHH para mantener la consistencia.
- **Actualice la plantilla anualmente**: Establezca un recordatorio para actualizar las métricas de departamentos durante la planificación presupuestaria.
- **Use para asignaciones**: La plantilla de departamentos impulsa los cálculos de asignación de costes -- manténgala precisa.
- **Desactive, no elimine**: Cuando los departamentos se reorganizan, desactive los antiguos en lugar de eliminarlos para preservar los datos históricos.
- **Aproveche los enlaces directos**: Haga clic en el número de plantilla directamente desde la lista para ir a la pestaña Detalles y editar métricas sin un clic adicional.
