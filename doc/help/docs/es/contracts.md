# Contratos

Los Contratos documentan sus acuerdos con proveedores -- licencias de software, contratos de mantenimiento, suscripciones SaaS y acuerdos de servicio. Haga seguimiento de fechas clave, costes, condiciones de renovación y vincule contratos a sus partidas OPEX y CAPEX para una visibilidad completa de costes.

## Primeros pasos

Navegue a **Gestión presupuestaria > Contratos** para ver su registro de contratos. Haga clic en **Nuevo** para crear su primera entrada.

**Campos obligatorios**:

- **Nombre**: Un nombre reconocible del contrato
- **Proveedor**: El proveedor que proporciona el servicio
- **Empresa**: Qué empresa firmó el contrato

**Muy recomendados** (establézcalos en la pestaña Detalles justo después de la creación):

- **Fecha de inicio**: Cuándo comienza el contrato
- **Duración**: Duración del contrato en meses
- **Importe anual**: El valor anual del contrato
- **Moneda**: Moneda del contrato
- **Auto-renovación**: Si el contrato se renueva automáticamente
- **Período de preaviso**: Cuántos meses de preaviso se requieren para cancelar

**Consejo**: El sistema calcula automáticamente la fecha de fin y el plazo límite de cancelación basándose en su fecha de inicio, duración y período de preaviso.

---

## Trabajar con la lista

La cuadrícula de Contratos proporciona una visión general de todos sus acuerdos con proveedores. Cada fila es un enlace clicable que abre el espacio de trabajo del contrato, y su contexto de búsqueda y filtro se preserva al navegar de vuelta.

**Columnas predeterminadas**:

- **Contrato**: Nombre del contrato (haga clic para abrir el espacio de trabajo)
- **Proveedor**: El proveedor
- **Empresa**: La entidad contratante
- **Inicio**: Fecha de inicio del contrato
- **Duración (m)**: Duración en meses
- **Auto-renovación**: Si el contrato se auto-renueva (sí/no)
- **Preaviso (m)**: Período de preaviso en meses
- **Fin**: Fecha de fin calculada
- **Cancelar antes de**: Plazo límite de cancelación (fecha de fin menos período de preaviso)
- **Importe anual**: Valor anual del contrato (formateado con separadores de espacio)
- **Moneda**: Código de moneda
- **Facturación**: Frecuencia de facturación (Mensual, Trimestral, Anual, Otra)
- **OPEX vinculados**: Número de partidas OPEX vinculadas (haga clic para abrir el espacio de trabajo)
- **Estado**: **Activado** o **Desactivado**, según el fin de validez

**Columnas adicionales** (mediante el selector de columnas):

- **Tarea**: Última tarea de este contrato (estado y vista previa de la descripción)

**Ordenación predeterminada**: Por plazo límite de cancelación ascendente, para que los contratos que requieren acción pronto aparezcan primero.

**Filtrado**:

- Búsqueda rápida: Busca en nombre del contrato, proveedor y empresa
- Filtros de columna: Disponibles en cada encabezado de columna. El filtro **Estado** ofrece **Activado** y **Desactivado**. Si hace clic en **Limpiar** dentro del filtro, o desmarca ambos valores, la lista no muestra nada, sea cual sea la opción de **Mostrar**
- **Alcance de estado**: el selector **Mostrar: Todos / Activos / Desactivados** sobre la lista. La lista muestra por defecto los contratos activados. Elija **Todos** o **Desactivados** para encontrar los contratos cuyo fin de validez ya pasó

**Acciones**:

- **Nuevo**: Crear un nuevo contrato (requiere `contracts:manager`)
- **Importar CSV**: Importación masiva de contratos (requiere `contracts:admin`)
- **Exportar CSV**: Exportar a CSV (requiere `contracts:admin`)

---

## El espacio de trabajo de Contratos

Haga clic en cualquier fila para abrir el espacio de trabajo. El encabezado muestra el nombre del contrato, su posición en la lista (p. ej., "Contrato 3 de 42") y controles de navegación:

- **Anterior / Siguiente**: Moverse entre contratos sin volver a la lista
- **Restablecer**: Descartar cambios no guardados en la pestaña actual
- **Guardar**: Persistir sus ediciones
- **Cerrar** (icono X): Volver a la lista, preservando su contexto de búsqueda y filtro

El espacio de trabajo tiene cuatro pestañas verticales: **Visión general**, **Detalles**, **Relaciones** y **Tareas**.

### Visión general

La pestaña Visión general captura la identidad y el estado del ciclo de vida del contrato.

**Qué puede editar**:

- **Nombre del contrato**: El nombre visible usado en listas e informes
- **Proveedor**: Vínculo a un proveedor de los datos maestros
- **Empresa contratante**: Qué empresa es parte de este contrato
- **Responsable**: La persona encargada de gestionar este contrato
- **Notas**: Notas de texto libre
- **Interruptor de estado**: su etiqueta muestra el estado actual (**Activado** o **Desactivado**). Si cambia el contrato a **Desactivado** sin fecha, el fin de validez se fija en hoy
- **Fin de validez**: la fecha en que el contrato termina. Escriba una fecha en formato dd/mm/aaaa o use el botón de calendario. Déjela en blanco para que el contrato permanezca activo indefinidamente

**Cómo funciona**:

- Al crear un nuevo contrato, solo está disponible la pestaña Visión general. Una vez que guarde, las pestañas restantes se hacen accesibles y se le lleva directamente a la pestaña Detalles para completar los términos financieros.
- Nombre, Proveedor y Empresa son obligatorios para crear un contrato.

---

### Detalles

La pestaña Detalles captura fechas, condiciones e información financiera.

**Qué puede editar**:

- **Fecha de inicio**: Cuándo comienza el contrato (dd/mm/aaaa)
- **Duración (meses)**: Duración del contrato
- **Preaviso (meses)**: Preaviso de cancelación requerido
- **Importe anual**: El valor anual del contrato a la firma
- **Moneda**: Código de moneda de tres letras (p. ej., EUR, USD)
- **Frecuencia de facturación**: Mensual, Trimestral, Anual u Otra
- **Auto-renovación**: Si el contrato se renueva automáticamente

**Campos calculados** (solo lectura):

- **Fecha de fin**: Fecha de inicio más duración
- **Plazo límite de cancelación**: Fecha de fin menos período de preaviso

---

### Relaciones

La pestaña Relaciones vincula contratos a otras entidades en su registro.

**Vínculos disponibles**:

- **Partidas OPEX**: Costes recurrentes asociados a este contrato -- utilice la selección múltiple con búsqueda para encontrar y vincular elementos por nombre del producto
- **Partidas CAPEX**: Partidas de gasto de capital vinculadas a este contrato -- misma interfaz de selección múltiple con búsqueda
- **Contactos**: Personas asociadas a este contrato, cada una con un rol (Comercial, Técnico, Soporte u Otro). Los contactos heredados del proveedor se muestran con una insignia rellena; los añadidos manualmente aparecen con una insignia delineada. Haga clic en una fila de contacto para abrir su perfil.
- **Sitios web relevantes**: Enlaces a documentos externos como PDFs de contratos o portales de proveedores. Cada enlace tiene una descripción y una URL.
- **Adjuntos**: Suba archivos arrastrando y soltando o usando el selector de archivos. Haga clic en un chip de adjunto para descargarlo; haga clic en el icono de eliminar para borrarlo.

**Consejo**: Vincular partidas OPEX y CAPEX a contratos le da una trazabilidad completa de costes -- desde líneas presupuestarias hasta acuerdos con proveedores.

---

### Tareas

La pestaña Tareas gestiona elementos de acción para este contrato (p. ej., revisiones de renovación, negociaciones de precio, verificaciones de conformidad).

**Lista de tareas**:

- Muestra todas las tareas vinculadas a este contrato
- Columnas: Título, Estado, Prioridad, Fecha de vencimiento, Acciones
- Haga clic en el título de una tarea para abrir el espacio de trabajo completo de tareas

**Filtrado**:

- Haga clic en el icono de filtro para mostrar u ocultar los controles de filtro
- **Filtro de estado**: Todos, Activos (oculta completados/cancelados), o un estado específico (Abierto, En progreso, Pendiente, En pruebas, Completado, Cancelado)
- Haga clic en el botón de limpiar para restablecer filtros
- El filtro predeterminado muestra solo tareas activas

**Crear una tarea**:

- Haga clic en **Añadir tarea** para abrir el espacio de trabajo de creación de tareas
- La tarea se vincula automáticamente a este contrato
- Complete el título, descripción, prioridad, asignado y fecha de vencimiento en el espacio de trabajo de tareas

**Eliminar una tarea**:

- Haga clic en el icono de eliminar en la columna de Acciones
- Confirme la eliminación en el diálogo

**Nota**: La pestaña Tareas solo está disponible después de que el contrato se haya guardado por primera vez. Si no tiene el permiso `contracts:manager`, los botones Añadir tarea y Eliminar están ocultos.

---

## Importación/exportación CSV

Mantenga su registro de contratos sincronizado con sistemas externos usando CSV.

**Exportar**: Descarga todos los contratos con campos principales y fechas calculadas. La columna `status` contiene el estado que se deduce del fin de validez.

**Importar**:

- Utilice **Verificación previa** para validar antes de aplicar
- Una fila corresponde a un contrato por su nombre y su proveedor
- Soporta creación y actualizaciones
- El archivo no tiene columna de fin de validez. En una actualización, un `status` vacío, o igual al estado actual del contrato, conserva su fin de validez. Un estado distinto se aplica: `enabled` borra el fin de validez, y `disabled` termina el contrato hoy, salvo que su fin de validez ya haya pasado
- Un contrato nuevo queda activado salvo que la fila indique `disabled`

**Notas**:

- Utilice codificación **UTF-8** y **puntos y coma** como separadores
- Los campos calculados (Fecha de fin, Plazo límite de cancelación) no se importan -- se calculan a partir de la Duración y el Período de preaviso

---

## Consejos

- **Vigile la columna Cancelar antes de**: La lista ordena por plazo límite de cancelación por defecto, así que los contratos que necesitan atención aparecen primero.
- **Vincule a OPEX y CAPEX temprano**: Conecte contratos a partidas de coste al crearlos para un seguimiento completo de costes.
- **Use tareas para renovaciones**: Cree una tarea 3--6 meses antes del plazo límite de cancelación para la revisión de renovación.
- **Registre importes anuales**: Incluso si la facturación es mensual, registre el importe anual para facilitar la comparación año a año.
- **Enlace directo desde la lista**: Puede compartir un enlace directo a cualquier contrato -- la URL del espacio de trabajo incluye el ID del contrato y preserva su contexto de lista (búsqueda, orden, filtros) para que el botón atrás le devuelva exactamente donde estaba.
