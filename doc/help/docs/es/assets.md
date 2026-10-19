# Activos

Los activos documentan el inventario de su infraestructura: servidores físicos, máquinas virtuales, contenedores, instancias de nube y dispositivos de red. Vincule activos a ubicaciones, aplicaciones, conexiones, contratos, proyectos y tareas para construir una imagen completa de su infraestructura IT.

## Primeros pasos

Navegue a **Panorama IT > Activos** para ver su inventario de activos. Haga clic en **Añadir activo** para crear su primera entrada.

**Campos obligatorios**:
- **Nombre**: Un nombre de activo o nombre de host único
- **Tipo de activo**: Servidor web, Máquina virtual, Servidor físico, Contenedor, etc. (configurable en **Panorama IT > Configuración**)
- **Ubicación**: Dónde se aloja el activo (determina el proveedor, el tipo de alojamiento y el país)

**Muy recomendados**:
- **Ciclo de vida**: Estado actual (Activo, Obsoleto, Retirado, etc.)
- **Entorno**: A qué entorno pertenece este activo (Prod, Pre-prod, QA, Test, Dev, Sandbox)

**Consejo**: Use convenciones de nomenclatura coherentes que incluyan información de entorno y rol (p. ej., `prod-web-01`, `dev-db-master`). Al crear un nuevo activo, el nombre de host se deriva automáticamente del nombre que escriba.

**Permisos**:
- Ver: `infrastructure:reader`
- Crear / editar: `infrastructure:member`
- Importar / Exportar / Eliminar: `infrastructure:admin`

---

## Trabajar con la lista

La lista de activos le ofrece una visión filtrable y ordenable de cada activo de su inventario.

**Columnas predeterminadas**:

| Columna | Qué muestra |
|---------|-------------|
| **#** | Referencia del activo (p. ej., `AST-123`), monoespaciado |
| **Nombre** | Nombre del activo (haga clic para abrir el espacio de trabajo) |
| **Tipo de activo** | El tipo del activo (p. ej., Máquina Virtual, Servidor Físico) |
| **Clúster** | Pertenencia a clúster, o una insignia "Clúster" si este activo es un clúster |
| **Entorno** | Prod, Pre-prod, QA, Test, Dev, Sandbox, con un punto de color |
| **Ubicación** | Dónde se aloja el activo |
| **Alojamiento** | Tipo de alojamiento (derivado de la ubicación) |
| **OS** | Sistema operativo |
| **Zona de red** | Segmento de red (derivado de la subred) |
| **Ciclo de vida** | Estado actual del ciclo de vida |
| **Asignaciones** | Número de asignaciones de aplicaciones |
| **Creado** | Cuándo se creó el registro |

**Ordenación predeterminada**: **Creado** descendente (los más recientes primero).

**Columnas adicionales** (ocultas por defecto, disponibles mediante el selector de columnas):
- **Sublocalización**: Área específica dentro de la ubicación (edificio, sala, rack)
- **Puesta en marcha**: Fecha en que el activo entró en producción
- **Fin de vida**: Fecha planificada o efectiva de retiro
- **Zona de administración**: La zona de su modelo de administración a la que pertenece el activo

**Filtrado**:

La mayoría de columnas admiten filtros de conjunto de casillas para un filtrado rápido de selección múltiple. Las opciones de filtro se actualizan dinámicamente según otros filtros activos y la consulta de búsqueda, de modo que solo ve los valores que existen en el conjunto de resultados actual.

| Columna | Notas |
|---------|-------|
| Tipo de activo | Filtrar por uno o más tipos de activo |
| Clúster | Incluye "(Sin clúster)" para activos independientes |
| Entorno | Prod, Pre-prod, QA, Test, Dev, Sandbox |
| Ubicación | Incluye "(Sin ubicación)" para activos no asignados |
| Sublocalización | Incluye "(Sin sublocalización)" para activos sin sublocalización |
| Alojamiento | Filtrar por tipo de alojamiento |
| OS | Filtrar por sistema operativo |
| Zona de red | Filtrar por segmento de red |
| Ciclo de vida | Filtrar por estado del ciclo de vida |
| Zona de administración | Incluye "(Vacío)" para los activos sin zona |

**Consejo**: Combine filtros entre columnas para acotar resultados. Por ejemplo, filtre por Entorno = "Prod" y Ciclo de vida = "Activo" para ver solo los activos activos de producción.

**Acciones**:
- **Añadir activo**: Crear un nuevo activo (`infrastructure:member`)
- **Importar CSV** / **Exportar CSV**: Operaciones masivas (`infrastructure:admin`)
- **Eliminar activo** (filas seleccionadas): Eliminar los activos seleccionados (`infrastructure:admin`). Un activo todavía asignado a aplicaciones o vinculado a conexiones no se puede eliminar: retírelo primero de ellas. Antes de eliminar nada, la confirmación enumera los activos que se conservan, con el motivo

---

## Clústeres

Los activos pueden organizarse en clústeres:

- **Activo regular**: Una instancia individual de infraestructura
- **Clúster**: Un grupo de activos que actúan como una única unidad lógica

Al editar un activo, active el conmutador **Clúster** en la pestaña Técnico para marcarlo como clúster. Los activos clúster pueden ser puntos finales en conexiones, pero las asignaciones de aplicaciones deben hacerse sobre los hosts miembros, no sobre el clúster en sí.

Los miembros del clúster se gestionan desde la pestaña **Técnico** del espacio de trabajo del clúster mediante **Editar miembros**.

---

## El espacio de trabajo de Activos

Haga clic en cualquier fila para abrir el espacio de trabajo. El espacio de trabajo tiene un **encabezado** con metadatos rápidos, un **panel de propiedades** a la derecha (la tarjeta de identidad del activo, siempre visible) y un **área de contenido** en el centro que cambia con cada pestaña.

### Encabezado

El encabezado muestra:
- **Nombre del activo** (editable en línea)
- **Referencia del activo** (p. ej., `AST-123`): identificador copiable
- Chip de **Ciclo de vida** (también editable desde el panel de propiedades)
- **Enviar enlace**: copiar un enlace compartible a este espacio de trabajo
- **Eliminar** (`infrastructure:admin`). Para un activo todavía en uso, el motivo aparece antes de cualquier confirmación
- **Anterior / Siguiente** (p. ej., "3 de 47"): navegar por la lista filtrada sin volver a ella

### Panel de propiedades (panel derecho)

El panel muestra la tarjeta de identidad del activo en cada pestaña. Las ediciones se guardan automáticamente.

**Identificación y ubicación**:
- **Tipo de activo** (obligatorio)
- **Ubicación** (obligatorio)
- **Sublocalización** (cuando la ubicación tiene sublocalizaciones definidas)
- **Tipo de alojamiento**, **Proveedor de nube / Empresa operadora**, **País**, **Ciudad**: de solo lectura, derivados de la ubicación

**Estado**:
- **Entorno**: Prod, Pre-prod, QA, Test, Dev, Sandbox
- **Zona de administración**: La zona de su modelo de administración a la que pertenece el activo, por ejemplo el Tier 0 para un controlador de dominio y el hipervisor que lo ejecuta. Elija entre las zonas configuradas en **Panorama IT > Configuración**. El activo aparece entonces en esa zona en la [Vista de la administración](administration-view.md)
- **Ciclo de vida**: Activo, Obsoleto, Retirado, etc. (configurable en Configuración)
- **Puesta en marcha**: Cuándo entró el activo en producción
- **Fin de vida**: Fecha planificada o efectiva de retiro

---

### Visión general

La pestaña Visión general es la página de inicio del activo.

**Descripción**: Una descripción enriquecida del activo. Se guarda automáticamente mientras edita.

**Asignaciones** (no se muestra para activos clúster): Lista las aplicaciones que se ejecutan en este activo. Cada fila muestra:

| Columna | Qué muestra |
|---------|-------------|
| **Aplicación** | Nombre de la aplicación (clicable: salta a los Despliegues de la aplicación) |
| **Entorno** | El entorno de despliegue al que pertenece la asignación |
| **Rol** | Rol del servidor (Web, Base de datos, Aplicación, etc.) |
| **Desde** | Fecha en que se asignó el servidor |
| **Notas** | Notas de texto libre |

Haga clic en **Añadir asignación** para vincular este activo a un despliegue de aplicación. Elija la aplicación, luego el entorno (la aplicación ya debe tener un despliegue en ese entorno), luego el rol y la fecha / notas opcionales. Use los iconos de la fila para editar o eliminar.

Si este activo es un clúster, un aviso en línea reemplaza la tabla de asignaciones y le pide que asigne en su lugar los hosts miembros.

**Conexiones**: Una vista de solo lectura de todas las conexiones que involucran a este activo. Cada fila muestra el ID y nombre de la conexión (clicable: abre el espacio de trabajo de Conexión), topología (Servidor a Servidor o Multi-servidor), protocolos, etiquetas de los puntos finales de origen y destino, y estado del ciclo de vida. Para crear o editar una conexión, navegue a **Panorama IT > Conexiones**.

**Conocimiento**: Artículos de conocimiento vinculados a este activo. Con `knowledge:member` puede crear nuevos artículos directamente desde esta sección.

---

### Técnico

La pestaña Técnico organiza el clúster, la identidad de red, las tecnologías que lleva el servidor y la configuración de IP.

**Gestión de clúster**:
- Conmutador **Clúster**: marcar este activo como clúster.
- Si el activo **es un clúster**: una sección **Miembros** lista los activos miembros (Nombre, Entorno, Estado, Sistema operativo). Haga clic en **Editar miembros** para añadir o quitar miembros mediante un diálogo de búsqueda.
- Si el activo **no es un clúster**: una sección **Pertenencia a clúster** muestra los clústeres a los que pertenece este activo (si los hay).

**Identidad**:
- **Nombre de host**: El nombre de host de red del activo. Se rellena previamente desde el nombre del activo en la creación; puede sobrescribirlo en cualquier momento. Obligatorio cuando se selecciona un dominio. Admite letras, dígitos, guiones y puntos, y cada parte entre puntos puede tener 63 caracteres como máximo, de modo que un nombre como `DL3.ROBOT-15MS.IE2000` es válido tal cual.
- **Dominio**: El dominio Active Directory o DNS al que pertenece el activo. Elija entre los dominios configurados en **Panorama IT > Configuración**. Las opciones del sistema incluyen "Workgroup" (independiente) y "N/A" (no aplicable).
- **FQDN**: Nombre de Dominio Completamente Cualificado, calculado automáticamente desde el nombre de host y el sufijo DNS del dominio. Solo lectura.
- **Alias**: Nombres DNS o alias adicionales para este activo. Escriba y pulse Enter para añadir.
- **Sistema operativo**: Tipo y versión del SO (p. ej., Windows Server 2022, Ubuntu 24.04 LTS). Deshabilitado para clústeres: el SO se define por miembro. Cuando se selecciona, muestra debajo las fechas de fin de soporte estándar y extendido.

**Tecnologías**: lo que lleva el servidor, por ejemplo SQL Server, vSphere o Active Directory. Columnas: **Ref.**, **Nombre**, **Familia**, **Versión** y, cuando el servidor lleva una tecnología a través de otro, **Vía**.

- Una tecnología instalada en este servidor se quita con la cruz al final de su fila.
- Una tecnología instalada en el servidor o clúster en el que se ejecuta este muestra ese servidor en **Vía**. Sigue a la instalación y se quita allí.
- **Añadir** (`infrastructure:member`) abre una búsqueda de tecnología y luego el selector de versión: elija una versión, **Versión desconocida**, o escriba una etiqueta nueva y elija **Añadir la versión «…»** para crearla. Cada cambio se guarda de inmediato.

La versión y las notas de una instalación se cambian desde la pestaña **Servidores** de la tecnología. Consulte [Tecnologías](technologies.md#vincular-una-tecnologia-a-un-servidor).

**Direcciones IP**:

Los activos admiten múltiples direcciones IP, cada una con su propia configuración de red:

- Haga clic en **Añadir dirección IP** para añadir una nueva entrada.
- **Tipo**: El propósito de la dirección IP (Host, IPMI, Gestión, iSCSI o tipos personalizados de Configuración)
- **Dirección IP**: La dirección en sí
- **Subred**: Subred de red de la lista configurada (filtrada por la ubicación del activo)
- **Zona de red**: Derivada automáticamente de la subred seleccionada (solo lectura)
- **VLAN**: Derivada automáticamente de la subred seleccionada (solo lectura)

Esto le permite documentar múltiples interfaces de red por activo, por ejemplo, un servidor físico con tanto una IP de host como una dirección de gestión IPMI en subredes diferentes.

---

### Hardware

*Solo visible para tipos de activos físicos.*

Hace seguimiento de los detalles físicos del hardware. Se guarda automáticamente mientras escribe.

- **Número de serie**
- **Fabricante**
- **Modelo**
- **Fecha de compra**
- **Ubicación en el rack** (p. ej., Fila A, Rack 12)
- **Unidades de rack** (p. ej., U1-U4)
- **Notas**

---

### Soporte

*Solo visible para tipos de activos físicos.*

Hace seguimiento de información de soporte y contactos del proveedor.

- **Proveedor**: Seleccionar del directorio de proveedores
- **Contrato de soporte**: Vincular a un registro de contrato
- **Nivel de soporte**: Texto libre (p. ej., Oro, Plata, 24x7)
- **Caducidad del soporte**: Fecha de expiración
- **Notas**

**Contactos de soporte**: Una tabla donde puede añadir contactos del directorio de contactos, cada uno con una etiqueta de rol de texto libre. La tabla muestra automáticamente el correo, teléfono y móvil de cada contacto.

---

### Relaciones

La pestaña Relaciones conecta este activo a otros registros en KANAP. La insignia de la pestaña cuenta todos los elementos vinculados. La mayoría de los campos se guardan automáticamente.

**Si este servidor cae**: la pestaña empieza por lo que se detiene con este activo. Una línea de resumen cuenta las aplicaciones, activos, clústeres, tecnologías y procesos de negocio afectados, y después una tabla por tipo:

- **Aplicaciones**: las que tienen un despliegue en servicio en un activo caído, con sus entornos, su criticidad y los activos en los que se ejecutan (**Vía**).
- **Activos**: los activos que contiene, hasta tres niveles, y los activos que dependen de él. **Vía** muestra el camino.
- **Clústeres**: los clústeres con un miembro caído. **Caído** cuando no queda ningún miembro en pie, si no **Degradado** con el número de miembros caídos. Las aplicaciones de un clúster caído caen con él.
- **Tecnologías**: las instaladas en un activo caído, con sus versiones.
- **Procesos de negocio**: los procesos de las aplicaciones afectadas.

Los activos retirados cortan la cadena: nada cae a través de ellos. Cada tabla muestra sus 50 primeras filas y cuenta el resto. Las aplicaciones y los procesos requieren el derecho de leerlos. La sección se actualiza al guardar las relaciones del activo, más abajo.

**Relaciones de activos**:
- **Depende de**: Otros activos de los que depende este (p. ej., un servidor de base de datos)
- **Contiene**: Activos contenidos dentro de este (p. ej., servidores en un rack)
- **Contenido por** / **Del que dependen**: Vistas inversas de solo lectura, mostradas solo cuando otros activos hacen referencia a este

**Financiero y proyectos**:
- **Líneas presupuestarias**: Vincular a líneas OPEX y CAPEX, en una sola lista. Busque por título o por referencia (`BL-12`); cada sugerencia muestra su tipo
- **Contratos**: Vincular a registros de contratos
- **Proyectos**: Vincular a proyectos del portafolio relacionados con este activo

**Tareas**: Tareas vinculadas a este activo. Solo lectura aquí: las tareas ganan o pierden este vínculo cuando establece el campo **Activo** en una tarea desde la página de Tareas.

**Sitios web relevantes**: Añada URLs con nombres opcionales. Es útil para portales de proveedores, paneles de monitoreo o enlaces a documentación. **Añadir URL** abre un diálogo; las entradas existentes pueden editarse o eliminarse.

**Adjuntos**: Arrastre y suelte archivos o haga clic en **Seleccionar archivos** para subirlos. Haga clic en un chip de adjunto para descargarlo. La eliminación está disponible para los gestores.

---

## Importación/exportación CSV

Mantenga su inventario de activos a escala usando la importación y exportación CSV. Esta funcionalidad soporta operaciones masivas para carga inicial de datos, actualizaciones periódicas desde sistemas externos y extracción de datos para informes.

### Acceder a las funciones CSV

Desde la lista de Activos:
- **Exportar CSV**: Descargar activos a un archivo CSV
- **Importar CSV**: Subir un archivo CSV para crear o actualizar activos

**Permisos requeridos**: `infrastructure:admin` para operaciones de importación/exportación.

### Opciones de exportación

| Opción | Descripción |
|--------|-------------|
| **Exportación completa** | Todos los campos exportables. Usar para informes y extracción completa de datos |
| **Enriquecimiento de datos** | Todos los campos importables. Coincide con el formato de la plantilla de importación, ideal para edición de ida y vuelta (exportar, modificar, reimportar) |
| **Selección personalizada** | Elegir campos específicos para incluir en su exportación |

**Descarga de plantilla** (desde el diálogo de Importación): Descarga un CSV en blanco con todos los encabezados de campos importables. Úselo para preparar archivos de importación con la estructura correcta.

### Flujo de trabajo de importación

1. **Prepare su archivo**: guárdelo en UTF-8. Las comas y los puntos y coma funcionan, y también un archivo que Excel guardó como CSV simple (Windows-1252). Descargue una plantilla para asegurar los encabezados correctos. El separador, los importes, las fechas y los sí o no de cada idioma están en [Archivos CSV](csv-files.md).

2. **Elija la configuración de importación**:
   - **Modo**:
     - `Enriquecer` (predeterminado): Las celdas vacías preservan los valores existentes: solo actualiza lo que especifique
     - `Reemplazar`: Las celdas vacías borran los valores existentes (reemplazo completo de todos los campos)
   - **Operación**:
     - `Upsert` (predeterminado): Crear nuevos activos o actualizar existentes
     - `Solo actualizar`: Solo modificar activos existentes, omitir nuevos
     - `Solo insertar`: Solo crear nuevos activos, omitir existentes

3. **Validar primero**: Haga clic en **Verificación previa** para validar su archivo sin hacer cambios. Revise errores y advertencias.

4. **Aplicar cambios**: Si la validación es correcta, haga clic en **Importar** para confirmar los cambios.

### Referencia de campos

**Campos principales**:

| Columna CSV | Descripción | Obligatorio | Notas |
|-------------|-------------|-------------|-------|
| `id` | UUID del activo | No | Para actualizaciones; deje en blanco para nuevos activos |
| `name` | Nombre del activo | Sí | Se usa como identificador único para coincidencias |
| `location_code` | Código de ubicación | Sí | Debe coincidir con un código de ubicación existente |
| `kind` | Tipo de activo | Sí | Acepta código o etiqueta (p. ej., `vm` o `Virtual Machine`) |
| `environment` | Entorno | Sí | `prod`, `pre_prod`, `qa`, `test`, `dev`, `sandbox` |
| `status` | Estado del ciclo de vida | No | Acepta código o etiqueta (p. ej., `active` o `Active`) |
| `is_cluster` | Si es un clúster | No | `sí` o `no` |
| `hostname` | Nombre de host de red | No | |
| `domain` | Dominio DNS | No | Acepta código o etiqueta de Configuración |
| `admin_zone` | Zona de administración | No | Acepta código o etiqueta de Configuración |
| `aliases` | Alias DNS | No | Lista separada por comas |
| `operating_system` | Tipo de SO | No | Acepta código o etiqueta de Configuración |
| `cluster` | Pertenencia a clúster | No | Nombre del clúster padre |
| `notes` | Notas de texto libre | No | |

**Campos de dirección IP** (hasta 4 direcciones por activo):

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `ip_1_type` | Tipo de dirección IP | Acepta código o etiqueta (p. ej., `host` o `Host IP`) |
| `ip_1_address` | Dirección IP | |
| `ip_1_subnet_cidr` | Subred en notación CIDR | |
| `ip_2_type` hasta `ip_4_type` | Tipos de IP adicionales | Mismo patrón para los huecos 2-4 |
| `ip_2_address` hasta `ip_4_address` | Direcciones adicionales | |
| `ip_2_subnet_cidr` hasta `ip_4_subnet_cidr` | Subredes adicionales | |

### Aceptación de etiquetas y códigos

Para campos configurados en **Panorama IT > Configuración**, puede usar tanto el código interno como la etiqueta visible:

| Campo | Ejemplos de códigos | Ejemplos de etiquetas |
|-------|---------------------|----------------------|
| Tipo de activo (`kind`) | `vm`, `physical`, `container` | `Virtual Machine`, `Physical Server`, `Container` |
| Ciclo de vida (`status`) | `active`, `inactive`, `decommissioned` | `Active`, `Inactive`, `Decommissioned` |
| Sistema operativo | `windows_2022`, `ubuntu_24` | `Windows Server 2022`, `Ubuntu 24.04 LTS` |
| Dominio | `corp`, `dmz` | `Corporate Domain`, `DMZ` |
| Zona de administración (`admin_zone`) | `tier_0`, `tier_1` | `Tier 0 (núcleo de confianza)`, `Tier 1 (servidores y aplicaciones)` |
| Tipo de dirección IP | `host`, `ipmi`, `mgmt` | `Host IP`, `IPMI`, `Management` |

El sistema normaliza automáticamente los valores durante la importación, por lo que `Virtual Machine`, `virtual machine` y `vm` se resuelven al mismo tipo de activo. Un valor que coincide con varias entradas se rechaza en lugar de adivinarse. La exportación CSV escribe nombres en estas columnas, de modo que un archivo exportado se puede volver a importar tal cual.

### Coincidencia y actualizaciones

Los activos se emparejan por **nombre** (sin distinguir mayúsculas). Cuando se encuentra una coincidencia:
- Con modo `Enriquecer`: Solo los valores CSV no vacíos actualizan el activo
- Con modo `Reemplazar`: Todos los campos se actualizan, los valores vacíos borran datos existentes

Si incluye la columna `id` con un UUID válido, la coincidencia usa primero el ID, luego el nombre como respaldo.

### Campos derivados

Algunos campos se calculan y no pueden importarse:
- **Proveedor**: Derivado automáticamente de la ubicación del activo
- **FQDN**: Calculado a partir del nombre de host + dominio

### Limitaciones

- **Máximo 4 direcciones IP**: Los activos admiten hasta 4 entradas de direcciones IP vía CSV
- **Asignación de clúster por nombre**: Use el nombre del clúster, no el ID, en la columna `cluster`
- **Ubicación obligatoria**: Cada activo debe tener un código de ubicación válido
- **Relaciones no incluidas**: Las asignaciones de aplicaciones, conexiones, vínculos financieros, proyectos, tareas y adjuntos deben gestionarse en el espacio de trabajo

### Solución de problemas

**Error "El archivo no tiene el formato correcto"**: Esto generalmente indica un problema de codificación. Asegúrese de que su CSV esté guardado como **UTF-8**:

- **En LibreOffice**: Al abrir un CSV, seleccione `UTF-8` en el desplegable de Juego de caracteres (no "Japanese (Macintosh)" u otras codificaciones). Al guardar, marque "Editar configuración de filtro" y elija UTF-8.
- **En Excel**: Guardar como > CSV UTF-8 (delimitado por comas).
- **Consejo general**: Si ve caracteres ilegibles al inicio de su archivo, la codificación es incorrecta.

### Ejemplo CSV

```csv
name;location_code;kind;environment;status;hostname;domain;ip_1_type;ip_1_address
PROD-WEB-01;NYC-DC1;Virtual Machine;prod;Active;prodweb01;corp;Host IP;10.0.1.10
PROD-DB-01;NYC-DC1;vm;prod;active;proddb01;corp;host;10.0.1.20
```

---

## Consejos

- **Nombre de forma coherente**: Incluya entorno, rol y secuencia en los nombres de los activos para facilitar la identificación.
- **Use clústeres**: Agrupe activos relacionados (p. ej., clúster web, clúster de bases de datos) para simplificar la gestión. Asigne aplicaciones a los hosts miembros, no al clúster en sí.
- **Haga seguimiento del ciclo de vida**: Marque los activos obsoletos y retirados para mantener los conteos de inventario precisos.
- **Vincule a ubicaciones**: Asigne activos a ubicaciones para que el tipo de alojamiento, país y ciudad se rellenen automáticamente.
- **Asigne a aplicaciones**: Use la pestaña Visión general para vincular activos a despliegues de aplicaciones. Las mismas asignaciones aparecen en la pestaña Despliegues de la aplicación.
- **Use la pestaña Relaciones**: Conecte activos a líneas presupuestarias, contratos y proyectos para visibilidad financiera.
- **Las tareas vienen de la página Tareas**: Para adjuntar una tarea a un activo, defina el campo Activo en la propia tarea; aparecerá en Relaciones > Tareas.
- **Adjunte documentación**: Suba archivos de configuración, diagramas de arquitectura o documentos del proveedor directamente a la pestaña Relaciones.
