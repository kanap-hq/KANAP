# Ubicaciones

Las Ubicaciones documentan dónde está alojada su infraestructura IT: centros de datos, regiones en la nube, salas de servidores de oficina e instalaciones de colocación. Asignar activos y aplicaciones a ubicaciones le da visibilidad geográfica, ayuda con la planificación de capacidad y mantiene los contactos de las instalaciones al alcance cuando los necesite.

## Primeros pasos

Navegue a **Panorama IT > Ubicaciones** para abrir el registro de ubicaciones. Haga clic en **Añadir ubicación** para crear una nueva entrada.

**Campos obligatorios**:
- **Código**: Un identificador corto único (p. ej., `DC-EU-WEST`, `AWS-US-EAST-1`)
- **Nombre**: Un nombre descriptivo para mostrar
- **Tipo de alojamiento**: El tipo de instalación: centro de datos propio, colocación, región en la nube, etc.

**Muy recomendado**:
- **País**: Dónde se encuentra la ubicación geográficamente
- **Proveedor** o **Empresa operadora**: Quién opera la instalación

**Consejo**: Use convenciones de nomenclatura consistentes. Prefijar ubicaciones en la nube con el nombre del proveedor (`AWS-`, `AZURE-`, `GCP-`) las hace fáciles de identificar en listas e informes.

---

## Trabajar con la lista

La lista le ofrece una vista general con búsqueda de cada ubicación registrada.

**Columnas predeterminadas**:
- **Código**: Código de ubicación (haga clic para abrir el espacio de trabajo)
- **Nombre**: Nombre para mostrar
- **Tipo de alojamiento**: Propio, colocación, nube pública, etc.
- **Proveedor / Empresa**: Proveedor de nube para ubicaciones de tipo nube, o empresa operadora para ubicaciones propias
- **País**: Nombre del país y código ISO
- **Ciudad**: Nombre de la ciudad
- **Activos**: Número de activos asignados a esta ubicación
- **Creado**: Cuándo se creó el registro

**Filtrado**:
- Búsqueda rápida: Búsqueda de texto libre en todas las filas
- Filtros de columna: Filtros de texto en Código, Nombre y Ciudad; filtro de conjunto en Tipo de alojamiento

**Acciones**:
- **Añadir ubicación**: Crear una nueva ubicación (requiere `locations:member`)

También puede mostrar, ocultar y reordenar columnas usando el selector de columnas.

---

## El espacio de trabajo de ubicaciones

Haga clic en cualquier fila para abrir el espacio de trabajo. Tiene cuatro pestañas: **Vista general**, **Contactos y soporte**, **Relaciones** e **Historial** (los cambios hechos en la ubicación, vea [Historial de los registros](record-history.md)). Las pestañas de Contactos y soporte y Relaciones están disponibles después de guardar la ubicación por primera vez.

### Vista general

La pestaña Vista general captura información de identidad y geográfica, dividida en dos secciones, más un panel de sub-ubicaciones.

**Información básica**:
- **Código**: Identificador único (obligatorio)
- **Nombre**: Nombre para mostrar (obligatorio)
- **Tipo de alojamiento**: Categoría de instalación (obligatorio). Los tipos de alojamiento son configurables en **Panorama IT > Configuración**.

**Detalles de ubicación**: los campos mostrados aquí dependen de la categoría del tipo de alojamiento:

Para tipos de alojamiento **propios**:
- **Empresa operadora**: La empresa que gestiona la instalación. Seleccionar una empresa rellena automáticamente País y Ciudad si están vacíos.

Para tipos de alojamiento **en la nube**:
- **Proveedor de nube**: El proveedor de nube (p. ej., AWS, Azure, GCP)
- **Región**: Región en la nube o zona de disponibilidad

Ambas categorías también muestran:
- **País**: Seleccionado de la lista de países ISO
- **Ciudad**: Nombre de la ciudad
- **Información adicional**: Notas de texto libre sobre la ubicación

**Cómo funciona**: Cambiar entre un tipo de alojamiento propio y uno en la nube borra los campos que pertenecen a la otra categoría. El editor pide confirmación antes de hacer el cambio.

#### Sub-ubicaciones

Debajo del formulario principal, el panel de **Sub-ubicaciones** le permite dividir una ubicación en áreas físicas más pequeñas: edificios, salas, racks, jaulas o cualquier otra subdivisión que tenga sentido para su infraestructura.

Cada sub-ubicación tiene:
- **Nombre**: Una etiqueta corta (p. ej., "Edificio A, Sala 1, Rack 5")
- **Descripción**: Detalle adicional opcional

Las sub-ubicaciones están disponibles en cuanto la ubicación existe (después de hacer clic en **Crear**). Cada fila se guarda por sí sola al salir del campo, y eliminar una sub-ubicación pide confirmación primero.

Los activos pueden asignarse a una sub-ubicación específica dentro de una ubicación, lo que le permite rastrear exactamente dónde se encuentra el hardware. La pestaña Relaciones muestra la sub-ubicación de cada activo que tiene una.

---

### Contactos y soporte

Esta pestaña organiza las personas y referencias asociadas a una ubicación en tres secciones.

**Contactos internos**: Miembros del equipo de su organización vinculados a esta ubicación. Cada fila tiene un selector de **Usuario** y un campo de texto libre de **Rol** (p. ej., "Responsable de operaciones", "Oficial de seguridad").

**Contactos externos**: Contactos de terceros extraídos de sus datos maestros de Contactos. Cada fila tiene un selector de **Contacto** y un campo de **Rol** (p. ej., "Gestor de cuenta", "Contacto NOC").

**Sitios web relevantes**: Enlaces útiles como portales de proveedores, documentación de instalaciones o páginas de estado. Cada fila tiene una **Descripción** y una **URL**.

Los cambios se guardan automáticamente. Añadir un contacto o un enlace lo guarda al momento, y un rol, una descripción o una URL se guarda al salir del campo.

---

### Relaciones

La pestaña Relaciones muestra los activos de esta ubicación y las aplicaciones que se ejecutan en ellos, y después los enlaces web de la ubicación. Haga clic en una fila para abrir el activo o la aplicación. La insignia de la pestaña cuenta los activos y las aplicaciones que puede ver, y los enlaces web.

| Sección | Columnas |
|---|---|
| **Activos** | Referencia (`AST-12`), nombre, sub-ubicación, tipo, entorno, proveedor, estado |
| **Aplicaciones** | Referencia (`APP-3`), nombre, entornos, ciclo de vida |

**Activos** lista los activos situados en esta ubicación. La columna **Sub-ubicación** solo aparece cuando al menos un activo tiene una sub-ubicación. La sección es de solo lectura: la ubicación de un activo se elige en el propio activo. Requiere poder leer la infraestructura.

**Aplicaciones** lista las aplicaciones con una instancia en uno de esos activos. **Entornos** muestra los entornos de esas instancias. La sección es de solo lectura y requiere poder leer las aplicaciones. Un Colaborador de negocio solo ve las aplicaciones en las que participa.

**Enlaces web**: los enlaces de la ubicación (portales de proveedores, documentación de instalaciones, páginas de estado), una fila cada uno con su nombre, el dominio del enlace y la fecha en que se añadió. Son los mismos enlaces que los **Sitios web relevantes** de la pestaña Contactos y soporte. Haga clic en un enlace para abrirlo en una pestaña nueva. Con `locations:member`:

- **Añadir enlace** abre un diálogo para una URL y un nombre opcional; el enlace se guarda al instante. Para cambiar un enlace, pase el cursor sobre su fila y haga clic en el lápiz.
- Para quitar un enlace, pase el cursor sobre su fila y haga clic en la cruz. Un mensaje nombra el enlace y ofrece **Deshacer**, que lo vuelve a crear.

---

## Eliminar una ubicación

Desde el encabezado del espacio de trabajo, haga clic en **Eliminar** (icono de papelera) para eliminar una ubicación.

- Requiere permiso `locations:member`.
- No se puede eliminar una ubicación que todavía tiene activos: el mensaje indica cuántos. Asigne primero esos activos a otra ubicación.
- Si tiene cambios sin guardar en el espacio de trabajo, esos cambios se pierden al eliminar.

---

## Tipos de alojamiento

Los tipos de alojamiento son configurables en **Panorama IT > Configuración**. Cada tipo pertenece a una categoría que controla qué campos aparecen en el espacio de trabajo.

| Tipo | Categoría | Ejemplo |
|------|-----------|---------|
| Centro de datos privado | Propio | Instalación de propiedad de la empresa |
| Colocación | Propio | Espacio alquilado en instalación compartida |
| Nube pública | Nube | AWS, Azure, GCP |
| Nube privada | Nube | Plataforma de nube operada por la empresa |
| Edge | Nube | Ubicaciones de computación en el borde |

---

## Permisos

| Acción | Nivel mínimo |
|--------|-------------|
| Ver la lista y espacio de trabajo | `locations:reader` |
| Crear, editar o eliminar una ubicación | `locations:member` |
| Configurar tipos de alojamiento y proveedores | `settings:admin` |

---

## Consejos

- **Sea consistente con los códigos**: Una convención de nomenclatura clara hace que las ubicaciones sean fáciles de identificar de un vistazo y mantiene los filtros útiles.
- **Use sub-ubicaciones para granularidad**: Si un centro de datos tiene múltiples salas o racks, modélelos como sub-ubicaciones en lugar de ubicaciones separadas. Esto mantiene la lista limpia mientras sigue rastreando la ubicación física.
- **Rastree regiones en la nube individualmente**: Cree una ubicación por región en la nube que use, no solo una por proveedor.
- **Vincule activos a ubicaciones**: Esto permite informes geográficos, planificación de recuperación ante desastres y análisis rápido de impacto durante incidentes.
- **Documente contactos temprano**: Tener los contactos de las instalaciones registrados antes de un incidente ahorra tiempo crítico cuando más importa.
