# Interfaces

Las interfaces documentan los flujos lógicos de datos entre sus aplicaciones. Cada interfaz representa una integración de negocio -- el "por qué" y el "qué" del intercambio de datos -- independiente de cómo se implementa técnicamente. El espacio de trabajo le permite describir la interfaz, definir los tramos que mueven datos a través de su panorama, configurar enlaces específicos por entorno, capturar las reglas de mapeo a nivel de campo y vincular interfaces, documentos y adjuntos relacionados.

## Primeros pasos

Navegue a **Panorama IT > Interfaces** para ver su registro de integraciones. Haga clic en **Añadir interfaz** para crear una nueva entrada, o abra una existente para editarla.

Para crear una interfaz necesita:

- **ID de interfaz**: Un código corto único (p. ej., `INT-CRM-ERP-001`)
- **Nombre**: Un nombre descriptivo para la integración
- **Propósito de negocio**: Un breve resumen de por qué existe esta integración
- **Aplicación de origen** y **Aplicación de destino**
- **Categoría de datos**: El tipo de datos transferidos

Una vez establecidos estos, puede guardar la interfaz; el resto del espacio de trabajo (Técnico, Entornos, Mapeo, Relaciones) queda disponible a continuación.

**Consejo**: Defina pronto el **Tipo de ruta de integración** (Directa o Vía middleware). Controla qué tramos se generan automáticamente y qué aparece en la pestaña Técnico y en la matriz de Entornos.

---

## Trabajar con la lista

La cuadrícula de Interfaces muestra su registro de integraciones de un vistazo.

**Columnas predeterminadas**:

- **ID de interfaz**: El identificador único (haga clic para abrir el espacio de trabajo)
- **Nombre**: Nombre de la interfaz
- **Entornos**: Puntos de colores que muestran qué entornos ya tienen enlaces configurados (p. ej., PROD, QA, DEV)
- **App de origen** y **App de destino**: Las aplicaciones conectadas
- **Ciclo de vida**: Estado actual
- **Criticidad**: Importancia para el negocio
- **Creado**: Cuándo se creó el registro

**Columnas adicionales** (mediante el selector de columnas):

- **Proceso de negocio**: Proceso de negocio vinculado
- **Categoría de datos**: Tipo de datos transferidos
- **Contiene PII**: Si la interfaz maneja datos personales
- **Cobertura de entornos**: Número de entornos con al menos un enlace
- **Enlaces**: Número total de enlaces de entorno

**Filtrado**:

- Búsqueda rápida en todas las columnas de texto
- Filtros de columna en las columnas de texto, incluidos ciclo de vida y criticidad. Proceso de negocio, categoría de datos y contiene PII no tienen filtro de columna

**Acciones**:

- **Añadir interfaz**: Crear una nueva interfaz (requiere `applications:manager`)
- **Duplicar interfaz**: Crear una copia de una interfaz seleccionada (requiere `applications:manager`). Seleccione exactamente una fila para activar esta acción. Un diálogo le permite elegir si copiar los enlaces de entorno -- consulte [Copiar interfaces](#copiar-interfaces) más abajo.
- **Eliminar seleccionadas**: Eliminar interfaces seleccionadas (requiere `applications:admin`). Una opción de casilla permite también eliminar los enlaces relacionados; si no está marcada, las interfaces con enlaces no se eliminarán.

---

## El espacio de trabajo de Interfaces

Haga clic en cualquier fila para abrir el espacio de trabajo. El espacio de trabajo tiene un panel lateral con las propiedades de la interfaz a la izquierda y cinco pestañas a la derecha.

### Propiedades de la interfaz (panel lateral)

El panel lateral permanece visible en cada pestaña y agrupa los campos más editados en tres secciones plegables:

**Propiedades principales**:

- **ID de interfaz**, **Nombre**, **Propósito de negocio** (obligatorio)
- **Proceso de negocio**: Vínculo a un proceso de negocio de los datos maestros
- **Ciclo de vida** y **Criticidad**
- **Aplicación de origen** y **Aplicación de destino** (obligatorio)
- **Tipo de ruta de integración**: Directa o Vía middleware
- **Aplicaciones middleware**: Solo se muestra cuando el tipo de ruta es Vía middleware. La lista se restringe a las aplicaciones marcadas como ETL/middleware.

**Equipo**:

- **Responsables de negocio**: Partes interesadas del negocio responsables de la integración
- **Responsables IT**: Miembros del equipo técnico responsables del mantenimiento

**Datos y conformidad**:

- **Categoría de datos**: El tipo de datos transferidos
- **Clasificación de datos**: Nivel de sensibilidad (Público, Interno, Confidencial, Restringido)
- **Contiene PII**: Cuando está marcado, aparece un campo **Descripción PII** para que pueda detallar qué PII está incluido
- **Residencia de datos**: Países por donde fluyen los datos (códigos ISO de 2 letras)

Los cambios en los campos del panel lateral se guardan automáticamente al salir del campo, de modo que puede actualizar propiedades desde cualquier pestaña sin cambiar de contexto.

---

### Especificación

La pestaña Especificación es un documento de texto enriquecido gestionado donde describe la interfaz de principio a fin -- contexto de negocio, alcance, contrato, ejemplos. Es el documento narrativo principal de la interfaz.

**Consejo**: Use esta pestaña como su única fuente de verdad para la prosa. Las reglas de mapeo y los tramos técnicos viven en las pestañas dedicadas a continuación; mantenga este documento centrado en la intención, el alcance y el resumen legible para humanos.

---

### Técnico

La pestaña Técnico define los **tramos** compartidos que componen la interfaz. Los tramos son plantillas: describen lo que hace cada paso en general (la misma definición se aplica en todos los entornos).

Para cada tramo puede editar:

- **Tipo de tramo**: EXTRACT, TRANSFORM, LOAD o DIRECT (definido automáticamente según la ruta de integración)
- **De -> A**: Qué rol maneja cada paso (App de origen, App de destino o Middleware)
- **Tipo de disparador**: Qué inicia este tramo (p. ej., programado, basado en eventos, manual)
- **Patrón**: El patrón de integración (p. ej., lote, tiempo real, pub/sub)
- **Formato**: El formato de datos (p. ej., JSON, XML, CSV, archivo plano)
- **Nombre de trabajo**: Un nombre opcional de trabajo o proceso predeterminado

Si aún no aparecen tramos, guarde primero la interfaz. Los tramos se generan a partir de **Aplicación de origen**, **Aplicación de destino** y **Tipo de ruta de integración** del panel lateral.

---

### Entornos

La pestaña Entornos gestiona los enlaces por entorno que convierten las plantillas de tramos en configuraciones reales. Presenta una matriz de entornos y tramos, permitiéndole configurar cada combinación de forma independiente.

**Cómo funciona**:

- Cada entorno (Prod, Pre-prod, QA, Test, Dev, Sandbox o personalizado) puede tener enlaces para cada tramo
- Los entornos se descubren automáticamente desde sus instancias de aplicación; también puede añadir entornos personalizados
- Haga clic en una celda vacía para crear un enlace, o haga clic en uno existente para editarlo

**Campos del enlace**:

- **Instancia de origen** e **Instancia de destino**: Qué instancias de aplicación usar en este entorno
- **Estado**: Habilitado, Deshabilitado o En pruebas
- **Punto final de origen** y **Punto final de destino**: Puntos finales técnicos (URLs, rutas, nombres de cola, etc.)
- **Detalles del disparador**: Configuración del disparador específica del entorno
- **Nombre de trabajo del entorno**: Sobrescribir el nombre de trabajo de la plantilla de tramo para este entorno
- **Modo de autenticación**: Cómo autentica el enlace
- **URL de monitoreo**: Enlace a la monitorización u observabilidad de este enlace
- **Aplicación de herramienta de integración**: Si aplica, la herramienta de integración utilizada
- **Notas del entorno**: Notas específicas del entorno

**Vinculación de conexiones**: Cada enlace puede vincularse a conexiones de infraestructura de su registro de conexiones. Esto le permite trazar la ruta completa desde la interfaz lógica hasta la conexión de red física.

---

### Mapeo

La pestaña Mapeo es donde describe cómo los campos de origen se convierten en campos de destino. Está organizada alrededor de dos conceptos:

- Las **reglas de mapeo** describen una única decisión de mapeo -- uno o más campos de origen, uno o más campos de destino, una operación (copia directa, transformación, búsqueda, división, fusión, filtro, valor predeterminado o una operación personalizada) y notas opcionales de condición / negocio / middleware.
- Los **grupos de mapeo** son carpetas que organizan las reglas en secciones temáticas (por ejemplo "Cabecera", "Bloque del cliente", "Líneas de detalle", "Pie"). Las reglas pueden asignarse a un grupo o dejarse sin agrupar. Dos grupos base, **Head** e **Item**, están siempre presentes; puede añadir más.

La pestaña trabaja sobre el **conjunto de mapeo predeterminado** de la interfaz. La barra del encabezado muestra el nombre del conjunto, el número de revisión actual, los conteos de reglas y grupos.

**Filtrado de reglas**:

Use el desplegable **Vista de grupo** encima de la tabla de reglas para centrarse en:

- **Todas las reglas** (predeterminado)
- Reglas **Sin agrupar** (con el conteo)
- Un grupo específico (mostrando el orden, el título y el conteo de reglas)

**Gestionar grupos**:

Haga clic en **Gestionar grupos** para abrir el gestor de grupos. Desde ahí puede:

- Añadir un nuevo grupo (título, descripción opcional, orden)
- Editar un grupo existente
- Eliminar un grupo no base (las reglas asignadas a él pasan a Sin agrupar)

Los grupos base **Head** e **Item** pueden seleccionarse pero no editarse ni eliminarse.

**Añadir o editar una regla**:

Haga clic en **Añadir regla** o haga clic en cualquier fila de regla para abrir el panel de regla a la derecha. Campos de la regla:

- **Título de la regla** (obligatorio) y **Clave de regla** opcional (un identificador técnico estable para exportaciones o sistemas posteriores)
- **Grupo**: Asignar a un grupo o dejar Sin agrupar
- **Campo(s) de origen**: Una fila por enlace de origen. Cada fila tiene una **ruta** (p. ej., `origin.customerId`) y un **tipo** opcional (cadena, número, fecha, etc., o cualquier descriptor de texto libre). Use múltiples filas para modelar mapeos 1:N o N:1.
- **Campo(s) de destino**: Misma estructura, una fila por enlace de destino
- **Operación**: Copia directa, Transformación, Búsqueda, División, Fusión, Filtro, Valor predeterminado u **Otra** (con una etiqueta de texto libre)
- **Se aplica al tramo**: Restringir la regla a un tramo específico (p. ej., solo el tramo EXTRACT) o dejar como **Todos los tramos**
- **Orden**: Orden de visualización dentro del grupo
- **Condición**: Cuándo se aplica la regla
- **Regla de negocio**: Explicación en lenguaje claro de la lógica de negocio
- **Nota de middleware / transformación**: Notas de implementación para el equipo de middleware o ETL
- **Observaciones**: Cualquier otra cosa que valga la pena anotar

La tabla de mapeo resume cada regla listando los enlaces de origen, una flecha y los enlaces de destino, además de la operación, el grupo al que pertenece y el alcance del tramo. Haga clic en una fila para editarla, o use los iconos de la fila para editar o eliminar.

**Consejo**: Mantenga una regla por decisión lógica en lugar de una regla por campo. Una regla que toma tres campos de origen y produce un campo de destino concatenado es más clara que tres filas casi idénticas -- y el campo de operación hace explícita la intención.

---

### Relaciones

La pestaña Relaciones reúne los vínculos de esta interfaz con otras cosas.

- **Dependencias de interfaz**: Interfaces aguas arriba y aguas abajo. Úselas para documentar ordenamientos como "La sincronización de pedidos debe ejecutarse antes que la sincronización de facturas".
- **URLs externas**: Enlaces a documentación en Confluence, SharePoint, etc. Añada una descripción y una URL; el icono de abrir en nueva pestaña le lleva directamente al enlace.
- **Adjuntos**: Arrastre y suelte archivos en el área de carga o use **Seleccionar archivos** para adjuntar documentos de especificación directamente a la interfaz. Haga clic en un chip de adjunto para descargarlo; haga clic en el icono de papelera para eliminarlo (requiere derechos de gestor).

Una sección de Conocimiento está reservada para futura vinculación de conocimiento entre entidades; actualmente muestra un marcador informativo.

---

## Copiar interfaces

Hay dos formas de copiar interfaces en KANAP.

### Duplicar Interfaz (desde la cuadrícula de Interfaces)

Use esto cuando desee una copia independiente de una interfaz -- típicamente para crear una integración similar entre las mismas o diferentes aplicaciones.

1. Seleccione una interfaz en la cuadrícula
2. Haga clic en **Duplicar interfaz**
3. Elija si copiar los enlaces de entorno:
   - **Sin enlaces**: Una copia limpia -- solo la definición de la interfaz, los tramos, los responsables y los metadatos
   - **Con enlaces**: También copia los enlaces de entorno, pero borra los detalles específicos del entorno (puntos finales, autenticación, nombres de trabajo) para que pueda configurarlos de nuevo

**Qué se copia**:

| Datos | Copiado |
|-------|---------|
| Definición de la interfaz (nombre, apps, tipo de ruta) | Sí |
| Tramos (extract / transform / load / direct) | Sí |
| Aplicaciones middleware | Sí |
| Responsables (negocio e IT) | Sí |
| Empresas afectadas | Sí |
| Dependencias | Sí |
| Identificadores clave | Sí |
| Enlaces a URLs externas | Sí |
| Residencia de datos | Sí |
| Enlaces | Opcional |
| Grupos y reglas de mapeo | No |
| Adjuntos | No |

**Nomenclatura**: La copia recibe " - copia" añadido tanto al nombre como al ID de interfaz.

### Migración de versión (desde el versionado de aplicaciones)

Use esto al actualizar una aplicación a una nueva versión y necesite migrar interfaces a la nueva versión. Consulte [Aplicaciones > Gestión de versiones](applications.md#gestion-de-versiones) para más detalles.

**Diferencias clave respecto a Duplicar**:

| Aspecto | Duplicar | Migración de versión |
|---------|----------|----------------------|
| Propósito | Crear copia independiente | Migrar a nueva versión de la app |
| Referencias de app | Sin cambios | Actualizadas a la nueva versión |
| Referencias de middleware | Sin cambios | Actualizadas si la app es middleware |
| Dependencias | Copiadas | No copiadas |
| Enlaces | Opcional (instancias sin cambios) | Opcional (instancias mapeadas a la nueva app) |
| Ciclo de vida | Preservado | Restablecido a Propuesto |
| Sufijo de nombre | " - copia" | " (nueva versión)" |

---

## Consejos

- **Documente primero el "por qué"**: Use la pestaña Especificación y el campo **Propósito de negocio** del panel lateral para capturar la intención antes de sumergirse en tramos y enlaces.
- **Use el panel lateral desde cualquier pestaña**: Responsables, criticidad, tipo de ruta, indicador PII y el resto persisten inmediatamente, de modo que puede actualizarlos mientras revisa reglas o enlaces.
- **Una interfaz, muchos entornos**: No cree interfaces separadas para cada entorno -- use una interfaz y configure cada entorno en la pestaña Entornos.
- **Agrupe sus reglas de mapeo**: Para interfaces con más de un puñado de campos, organice las reglas en grupos de mapeo (Cabecera, Líneas de detalle, Pie, etc.). Hace que la revisión y el análisis de impacto sean mucho más fáciles.
- **Mantenga el middleware explícito**: Si los datos fluyen a través de middleware, defina el tipo de ruta como **Vía middleware** y elija las aplicaciones middleware. El Mapa de interfaces renderizará entonces la ruta de datos real.
- **Duplique para interfaces similares**: Al crear una nueva interfaz que es similar a una existente, use **Duplicar interfaz** para copiar todas las configuraciones, luego modifique lo que sea diferente. Opcionalmente incluya enlaces para obtener una ventaja en la configuración del entorno.
- **Vincule enlaces a conexiones de infra**: En la pestaña Entornos, vincule cada enlace a su conexión de infraestructura subyacente para que pueda trazar la ruta completa desde la interfaz de negocio hasta la conexión de red.
