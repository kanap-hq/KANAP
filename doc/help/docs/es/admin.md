# Administración

La sección de Administración proporciona acceso a la gestión de usuarios, configuración de roles, facturación, ajustes de autenticación, controles de personalización y el visor de registro de auditoría. Estas páginas normalmente están restringidas a los administradores.

## Dónde encontrarla

Navegue a **Administración** desde el menú principal para acceder al centro de administración.

**Permisos**: Las distintas páginas de administración requieren permisos diferentes:
- Empresas, Departamentos, Proveedores, Cuentas: `{recurso}:reader` para ver
- Usuarios y acceso: `users:reader` para ver, `users:admin` para gestionar
- Roles: `users:reader` para ver, `users:admin` para editar
- Registro de auditoría: Requiere `users:admin`
- Facturación: Requiere el rol de administrador de facturación
- Autenticación: Requiere `users:admin` (con flag de funcionalidad; requiere SSO habilitado)
- Personalización: Requiere `users:admin` (solo host del espacio de trabajo; accesible desde la barra lateral)

---

## Centro de Administración

La página principal de Administración proporciona acceso rápido a las funciones administrativas principales:

| Tarjeta | Descripción | Permiso requerido |
|---------|-------------|-------------------|
| **Empresas** | Gestionar empresas y métricas anuales | `companies:reader` |
| **Departamentos** | Gestionar departamentos y plantilla | `departments:reader` |
| **Proveedores** | Gestionar proveedores y contactos | `suppliers:reader` |
| **Cuentas** | Gestionar códigos contables | `accounts:reader` |
| **Usuarios y acceso** | Gestionar usuarios y roles | `users:reader` |
| **Roles** | Definir permisos de roles | `users:reader` |
| **Registro de auditoría** | Consultar todo el historial de cambios | `users:admin` |
| **Facturación** | Plan y facturas | Administrador de facturación |

Autenticación y Personalización están disponibles desde la navegación lateral pero no aparecen en la página principal del centro de Administración.

---

## Registro de auditoría

La página de Registro de auditoría muestra el historial de cambios del espacio de trabajo para las actualizaciones de datos en toda la plataforma.

### Acceso

- Ruta: `/admin/audit-logs`
- Permiso requerido: `users:admin`
- Esta página es de solo lectura (no hay acciones de crear/editar/eliminar).

### Qué puede hacer

- Buscar por nombre de tabla, acción y actor (correo/nombre)
- Filtrar por:
  - Fecha
  - Tabla
  - Acción
  - Origen (`user`, `system`, `webhook`)
- Abrir cualquier fila para ver los detalles completos:
  - Chips de metadatos (fecha, tabla, acción, origen, referencia de origen, espacio de trabajo, ID de registro, usuario)
  - Resumen de campos modificados
  - Comparación lado a lado de los datos JSON **Antes** y **Después**

### Columnas

**Columnas predeterminadas**:
- **Fecha**: Cuándo ocurrió el cambio
- **Tabla**: Qué tabla de la base de datos fue afectada
- **Acción**: El tipo de cambio (crear, actualizar, eliminar, desactivar)
- **Origen**: Quién o qué desencadenó el cambio (usuario, sistema, webhook)
- **Usuario**: Correo del usuario que realizó el cambio (o "Sistema"/"Webhook" para orígenes no humanos)

**Columnas adicionales** (mediante el selector de columnas):
- **ID de registro**: Identificador del registro afectado
- **ID de usuario**: UUID del usuario que actuó
- **Nombre de usuario**: Nombre visible del usuario que actuó
- **Ref. de origen**: Referencia externa para cambios originados por webhook
- **ID de espacio de trabajo**: El espacio de trabajo al que pertenece esta entrada

### Paginación

- La cuadrícula utiliza paginación explícita con **100 filas por página**.
- Los filtros y la búsqueda se aplican a todo el conjunto de datos, no solo a la página actual.

### Comprender el origen y el actor

- **Origen = user**: cambio iniciado por una acción de usuario autenticado.
- **Origen = webhook**: cambio iniciado por un webhook externo (por ejemplo, eventos de sincronización de facturación). Utilice **Ref. de origen** para correlacionar los IDs del evento de origen.
- **Origen = system**: proceso interno de la plataforma sin un actor de usuario directo.

Si una cuenta de usuario ya no es resoluble en el contexto actual, la columna de Usuario puede mostrar un UUID alternativo (`Unknown (xxxx...)`) en lugar de un correo electrónico.

---

## Usuarios y acceso

Gestione quién puede acceder a KANAP y qué puede hacer.

### La cuadrícula de usuarios

**Columnas predeterminadas**:
- **Apellido** / **Nombre**: Nombre del usuario
- **Correo electrónico**: Correo de inicio de sesión
- **Cargo**: Su cargo en la organización
- **Estado**: Un punto de color con el estado de la cuenta. Vea más abajo.
- **Último inicio de sesión**: Cuándo inició sesión la persona por última vez, o **Nunca**
- **Roles**: todos los roles asignados al usuario
- **Tipo de cuenta**: **Local** para las cuentas que inician sesión con correo y contraseña, **Microsoft Entra** para las que inician sesión con Microsoft
- **Empresa** / **Departamento**: Asignación organizacional del usuario

**Columnas adicionales** (mediante el selector de columnas):
- **Teléfono de empresa** / **Teléfono móvil**: Números de contacto
- **MFA habilitado**: Si la autenticación multifactor está activa
- **Creado**: Cuándo se creó el usuario

**Valores de estado**:

| Estado | Significado |
|--------|-------------|
| **Activado** | La cuenta puede iniciar sesión y usar KANAP. |
| **Desactivado** | La cuenta se conserva con todo su historial, pero no puede iniciar sesión. |
| **Invitado** | Se envió una invitación y todavía no ha sido aceptada. |
| **Acceso pendiente** | La persona puede iniciar sesión pero no tiene ningún rol, así que no puede abrir nada. Asígnele un rol para darle acceso. |
| **Contacto** | Solo una entrada del directorio. La persona no inicia sesión. |

La cuadrícula muestra por defecto los usuarios **Activos**. Utilice el conmutador **Mostrar** para alternar entre **Todos**, **Activos**, **Invitados** y **Desactivados**.

### Acciones de gestión de usuarios

Acciones de la barra de herramientas:

| Acción | Descripción | Permiso |
|--------|-------------|---------|
| **Nuevo** | Crear un nuevo usuario | `users:admin` |
| **Importar CSV** | Importación masiva de usuarios | `users:admin` |
| **Exportar CSV** | Exportar lista de usuarios | `users:admin` |
| **Invitar** | Enviar invitaciones de inicio de sesión a los usuarios seleccionados | `users:admin` |
| **Desactivar** | Desactivar los usuarios seleccionados. Se cierra su sesión de inmediato. | `users:admin` |
| **Eliminar** | Eliminar permanentemente los usuarios seleccionados | `users:admin` |

`users:reader` basta para abrir la página y consultar la lista. Todas las acciones anteriores, y las acciones de fila siguientes, requieren `users:admin`.

Acciones de fila, desde el menú al final de cada fila:

| Acción | Descripción |
|--------|-------------|
| **Editar** | Abrir el usuario para editarlo. Hacer clic en la fila tiene el mismo efecto. |
| **Activar** / **Desactivar** | Activar o desactivar la cuenta. Al desactivarla se cierra la sesión de la persona de inmediato. |
| **Enviar invitación** | Enviar por correo una invitación de inicio de sesión. Oculta para las cuentas de Microsoft Entra. |
| **Enviar restablecimiento de contraseña** | Enviar por correo un enlace de restablecimiento de contraseña. Se muestra solo para cuentas locales activadas. |
| **Eliminar** | Eliminar el usuario permanentemente. Desactive la cuenta en su lugar si otros registros la referencian. |

### Archivo CSV de usuarios

**Exportar CSV** descarga la lista de usuarios. **Importar CSV** vuelve a leer un archivo. El diálogo de importación incluye también **Descargar plantilla**: un archivo solo con los encabezados.

Las columnas:

| Columna | Contenido |
|---|---|
| `email` | Obligatoria. Las filas se emparejan por esta dirección, así que escríbala tal como la tiene el espacio de trabajo |
| `first_name`, `last_name` | El nombre de la persona |
| `role` | El rol que se asignará. Una celda vacía da el rol **Contact** |
| `company_name` | La empresa, por su nombre. Opcional |
| `department_name` | El departamento, por su nombre. Necesita un `company_name` |
| `status` | `contact`, `invited`, `enabled` o `disabled`. Una celda vacía da `contact` |

La carga crea un rol que el archivo nombra y que su espacio de trabajo no tiene, con una descripción por defecto. La verificación lo lista y no crea nada: un archivo que solo comprueba no cambia ningún rol. Un nombre que aparece dos veces en el archivo se conserva una vez, gana la primera fila.

El archivo no contiene ninguna fecha ni ningún importe. Una importación no define ninguna contraseña: un usuario nuevo inicia sesión tras una invitación o un restablecimiento de contraseña.

Consulte [Archivos CSV](csv-files.md) para la codificación, el separador y los dos pasos de importación.

### Crear un usuario

1. Haga clic en **Nuevo**
2. Complete los campos obligatorios:
   - **Correo electrónico**: Dirección de correo de inicio de sesión (debe ser única)
3. Campos opcionales:
   - **Nombre** / **Apellido**: Nombre del usuario
   - **Puesto de trabajo**: Su cargo en la organización
   - **Teléfono profesional** / **Teléfono móvil**: Números de contacto
   - **Roles**: Asignar uno o más roles (determina los permisos)
   - **Empresa** / **Departamento**: Asignación organizacional
   - **Habilitado**: Si el usuario puede iniciar sesión
4. Haga clic en **Guardar** o **Guardar e invitar** para enviar el correo de inicio de sesión

### Asignación de múltiples roles

Se pueden asignar múltiples roles a los usuarios. Sus permisos efectivos son la combinación de todos los roles asignados: si cualquier rol otorga acceso a un recurso, el usuario tiene ese acceso.

Quitar todos los roles no elimina la cuenta. El usuario pasa al rol de sistema **Contacto**, se queda sin acceso y aparece como **Acceso pendiente** en la cuadrícula. No puede quitarse su propio último rol, así que no puede bloquearse a sí mismo.

### Gestión de puestos

La suscripción alojada incluye **usuarios ilimitados** — no hay límite de puestos que gestionar:
- **Usuarios habilitados**: Pueden iniciar sesión y usar KANAP
- **Usuarios deshabilitados**: Conservan sus datos pero ya no pueden iniciar sesión
- El contador en la barra de herramientas muestra el número de usuarios habilitados
- Active o desactive el interruptor **Habilitado** al editar un usuario para controlar el acceso

### Usuarios gestionados por Microsoft Entra

Las cuentas con el tipo de cuenta **Microsoft Entra** pertenecen a su directorio. Su perfil se actualiza desde Entra en dos momentos:

- **En cada inicio de sesión**, desde el perfil de Microsoft de la propia persona
- **Cada noche**, mediante la sincronización diaria del directorio, si un administrador de Microsoft Entra la ha aprobado. Consulte [Autenticación](#autenticacion).

Ambos actualizan los mismos campos: nombre, apellido, cargo, teléfono de empresa, teléfono móvil, y el departamento y la empresa, comparados por nombre con los registros que ya existen en KANAP. Los valores vacíos del directorio nunca borran lo que está almacenado en KANAP.

Las personas que también son colaboradores reciben además su **Responsable** desde el directorio, con la sincronización nocturna. KANAP relaciona el responsable declarado en Entra con su cuenta de KANAP y lo escribe en la ficha del colaborador, donde el campo pasa a ser de solo lectura. Un responsable que todavía no tiene cuenta de KANAP se recupera en una sincronización posterior. Consulte [Colaboradores](portfolio-team-members.md).

Al editar uno de estos usuarios, los campos de correo, nombre, cargo y teléfono están bloqueados, con la nota:

> Este usuario es gestionado por Microsoft Entra ID y no puede ser editado aquí. Última sincronización desde Microsoft Entra: {fecha}

Aún puede gestionar sus roles, empresa, departamento y el interruptor Habilitado.

Las cuentas de Microsoft Entra nunca tienen una contraseña de KANAP. No se les puede enviar una invitación ni un restablecimiento de contraseña.

Si alguien es eliminado de su directorio, o su cuenta del directorio es desactivada, la sincronización nocturna desactiva su cuenta de KANAP. Se cierra su sesión de inmediato y sus datos se conservan.

### Inicio de sesión inmediato con Microsoft

Cuando el inicio de sesión único está conectado, una persona que inicia sesión con Microsoft por primera vez obtiene automáticamente una cuenta de KANAP. Si ya existe una cuenta con la misma dirección de correo, se vincula a su identidad de Microsoft en lugar de crear otra.

Una cuenta nueva empieza con el rol de sistema **Contacto** y sin permisos. La persona ve una página que dice:

> Su cuenta aún no tiene acceso a KANAP. Pida a su administrador que le conceda acceso.

Los administradores reciben un correo cuando esto ocurre. Para dar acceso a la persona, abra **Administración > Usuarios**, búsquela con el estado **Acceso pendiente** y asígnele un rol.

---

## Roles

Defina qué puede hacer cada rol en todo KANAP.

### Cómo funcionan los roles

Cada rol tiene niveles de permiso para diferentes recursos:
- **Ninguno**: Sin acceso a este recurso
- **Lector**: Solo lectura
- **Colaborador**: Ver y editar elementos existentes, añadir comentarios y adjuntos, pero no puede crear nuevos elementos de nivel superior (actualmente utilizado para proyectos del portafolio)
- **Miembro**: Ver, crear y editar
- **Administrador**: Acceso completo incluyendo eliminación

### Grupos de permisos

Los recursos están organizados en grupos para facilitar la gestión:

**Presupuesto y Finanzas**
| Recurso | Qué controla |
|---------|--------------|
| `opex` | Gastos operativos |
| `capex` | Gastos de capital |
| `budget_ops` | Herramientas de administración presupuestaria, incluida la configuración de monedas |
| `contracts` | Contratos con proveedores |
| `analytics` | Dimensiones analíticas |
| `reporting` | Acceso a informes |

**Gestión del Portafolio**
| Recurso | Qué controla |
|---------|--------------|
| `portfolio_requests` | Solicitudes del portafolio |
| `portfolio_projects` | Proyectos del portafolio |
| `portfolio_planning` | Planificación del portafolio |
| `portfolio_reports` | Informes del portafolio |
| `portfolio_settings` | Configuración del portafolio |

**Panorama IT**
| Recurso | Qué controla |
|---------|--------------|
| `applications` | Aplicaciones |
| `infrastructure` | Servidores e infraestructura |
| `locations` | Datos maestros de ubicaciones |
| `settings` | Solo la configuración del panorama IT |

**Datos maestros**
| Recurso | Qué controla |
|---------|--------------|
| `companies` | Datos maestros de empresas |
| `departments` | Datos maestros de departamentos |
| `cost_centers` | Centros de coste y sus grupos |
| `working_day_profiles` | Calendarios laborales, para las líneas con precio por día |
| `suppliers` | Datos maestros de proveedores |
| `contacts` | Directorio de contactos |
| `accounts` | Plan de cuentas |
| `business_processes` | Catálogo de procesos de negocio |

**Tareas**
| Recurso | Qué controla |
|---------|--------------|
| `tasks` | Gestión de tareas |

**Base de conocimiento**
| Recurso | Qué controla |
|---------|--------------|
| `knowledge` | Artículos de la base de conocimiento |

El recurso de Base de conocimiento admite los niveles Lector, Miembro y Administrador (Colaborador no está disponible para este recurso).

**Administración**
| Recurso | Qué controla |
|---------|--------------|
| `users` | Gestión de usuarios y roles |
| `billing` | Facturación y suscripción |

### Tipos de roles

Los roles se clasifican según cómo pueden modificarse:

| Etiqueta | Descripción |
|----------|-------------|
| **Sistema** | No puede modificarse. Administrador tiene acceso completo; Contacto es solo para entradas del directorio. |
| **Integrado** | Roles preconfigurados que proporcionan patrones de acceso estándar. No se pueden modificar directamente; utilice **Duplicar** para crear una copia personalizable. |
| _(sin etiqueta)_ | Roles personalizados que usted crea. Totalmente editables. |

### Roles integrados

KANAP incluye roles preconfigurados organizados por área funcional:

**Presupuesto**: Administrador de presupuesto, Miembro de presupuesto, Lector de presupuesto
**Portafolio**: Administrador de portafolio, Miembro de portafolio, Lector de portafolio, **Colaborador de negocio**
**Panorama IT**: Administrador de panorama IT, Miembro de panorama IT, Lector de panorama IT
**Datos maestros**: Administrador de datos maestros, Miembro de datos maestros, Lector de datos maestros
**Tareas**: Administrador de tareas, Miembro de tareas, Lector de tareas

#### El rol de Colaborador de negocio

El rol de **Colaborador de negocio** está diseñado para partes interesadas del negocio que participan en el proceso del portafolio sin privilegios completos de gestión de proyectos. Un Colaborador de negocio puede:

- **Enviar y gestionar solicitudes del portafolio** (acceso completo de miembro a solicitudes)
- **Editar proyectos existentes**: actualizar campos, añadir comentarios, subir adjuntos, gestionar fases, hitos, dependencias y entradas de tiempo
- **Crear y trabajar en tareas del proyecto**: añadir tareas a proyectos, registrar tiempo y publicar comentarios
- **Ver usuarios, empresas, departamentos y contactos** para selecciones en desplegables

Un Colaborador de negocio **no puede**:
- Crear nuevos proyectos (requiere nivel Miembro en proyectos del portafolio)
- Convertir solicitudes en proyectos (requiere nivel Miembro)
- Importar/exportar CSV (requiere nivel Administrador)

Este rol cubre la brecha entre el acceso de solo lectura (Lector) y la gestión completa de proyectos (Miembro), permitiendo a los usuarios de negocio contribuir activamente sin la capacidad de crear nuevos proyectos.

### El rol de Contacto

El rol de **Contacto** es un rol especial del sistema para usuarios que aparecen en listas desplegables pero no necesitan iniciar sesión. Usos comunes:

- Solicitantes o patrocinadores que solo necesitan ser referenciados, no usuarios activos
- Partes interesadas externas listadas con fines de seguimiento
- Entradas de marcador de posición para la estructura organizacional

**Usuarios con rol de Contacto:**
- No pueden iniciar sesión en KANAP
- No cuentan en el total de usuarios habilitados
- No reciben notificaciones por correo electrónico (incluso si están asignados a proyectos/tareas)
- Pueden ser seleccionados en desplegables de usuario (p. ej., como patrocinador del proyecto)

Si alguien con el rol de Contacto necesita usar activamente KANAP, cambie su rol a un rol regular (p. ej., Lector, Miembro) e invítelo.

Hay una excepción: la persona creada automáticamente en su primer inicio de sesión con Microsoft también tiene el rol de Contacto. Puede iniciar sesión, pero solo llega a la página de acceso pendiente hasta que le asigne un rol. La cuadrícula la muestra como **Acceso pendiente**.

### Gestión de roles

La página de Roles tiene un diseño de dos paneles:
- **Panel izquierdo**: Lista de todos los roles con etiquetas indicando el tipo y un conteo de usuarios para cada rol
- **Panel derecho**: Detalles y permisos del rol seleccionado

**Acciones**:
- **Nuevo rol**: Crear un rol personalizado desde cero
- **Duplicar**: Copiar un rol existente (incluyendo roles integrados) como punto de partida. No disponible para roles de Sistema.
- **Eliminar**: Eliminar un rol personalizado (solo si no tiene usuarios asignados)
- **Guardar detalles**: Actualizar nombre y descripción del rol
- **Guardar permisos**: Aplicar cambios de permisos

### Crear un rol personalizado

1. Haga clic en **Nuevo rol**
2. Introduzca un nombre y una descripción
3. Haga clic en **Crear**
4. Configure los niveles de permiso para cada grupo de recursos
5. Haga clic en **Guardar permisos**

**Consejo**: Comience duplicando un rol integrado que se aproxime a lo que necesita, y luego ajuste los permisos.

---

## Facturación

Gestione su suscripción, usuarios y facturas.

### Resumen de la suscripción

La tarjeta de suscripción muestra su plan actual de un vistazo:
- **Plan**: Hosted KANAP (o Prueba gratuita). La suscripción incluye usuarios ilimitados — facturación mensual o anual
- **Puestos**: Número de usuarios habilitados
- **Estado**: Activo, En prueba, Pago vencido, Cancelado, etc.
- **Fecha de renovación**: Cuándo comienza el siguiente ciclo de facturación

Para suscripciones activas (no pruebas locales), se muestran detalles adicionales:
- **Importe por período**: Coste del ciclo de facturación actual
- **Frecuencia de facturación**: Mensual o Anual
- **Método de cobro**: Cargo automático o Factura (pago manual)
- **Método de pago**: Datos de la tarjeta o Transferencia bancaria
- **Última sincronización con Stripe**: Cuándo se actualizaron por última vez los datos de suscripción desde Stripe

Si la suscripción está en período de prueba, se muestran los días restantes de prueba.

### Acciones

- **Elegir plan** / **Cambiar plan**: Abrir el cuadro de diálogo del plan para suscribirse o alternar entre facturación mensual y anual. Requiere administrador de facturación.
- **Gestionar suscripción**: Abrir el portal de cliente de Stripe para actualizar métodos de pago, cancelar u otros cambios. Solo disponible cuando existe una suscripción de Stripe.

Si su suscripción no está en buen estado (prueba expirada, pago vencido, etc.), el cuadro de selección de plan se abre automáticamente al visitar la página de Facturación.

### Historial de facturas

Las facturas anteriores se muestran debajo de la tarjeta de suscripción:
- Número de factura y fecha
- Estado (Borrador, Abierta, Pagada, Anulada, Incobrable)
- Importe y moneda
- **Ver**: Abrir la factura en el visor alojado de Stripe
- **Descargar**: Descargar la factura en PDF

Por defecto, se muestran las cinco facturas más recientes. Haga clic en **Mostrar más facturas** para ver el historial completo.

### Información del cliente

Actualice los datos de contacto asociados a su registro de cliente en Stripe:
- **Nombre del cliente** y **Empresa**
- **Correo electrónico** y **Teléfono**
- **Número de IVA**
- **Dirección** (línea 1, línea 2, ciudad, estado/provincia, código postal, país)

### Información de facturación

Datos de contacto separados utilizados específicamente en las facturas. Haga clic en **Copiar del cliente** para autocompletar a partir de la información del cliente anterior.

Los campos coinciden con la sección de información del cliente: nombre del destinatario, empresa, correo electrónico, teléfono, número de IVA y dirección completa.

Haga clic en **Guardar cambios** para actualizar tanto los datos del cliente como los de facturación. Utilice **Restablecer** para descartar las ediciones no guardadas.

---

## Autenticación

Configure el inicio de sesión único (SSO) para su organización. Esta página solo está disponible cuando la funcionalidad SSO está habilitada y no es accesible desde el host de administración de la plataforma.

### Microsoft Entra ID

Conecte KANAP a su inquilino de Microsoft Entra ID para SSO:

1. Haga clic en **Conectar**
2. Inicie sesión con una cuenta de administrador de Microsoft
3. Conceda los permisos solicitados
4. Los usuarios ahora pueden iniciar sesión con sus cuentas de Microsoft

### Estado del SSO

- **Conectado**: Muestra su ID de inquilino de Entra
- **No conectado**: Solo autenticación local

### Acciones

| Acción | Descripción |
|--------|-------------|
| **Conectar** | Iniciar el flujo de configuración de Microsoft Entra |
| **Reconectar** | Volver a ejecutar el flujo de configuración (se muestra cuando ya está conectado) |
| **Probar inicio de sesión** | Probar el inicio de sesión SSO con su cuenta de Microsoft |
| **Desconectar** | Eliminar la configuración SSO (vuelve a autenticación local) |

### Sincronización diaria del directorio

Este bloque aparece debajo de la tarjeta de Entra una vez conectado el inicio de sesión único. Cada noche a las 03:00 hora del servidor, KANAP actualiza nombres, cargos, teléfonos, departamentos y empresas desde Microsoft Entra, actualiza el responsable de las personas que son colaboradores, y desactiva las cuentas eliminadas o desactivadas en el directorio.

Los departamentos y las empresas se comparan por nombre con los registros que ya existen en KANAP. No se crea nada automáticamente. Los valores vacíos del directorio nunca borran lo que ya está almacenado en KANAP.

La sincronización necesita una aprobación única por parte de un administrador de Microsoft Entra. Hasta que se otorgue, el bloque muestra **Aún no autorizado. Un administrador de Microsoft Entra debe conceder a KANAP permiso para leer los usuarios del directorio.**

| Estado o acción | Qué significa |
|-----------------|---------------|
| **Aún no autorizado...** | Ningún administrador de Microsoft Entra ha aprobado la sincronización, o falta el permiso requerido en el registro de aplicación. |
| **Conceder acceso en Microsoft Entra** | Le lleva a la página de aprobación de Microsoft. Se muestra mientras la sincronización no está autorizada. Vuelve con **Acceso concedido. La primera sincronización está en curso.** |
| **Última sincronización {fecha}: N cuentas actualizadas, N desactivadas.** | Resultado de la última ejecución correcta. |
| **La última sincronización falló: {mensaje}** | La última ejecución no se completó. El mensaje proviene de Microsoft. |
| **Sincronizar ahora** | Ejecuta la sincronización de inmediato en lugar de esperar a esta noche. Informa **Sincronización completada: N cuentas actualizadas, N desactivadas.** |

Los pasos de configuración del registro de aplicación de Entra están en [SSO con Microsoft Entra](on-premise/sso-entra.md).

---

## Personalización

Utilice **Administración > Personalización** para aplicar la identidad de su empresa en KANAP.

- Ruta: `/admin/branding`
- Permiso: `users:admin`
- Alcance: solo hosts de espacio de trabajo (no disponible en el host de administración de la plataforma)

La Personalización le permite:
- Subir o eliminar el logotipo de su espacio de trabajo
- Controlar si el logotipo se muestra en modo oscuro
- Configurar colores primarios separados para los modos claro y oscuro
- Restablecer toda la personalización a los valores predeterminados

Para instrucciones detalladas paso a paso, consulte: [Personalización](branding.md)

---

## Configuración

La página de Configuración le permite gestionar su perfil personal y sus preferencias de notificación. Acceda a ella desde el menú de usuario (avatar superior derecho) o navegue a `/settings`.

La página tiene dos pestañas, accesibles por URL:
- `/settings/profile` (predeterminada) -- Pestaña de Perfil
- `/settings/notifications` -- Pestaña de Notificaciones

### Perfil

Edite su información personal:
- **Nombre** / **Apellido**
- **Puesto de trabajo**
- **Teléfono profesional** / **Teléfono móvil**

Si su organización utiliza Microsoft Entra ID (SSO), algunos campos pueden estar sincronizados desde Entra y no pueden editarse en KANAP.

### Notificaciones

Controle qué notificaciones por correo electrónico recibe.

**Conmutador principal**: Active o desactive todas las notificaciones por correo electrónico con el interruptor **Notificaciones por correo electrónico** en la parte superior.

**Categorías por espacio de trabajo** (cada una con su propio conmutador de activar/desactivar):

| Espacio de trabajo | Categorías de notificación |
|---------------------|----------------------------|
| **Portafolio** | Cambios de estado, cuando se le añade a un equipo, cambios de equipo en elementos que usted dirige, comentarios |
| **Tareas** | Asignación (como asignado, solicitante o visor), cambios de estado, comentarios |
| **Presupuesto** | Alertas de vencimiento, cambios de estado, comentarios |

Las **Alertas de vencimiento** envían un correo a los responsables de un contrato, de una partida OPEX o de una partida CAPEX 30, 14, 7 y 1 día(s) antes de sus fechas: el plazo de cancelación y la fecha de fin de un contrato, el fin de validez de una partida OPEX o CAPEX. Solo las reciben los responsables que activaron las notificaciones de Presupuesto y las **Alertas de vencimiento**. La comprobación se ejecuta cada día a las 08:00 UTC. Cada recordatorio se envía una sola vez al día a cada destinatario, aunque la comprobación vuelva a ejecutarse ese día, por ejemplo tras un reinicio.

**Correo electrónico de revisión semanal**: Reciba un resumen periódico de su actividad y elementos próximos. Configure:
- **Día de la semana** (p. ej., Lunes)
- **Hora** (hora en su zona horaria)
- **Zona horaria**

Utilice el botón **Vista previa del correo** para enviarse un correo de prueba y verificar el formato.

Todos los cambios se guardan automáticamente al activar/desactivar interruptores o cambiar selecciones.

---

## Consejos

  - **Duplique roles integrados**: En lugar de crear roles desde cero, duplique un rol integrado y ajuste los permisos. Esto ahorra tiempo y garantiza que no omita recursos importantes.
  - **Use múltiples roles para mayor flexibilidad**: Asigne a los usuarios múltiples roles para combinar permisos, por ejemplo, un rol de "Lector de finanzas" más un rol de "Gestor de proyectos".
  - **Utilice SSO**: Si tiene Microsoft 365, conecte Entra ID para facilitar la gestión de usuarios y la sincronización automática de perfiles.
  - **Desactive, no elimine**: Cuando alguien se va, desactive su cuenta para preservar el historial de auditoría.
  - **Revise los permisos periódicamente**: Audite los permisos de los roles de forma regular para mantener el principio de mínimo privilegio.
