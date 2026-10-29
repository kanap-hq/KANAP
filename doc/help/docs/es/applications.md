# Aplicaciones

Aplicaciones es su registro central para documentar el panorama de aplicaciones IT. Cubre aplicaciones de negocio, herramientas de productividad, servicios de infraestructura y todo lo intermedio. Utilícelo para hacer seguimiento de la propiedad, despliegues, integraciones, relaciones financieras e información de conformidad en todo su portafolio.

## Categorías de aplicaciones

Cada aplicación o servicio pertenece a una **categoría** que describe su propósito principal. Esta clasificación ayuda a diferentes partes interesadas a filtrar y centrarse en lo que les importa.

| Categoría | Descripción | Ejemplos |
|-----------|-------------|----------|
| **Línea de negocio** | Aplicaciones de negocio principales que soportan procesos de negocio específicos | SAP, Salesforce, Workday, ERP personalizado |
| **Productividad** | Herramientas para el usuario final en el trabajo diario, incluidas utilidades y colaboración | Office 365, Acrobat Reader, Teams, Slack, Chrome |
| **Seguridad** | Herramientas para proteger sistemas, datos y acceso | CrowdStrike, Okta, plataformas SIEM, firewalls |
| **Analítica** | Herramientas de informes, inteligencia de negocio y almacén de datos | Power BI, Tableau, Snowflake |
| **Desarrollo** | Herramientas utilizadas por equipos de desarrollo y DevOps | Python, Git, Jenkins, VS Code, Docker |
| **Integración** | Plataformas que conectan sistemas y mueven datos | MuleSoft, Kafka, pasarelas API, herramientas ETL |
| **Infraestructura** | Servicios fundamentales de los que dependen otros sistemas | PostgreSQL, Redis, Kubernetes, sistemas de almacenamiento |

**Consejos para la clasificación**:
- Elija según el **propósito principal** de la aplicación, no según quién la gestiona
- En caso de duda, pregunte: "¿Para qué se usa principalmente esta herramienta?"
- Las categorías pueden personalizarse en **Panorama IT > Configuración** para coincidir con la terminología de su organización

### Filtrado por parte interesada

Diferentes equipos pueden usar categorías para centrarse en su área de responsabilidad:

| Parte interesada | Filtro sugerido |
|-------------------|-----------------|
| Ciberseguridad | Categoría Seguridad, o alta criticidad en todas las categorías |
| Mesa de servicio | Productividad + Línea de negocio (aplicaciones orientadas al usuario) |
| Infraestructura | Infraestructura + Integración |
| Arquitectura empresarial | Todas las categorías |

---

## Primeros pasos

Navegue a **Panorama IT > Aplicaciones** para ver su lista. Haga clic en **Nueva App / Servicio** para crear su primera entrada.

**Campos obligatorios**:
- **Nombre**: Un nombre reconocible para la aplicación o servicio, de 200 caracteres como máximo. Consulte [Nombres únicos](#unique-names)
- **Categoría**: El propósito principal de esta aplicación (ver categorías arriba)
- **Ciclo de vida**: Estado actual (Activo, Propuesto, Obsoleto, Retirado, o cualquier código personalizado definido en Configuración)

**Muy recomendados**:
- **Proveedor**: El proveedor que proporciona el software (vinculado a sus datos maestros de Proveedores)
- **Editor**: El editor del software (p. ej., Microsoft, SAP, Oracle)
- **Descripción**: Qué hace esta aplicación

Los campos de clasificación son opcionales al crear una aplicación. La **Criticidad de negocio**, la criticidad cibernética, la confidencialidad de los datos y la ola de recuperación se eligen entre los niveles que su organización definió en **Panorama IT > Configuración**; cada opción muestra la definición del nivel. Los valores permanecen sin definir hasta que usted los seleccione.

**Opcionales pero útiles**:
- **Versión**: Identificador de versión actual (texto libre, p. ej., "4.2.1", "2023", "T1 2024")
- **Fecha de puesta en marcha**: Cuándo esta versión entró o entrará en producción
- **Fin de soporte**: Cuándo finaliza el soporte del proveedor para esta versión
- **Fecha de retiro**: Cuándo esta versión fue efectivamente decomisionada
- **Licencia**: Términos y notas de licencia
- **Notas**: Notas internas de texto libre
- **Puede tener apps hijas**: Active esto para usar esta aplicación como una "suite" que agrupa otras aplicaciones

El **Fin de soporte** y la **Fecha de retiro** no pueden ser anteriores a la **Puesta en marcha**.

Una vez que guarde, el espacio de trabajo desbloquea todas las pestañas para documentación detallada.

### Nombres únicos { #unique-names }

Dos aplicaciones no pueden tener el mismo nombre. La comparación no distingue mayúsculas de minúsculas e ignora los espacios al principio y al final del nombre: `CRM` y ` crm ` son el mismo nombre. Si el nombre ya está en uso, el mensaje nombra la aplicación que lo tiene, con su referencia (`APP-12`). La regla se aplica cuando crea, renombra, copia o importa una aplicación, y cuando crea una nueva versión.

Las aplicaciones que ya compartían nombre antes de esta regla siguen siendo editables. Su nombre solo se comprueba cuando cambia.

**Consejo**: Comience documentando sus aplicaciones más críticas. Utilice la pestaña **Despliegues** para capturar qué entornos existen (Prod, QA, Dev) y qué servidores los ejecutan, luego vincule interfaces, contratos y líneas presupuestarias a medida que avance.

**Permisos**:
- Ver: `applications:reader`
- Crear / editar: `applications:member`
- Importar / Exportar / Eliminar: `applications:admin`

---

## Trabajar con la lista { #working-with-the-list }

La cuadrícula de Aplicaciones proporciona una vista completa de su portafolio de aplicaciones.

**Filtro de alcance superior (Mostrar)**:
- **Mis aplicaciones**: muestra apps donde usted está listado en el panel de propiedades como **Responsable de negocio** o **Responsable IT**. Se admiten entradas con múltiples responsables.
- **Aplicaciones de mi equipo**: muestra apps donde cualquier miembro de su equipo de Portafolio está listado como Responsable de negocio o Responsable IT. Su propia propiedad también se incluye en este alcance. Deshabilitado si no está asignado a un equipo de Portafolio.
- **Todas las aplicaciones** (predeterminado): muestra la cuadrícula completa de Aplicaciones con el comportamiento predeterminado del filtro de ciclo de vida.
- Su selección se recuerda entre sesiones: al volver a la página se restaura su última elección.

**Columnas predeterminadas**:
- **Nombre**: Nombre de la aplicación, con debajo una línea "Incluida en: {suite}" para una aplicación incluida en una suite
- **Vulnerabilidades por revisar**: las vulnerabilidades aún por revisar en las tecnologías que la aplicación declara o que sus servidores de despliegue tienen registradas y, en naranja, cuántas son críticas o altas (`5 · 2`). Vacía para una aplicación desactivada o cuando no queda ninguna. Haga clic para abrir la página [Vulnerabilidades](vulnerabilities.md) filtrada por la aplicación. Presente cuando se siguen las vulnerabilidades. Consulte [Lo que KANAP cuenta](vulnerabilities.md#what-kanap-counts)
- **Categoría**: El propósito principal de la aplicación
- **Entornos**: Chips de colores que muestran entornos activos (Prod, Pre-prod, QA, Test, Dev, Sandbox). Pase el ratón para ver la URL base y el ciclo de vida.
- **Ciclo de vida**: Estado actual
- **Criticidad de negocio**: Nivel de importancia para el negocio
- **Editor**: Editor del software
- **Usuarios derivados {año}**: los usuarios contados para las empresas y departamentos de la audiencia en el año en curso, o en el año más cercano con datos. Un número de usuarios indicado a mano lo sustituye. La información emergente del encabezado lo explica
- **Creado**: Cuándo se creó el registro

Una celda sin valor muestra un guion.

**Ordenación predeterminada**: **Nombre** ascendente (A a Z).

**Columnas adicionales** (mediante el selector de columnas):
- **Suites**: Suites padre a las que pertenece esta aplicación
- **Proveedor**: Nombre del proveedor vinculado
- **Responsables de negocio** / **Responsables IT**: Responsables asignados (truncado, pase el ratón o haga clic para verlos todos)
- **Alojamiento**: Derivado de las ubicaciones de servidores asignados a los despliegues de la app. Una aplicación en un clúster toma también las ubicaciones de sus miembros
- **Acceso externo**: Si la app es accesible desde internet
- **SSO habilitado** / **MFA habilitado**: Características de autenticación
- **Integración de datos / ETL**: Si la app participa en integraciones de datos
- **Líneas OPEX** / **Líneas CAPEX** / **Contratos**: Gasto y contratos vinculados
- **Componentes**: Aplicaciones hijas (si es una suite)
- **Clase de datos** / **Contiene PII** / **Residencia de datos**: Información de conformidad
- **Criticidad cibernética**, **Ola de recuperación**, **RTO**, **RPO**, **Estado/fecha de revisión**: Campos de clasificación y continuidad

**Progreso de la clasificación**: el mosaico Conformidad de su panel muestra cuántas aplicaciones visibles están revisadas, por revisar o aún tienen campos de clasificación por completar, además de los puntos que requieren acción. Cada cifra abre la lista de aplicaciones filtrada en consecuencia. Consulte [Mi panel](my-dashboard.md#conformidad).

**Filtrado**:
- Búsqueda rápida: coincide con el nombre y editor
- Los filtros de criticidad, criticidad cibernética, clase de datos y ola de recuperación listan sus valores en el orden del catálogo (la más crítica primero, las olas en orden de restauración).
- La mayoría de columnas usan filtros de conjunto de casillas que solo muestran los valores presentes en el conjunto de resultados actual. **Todos** marca todos los valores y **Ninguno** los desmarca todos. El filtro flotante muestra `Todos`, `Ninguno` o `N seleccionados` con una **x** para limpiar.
- Las aplicaciones retiradas están ocultas por defecto; use el filtro de **Ciclo de vida** para incluir Retiradas.
- **Vulnerabilidades por revisar** filtra por **Con vulnerabilidades graves**, **Con vulnerabilidades** o **Sin**, y ordena por las vulnerabilidades críticas o altas y luego por el total. Las aplicaciones desactivadas van al final y no entran en ningún valor del filtro.

**Acciones**:
- **Nueva App / Servicio**: Crear una nueva entrada (`applications:member`)
- **Importar**: Importación masiva desde un archivo CSV o un libro de Excel (`applications:admin`)
- **Exportar**: Exportar las aplicaciones que muestra la lista a un archivo CSV o un libro de Excel (`applications:admin`). Consulte [Opciones de exportación](#export-options).
- **Copiar elemento**: Duplicar una aplicación seleccionada con todas sus relaciones principales (`applications:member`). Consulte [Copiar aplicaciones](#copiar-aplicaciones) para saber qué se copia y qué no.
- **Eliminar seleccionadas**: Eliminar aplicaciones seleccionadas (`applications:admin`). Una aplicación que es origen o destino de una interfaz no se puede eliminar: desactívela en su lugar, o elimine primero sus interfaces. Antes de la confirmación, la ventana muestra esas aplicaciones como conservadas, con su número de interfaces. Las demás se eliminan con sus despliegues y sus vínculos con otros elementos; la confirmación cuenta los despliegues

---

## El espacio de trabajo de Aplicaciones

Haga clic en cualquier fila para abrir el espacio de trabajo. El espacio de trabajo tiene un **encabezado** con metadatos rápidos, un **panel de propiedades** a la derecha (la tarjeta de identidad de la aplicación, siempre visible) y un **área de contenido** en el centro que cambia con cada pestaña.

Las pestañas son **Vista general**, **Despliegues**, **Interfaces**, **Operaciones**, **Conformidad**, **Relaciones** e **Historial** (los cambios de la aplicación, vea [Historial de los registros](record-history.md)).

### Encabezado

El encabezado muestra:
- **Nombre de la aplicación** (editable en línea)
- **Referencia**: identificador corto que puede copiar
- Chip de **Ciclo de vida**: haga clic para cambiar
- Chip de **Criticidad de negocio**: muestra el nivel y abre un menú con los niveles de la organización
- **Vulnerabilidades graves**, por ejemplo «3 graves»: las vulnerabilidades críticas o altas aún por revisar en la aplicación, con el color de la más alta. Un icono de alerta aparece cuando algunas se conocen como explotadas. Haga clic para abrir la página [Vulnerabilidades](vulnerabilities.md) filtrada por la aplicación. Solo se muestra cuando la aplicación tiene alguna
- Chip de **Versión** (si hay versión definida): haga clic para copiar
- Fecha de **Puesta en marcha**
- **Compartir**: copiar un enlace compartible a este espacio de trabajo
- **Nueva versión**: lanzar el asistente de migración de versión (consulte [Gestión de versiones](#gestion-de-versiones))
- **Convertir en tecnología** (`applications:admin` e `infrastructure:member`): consulte [Convertir una aplicación en tecnología](#convertir-una-aplicacion-en-tecnologia)
- **Eliminar**, un icono de papelera con su nombre en una información emergente (`applications:admin`): una aplicación con interfaces recibe el rechazo y el motivo, solo con Cerrar. Si no, la confirmación nombra la aplicación y cuenta los despliegues eliminados con ella, junto con sus vínculos con otros elementos
- **Anterior / Siguiente**: recorrer la lista filtrada sin volver a la cuadrícula

### Panel de propiedades (panel derecho)

El panel es la tarjeta de identidad de la aplicación. Se muestra en cada pestaña y se edita en línea: los cambios se guardan automáticamente.

**Identidad**:
- **Categoría**, **Proveedor**, **Editor**
- **Incluida en**: las suites a las que pertenece esta aplicación. Elija una en **Añadir una suite**: la lista ofrece las aplicaciones que tienen marcada **Puede contener aplicaciones secundarias**. Cada nombre abre la suite. Para quitar una, pase el cursor sobre su nombre y haga clic en la cruz al final. Una suite puede pertenecer a otra suite, pero se rechaza un vínculo que crearía un bucle (por ejemplo, una suite dentro de uno de sus propios componentes)

**Versión y fechas del ciclo de vida**:
- **Versión**. Debajo, **Versión anterior** abre la aplicación a partir de la cual se creó esta con **Nueva versión**, y **Versión siguiente** abre las aplicaciones creadas a partir de ella. Estos enlaces solo aparecen cuando existen tales aplicaciones
- **Puesta en marcha**, **Fin de soporte**, **Fecha de retiro**. El **Fin de soporte** y la **Fecha de retiro** no pueden ser anteriores a la **Puesta en marcha**

**Procesos de negocio y responsables**:
- **Procesos de negocio**: los procesos que la aplicación respalda. Cada nombre abre el proceso. Escriba en el campo para buscar y añadir un proceso; pase el cursor sobre un nombre y haga clic en la cruz para quitarlo. Cada cambio se guarda al instante. El proceso muestra el mismo vínculo en su propia sección **Aplicaciones**. Un proceso desactivado sigue en la lista, atenuado. Cambiar la lista requiere también `business_processes:member`; sin permiso de lectura de los procesos de negocio, el campo no aparece.
- **Responsables de negocio**: partes interesadas del negocio responsables de esta aplicación (selección múltiple)
- **Responsables IT**: miembros del equipo IT responsables del soporte técnico (selección múltiple)

Para quitar un responsable, pase el cursor sobre su nombre y haga clic en la cruz al final.

Al quitar un responsable, un proceso de negocio, una suite o un contacto de soporte aparece un mensaje con **Deshacer**, que lo restablece.

**Audiencia**:
- Añada filas de **Empresa / Departamentos** para registrar quién usa esta aplicación. Elija una empresa y opcionalmente restrinja a departamentos específicos.
- Una línea bajo la audiencia indica lo que abarca. Sin ningún departamento elegido, la audiencia es toda la empresa. Con departamentos elegidos, se limita a esos departamentos: quítelos para volver a incluir toda la empresa.
- Se muestra un conteo de **Usuarios** en vivo.
- **Método de cálculo**: **Derivado** (calculado automáticamente a partir de la audiencia basándose en las métricas de Usuarios IT / Plantilla de los datos maestros) o **Manual** (un único número de sustitución que usted introduce).

---

### Visión general

La pestaña Visión general es la narrativa de la aplicación. Contiene:

**Descripción**: Una descripción enriquecida de la aplicación. El editor guarda automáticamente mientras escribe. Quien puede modificar la aplicación puede modificar su descripción, sin permiso sobre la base de conocimiento. La descripción se guarda como documento gestionado en la base de conocimiento. Su título lleva la referencia y el nombre de la aplicación, en el idioma de la persona que lo creó. Al renombrar la aplicación, en el espacio de trabajo o por una importación, ese título se actualiza.

**Conexiones**: Un resumen de solo lectura construido a partir de las interfaces de la aplicación. Para apps no middleware muestra dos filas: **Recibe de** y **Envía a**. Para apps ETL/middleware muestra una única fila **Conectado a**. Cada entrada es una píldora clicable que abre la aplicación relacionada; "+ N más en Interfaces" salta a la pestaña Interfaces.

**Conocimiento**: Artículos de conocimiento vinculados. Si tiene `knowledge:member`, puede crear nuevos artículos directamente desde esta sección.

**Soporte**:
- Una tabla de contactos de soporte extraída de sus datos maestros de Contactos. Cada fila muestra el nombre del contacto, correo, teléfono y un rol de texto libre (p. ej., Gestor de cuenta, Soporte N1).
- **Añadir contacto** abre un diálogo para elegir un contacto y definir un rol.
- **Notas de soporte**: texto libre para los acuerdos de soporte (SLA, vías de escalado, información de guardias).

---

### Despliegues

La pestaña Despliegues documenta dónde se ejecuta realmente la aplicación: un bloque por entorno, con los servidores asignados a cada uno.

**Entornos**: Producción, Pre-producción, QA, Test, Desarrollo, Sandbox.

**Para cada despliegue puede capturar**:
- **Ciclo de vida**: estado por entorno (Activo, Propuesto, Obsoleto, Retirado, etc.)
- **URL base**: la URL de acceso para este entorno
- **SSO habilitado** / **MFA soportado**
- **Notas**

**Añadir despliegue** abre un diálogo donde define entorno, ciclo de vida, URL base, indicadores SSO/MFA y notas. Cada entorno solo puede añadirse una vez. El chip de ciclo de vida en el encabezado de un despliegue también puede cambiarse en línea desde un menú emergente. Un despliegue que todavía tiene servidores o enlaces de interfaz no se puede eliminar: retírelos primero.

**Servidores por despliegue**: Cada bloque de despliegue muestra una tabla de servidores asignados:

| Columna | Qué muestra |
|---------|-------------|
| **Servidor** | Nombre del activo (clicable) |
| **Rol** | p. ej., Web, Base de datos, Aplicación (de la lista de roles de servidor en Configuración) |
| **Alojamiento** | Derivado de la ubicación del activo |
| **Desde** | Fecha en que se asignó el servidor a este despliegue |

Haga clic en **Añadir servidor** en el encabezado del despliegue para vincular un activo. El selector lista los clústeres con sus miembros bajo su nombre. La asignación de un clúster llega a sus miembros en servicio: aparecen bajo la fila del clúster, sin acciones. Modifique la asignación en el clúster. Cuando elige un miembro de un clúster, KANAP pregunta si asignar el clúster o solo este servidor. Consulte [Aplicaciones en un clúster](assets.md#applications-on-a-cluster). Añadir, cambiar o quitar un servidor requiere `applications:member` e `infrastructure:member`.

Cuando la aplicación está asignada directamente a cada miembro en servicio de un clúster, una línea bajo la tabla los nombra, con un botón para asignar la aplicación al clúster (**Asignar a** y su nombre). Tras una confirmación, el clúster toma la asignación y se quitan las asignaciones propias de los miembros. La aplicación sigue entonces disponible mientras un miembro siga activo.

**Consejo**: Documente primero los servidores en **Panorama IT > Activos**, luego vincúlelos aquí. La pestaña Operaciones del activo muestra las mismas asignaciones de forma inversa, en **Aplicaciones alojadas**.

---

### Interfaces

La pestaña Interfaces muestra todas las integraciones en las que participa esta aplicación: como origen, destino o middleware. La insignia de la pestaña muestra el conteo total.

Las interfaces se **agrupan por entorno** (PROD, PRE_PROD, QA, ...). Dentro de cada entorno se dividen en:

- **Entrantes**: esta aplicación recibe datos
- **Salientes**: esta aplicación envía datos
- **Enrutadas**: esta aplicación es el middleware/ETL para un flujo entre otras dos apps

Cada fila muestra el nombre de la interfaz, la aplicación contraparte y un indicador **Vía middleware**. Haga clic en la fila para abrir el espacio de trabajo de la interfaz; haga clic en la contraparte para abrir la otra aplicación.

**Consejo**: Las interfaces se gestionan desde la página de Interfaces. Esta pestaña es una vista de solo lectura por conveniencia, pero es la forma más rápida de navegar entre aplicaciones conectadas.

---

### Operaciones { #operations }

La pestaña Operaciones reúne, en este orden, cómo acceden los usuarios a la aplicación (**Técnico**), las tecnologías de las que depende y sus vulnerabilidades.

**Técnico**:
- **Métodos de acceso** (selección múltiple): cómo acceden los usuarios a esta aplicación. Las opciones son configurables en [Configuración del Panorama IT](it-ops-settings.md). Los valores predeterminados incluyen Web, Aplicación instalada localmente, Aplicación móvil, HMI propietario (interfaz industrial), Terminal / CLI, VDI / Escritorio remoto, Kiosk.
- **Acceso externo**: si la aplicación es accesible desde internet
- **Integración de datos / ETL**: si la aplicación participa en pipelines de integración de datos (también activa el modo "middleware" para esta app en las vistas de Interfaces y Conexiones)
- **Puede tener apps hijas**: convertir esta aplicación en una Suite que agrupa otras aplicaciones. No puede desmarcar la casilla mientras haya aplicaciones incluidas en la suite: quítelas primero de la suite

**Tecnologías** lista aquello de lo que depende la aplicación, a partir de dos fuentes que indica la columna **Vínculo**. Columnas: referencia (`TEC-4`), nombre, familia, versiones, vínculo, servidores por los que llega (**Vía**), fin del soporte estándar.

- **Declarada**: alguien vinculó la tecnología a la aplicación, por ejemplo Entra ID para una aplicación cuyos usuarios inician sesión con ella.
- **Alojada**: un servidor de uno de sus despliegues lleva la tecnología, incluido un miembro de un clúster al que está asignada. **Vía** nombra el servidor, y el host cuando la tecnología se ejecuta en el host de una máquina virtual. Los despliegues desactivados no cuentan.

Una tecnología puede ser ambas cosas. Un guion en la columna de versiones indica que la versión no se conoce. El fin del soporte estándar pasa a naranja una vez superado. La sección requiere `infrastructure:reader`.

**Añadir una tecnología**: haga clic en **Añadir**, elija la tecnología y luego su versión: una existente, una nueva que usted escribe o **Versión desconocida**. Cuando la aplicación tiene servidores de despliegue en servicio, un último paso propone registrar la tecnología con la misma versión en ellos, por ejemplo «Registrar también PHP 8.2 en». Cada servidor muestra sus entornos y sus roles. No hay nada marcado: marque los servidores que la ejecutan y haga clic en **Añadir**. Un servidor que ya lleva la tecnología muestra **Ya registrada** y conserva su propia versión. Un sistema operativo no se propone aquí: regístrelo en la página del servidor. Cerrar la lista no añade nada.

**Cambiar una tecnología declarada**: haga clic en su versión para elegir otra. Cuando ningún servidor de la aplicación lleva una tecnología declarada, el icono de servidor al final de su fila (**Registrar en un servidor**) propone la misma lista de servidores. Una tecnología alojada se cambia en el servidor: haga clic en el servidor en **Vía** para abrir su página.

Para añadir, cambiar o quitar una tecnología declarada, y para registrarla en servidores, necesita `applications:member` e `infrastructure:member`. Una tecnología alojada no tiene cruz: quítela del servidor.

**Vulnerabilidades** (cuando se siguen las vulnerabilidades) lista las vulnerabilidades aún por revisar en la aplicación, en las alertas. El número junto al título es el de vulnerabilidades distintas por revisar: haga clic en él para abrir la página [Vulnerabilidades](vulnerabilities.md) filtrada por la aplicación. Una línea por tecnología y versión:

| Columna | Qué muestra |
|---|---|
| **Tecnología**, **Versión** | La tecnología y su versión. **Versión no registrada (potencialmente afectada)** cuando no se indica ninguna versión |
| **Servidores** | Los servidores de despliegue que tienen esta tecnología y esta versión registradas en sí mismos. **Declarada** cuando la aplicación la declara y ningún servidor la tiene. **Registrar en un servidor** ofrece entonces sus servidores de despliegue, como en **Tecnologías** |
| **Crít.**, **Alta**, **Media**, **Baja**, **S. eval.** | Una columna por gravedad (Crítica, Alta, Media, Baja, Sin evaluar, el nombre completo en una información emergente del encabezado): las vulnerabilidades aún por revisar. Una vulnerabilidad calificada **Ninguna** cuenta con **Baja** |
| **Total** | Las vulnerabilidades distintas aún por revisar en esta línea |

**Ver** abre la página [Vulnerabilidades](vulnerabilities.md) filtrada por la aplicación y la tecnología. Cuando no queda nada por revisar, la sección lo dice en una línea. Mientras la primera lectura de un producto en la NVD, o el cotejo de una tecnología recién registrada en esta aplicación o en uno de sus servidores de despliegue, sigue en curso, la sección muestra «Búsqueda de vulnerabilidades en curso…» y se completa sola. Cuando la búsqueda no se puede completar, la sección lo dice. Una aplicación desactivada no tiene sección.

La sección solo cuenta vínculos directos. Una tecnología que la sección **Tecnologías** muestra a través del host de una máquina virtual no cuenta aquí: cuenta en el host. Consulte [Lo que KANAP cuenta](vulnerabilities.md#what-kanap-counts).

Un usuario que lee las aplicaciones sin leer la infraestructura sigue viendo esta sección, la insignia del encabezado y la columna de la lista, para las aplicaciones que puede leer.

---

### Conformidad

La pestaña Conformidad captura información de protección de datos y normativa.

**Qué puede editar**:
- **Clase de datos**: nivel de confidencialidad (Público, Interno, Confidencial, Restringido, o cualquier código personalizado definido en Configuración)
- **Última prueba DR**: fecha de la prueba de recuperación ante desastres más reciente
- **Contiene PII**: si la aplicación almacena información de identificación personal
- **Residencia de datos**: países donde se almacenan los datos (selección múltiple, códigos ISO + nombres)

**Consejo**: Las clases de datos son configurables en **Panorama IT > Configuración**. Personalícelas para que coincidan con la política de clasificación de datos de su organización.

---

### Clasificación y continuidad

El área de Conformidad también registra las decisiones de continuidad y clasificación de la aplicación. Los valores ausentes se muestran como **No definido**; KANAP no sustituye un nivel predeterminado.

La pestaña se organiza en cuatro bloques, en el orden de un análisis de impacto en el negocio.

**Criticidad**:
- La **Criticidad de negocio** se elige entre los niveles definidos por su organización. Cada opción muestra la definición del nivel, normalmente la interrupción que la actividad puede tolerar. El nivel es una referencia estable: renombrar un nivel, cambiar su definición o reordenar el catálogo en Configuración nunca mueve una aplicación a otro nivel.
- La **Criticidad cibernética** se selecciona de forma independiente. El selector muestra la descripción de cada nivel; elija el nivel con las consecuencias plausibles más graves. No confunda la criticidad cibernética con el nivel de riesgo.

**Datos**:
- La **Confidencialidad de los datos** utiliza el catálogo de clases de datos de la organización.
- **Contiene datos personales** y **Residencia de los datos** completan la visión de los datos.
- Los datos personales, la criticidad de negocio y cibernética, y el alojamiento de las instancias deciden también qué cláusulas se esperan en los contratos vinculados a la aplicación. Vea la pestaña **Conformidad** en [Contratos](contracts.md#conformidad).

**Continuidad y recuperación**:
- La **ola de recuperación** indica el orden de restauración; no representa una duración ni una gravedad.
- El **RTO** es el objetivo de tiempo de recuperación. El **RPO** es la pérdida de datos aceptable y puede ser cero. Si el RTO alcanza la duración máxima tolerable de interrupción definida en el nivel de negocio elegido, KANAP muestra una advertencia y conserva ambos valores.
- Bajo la ola, KANAP lista las interfaces que vinculan esta aplicación con una aplicación prevista en una ola **posterior** («Intercambio con CRM, prevista en V3»), con un enlace a cada interfaz. Ambas aplicaciones deben estar operativas para que el flujo funcione; el responsable del plan de recuperación decide. Las interfaces retiradas se ignoran, y los usuarios con un alcance restringido de Colaborador de negocio no ven esta lista.
- **Última prueba de recuperación** contiene la fecha de la prueba más reciente. Un enlace abierto desde esta zona utiliza la única sección **Base de conocimiento** de Visión general y no crea un registro duplicado. Las URL antiguas siguen disponibles en Relaciones.

Pueden aparecer dos indicaciones discretas: datos en el nivel de confidencialidad más alto combinados con la criticidad cibernética más baja, y una aplicación en el nivel de negocio más crítico sin prueba de recuperación en los últimos doce meses. Nunca bloquean nada.

**Revisión**:
- La **Justificación** documenta el razonamiento detrás de los niveles elegidos y en qué se apoya el plan de recuperación.
- La revisión es una marca de tiempo: **Marcar como revisado** registra quién revisó la clasificación y cuándo. Está disponible cuando la criticidad de negocio, la criticidad cibernética, la confidencialidad de los datos, la ola de recuperación y la justificación están presentes.
- La fecha de revisión y el revisor siguen visibles después. Cuando un valor de clasificación, una referencia de recuperación o la residencia de los datos cambia tras la revisión, la pestaña muestra **Modificada desde la revisión** y la lista muestra **Por revisar**. Cambiar el nombre o el editor no le afecta. Cambiar el catálogo en Configuración nunca invalida una revisión.

### Relaciones

La pestaña Relaciones muestra con qué está vinculada esta aplicación: sus líneas presupuestarias, contratos, proyectos, solicitudes, tareas e incidentes, cada uno en su propia tabla, y después sus enlaces y archivos. Las tecnologías están en la pestaña [Operaciones](#operations), los procesos de negocio en el [panel de propiedades](#panel-de-propiedades-panel-derecho). Haga clic en una fila para abrir el registro. La insignia de la pestaña cuenta las líneas presupuestarias, contratos, proyectos, solicitudes e incidentes vinculados, así como los enlaces y archivos. Las tareas no se cuentan.

**Componentes** (solo cuando está activado "Puede tener apps hijas"): una tabla que lista las aplicaciones hijas de esta Suite, con su ciclo de vida y criticidad. Haga clic en una fila para abrir el espacio de trabajo del hijo.

**Registros vinculados**, una tabla cada uno:

| Sección | Columnas |
|---|---|
| **Líneas presupuestarias** | Referencia (`BL-12`), nombre, tipo (OPEX o CAPEX), proveedor y el importe del año en curso en su columna presupuestaria por defecto, en la moneda de reporte. Un guion significa que la línea no tiene presupuesto para el año |
| **Contratos** | Nombre, proveedor, fin del periodo en curso, importe anual en la moneda del contrato, renovación (tácita o manual) |
| **Proyectos** | Referencia (`PRJ-7`), nombre, estado, fin previsto |
| **Solicitudes** | Referencia (`REQ-23`), nombre, estado, entrega deseada |
| **Tareas** | Referencia (`T-118`), título, estado, asignado, vencimiento. Solo aparecen las tareas vinculadas a esta aplicación, no las tareas de sus proyectos |
| **Incidentes** | Referencia (`INC-14`), título, severidad, estado, fecha de detección |

Un incidente confidencial solo aparece para las personas que pueden verlo en el registro de incidentes, sin su título.

Las fechas en naranja requieren atención: un contrato cuya decisión de renovación cae dentro de su ventana de decisión de contratos, o una tarea abierta con el vencimiento pasado. Una línea presupuestaria o un contrato desactivado sigue en la lista con el nombre atenuado. Solo ve las secciones de los módulos que puede leer.

A partir de dos filas, las líneas presupuestarias y los contratos terminan con una fila de total. El total de las líneas presupuestarias está en la moneda de reporte. Una línea cuya moneda no tiene tipo de cambio para el año muestra su importe en su propia moneda con una pequeña marca naranja, y el total la excluye. Un aviso de una línea bajo la tabla la indica, por ejemplo «Se excluye 1 línea sin tipo de cambio: USD 2026.» Vea [Tipos manuales](currencies.md#tipos-manuales). Los contratos tienen un total por moneda, sin los contratos desactivados.

**Añadir y quitar vínculos** (`applications:member`): **Añadir**, a la derecha de una sección, abre una búsqueda. Escriba un nombre o una referencia y elija un resultado: el vínculo se guarda al instante. Para quitar un vínculo, pase el cursor sobre la fila y haga clic en la cruz al final. Quitar un vínculo no elimina nada más. Vincular o desvincular un incidente requiere también `incidents:contributor` y queda registrado en el diario del incidente. Un incidente cerrado o cancelado no se puede vincular ni desvincular: reábralo primero.

**Relacionados**: sugerencias de registros que podría vincular, cada una con el motivo de la sugerencia:

- contratos y líneas presupuestarias del proveedor de la aplicación;
- líneas presupuestarias de un contrato vinculado o de un proyecto vinculado;
- proyectos que contienen una tarea vinculada a la aplicación.

Haga clic en **Vincular** para añadir la sugerencia a su sección. La sección no aparece cuando no hay nada que sugerir.

**También relacionado**: una línea bajo las sugerencias cuenta los activos de los despliegues de la aplicación, sus interfaces y sus documentos de conocimiento. Cada número abre la pestaña o la sección correspondiente.

**Enlaces y archivos**: los enlaces web de la aplicación (portales de proveedores, paneles de monitoreo, documentación) y sus archivos, una fila cada uno con su nombre, el dominio del enlace o el tamaño del archivo, y la fecha en que se añadió. Haga clic en un enlace para abrirlo en una pestaña nueva, o en un archivo para descargarlo. Con `applications:member`:

- **Añadir enlace** abre un diálogo para una URL y un nombre opcional; el enlace se guarda al instante. Para cambiar un enlace, pase el cursor sobre su fila y haga clic en el lápiz.
- **Adjuntar archivo** abre el selector de archivos. También puede soltar archivos sobre la sección: se resalta mientras arrastra.
- Para quitar un enlace o un archivo, pase el cursor sobre la fila y haga clic en la cruz. Quitar un enlace muestra un mensaje y ofrece **Deshacer**, que vuelve a crear el enlace. Eliminar un archivo pide una confirmación antes.

---

## Convertir una aplicación en tecnología

Algunas fichas se crearon como aplicaciones cuando en realidad son tecnologías: un motor de base de datos, un directorio, un servidor de aplicaciones. **Convertir en tecnología**, en la cabecera, transforma una ficha así en una [tecnología](technologies.md). Convierta cuando otra aplicación pueda caer o volverse vulnerable por su causa.

Necesita `applications:admin` e `infrastructure:member`.

La ventana comprueba primero qué cambia la conversión. Elija una **Familia** y lea las tres listas:

- **Pasa a la tecnología**: responsables, contactos de soporte, contratos, líneas presupuestarias, proyectos, enlaces web, documentos, incidentes y los servidores de sus despliegues activos. Cada servidor pasa a ser un servidor que lleva la tecnología, con versión desconocida. Un clúster aporta sus miembros en servicio. Los vínculos de los módulos que usted no puede leer también pasan.
- **Se conserva, sin su vínculo con la aplicación**: los documentos gestionados permanecen en su biblioteca, entre los documentos sin clasificar.
- **Se pierde con la aplicación**: despliegues y entornos, pertenencia a una suite, predecesor y sucesores, residencia de los datos, empresas y departamentos que la usan, vínculos de conocimiento, tareas y solicitudes vinculadas, procesos de negocio, tecnologías de las que depende, y los campos propios de las aplicaciones (usuarios, modos de acceso, SSO, MFA, datos personales). También desaparece su referencia `APP`.

La tecnología conserva el nombre, el editor, la descripción, las notas, las notas de soporte, el ciclo de vida, la criticidad cibernética y los campos de recuperación. Cada contacto de soporte figura una sola vez, con el primer rol que tenía. La ventana indica el tipo de alojamiento que toma la tecnología. Con servidores, es el tipo de alojamiento de sus ubicaciones (el que tiene más servidores), si no **Local**. Sin servidores, es el **Alojamiento** de la aplicación, si no **SaaS**. Puede cambiarlo después en la tecnología. **Convertir** crea la tecnología, elimina la aplicación y abre la nueva ficha. El registro de auditoría conserva la referencia antigua.

**Cuando se rechaza**: la ventana lista los motivos y **Convertir** queda desactivado. Una aplicación no puede convertirse mientras sea origen, destino o middleware de interfaces, herramienta de integración de enlaces de interfaz, una suite con componentes, o tenga enlaces de interfaz en sus despliegues. Una tecnología con el mismo nombre, valores que una tecnología no admite (incluida una lista **Tipos de alojamiento** sin ningún tipo en uso) o archivos que faltan en el almacenamiento también la bloquean. Quite primero esos vínculos, o mantenga la ficha como aplicación.

---

## Gestión de versiones

KANAP ofrece **dos formas de gestionar versiones de aplicaciones**, dependiendo de cómo su organización maneja las actualizaciones:

| Enfoque | Ideal para | Qué sucede |
|---------|------------|------------|
| **Simple** | La mayoría de aplicaciones | Actualice los campos de versión en el panel de propiedades o en el formulario de creación: mismo registro, nuevo número de versión |
| **Sofisticado** | Migraciones mayores | Use **Nueva versión** para crear un nuevo registro de aplicación con seguimiento de linaje. Ejecute las versiones antigua y nueva en paralelo |

### Seguimiento simple de versiones (actualizaciones in situ)

Para la mayoría de aplicaciones (donde actualiza y la versión anterior simplemente desaparece), actualice los campos **Versión**, **Puesta en marcha**, **Fin de soporte** y **Fecha de retiro** en el formulario de creación o en el panel de propiedades. El chip de versión del encabezado y los metadatos de **Puesta en marcha** reflejan lo que defina.

Este enfoque mantiene todo en un solo registro. Cuando actualiza, modifique los campos de versión y listo. La pestaña **Historial** conserva los valores anteriores.

**Use esto cuando**: las actualizaciones ocurren in situ sin solapamiento: una versión reemplaza a otra.

### Crear una nueva versión (migraciones en paralelo)

Para actualizaciones mayores de aplicaciones donde necesita ejecutar las versiones antigua y nueva en paralelo en diferentes entornos (p. ej., SAP S/4HANA 1909 en Prod mientras 2023 está en QA), utilice **Nueva versión** en el encabezado del espacio de trabajo.

El asistente tiene tres pasos:

1. **Detalles de la versión**: nuevo nombre de la aplicación, etiqueta de versión, fechas de **Puesta en marcha** y **Fin de soporte**. El nombre debe estar libre (consulte [Nombres únicos](#unique-names)), y el **Fin de soporte** no puede ser anterior a la **Puesta en marcha**.
2. **Opciones de copia**: elija qué copiar del origen. Los valores predeterminados se muestran a continuación.
3. **Interfaces**: seleccione qué interfaces migrar a la nueva versión.

La nueva versión se crea como una aplicación separada con:
- Un ciclo de vida **Propuesto** (listo para configurar antes de la puesta en marcha)
- Un enlace a su predecesor (usado por la línea de tiempo de versiones)
- Datos copiados según sus selecciones
- Interfaces duplicadas apuntando a la nueva versión

Una vez creada, un mensaje indica la referencia de la nueva versión. Las dos aplicaciones quedan entonces enlazadas mediante **Versión anterior** y **Versión siguiente** en el panel de propiedades.

Los valores de clasificación y continuidad se copian, pero la nueva versión empieza con la revisión restablecida y sin copiar la última prueba de recuperación.

### Qué se copia

| Opción | Predeterminado |
|--------|----------------|
| Responsables (negocio e IT) | Activado |
| Empresas (audiencia) | Activado |
| Departamentos | Activado |
| Residencia de datos | Activado |
| Enlaces | Activado |
| Contactos de soporte | Activado |
| Líneas presupuestarias (OPEX + CAPEX, emparejadas) | Activado |
| Contratos | Activado |
| Despliegues | Desactivado |
| Enlaces de despliegue | Desactivado (solo disponible cuando se selecciona Despliegues) |

**Siempre se copia**: la descripción, los procesos de negocio, los métodos de acceso, las casillas **Acceso externo**, **Integración de datos / ETL** y **Puede contener aplicaciones secundarias**, y el número de usuarios indicado a mano.

**No se copia** (debe configurarse de nuevo): pertenencia a suite, adjuntos, las fechas de la aplicación de origen, la última prueba de recuperación, la revisión de la clasificación y las asignaciones de servidores. El asistente los enumera.

### Migración de interfaces

Durante la creación de versiones, el asistente muestra todas las interfaces donde esta aplicación es origen, destino o middleware (cuando ETL está habilitado). Las interfaces seleccionadas se duplican con sus referencias actualizadas a la nueva versión. Cada interfaz migrada incluye sus tramos, responsables, empresas, identificadores clave, enlaces, residencia de datos y su especificación (el texto del origen y sus imágenes). Un ID de interfaz vacío permanece vacío. Las interfaces migradas comienzan con un ciclo de vida **Propuesto**. Las interfaces originales permanecen vinculadas a la versión anterior.

**Copiar enlaces**: Si selecciona tanto **Despliegues** como **Enlaces de despliegue**, los enlaces de interfaz también se copian. Los enlaces se mapean a los despliegues de la nueva aplicación (emparejados por entorno); los detalles específicos del entorno (endpoints, autenticación, nombres de trabajo) se borran y el estado del enlace se restablece a **Propuesto**.

**Aplicaciones ETL/Middleware**: Si la aplicación tiene **Integración de datos / ETL** habilitado, el asistente también muestra interfaces que *fluyen a través de* esta aplicación como middleware. Estas son interfaces donde otro origen envía datos a otro destino a través de su ETL. Copiarlas crea nuevas definiciones de interfaz para el ETL actualizado, con las referencias de middleware debidamente actualizadas.

**Consejo**: Use esto al actualizar su ERP o ETL: migre las interfaces críticas y opcionalmente copie los enlaces para obtener una ventaja en la configuración del entorno.

---

## Copiar aplicaciones

Hay dos formas de copiar una aplicación en KANAP:

### Copiar elemento (desde la cuadrícula de Aplicaciones)

Utilice esto cuando desee crear un duplicado independiente de una aplicación, típicamente para crear una entrada de aplicación similar sin linaje de versiones.

1. Seleccione una aplicación en la cuadrícula
2. Haga clic en **Copiar elemento**
3. El sistema crea una copia con el nombre de la aplicación de origen y un sufijo en el idioma de su pantalla: "CRM (copia)", o "CRM (copy)" en inglés. Si ese nombre ya está en uso, la copia se numera: "CRM (copia 2)", luego "CRM (copia 3)"
4. Se le lleva a la nueva aplicación para hacer cambios

**Qué se copia**: Todos los campos principales (excepto fecha de última prueba DR), incluidos los valores de clasificación y continuidad, responsables, empresas, departamentos, suites, líneas OPEX/CAPEX, contratos, enlaces, residencia de datos y contactos de soporte. La revisión de la copia se restablece.

**Qué NO se copia**: Despliegues, interfaces, asignaciones de servidores, adjuntos, campos de versión (versión, fecha de puesta en marcha, fin de soporte).

### Comparación: Copiar elemento vs Nueva versión

| Aspecto | Copiar elemento | Nueva versión |
|---------|-----------------|---------------------|
| **Propósito** | Duplicado independiente | Sucesor versionado con linaje |
| **Opciones del usuario** | Ninguna (automático) | Asistente de 3 pasos |
| **Linaje** | Sin enlace al predecesor | Establece predecesor |
| **Ciclo de vida** | Preservado | Restablecido a Propuesto |
| **Nombre** | Sufijo "(copia)", numerado si el nombre está en uso | Especificado por el usuario, debe estar libre |

**Relaciones**:

| Relación | Copiar elemento | Nueva versión |
|----------|-----------------|---------------------|
| Responsables (negocio e IT) | Sí | Opcional (predeterminado: sí) |
| Empresas (audiencia) | Sí | Opcional (predeterminado: sí) |
| Departamentos | Sí | Opcional (predeterminado: sí) |
| Residencia de datos | Sí | Opcional (predeterminado: sí) |
| Enlaces | Sí | Opcional (predeterminado: sí) |
| Contactos de soporte | Sí | Opcional (predeterminado: sí) |
| Procesos de negocio | No | Sí |
| Suites (pertenencia) | Sí | No |
| Líneas OPEX | Sí | Opcional (predeterminado: sí) |
| Líneas CAPEX | Sí | Opcional (predeterminado: sí) |
| Contratos | Sí | Opcional (predeterminado: sí) |
| Despliegues | No | Opcional (predeterminado: no) |
| Enlaces | No | Opcional (predeterminado: no) |
| Interfaces | No | Seleccionadas por el usuario |
| Asignaciones de servidores | No | No |
| Adjuntos | No | No |

**Campos principales**:

| Campo | Copiar elemento | Nueva versión |
|-------|-----------------|---------------------|
| Descripción | Sí | Sí |
| Métodos de acceso | Sí | Sí |
| ETL habilitado | Sí | Sí |
| Notas de soporte | Sí | Sí |
| Última prueba DR | No | No |
| Campos de versión | No | Especificados por el usuario |
| Sobrescritura de usuarios | Sí | Sí |
| Año de usuarios | Sí | Restablecido al año actual |

---

## Importación/exportación CSV

Mantenga su inventario de aplicaciones a escala usando la importación y exportación. Esta funcionalidad soporta operaciones masivas para carga inicial de datos, actualizaciones periódicas desde sistemas externos y extracción de datos para informes.

### Acceder a las funciones CSV

Desde la lista de Aplicaciones:
- **Exportar**: Descargar aplicaciones a un archivo CSV o un libro de Excel
- **Importar**: Subir un archivo CSV o un libro de Excel para crear o actualizar aplicaciones
- **Descargar plantilla** (desde dentro del diálogo de importación): Obtener un CSV en blanco con los encabezados correctos

**Permisos requeridos**: `applications:admin` para operaciones de importación/exportación.

### Opciones de exportación { #export-options }

**Contenido del archivo**: las aplicaciones que muestra la lista. La exportación sigue los filtros de columna, la búsqueda rápida y la opción **Mostrar** (**Mis aplicaciones**, **Aplicaciones de mi equipo** o **Todas las aplicaciones**). El diálogo indica cuántas aplicaciones contendrá el archivo. Sin filtro de **Ciclo de vida**, las aplicaciones retiradas quedan fuera, como en la lista. Las filas conservan el orden de la lista.

**Formato**: **CSV** o **Excel (.xlsx)**, elegido en el diálogo y recordado por su navegador. El libro contiene las mismas columnas que el CSV en una hoja, con los números y las fechas como valores que Excel puede ordenar y filtrar. La importación lee los dos; en un libro, lee la primera hoja. Consulte [Archivos CSV y Excel](csv-files.md).

**Columnas**: el archivo empieza por `id` y `reference` (`APP-12`), y después las columnas siguen el espacio de trabajo, pestaña por pestaña. La importación ignora `reference`.

**Idioma de los valores**: los valores de catálogo (categoría, ciclo de vida, criticidad, criticidad cibernética, ola de recuperación, clase de datos, métodos de acceso) y el estado se escriben como los muestra la pantalla, en el idioma de su pantalla: `Active` en inglés, `Activo` en español. Un nombre que su organización dio a un valor en **Panorama IT > Configuración** se mantiene tal cual.

**Presets**:

| Preset | Descripción |
|--------|-------------|
| **Exportación completa** | Todos los campos exportables incluidos datos calculados/solo lectura (marcas de tiempo, residencia de datos, métricas de usuarios) |
| **Enriquecimiento de datos** | Solo campos importables. Ideal para flujos de trabajo de edición de ida y vuelta |

**Exportación de plantilla**: Descarga solo encabezados. Es útil para preparar archivos de importación con la estructura correcta. La plantilla incluye todos los campos importables.

**Selección personalizada**: Elija campos específicos para incluir en su exportación.

### Flujo de trabajo de importación

1. **Prepare su archivo**: un archivo CSV o un libro de Excel (`.xlsx`). Guarde un archivo CSV en UTF-8. Las comas y los puntos y coma funcionan, y también un archivo que Excel guardó como CSV simple (Windows-1252). Descargue una plantilla para asegurar los encabezados correctos. El separador, los importes, las fechas y los sí o no de cada idioma están en [Archivos CSV y Excel](csv-files.md).

2. **Elija la configuración de importación**:
   - **Modo**:
     - `Enriquecer` (predeterminado): Las celdas vacías preservan los valores existentes: solo actualiza lo que especifique
     - `Reemplazar`: Reemplaza los valores de las columnas del archivo. Una celda vacía borra el valor guardado, salvo en las columnas de clasificación (use `__CLEAR__`). Una columna que falta en el archivo conserva sus valores. Algunos campos no se pueden vaciar: la **Verificación previa** los señala.
   - **Operación**:
     - `Upsert` (predeterminado): Crear nuevas aplicaciones o actualizar las existentes
     - `Solo actualizar`: Solo modificar aplicaciones existentes, omitir nuevas
     - `Solo insertar`: Solo crear nuevas aplicaciones, omitir existentes

     La operación se aplica también a los responsables y a la residencia de datos: una fila que la operación omite los deja como están.

3. **Validar primero**: Haga clic en **Verificación previa** para validar su archivo sin hacer cambios. Revise errores y advertencias.

4. **Aplicar cambios**: Si la validación es correcta, haga clic en **Importar** para confirmar los cambios.

### Comprobaciones de las filas

La verificación previa aplica las mismas reglas que el espacio de trabajo. Una fila se rechaza cuando:

- su nombre supera los 200 caracteres, u otra aplicación ya lo tiene (consulte [Nombres únicos](#unique-names));
- su nombre coincide con dos aplicaciones existentes: añada la columna `id` para elegir una;
- su categoría o su ciclo de vida no coincide con ningún código ni ningún nombre del catálogo;
- un correo de responsable no coincide con ningún usuario;
- su **Fin de soporte** o su **Fecha de retiro** es anterior a su **Puesta en marcha**;
- `is_suite` vale `no` para una suite que aún contiene aplicaciones.

Un archivo con una sola fila rechazada no carga nada. Consulte [Archivos CSV y Excel](csv-files.md).

### Referencia de campos

**Campos de visión general**:

| Columna CSV | Descripción | Obligatorio | Notas |
|-------------|-------------|-------------|-------|
| `id` | UUID de la aplicación | No | Para actualizaciones; deje en blanco para nuevas aplicaciones |
| `name` | Nombre de la aplicación | Sí | 200 caracteres como máximo. Sirve para encontrar las aplicaciones existentes |
| `description` | Qué hace la aplicación | No | |
| `category` | Propósito principal | No | Acepta código o etiqueta de Configuración. Un valor desconocido hace rechazar la fila |
| `supplier_name` | Nombre del proveedor | No | Debe coincidir con un proveedor existente |
| `editor` | Editor del software | No | Texto libre (p. ej., Microsoft, SAP) |
| `criticality` | Criticidad de negocio | No | Acepta código o etiqueta de Configuración; `__CLEAR__` lo borra |
| `lifecycle` | Estado actual | No | Acepta código o etiqueta de Configuración. Un valor desconocido hace rechazar la fila |
| `is_suite` | Puede tener apps hijas | No | `sí` o `no` |

**Campos de versión**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `version` | Versión actual | Texto libre |
| `go_live_date` | Cuándo entró en producción | Formato de fecha: AAAA-MM-DD |
| `end_of_support_date` | Fin del soporte del proveedor | Formato de fecha: AAAA-MM-DD |
| `retired_date` | Fecha de decomisionamiento | Formato de fecha: AAAA-MM-DD |

**Campos técnicos**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `access_methods` | Cómo acceden los usuarios | Códigos o etiquetas separados por comas de Configuración (p. ej., `web,mobile,vdi`) |
| `external_facing` | Accesible desde internet | `sí` o `no` |
| `etl_enabled` | Integración de datos | `sí` o `no` |
| `support_notes` | Información de soporte | Texto libre |
| `licensing` | Términos de licencia | Texto libre |
| `notes` | Notas internas | Texto libre |

**Campos de conformidad**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `data_class` | Clasificación de datos | Acepta código o etiqueta de Configuración |
| `last_dr_test` | Fecha de última prueba DR | Formato de fecha: AAAA-MM-DD |
| `contains_pii` | Almacena datos personales | `sí` o `no` |
| `data_residency` | Países de almacenamiento de datos | Códigos de país ISO separados por comas (p. ej., `FR,DE`). En modo `Enriquecer`, una celda vacía conserva los países |

**Campos de clasificación**:

| Columna CSV | Descripción | Notas |
|------------|-------------|-------|
| `criticality` | Nivel de criticidad de negocio | Código del tenant o etiqueta no ambigua |
| `cyber_criticality` | Nivel de consecuencias cibernéticas | Código del tenant o etiqueta no ambigua |
| `recovery_wave` | Orden de recuperación | Código del tenant o etiqueta no ambigua |
| `rto_minutes` / `rpo_minutes` | Objetivos de recuperación | Minutos enteros; RPO puede ser cero |
| `classification_justification` | Justificación | Texto libre |

Una celda de clasificación vacía conserva el valor existente en los modos Enriquecer y Reemplazar; use `__CLEAR__` para borrar una clasificación.

**Campos de responsables**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `business_owner_email_1` hasta `_4` | Correos de responsables de negocio | Deben coincidir con el correo de un usuario existente. Un correo desconocido hace rechazar la fila |
| `it_owner_email_1` hasta `_4` | Correos de responsables de TI | Deben coincidir con el correo de un usuario existente. Un correo desconocido hace rechazar la fila |

En modo `Enriquecer`, cuando todas las celdas de responsables de un tipo están vacías, la aplicación conserva sus responsables de ese tipo.

**Campos solo de exportación** (incluidos en Exportación completa pero no importables):

| Columna CSV | Descripción |
|-------------|-------------|
| `status` | Activado o desactivado, en el idioma de su pantalla. Se cambia en la propia aplicación |
| `users_mode` | Método de conteo de usuarios (`manual`, `it_users`, `headcount`) |
| `users_year` | Año de referencia para cálculos de usuarios |
| `users_override` | Sobrescritura manual del conteo de usuarios |
| `created_at` | Marca de tiempo de creación del registro |
| `updated_at` | Marca de tiempo de última modificación |
| `vulnerabilities_to_review` | Vulnerabilidades aún por revisar, contadas como en la columna de la lista. Vacía para una aplicación desactivada |
| `severe_vulnerabilities` | De ellas, las críticas o altas. Vacía para una aplicación desactivada |

Las dos columnas de vulnerabilidades no aparecen cuando no se siguen las vulnerabilidades. La importación las ignora.

### Aceptación de etiquetas y códigos

Para campos configurados en **Panorama IT > Configuración**, puede usar tanto el código interno como la etiqueta visible:

| Campo | Ejemplos de códigos | Ejemplos de etiquetas |
|-------|---------------------|----------------------|
| Categoría | `lob`, `productivity`, `security` | `Line-of-business`, `Productivity`, `Security` |
| Ciclo de vida | `active`, `proposed`, `deprecated` | `Active`, `Proposed`, `Deprecated` |
| Clase de datos | `public`, `internal`, `confidential` | `Public`, `Internal`, `Confidential` |

El sistema normaliza automáticamente los valores durante la importación, por lo que `Line-of-business`, `line-of-business` y `lob` se resuelven a la misma categoría. Las etiquetas que muestra la pantalla se aceptan en inglés, francés, alemán y español: `Active`, `Actif`, `Aktiv` y `Activo` designan el mismo ciclo de vida. Un archivo exportado en un idioma se importa por tanto en otro.

### Coincidencia y actualizaciones

Las aplicaciones se emparejan por **nombre**, sin distinguir mayúsculas de minúsculas e ignorando los espacios al principio y al final. Cuando se encuentra una coincidencia:
- Con modo `Enriquecer`: Solo los valores CSV no vacíos actualizan la aplicación
- Con modo `Reemplazar`: Las columnas del archivo se actualizan, y una celda vacía borra el valor guardado. Las columnas que faltan en el archivo conservan sus valores. Una celda de clasificación vacía conserva su valor, y `__CLEAR__` la borra. El nombre, el `id`, el ciclo de vida y los campos obligatorios no se pueden vaciar: la **Verificación previa** señala un error en la fila. Una aplicación nueva recibe los valores predeterminados.

Si incluye la columna `id` con un UUID válido, la coincidencia usa primero el ID, luego el nombre como respaldo. Cuando dos aplicaciones existentes tienen el nombre de una fila, la fila se rechaza: añada la columna `id` para elegir una.

Una fila encontrada por su `id` con otro nombre renombra la aplicación. El nuevo nombre debe estar libre. El título del documento de descripción de la aplicación sigue el nuevo nombre.

### Limitaciones

- **Despliegues no incluidos**: Los despliegues por entorno (Prod, QA, Dev) requieren configuración en el espacio de trabajo
- **Asignaciones de servidores excluidas**: Los enlaces a servidores deben configurarse en la pestaña Despliegues
- **Interfaces excluidas**: Las definiciones de integración no son parte de la importación y exportación
- **Máximo 4 responsables por tipo**: Se pueden importar/exportar hasta 4 responsables de negocio y 4 responsables IT
- **Métricas de usuarios solo de exportación**: Los campos de audiencia y conteo de usuarios (`users_mode`, `users_year`, `users_override`) se gestionan en el espacio de trabajo
- **Estado solo de exportación**: Active o desactive una aplicación en su espacio de trabajo

### Solución de problemas

**Error "El archivo no tiene el formato correcto"**: Esto generalmente indica un problema de codificación. Asegúrese de que su CSV esté guardado como **UTF-8**:

- **En LibreOffice**: Al abrir un CSV, seleccione `UTF-8` en el desplegable de Juego de caracteres (no "Japanese (Macintosh)" u otras codificaciones). Al guardar, marque "Editar configuración de filtro" y elija UTF-8.
- **En Excel**: Guardar como > CSV UTF-8 (delimitado por comas).
- **Consejo general**: Si ve caracteres ilegibles (`?¿`, `ï»¿`) al inicio de su archivo, la codificación es incorrecta.

### Ejemplo CSV

```csv
name;category;supplier_name;criticality;lifecycle;go_live_date;external_facing
Salesforce CRM;Line-of-business;Salesforce Inc;Critical;Active;2020-01-15;true
Microsoft 365;Productivity;Microsoft;high;active;2019-06-01;false
Custom ERP;lob;;Moderate;Active;2018-03-20;false
```

---

## Preguntar al asistente

[Plaid](ai-assistant.md) lee la versión, la fecha de puesta en servicio, la fecha de fin de soporte y la fecha de retirada de cada aplicación. Filtra, ordena y agrupa las aplicaciones según estas fechas. Su lista conserva las aplicaciones retiradas, mientras que el informe [Fin de soporte](end-of-support.md) solo conserva las que están en servicio.

Plaid también declara una tecnología en una aplicación, o la quita, con su versión y, si usted lo pide, en los servidores de despliegue de la aplicación. Para ello necesita el derecho de leer las aplicaciones y el nivel Miembro en la infraestructura. Un Business Contributor solo lo hace en las aplicaciones en las que participa. Plaid no vincula un sistema operativo: indíquelo en la página del servidor. Cada cambio llega como una vista previa que usted aprueba. Cuando pide a Plaid que lo deshaga, restablece exactamente lo que cambió. Una versión creada de paso se queda en la tecnología.

Pregunte, por ejemplo: «Añade PostgreSQL 16 a CheeseTrack y a sus servidores», «Quita PostgreSQL 14 de CheeseTrack», «¿Qué aplicaciones llegan al fin de soporte en los próximos seis meses?» o «¿Qué aplicaciones declaran PostgreSQL 14?»

---

## Consejos

- **Empiece por las apps críticas**: Documente primero sus aplicaciones críticas para el negocio, luego avance en los niveles de criticidad.
- **Use Suites para agrupar**: Active "Puede tener apps hijas" en la pestaña Operaciones para marcar una aplicación como Suite que agrupa componentes relacionados (p. ej., módulos SAP bajo una Suite SAP).
- **Vincule al gasto temprano**: Conecte líneas OPEX, CAPEX y contratos en la pestaña Relaciones para ver el panorama completo de costes de cada aplicación.
- **Mantenga los despliegues actualizados**: La pestaña Despliegues alimenta los chips de entorno en la lista: manténgala actualizada para una visibilidad precisa.
- **Documente la audiencia**: Defina la audiencia de empresas y departamentos en el panel de propiedades; el conteo de usuarios se deriva entonces automáticamente y se utiliza en los informes.
- **Aproveche el filtrado por categoría**: Utilice el filtro de columna Categoría para centrarse en tipos específicos de aplicaciones (p. ej., mostrar solo apps de Línea de negocio, o excluir herramientas de Productividad).
- **Adjunte conocimiento temprano**: Vincule runbooks y documentos de arquitectura desde la pestaña Visión general para que el equipo sepa dónde buscar durante los incidentes.
- **Las tareas vienen de la página Tareas**: Para adjuntar una tarea a una aplicación, defina el campo App / Servicio en la propia tarea; aparecerá en Relaciones > Tareas.
