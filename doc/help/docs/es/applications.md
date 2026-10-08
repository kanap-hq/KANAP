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
- **Nombre**: Un nombre reconocible para la aplicación o servicio
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

Una vez que guarde, el espacio de trabajo desbloquea todas las pestañas para documentación detallada.

**Consejo**: Comience documentando sus aplicaciones más críticas. Utilice la pestaña **Despliegues** para capturar qué entornos existen (Prod, QA, Dev) y qué servidores los ejecutan, luego vincule interfaces, contratos y partidas presupuestarias a medida que avance.

**Permisos**:
- Ver: `applications:reader`
- Crear / editar: `applications:manager` (también llamado `member`)
- Importar / Exportar / Eliminar: `applications:admin`

---

## Trabajar con la lista

La cuadrícula de Aplicaciones proporciona una vista completa de su portafolio de aplicaciones.

**Filtro de alcance superior (Mostrar)**:
- **Mis apps**: muestra apps donde usted está listado en el panel de propiedades como **Responsable de negocio** o **Responsable IT**. Se admiten entradas con múltiples responsables.
- **Apps de mi equipo**: muestra apps donde cualquier miembro de su equipo de Portafolio está listado como Responsable de negocio o Responsable IT. Su propia propiedad también se incluye en este alcance. Deshabilitado si no está asignado a un equipo de Portafolio.
- **Todas las apps** (predeterminado): muestra la cuadrícula completa de Aplicaciones con el comportamiento predeterminado del filtro de ciclo de vida.
- Su selección se recuerda entre sesiones -- al volver a la página se restaura su última elección.

**Columnas predeterminadas**:
- **Nombre**: Nombre de la aplicación con la categoría como subtítulo y una insignia "Incluido en: {suite}" para los componentes de una suite
- **Categoría**: El propósito principal de la aplicación
- **Entornos**: Chips de colores que muestran entornos activos (Prod, Pre-prod, QA, Test, Dev, Sandbox). Pase el ratón para ver la URL base y el ciclo de vida.
- **Ciclo de vida**: Estado actual
- **Criticidad de negocio**: Nivel de importancia para el negocio
- **Editor**: Editor del software
- **Usuarios derivados (A)**: Conteo calculado de usuarios para el año actual (basado en la audiencia establecida en el panel de propiedades)
- **Creado**: Cuándo se creó el registro

**Ordenación predeterminada**: **Nombre** ascendente (A a Z).

**Columnas adicionales** (mediante el selector de columnas):
- **Suites**: Suites padre a las que pertenece esta aplicación
- **Proveedor**: Nombre del proveedor vinculado
- **Responsables de negocio** / **Responsables IT**: Responsables asignados (truncado, pase el ratón o haga clic para verlos todos)
- **Alojamiento**: Derivado de las ubicaciones de servidores asignados a los despliegues de la app
- **Acceso externo**: Si la app es accesible desde internet
- **SSO habilitado** / **MFA habilitado**: Características de autenticación
- **Integración de datos / ETL**: Si la app participa en integraciones de datos
- **Partidas OPEX** / **Partidas CAPEX** / **Contratos**: Gasto y contratos vinculados
- **Componentes**: Aplicaciones hijas (si es una suite)
- **Clase de datos** / **Contiene PII** / **Residencia de datos**: Información de conformidad
- **Criticidad cibernética**, **Ola de recuperación**, **RTO**, **RPO**, **Estado/fecha de revisión**: Campos de clasificación y continuidad

**Progreso de la clasificación**: el mosaico Conformidad de su panel muestra cuántas aplicaciones visibles están revisadas, por revisar o aún tienen campos de clasificación por completar, además de los puntos que requieren acción. Cada cifra abre la lista de aplicaciones filtrada en consecuencia. Consulte [Mi panel](my-dashboard.md#conformidad).

**Filtrado**:
- Búsqueda rápida: coincide con el nombre y editor
- Los filtros de criticidad, criticidad cibernética, clase de datos y ola de recuperación listan sus valores en el orden del catálogo (la más crítica primero, las olas en orden de restauración).
- La mayoría de columnas usan filtros de conjunto de casillas que solo muestran los valores presentes en el conjunto de resultados actual; el filtro flotante muestra `Todos`, `Ninguno` o `N seleccionados` con una **x** para limpiar.
- Las aplicaciones retiradas están ocultas por defecto; use el filtro de **Ciclo de vida** para incluir Retiradas.

**Acciones**:
- **Nueva App / Servicio**: Crear una nueva entrada (`applications:manager`)
- **Importar CSV**: Importación masiva desde archivo CSV (`applications:admin`)
- **Exportar CSV**: Exportar la lista a CSV (`applications:admin`). Las columnas respaldadas por catálogos (categoría, ciclo de vida, criticidad, criticidad cibernética, ola de recuperación, clase de datos, métodos de acceso) se exportan con sus nombres; la importación acepta un nombre o el código interno.
- **Copiar elemento**: Duplicar una aplicación seleccionada con todas sus relaciones principales (`applications:manager`). Consulte [Copiar aplicaciones](#copiar-aplicaciones) para saber qué se copia y qué no.
- **Eliminar seleccionadas**: Eliminar aplicaciones seleccionadas (`applications:admin`)

---

## El espacio de trabajo de Aplicaciones

Haga clic en cualquier fila para abrir el espacio de trabajo. El espacio de trabajo tiene un **encabezado** con metadatos rápidos, un **panel de propiedades** a la derecha (la tarjeta de identidad de la aplicación -- siempre visible) y un **área de contenido** en el centro que cambia con cada pestaña.

### Encabezado

El encabezado muestra:
- **Nombre de la aplicación** (editable en línea)
- **Referencia**: identificador corto que puede copiar
- Chip de **Ciclo de vida**: haga clic para cambiar
- Chip de **Criticidad de negocio**: muestra el nivel y abre un menú con los niveles de la organización
- Chip de **Versión** (si hay versión definida): haga clic para copiar
- Fecha de **Puesta en marcha**
- **Enviar enlace**: copiar un enlace compartible a este espacio de trabajo
- **Crear nueva versión**: lanzar el asistente de migración de versión (consulte [Gestión de versiones](#gestion-de-versiones))
- **Eliminar** (`applications:admin`)
- **Anterior / Siguiente**: recorrer la lista filtrada sin volver a la cuadrícula

### Panel de propiedades (panel derecho)

El panel es la tarjeta de identidad de la aplicación. Se muestra en cada pestaña y se edita en línea -- los cambios se guardan automáticamente.

**Identidad**:
- **Categoría**, **Proveedor**, **Editor**

**Fechas del ciclo de vida**:
- **Puesta en marcha**, **Fin de soporte**, **Fecha de retiro**

**Responsables**:
- **Responsables de negocio**: partes interesadas del negocio responsables de esta aplicación (selección múltiple)
- **Responsables IT**: miembros del equipo IT responsables del soporte técnico (selección múltiple)

**Audiencia**:
- Añada filas de **Empresa / Departamentos** para registrar quién usa esta aplicación. Elija una empresa y opcionalmente restrinja a departamentos específicos.
- Se muestra un conteo de **Usuarios** en vivo.
- **Método de cálculo**: **Derivado** (calculado automáticamente a partir de la audiencia basándose en las métricas de Usuarios IT / Plantilla de los datos maestros) o **Manual** (un único número de sustitución que usted introduce).

---

### Visión general

La pestaña Visión general es la narrativa de la aplicación. Contiene:

**Descripción**: Una descripción enriquecida de la aplicación. El editor guarda automáticamente mientras escribe.

**Conexiones**: Un resumen de solo lectura construido a partir de las interfaces de la aplicación. Para apps no middleware muestra dos filas: **Recibe de** y **Envía a**. Para apps ETL/middleware muestra una única fila **Conectado a**. Cada entrada es una píldora clicable que abre la aplicación relacionada; "+ N más en Interfaces" salta a la pestaña Interfaces.

**Conocimiento**: Artículos de conocimiento vinculados. Si tiene `knowledge:member`, puede crear nuevos artículos directamente desde esta sección.

---

### Despliegues

La pestaña Despliegues documenta dónde se ejecuta realmente la aplicación -- un bloque por entorno, con los servidores asignados a cada uno.

**Entornos**: Producción, Pre-producción, QA, Test, Desarrollo, Sandbox.

**Para cada despliegue puede capturar**:
- **Ciclo de vida**: estado por entorno (Activo, Propuesto, Obsoleto, Retirado, etc.)
- **URL base**: la URL de acceso para este entorno
- **SSO habilitado** / **MFA soportado**
- **Notas**

**Añadir despliegue** abre un diálogo donde define entorno, ciclo de vida, URL base, indicadores SSO/MFA y notas. Cada entorno solo puede añadirse una vez. El chip de ciclo de vida en el encabezado de un despliegue también puede cambiarse en línea desde un menú emergente.

**Servidores por despliegue**: Cada bloque de despliegue muestra una tabla de servidores asignados:

| Columna | Qué muestra |
|---------|-------------|
| **Servidor** | Nombre del activo (clicable) |
| **Rol** | p. ej., Web, Base de datos, Aplicación (de la lista de roles de servidor en Configuración) |
| **Alojamiento** | Derivado de la ubicación del activo |
| **Desde** | Fecha en que se asignó el servidor a este despliegue |

Haga clic en **Añadir servidor** en el encabezado del despliegue para vincular un activo. Los activos de tipo clúster están excluidos -- asigne en su lugar los hosts miembros del clúster.

**Consejo**: Documente primero los servidores en **Panorama IT > Activos**, luego vincúlelos aquí. La pestaña Visión general del activo mostrará las mismas asignaciones de forma inversa.

---

### Interfaces

La pestaña Interfaces muestra todas las integraciones en las que participa esta aplicación -- como origen, destino o middleware. La insignia de la pestaña muestra el conteo total.

Las interfaces se **agrupan por entorno** (PROD, PRE_PROD, QA, ...). Dentro de cada entorno se dividen en:

- **Entrantes** -- esta aplicación recibe datos
- **Salientes** -- esta aplicación envía datos
- **Enrutadas** -- esta aplicación es el middleware/ETL para un flujo entre otras dos apps

Cada fila muestra el nombre de la interfaz, la aplicación contraparte y un indicador **Vía middleware**. Haga clic en la fila para abrir el espacio de trabajo de la interfaz; haga clic en la contraparte para abrir la otra aplicación.

**Consejo**: Las interfaces se gestionan desde la página de Interfaces. Esta pestaña es una vista de solo lectura por conveniencia, pero es la forma más rápida de navegar entre aplicaciones conectadas.

---

### Operaciones

La pestaña Operaciones captura cómo acceden los usuarios a la aplicación y quién la soporta.

**Técnico**:
- **Métodos de acceso** (selección múltiple): cómo acceden los usuarios a esta aplicación. Las opciones son configurables en [Configuración del Panorama IT](it-ops-settings.md). Los valores predeterminados incluyen Web, Aplicación instalada localmente, Aplicación móvil, HMI propietario (interfaz industrial), Terminal / CLI, VDI / Escritorio remoto, Kiosk.
- **Acceso externo**: si la aplicación es accesible desde internet
- **Integración de datos / ETL**: si la aplicación participa en pipelines de integración de datos (también activa el modo "middleware" para esta app en las vistas de Interfaces y Conexiones)
- **Puede tener apps hijas**: convertir esta aplicación en una Suite que agrupa otras aplicaciones

**Soporte**:
- Una tabla de contactos de soporte extraída de sus datos maestros de Contactos. Cada fila muestra el nombre del contacto, correo, teléfono y un rol de texto libre (p. ej., Gestor de cuenta, Soporte N1).
- **Añadir contacto** abre un diálogo para elegir un contacto y definir un rol.
- **Notas de soporte**: texto libre para los acuerdos de soporte (SLA, vías de escalado, información de guardias).

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

La pestaña Relaciones vincula esta aplicación a sus registros financieros, de contratos, de proyectos y de tareas. La insignia de la pestaña cuenta todos los elementos vinculados. Los cambios se guardan automáticamente.

**Componentes** (solo cuando está activado "Puede tener apps hijas"): una tabla que lista las aplicaciones hijas de esta Suite, con su ciclo de vida y criticidad. Haga clic en una fila para abrir el espacio de trabajo del hijo.

**Relaciones**:
- **Partidas OPEX**: costes recurrentes asociados a esta aplicación
- **Partidas CAPEX**: proyectos de gasto de capital
- **Contratos**: contratos con proveedores
- **Proyectos**: proyectos del portafolio vinculados a esta aplicación
- **Tareas**: tareas vinculadas a esta aplicación. Esta lista es de solo lectura aquí -- las tareas ganan o pierden este vínculo cuando establece el campo **App / Servicio** en una tarea desde la página de Tareas.

**Sitios web relevantes**: añada URLs con nombres opcionales -- útil para portales de proveedores, paneles de monitoreo o enlaces a documentación. **Añadir URL** abre un diálogo; las entradas existentes pueden editarse o eliminarse.

**Adjuntos**: Arrastre y suelte archivos o haga clic en **Seleccionar archivos** para subirlos. Haga clic en un chip de adjunto para descargarlo. La eliminación está disponible para los gestores.

---

## Gestión de versiones

KANAP ofrece **dos formas de gestionar versiones de aplicaciones**, dependiendo de cómo su organización maneja las actualizaciones:

| Enfoque | Ideal para | Qué sucede |
|---------|------------|------------|
| **Simple** | La mayoría de aplicaciones | Actualice los campos de versión en el panel de propiedades o en el formulario de creación -- mismo registro, nuevo número de versión |
| **Sofisticado** | Migraciones mayores | Use **Crear nueva versión** para crear un nuevo registro de aplicación con seguimiento de linaje -- ejecute las versiones antigua y nueva en paralelo |

### Seguimiento simple de versiones (actualizaciones in situ)

Para la mayoría de aplicaciones -- donde actualiza y la versión anterior simplemente desaparece -- actualice los campos **Versión**, **Puesta en marcha**, **Fin de soporte** y **Fecha de retiro** en el formulario de creación o en el panel de propiedades. El chip de versión del encabezado y los metadatos de **Puesta en marcha** reflejan lo que defina.

Este enfoque mantiene todo en un solo registro. Cuando actualiza, modifique los campos de versión y listo. El historial se rastrea en el registro de auditoría.

**Use esto cuando**: las actualizaciones ocurren in situ sin solapamiento -- una versión reemplaza a otra.

### Crear una nueva versión (migraciones en paralelo)

Para actualizaciones mayores de aplicaciones donde necesita ejecutar las versiones antigua y nueva en paralelo en diferentes entornos (p. ej., SAP S/4HANA 1909 en Prod mientras 2023 está en QA), utilice **Crear nueva versión** en el encabezado del espacio de trabajo.

El asistente tiene tres pasos:

1. **Detalles de la versión** -- nuevo nombre de la aplicación, etiqueta de versión, fechas de **Puesta en marcha** y **Fin de soporte**.
2. **Opciones de copia** -- elija qué copiar del origen. Los valores predeterminados se muestran a continuación.
3. **Interfaces** -- seleccione qué interfaces migrar a la nueva versión.

La nueva versión se crea como una aplicación separada con:
- Un ciclo de vida **Propuesto** (listo para configurar antes de la puesta en marcha)
- Un enlace a su predecesor (usado por la línea de tiempo de versiones)
- Datos copiados según sus selecciones
- Interfaces duplicadas apuntando a la nueva versión

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
| Partidas presupuestarias (OPEX + CAPEX, emparejadas) | Activado |
| Contratos | Activado |
| Despliegues | Desactivado |
| Enlaces de despliegue | Desactivado (solo disponible cuando se selecciona Despliegues) |

**No se copia** (debe configurarse de nuevo): pertenencia a suite, adjuntos, asignaciones de servidores.

### Migración de interfaces

Durante la creación de versiones, el asistente muestra todas las interfaces donde esta aplicación es origen, destino o middleware (cuando ETL está habilitado). Las interfaces seleccionadas se duplican con sus referencias actualizadas a la nueva versión. Cada interfaz migrada incluye sus tramos, responsables, empresas, identificadores clave, enlaces y residencia de datos. Las interfaces migradas comienzan con un ciclo de vida **Propuesto**. Las interfaces originales permanecen vinculadas a la versión anterior.

**Copiar enlaces**: Si selecciona tanto **Despliegues** como **Enlaces de despliegue**, los enlaces de interfaz también se copian. Los enlaces se mapean a los despliegues de la nueva aplicación (emparejados por entorno); los detalles específicos del entorno (endpoints, autenticación, nombres de trabajo) se borran y el estado del enlace se restablece a **Propuesto**.

**Aplicaciones ETL/Middleware**: Si la aplicación tiene **Integración de datos / ETL** habilitado, el asistente también muestra interfaces que *fluyen a través de* esta aplicación como middleware. Estas son interfaces donde otro origen envía datos a otro destino a través de su ETL. Copiarlas crea nuevas definiciones de interfaz para el ETL actualizado, con las referencias de middleware debidamente actualizadas.

**Consejo**: Use esto al actualizar su ERP o ETL: migre las interfaces críticas y opcionalmente copie los enlaces para obtener una ventaja en la configuración del entorno.

---

## Copiar aplicaciones

Hay dos formas de copiar una aplicación en KANAP:

### Copiar elemento (desde la cuadrícula de Aplicaciones)

Utilice esto cuando desee crear un duplicado independiente de una aplicación -- típicamente para crear una entrada de aplicación similar sin linaje de versiones.

1. Seleccione una aplicación en la cuadrícula
2. Haga clic en **Copiar elemento**
3. El sistema crea una copia con " (copia)" añadido al nombre
4. Se le lleva a la nueva aplicación para hacer cambios

**Qué se copia**: Todos los campos principales (excepto fecha de última prueba DR), incluidos los valores de clasificación y continuidad, responsables, empresas, departamentos, suites, partidas OPEX/CAPEX, contratos, enlaces, residencia de datos y contactos de soporte. La revisión de la copia se restablece.

**Qué NO se copia**: Despliegues, interfaces, asignaciones de servidores, adjuntos, campos de versión (versión, fecha de puesta en marcha, fin de soporte).

### Comparación: Copiar elemento vs Crear nueva versión

| Aspecto | Copiar elemento | Crear nueva versión |
|---------|-----------------|---------------------|
| **Propósito** | Duplicado independiente | Sucesor versionado con linaje |
| **Opciones del usuario** | Ninguna (automático) | Asistente de 3 pasos |
| **Linaje** | Sin enlace al predecesor | Establece predecesor |
| **Ciclo de vida** | Preservado | Restablecido a Propuesto |
| **Nombre** | Sufijo "(copia)" | Especificado por el usuario |

**Relaciones**:

| Relación | Copiar elemento | Crear nueva versión |
|----------|-----------------|---------------------|
| Responsables (negocio e IT) | Sí | Opcional (predeterminado: sí) |
| Empresas (audiencia) | Sí | Opcional (predeterminado: sí) |
| Departamentos | Sí | Opcional (predeterminado: sí) |
| Residencia de datos | Sí | Opcional (predeterminado: sí) |
| Enlaces | Sí | Opcional (predeterminado: sí) |
| Contactos de soporte | Sí | Opcional (predeterminado: sí) |
| Suites (pertenencia) | Sí | No |
| Partidas OPEX | Sí | Opcional (predeterminado: sí) |
| Partidas CAPEX | Sí | Opcional (predeterminado: sí) |
| Contratos | Sí | Opcional (predeterminado: sí) |
| Despliegues | No | Opcional (predeterminado: no) |
| Enlaces | No | Opcional (predeterminado: no) |
| Interfaces | No | Seleccionadas por el usuario |
| Asignaciones de servidores | No | No |
| Adjuntos | No | No |

**Campos principales**:

| Campo | Copiar elemento | Crear nueva versión |
|-------|-----------------|---------------------|
| Descripción | Sí | Sí |
| ETL habilitado | Sí | Sí |
| Notas de soporte | Sí | Sí |
| Última prueba DR | No | No |
| Campos de versión | No | Especificados por el usuario |
| Sobrescritura de usuarios | Sí | Restablecido a nulo |
| Año de usuarios | Sí | Restablecido al año actual |

---

## Importación/exportación CSV

Mantenga su inventario de aplicaciones a escala usando la importación y exportación CSV. Esta funcionalidad soporta operaciones masivas para carga inicial de datos, actualizaciones periódicas desde sistemas externos y extracción de datos para informes.

### Acceder a las funciones CSV

Desde la lista de Aplicaciones:
- **Exportar CSV**: Descargar aplicaciones a un archivo CSV
- **Importar CSV**: Subir un archivo CSV para crear o actualizar aplicaciones
- **Descargar plantilla** (desde dentro del diálogo de importación): Obtener un CSV en blanco con los encabezados correctos

**Permisos requeridos**: `applications:admin` para operaciones de importación/exportación.

### Opciones de exportación

**Presets**:

| Preset | Descripción |
|--------|-------------|
| **Exportación completa** | Todos los campos exportables incluidos datos calculados/solo lectura (marcas de tiempo, residencia de datos, métricas de usuarios) |
| **Enriquecimiento de datos** | Solo campos importables -- ideal para flujos de trabajo de edición de ida y vuelta |

**Exportación de plantilla**: Descarga solo encabezados -- útil para preparar archivos de importación con la estructura correcta. La plantilla incluye todos los campos importables.

**Selección personalizada**: Elija campos específicos para incluir en su exportación.

### Flujo de trabajo de importación

1. **Prepare su archivo**: Use codificación UTF-8 con separadores de punto y coma (`;`). Descargue una plantilla para asegurar encabezados correctos.

2. **Elija la configuración de importación**:
   - **Modo**:
     - `Enriquecer` (predeterminado): Las celdas vacías preservan los valores existentes -- solo actualiza lo que especifique
     - `Reemplazar`: Se actualizan los campos proporcionados; las celdas de clasificación vacías conservan el valor existente y `__CLEAR__` lo borra explícitamente
   - **Operación**:
     - `Upsert` (predeterminado): Crear nuevas aplicaciones o actualizar las existentes
     - `Solo actualizar`: Solo modificar aplicaciones existentes, omitir nuevas
     - `Solo insertar`: Solo crear nuevas aplicaciones, omitir existentes

3. **Validar primero**: Haga clic en **Verificación previa** para validar su archivo sin hacer cambios. Revise errores y advertencias.

4. **Aplicar cambios**: Si la validación es correcta, haga clic en **Importar** para confirmar los cambios.

### Referencia de campos

**Campos de visión general**:

| Columna CSV | Descripción | Obligatorio | Notas |
|-------------|-------------|-------------|-------|
| `id` | UUID de la aplicación | No | Para actualizaciones; deje en blanco para nuevas aplicaciones |
| `name` | Nombre de la aplicación | Sí | Se usa como identificador único para coincidencias |
| `description` | Qué hace la aplicación | No | |
| `category` | Propósito principal | No | Acepta código o etiqueta de Configuración |
| `supplier_name` | Nombre del proveedor | No | Debe coincidir con un proveedor existente |
| `editor` | Editor del software | No | Texto libre (p. ej., Microsoft, SAP) |
| `criticality` | Criticidad de negocio | No | Acepta código o etiqueta de Configuración; `__CLEAR__` lo borra |
| `lifecycle` | Estado actual | No | Acepta código o etiqueta de Configuración |
| `is_suite` | Puede tener apps hijas | No | `true` o `false` |
| `status` | Habilitado/deshabilitado | No | `enabled` o `disabled` |

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
| `external_facing` | Accesible desde internet | `true` o `false` |
| `etl_enabled` | Integración de datos | `true` o `false` |
| `support_notes` | Información de soporte | Texto libre |
| `licensing` | Términos de licencia | Texto libre |
| `notes` | Notas internas | Texto libre |

**Campos de conformidad**:

| Columna CSV | Descripción | Notas |
|-------------|-------------|-------|
| `data_class` | Clasificación de datos | Acepta código o etiqueta de Configuración |
| `last_dr_test` | Fecha de última prueba DR | Formato de fecha: AAAA-MM-DD |
| `contains_pii` | Almacena datos personales | `true` o `false` |
| `data_residency` | Países de almacenamiento de datos | Solo exportación (códigos ISO) |

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
| `business_owner_email_1` hasta `_4` | Correos de responsables de negocio | Deben coincidir con usuarios existentes por correo |
| `it_owner_email_1` hasta `_4` | Correos de responsables IT | Deben coincidir con usuarios existentes por correo |

**Campos solo de exportación** (incluidos en Exportación completa pero no importables):

| Columna CSV | Descripción |
|-------------|-------------|
| `data_residency` | Países de almacenamiento de datos (códigos ISO, separados por comas) |
| `users_mode` | Método de conteo de usuarios (`manual`, `it_users`, `headcount`) |
| `users_year` | Año de referencia para cálculos de usuarios |
| `users_override` | Sobrescritura manual del conteo de usuarios |
| `created_at` | Marca de tiempo de creación del registro |
| `updated_at` | Marca de tiempo de última modificación |

### Aceptación de etiquetas y códigos

Para campos configurados en **Panorama IT > Configuración**, puede usar tanto el código interno como la etiqueta visible:

| Campo | Ejemplos de códigos | Ejemplos de etiquetas |
|-------|---------------------|----------------------|
| Categoría | `lob`, `productivity`, `security` | `Line-of-business`, `Productivity`, `Security` |
| Ciclo de vida | `active`, `proposed`, `deprecated` | `Active`, `Proposed`, `Deprecated` |
| Clase de datos | `public`, `internal`, `confidential` | `Public`, `Internal`, `Confidential` |

El sistema normaliza automáticamente los valores durante la importación, por lo que `Line-of-business`, `line-of-business` y `lob` se resuelven a la misma categoría.

### Coincidencia y actualizaciones

Las aplicaciones se emparejan por **nombre** (sin distinguir mayúsculas). Cuando se encuentra una coincidencia:
- Con modo `Enriquecer`: Solo los valores CSV no vacíos actualizan la aplicación
- Con modo `Reemplazar`: se actualizan los campos proporcionados; las celdas de clasificación vacías conservan el valor existente y `__CLEAR__` lo borra explícitamente

Si incluye la columna `id` con un UUID válido, la coincidencia usa primero el ID, luego el nombre como respaldo.

### Limitaciones

- **Despliegues no incluidos**: Los despliegues por entorno (Prod, QA, Dev) requieren configuración en el espacio de trabajo
- **Asignaciones de servidores excluidas**: Los enlaces a servidores deben configurarse en la pestaña Despliegues
- **Interfaces excluidas**: Las definiciones de integración no son parte de la importación/exportación CSV
- **Máximo 4 responsables por tipo**: Se pueden importar/exportar hasta 4 responsables de negocio y 4 responsables IT
- **Métricas de usuarios solo de exportación**: Los campos de audiencia y conteo de usuarios (`users_mode`, `users_year`, `users_override`) se gestionan en el espacio de trabajo
- **Residencia de datos solo de exportación**: Las selecciones de países deben gestionarse en la pestaña Conformidad

### Solución de problemas

**Error "El archivo no tiene el formato correcto"**: Esto generalmente indica un problema de codificación. Asegúrese de que su CSV esté guardado como **UTF-8**:

- **En LibreOffice**: Al abrir un CSV, seleccione `UTF-8` en el desplegable de Juego de caracteres (no "Japanese (Macintosh)" u otras codificaciones). Al guardar, marque "Editar configuración de filtro" y elija UTF-8.
- **En Excel**: Guardar como > CSV UTF-8 (delimitado por comas), luego abra en un editor de texto para cambiar comas por puntos y coma.
- **Consejo general**: Si ve caracteres ilegibles (`?¿`, `ï»¿`) al inicio de su archivo, la codificación es incorrecta.

### Ejemplo CSV

```csv
name;category;supplier_name;criticality;lifecycle;go_live_date;external_facing
Salesforce CRM;Line-of-business;Salesforce Inc;Critical;Active;2020-01-15;true
Microsoft 365;Productivity;Microsoft;high;active;2019-06-01;false
Custom ERP;lob;;Moderate;Active;2018-03-20;false
```

---

## Consejos

- **Empiece por las apps críticas**: Documente primero sus aplicaciones críticas para el negocio, luego avance en los niveles de criticidad.
- **Use Suites para agrupar**: Active "Puede tener apps hijas" en la pestaña Operaciones para marcar una aplicación como Suite que agrupa componentes relacionados (p. ej., módulos SAP bajo una Suite SAP).
- **Vincule al gasto temprano**: Conecte partidas OPEX, CAPEX y contratos en la pestaña Relaciones para ver el panorama completo de costes de cada aplicación.
- **Mantenga los despliegues actualizados**: La pestaña Despliegues alimenta los chips de entorno en la lista -- manténgala actualizada para una visibilidad precisa.
- **Documente la audiencia**: Defina la audiencia de empresas y departamentos en el panel de propiedades; el conteo de usuarios se deriva entonces automáticamente y se utiliza en los informes.
- **Aproveche el filtrado por categoría**: Utilice el filtro de columna Categoría para centrarse en tipos específicos de aplicaciones (p. ej., mostrar solo apps de Línea de negocio, o excluir herramientas de Productividad).
- **Adjunte conocimiento temprano**: Vincule runbooks y documentos de arquitectura desde la pestaña Visión general para que el equipo sepa dónde buscar durante los incidentes.
- **Las tareas vienen de la página Tareas**: Para adjuntar una tarea a una aplicación, defina el campo App / Servicio en la propia tarea; aparecerá en Relaciones > Tareas.
