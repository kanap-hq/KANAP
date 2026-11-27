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
- **Referencia**: La referencia que asigna Kadratis (`DEPT-4`). Haga clic para abrir la pestaña Visión general del espacio de trabajo
- **Nombre**: Nombre del departamento. Haga clic para abrir la pestaña Visión general del espacio de trabajo
- **Empresa**: Empresa matriz. Haga clic para abrir la pestaña Visión general del espacio de trabajo
- **Plantilla (Año)**: Conteo de empleados para el año seleccionado. Haga clic para ir directamente a la pestaña Detalles para editar

**Columnas adicionales** (mediante el selector de columnas):
- **Estado**: Habilitado o Deshabilitado
- **Creado**: Cuándo se creó el departamento

**Selector de año**: Utilice el campo **Año** en la barra de herramientas para cambiar el año de plantilla que se muestra. La cuadrícula se actualiza automáticamente al cambiar el año.

**Alcance de estado**: Utilice el selector **Mostrar: Todos / Activos / Desactivados** para filtrar por estado del departamento. La lista muestra por defecto solo departamentos habilitados.

**Búsqueda rápida**: La barra de búsqueda filtra por nombres de departamento. Escriba una referencia, como `DEPT-4`, para encontrar ese departamento. Las cifras solas buscan en el texto.

**Filtros de columna**: El filtro **Referencia** acepta `DEPT-4` o `4`.

**Enlace directo**: Cada celda de la cuadrícula es un enlace clicable. Referencia, Nombre y Empresa abren la pestaña Visión general; Plantilla abre la pestaña Detalles. Cuando navega a un espacio de trabajo y luego vuelve, su orden de clasificación, consulta de búsqueda y filtros se preservan.

**Acciones**:
- **Nuevo**: Crear un nuevo departamento (requiere `departments:member`)
- **Importar**: Importación masiva de departamentos (requiere `departments:admin`)
- **Exportar**: Exportar a un archivo CSV o un libro de Excel (requiere `departments:admin`)
- **Eliminar seleccionados**: Eliminar departamentos seleccionados (requiere `departments:admin`). Un departamento usado en las asignaciones de líneas presupuestarias no se puede eliminar: desactívelo en su lugar. Antes de eliminar nada, la confirmación enumera los departamentos que se conservan, con el motivo

---

## El espacio de trabajo de Departamentos

Haga clic en cualquier fila para abrir el espacio de trabajo. Tiene tres pestañas: **Visión general**, **Detalles** e **Historial** (los cambios hechos en el departamento, vea [Historial de los registros](record-history.md)).

- **Encabezado**: la referencia del departamento (`DEPT-5`, haga clic en ella para copiarla) y su nombre. Haga clic en el nombre para cambiar el nombre del departamento. **Ant.** / **Sig.** permiten moverse entre departamentos en el orden y con los filtros de la lista sin volver a ella, y el botón de cierre vuelve a la lista
- **Panel de propiedades** a la derecha: **Empresa** y **Ciclo de vida**

**Dirección de la página**: la dirección de la página usa la referencia, por ejemplo `/master-data/departments/DEPT-5/overview`. La dirección anterior de la página de un departamento lo sigue abriendo y se sustituye por la nueva.

**Guardado automático**: Cada cambio se guarda por sí solo. No hay botón Guardar. El nombre y la descripción se guardan al salir del campo; la empresa y el ciclo de vida se guardan en cuanto los cambia. Puede seguir trabajando mientras se guarda un cambio. Cuando se rechaza un cambio, el motivo aparece bajo el campo que lo causó.

### Visión general

La pestaña Visión general contiene la descripción. Los demás campos están en el encabezado y en el panel de propiedades.

**Qué puede editar**:
- **Nombre**: Nombre del departamento (obligatorio), en el encabezado
- **Empresa**: Empresa matriz, vinculada a los datos maestros de Empresas (obligatorio). Una empresa que ya tiene un departamento con el mismo nombre se rechaza: "A department with this name already exists in the selected company." Un departamento que usan personas, solicitudes, proyectos o asignaciones de líneas presupuestarias se queda en su empresa: el cambio se rechaza y el mensaje cuenta lo que lo usa
- **Descripción**: Descripción de texto libre
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Deje la fecha en blanco para que el departamento permanezca activo indefinidamente, o fije una fecha futura para programar su fin. Pasar a **Desactivado** fija el fin de validez en este momento: la desactivación es inmediata. Mientras haya una fecha futura, el interruptor muestra **Activo hasta el** y esa fecha

**Crear un departamento**: **Nuevo** abre la página del departamento nuevo, con su panel de propiedades abierto. Escriba el nombre en el título de la parte superior de la página y elija la **Empresa**. Cuando solo se ofrece una empresa, ya está elegida, y puede cambiarla. El departamento se crea en cuanto tiene ambos, y todas sus pestañas quedan disponibles. Una **Descripción** se guarda después automáticamente. Pulse Escape en el título para salir sin crear nada, aunque ya haya escrito un nombre.

Mientras el departamento se está creando, el encabezado muestra **Crear** y **Cancelar** hasta que salga de la página. **Ctrl+S** funciona como el botón mostrado. **Crear** guarda el departamento cuando sus campos obligatorios están indicados y lo deja abierto. Si falta alguno, su etiqueta se pone en rojo con un icono de alerta y el cursor va a él. Una vez creado el departamento, **Crear** pasa a ser **Listo**: guarda lo que está escribiendo y le lleva de vuelta al punto de partida, la lista o la pantalla anterior. **Cancelar** sale sin conservar nada. En un departamento ya creado, lo elimina. Si introdujo algo más que lo necesario para crearlo, una confirmación enumera lo que se eliminará. Puede cancelar su propia creación sin el derecho a eliminar departamentos. Si sale de la página de otra forma, el departamento se conserva.

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

La exportación escribe un archivo CSV o un libro de Excel (`.xlsx`): elija en **Formato** en el diálogo. La importación lee los dos. Consulte [Archivos CSV y Excel](csv-files.md).

**Exportar** descarga los departamentos que muestra la lista (o, a petición en el diálogo, todos los departamentos) con su referencia, su empresa, su nombre, su descripción, su estado y su fin de validez. **Importar** vuelve a leer un archivo. El diálogo de importación incluye también **Descargar plantilla**: un archivo solo con los encabezados.

Las columnas, en este orden:

| Columna | Contenido |
|---|---|
| `reference` | Opcional. La referencia del departamento (`DEPT-12`). La exportación la escribe |
| `company_name` | Obligatoria. La empresa a la que pertenece el departamento, por su nombre |
| `name` | Obligatoria. El nombre del departamento |
| `description` | Texto libre |
| `status` | `enabled` o `disabled` |
| `disabled_at` | El fin de validez: una fecha (`2026-12-31`) o una fecha y una hora completas. La exportación escribe solo la fecha. Importada de nuevo, esa fecha conserva el fin de validez guardado |

**Importación**:

- Use la **Verificación previa** para validar el archivo antes de aplicarlo y después **Cargar**
- **Emparejamiento por referencia**: una `reference` rellenada (`DEPT-12` o `12`) designa el departamento que la fila actualiza, aunque su nombre haya cambiado. El departamento toma el nombre y la empresa que da la fila: otra empresa lo traslada a ella, salvo que el departamento esté en uso, como en su página (la fila se rechaza entonces). La verificación previa señala cada departamento que cambiará de nombre o de empresa
- **Emparejamiento por nombre**: cuando `reference` está vacía, o el archivo no tiene esa columna, una fila se empareja por nombre de departamento y nombre de empresa. Actualiza el departamento que nombra, y cualquier otra fila crea uno
- **Referencia desconocida**: una referencia que su espacio de trabajo no conoce rechaza la fila: «“DEPT-999” no es una referencia de este espacio de trabajo. Deje la celda vacía para importar la fila sin ella.» Es el caso de un archivo exportado desde otro espacio de trabajo
- **Cambio de nombre o traslado**: un nombre que ya tiene otro departamento de la empresa de la fila se rechaza, y el mensaje da la referencia de ese departamento: «“Finance” ya pertenece a DEPT-7.»
- **Una fila por departamento**: dos filas que actualizan el mismo departamento se rechazan: «Esta fila actualiza DEPT-7, como la fila 3. Deje una sola fila por registro.» Dos filas que crean el mismo departamento (misma empresa y mismo nombre, sin distinguir mayúsculas y minúsculas) también se rechazan: «Mismos valores en company_name, name que en la fila 3.»

**Celdas obligatorias**: `name` y `company_name`, una empresa existente. Una fila con una `reference` puede dejarlas vacías: el departamento conserva su nombre y su empresa

**Mismo nombre en dos empresas**: dos empresas pueden tener cada una un departamento con el mismo nombre. Una importación que nombra uno en una persona, una solicitud o un proyecto, o Kad en una solicitud o un proyecto, lo lee en la empresa del registro. Cuando el registro no tiene empresa, un nombre que solo tiene una empresa le da esa empresa, y un nombre que comparten varias empresas se rechaza con un mensaje que las nombra. Consulte [Nombres de registros](csv-files.md#names-of-records)

**Celdas vacías y `-`**: en un departamento que el archivo actualiza, una celda vacía conserva el valor guardado, y `-` borra `description` o `disabled_at`. `-` no puede borrar `reference`, `company_name`, `name` ni `status`: la fila se rechaza. Vea [Celdas vacías y `-`](csv-files.md#empty-cells-and-clearing)

**Celdas opcionales**: `reference`, `description`, `status`, `disabled_at`

**Columnas de ciclo de vida**:
- `status` es `enabled` o `disabled`, y `disabled_at` es el fin de validez, una fecha (`2026-12-31`) o una fecha y una hora completas. La exportación escribe el estado deducido del fin de validez. Un departamento nuevo se activa salvo que la fila indique `disabled`. En una actualización, un `status` vacío y un `disabled_at` vacío conservan los valores guardados. `enabled` con una fecha vacía borra el fin de validez. `disabled` con una fecha vacía conserva una fecha ya pasada y, si no, finaliza el departamento hoy
- Una fila cuyo estado contradice su fecha se rechaza con un error de fila: "El estado es «Activado», pero el fin de validez ya pasó. Escriba «-» en el fin de validez o «disabled» en el estado. Si el archivo viene de una exportación anterior, exporte los datos de nuevo." o "El estado es «Desactivado», pero el fin de validez aún no ha llegado. Escriba «enabled» en el estado o una fecha pasada en el fin de validez."

**Notas**:
- Consulte [Archivos CSV y Excel](csv-files.md) para la codificación, el separador, los formatos de fecha y los dos pasos de importación
- La plantilla de personal no está en el archivo. Introdúzcala por año en la pestaña **Detalles** del departamento

## Consejos

- **Refleje su estructura organizativa**: Replique la jerarquía de departamentos de su sistema de RRHH para mantener la consistencia.
- **Actualice la plantilla anualmente**: Establezca un recordatorio para actualizar las métricas de departamentos durante la planificación presupuestaria.
- **Use para asignaciones**: La plantilla de departamentos impulsa los cálculos de asignación de costes: manténgala precisa.
- **Desactive, no elimine**: Cuando los departamentos se reorganizan, desactive los antiguos en lugar de eliminarlos para preservar los datos históricos.
- **Aproveche los enlaces directos**: Haga clic en el número de plantilla directamente desde la lista para ir a la pestaña Detalles y editar métricas sin un clic adicional.
