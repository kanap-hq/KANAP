# Planes de cuentas y gestión de cuentas

Los Planes de cuentas (CoA) organizan su estructura contable agrupando cuentas en conjuntos nombrados. Cada empresa puede vincularse a un CoA, que determina qué cuentas están disponibles al registrar partidas OPEX o CAPEX.

## ¿Por qué usar Planes de cuentas?

Sin CoA, todas las cuentas están disponibles para todas las empresas, lo que facilita usar accidentalmente la cuenta incorrecta o mezclar estándares contables entre entidades. Los Planes de cuentas resuelven esto al:

  - **Asegurar consistencia**: Las empresas solo ven cuentas de su CoA asignado
  - **Soportar múltiples estándares**: Diferentes países o unidades de negocio pueden usar diferentes estructuras de cuentas
  - **Simplificar la selección**: Los desplegables de cuentas muestran solo cuentas relevantes, no todo su catálogo
  - **Habilitar plantillas**: Cargue conjuntos de cuentas preconfigurados desde plantillas específicas por país

**Ejemplo**: Su filial francesa utiliza el PCG (Plan Comptable General) francés, mientras que su entidad del Reino Unido usa UK GAAP. Cree dos CoA -- uno para cada estándar -- y asigne las empresas en consecuencia. Al registrar gasto, los usuarios ven automáticamente las cuentas correctas.

## La relación: CoA -> Empresa -> Cuentas

La jerarquía funciona así:

```
Plan de cuentas (FR-2024)
  -> asignado a
Empresa (Acme Francia)
  -> utilizado al registrar
Partidas OPEX/CAPEX -> Selección de cuenta (filtrada a cuentas de FR-2024 únicamente)
```

**Puntos clave**:
  - Un CoA puede asignarse a múltiples empresas
  - Cada empresa tiene un CoA
  - Las cuentas pertenecen a un CoA
  - Cuando crea/edita partidas de gasto, el desplegable de cuentas se filtra por el CoA de la empresa

## Dónde encontrarlo

- Ruta: **Datos maestros > Planes de cuentas**
- Permisos:
  - Ver: `accounts:reader`
  - Crear/editar cuentas y CoA: `accounts:manager`
  - Importar CSV, Exportar CSV, Eliminar: `accounts:admin`

## Trabajar con la lista

La página tiene dos capas: un **selector de CoA** en la parte superior y una **cuadrícula de cuentas** debajo.

### Barra de chips de CoA

Una fila horizontal de chips representa cada Plan de cuentas. Haga clic en un chip para cambiar la cuadrícula de cuentas a ese CoA.

- El chip seleccionado está relleno; los demás están delineados.
- Una insignia de estrella (**★**) marca el predeterminado del país para ese CoA.
- Una insignia de círculo más marca el predeterminado global.
- Pase el cursor sobre un chip para ver el nombre del CoA y el conteo de cuentas.

Si tiene permiso `accounts:manager`, aparecen dos controles adicionales a la derecha:

- **Nuevo**: Abre el diálogo de **Nuevo Plan de cuentas**.
- **Gestionar**: Abre el modal de **Gestionar Planes de cuentas** para la administración.

Cuando no existen CoA, la barra de chips muestra un aviso para crear su primer Plan de cuentas.

### Resumen del CoA

Debajo de la barra de chips, una línea de resumen muestra el **código**, **conteo de cuentas**, **nombre** y **país** del CoA seleccionado (para CoA con alcance de país).

### Cuadrícula de cuentas

La cuadrícula muestra cuentas solo del CoA seleccionado.

**Columnas predeterminadas**:
- **N.º de cuenta**: El número de la cuenta. Haga clic para abrir el espacio de trabajo de la cuenta.
- **Nombre**: El nombre de la cuenta. Haga clic para abrir el espacio de trabajo de la cuenta.
- **N.º cuenta consolidación**: El número de la cuenta de consolidación.
- **Nombre consolidación**: El nombre de la cuenta de consolidación.

**Columnas adicionales** (ocultas por defecto, habilite mediante el selector de columnas):
- **Nombre nativo**: El nombre de la cuenta en el idioma local.
- **Descripción**: Descripción de la cuenta.
- **Descripción consolidación**: Descripción de la cuenta de consolidación.
- **Estado**: Si la cuenta está habilitada o deshabilitada.
- **Creado**: Marca de tiempo de la creación de la cuenta.

**Filtrado**:
- Búsqueda rápida: Busca en las columnas de texto visibles.
- Alcance de estado: el selector **Mostrar: Todos / Activos / Desactivados** sobre la cuadrícula. Por defecto **Activos**, mostrando solo cuentas activas. Elija **Todos** para incluir cuentas desactivadas.
- Filtros de columna: Use filtros en los encabezados de columna (p. ej., la columna **Estado** tiene un filtro de conjunto). Si hace clic en **Limpiar** en el filtro **Estado**, o desmarca ambos valores, la lista no muestra nada, sea cual sea la opción de **Mostrar**.

**Ordenación**: Predeterminada por **N.º de cuenta** ascendente.

**Acciones** (en el encabezado de la página):
- **Nueva cuenta** (`accounts:manager`): Abre un nuevo espacio de trabajo de cuenta previnculado al CoA seleccionado.
- **Importar CSV** (`accounts:admin`): Importar cuentas al CoA seleccionado.
- **Exportar CSV** (`accounts:admin`): Exportar cuentas del CoA seleccionado.
- **Eliminar seleccionadas** (`accounts:admin`): Eliminar filas de cuentas seleccionadas. Seleccione filas usando la columna de casilla de verificación (visible para administradores).

Todas las celdas de fila son enlaces clicables al espacio de trabajo de la cuenta. Puede hacer clic derecho o Ctrl+clic para abrir en una nueva pestaña.

## El espacio de trabajo de la cuenta

Haga clic en cualquier fila de la cuadrícula de cuentas para abrir el espacio de trabajo de la cuenta.

### Visión general

El espacio de trabajo tiene una única pestaña **Visión general** con un formulario para ver y editar los campos de la cuenta.

**Qué puede editar**:
- **Plan de cuentas**: El CoA al que pertenece esta cuenta (desplegable de todos los CoA en su espacio de trabajo).
- **Número de cuenta** (obligatorio): El número de la cuenta.
- **Nombre de la cuenta** (obligatorio): El nombre de la cuenta en inglés (o su idioma principal).
- **Nombre nativo (idioma local)**: El nombre de la cuenta en el idioma local.
- **Descripción**: Descripción de texto libre.
- **Número de cuenta de consolidación**: El número de cuenta de consolidación estandarizado.
- **Nombre de cuenta de consolidación**: El nombre de consolidación estandarizado.
- **Descripción de cuenta de consolidación**: Detalles sobre la categoría de consolidación.
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Establezca un **Fin de validez** para programar cuándo la cuenta deja de aparecer en los desplegables de selección. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida).

**Navegación**:
- **Anterior / Siguiente**: Navegar entre cuentas en el orden actual de la lista.
- **Guardar**: Guardar cambios (habilitado cuando el formulario tiene cambios y tiene `accounts:manager`).
- **Restablecer**: Descartar cambios no guardados.
- **Cerrar** (botón X): Volver a la lista de cuentas, preservando su selección de CoA, ordenación, búsqueda y filtros.

Si navega fuera con cambios sin guardar, el sistema le solicita que guarde o descarte.

**Consejo**: Necesita `accounts:manager` para editar. Los usuarios de solo lectura ven un banner informativo.

## Configurar Planes de cuentas

### Crear un CoA

Puede crear un CoA de dos formas:

1. **Desde cero**: Elija un Alcance y luego cree un CoA vacío.
   - **Alcance**: `GLOBAL` (sin país) o `PAÍS` (requiere selección de país)
   - Para alcance `PAÍS`, puede marcarlo como el predeterminado para ese país. Solo existe un predeterminado por país a la vez.
   - Puede cargar cuentas más tarde vía CSV.
2. **Desde una plantilla**: Cargue un conjunto de cuentas preconfigurado mantenido por los administradores de la plataforma.
   - Las plantillas globales crean un CoA con alcance `GLOBAL` (sin campo de país).
   - Las plantillas de país crean un CoA con alcance `PAÍS` con el país de la plantilla prerrellenado.

**Campos del diálogo de creación**:
- **Modo**: Elija **Crear desde cero** o **Copiar de plantilla**.
- **Plantilla** (solo modo plantilla): Seleccione una plantilla del desplegable. Las plantillas globales se muestran como "ALL -- ..."; las plantillas de país muestran su código de 2 letras.
- **Código** (obligatorio): Un identificador estable usado en exportaciones/importaciones CSV y enlaces directos.
- **Nombre** (obligatorio): Un nombre descriptivo para el CoA.
- **Alcance**: `País` o `Global`.
- **País** (solo alcance país): Seleccione un país de la lista.
- **Establecer como predeterminado para este país** (solo alcance país): Marque para hacer de este el CoA predeterminado para el país seleccionado.

En modo plantilla, puede ejecutar **Verificación previa** antes de crear para ver cuántas cuentas se insertarán y actualizarán. Luego haga clic en **Crear** para finalizar.

**Predeterminados**:
  - Por país: Puede marcar un CoA como predeterminado para cada país. Las nuevas empresas de ese país se asignan automáticamente a ese CoA (puede cambiarlo después en la pestaña Visión general de la empresa).
  - Respaldo global: Su espacio de trabajo puede tener un CoA predeterminado global usado para países que aún no tienen un predeterminado específico. Los predeterminados de país tienen precedencia; el predeterminado global se aplica en todas partes.

### Cargar desde plantillas

Las plantillas son conjuntos de cuentas estándar gestionados por los administradores de la plataforma. Pueden ser:
  - Específicas de país (p. ej., PCG francés, UK GAAP)
  - Globales (disponibles para todos los países)

**Cómo funciona**:
  - Vaya a **Datos maestros > Planes de cuentas**
  - Haga clic en **Nuevo** en la barra de chips
  - Seleccione el modo **Copiar de plantilla**
  - Seleccione una plantilla; las plantillas globales se muestran como "ALL -- ..." (carga un CoA `GLOBAL`); las plantillas de país muestran su código de 2 letras
  - El sistema muestra un informe de verificación previa (cuántas cuentas se insertarán/actualizarán)
  - Confirme para copiar las cuentas en su CoA

**Qué se copia**: Números de cuenta, nombres, nombres nativos (idioma local), descripciones, mapeos de consolidación y estado. Las cuentas pasan a ser suyas para editar -- los cambios en la plantilla de la plataforma no afectan a su CoA a menos que la recargue explícitamente.

**Consejo**: Después de cargar una plantilla, puede añadir cuentas específicas de la empresa, renombrar entradas o deshabilitar cuentas no utilizadas. Las plantillas proporcionan un punto de partida, no una estructura bloqueada.

### Plantillas disponibles

KANAP incluye **20 plantillas preconfiguradas** que cubren 10 estándares contables. Cada estándar viene en dos versiones:

- **v1.0 (Simple)**: Un conjunto enfocado de ~20 cuentas relevantes para IT -- licencias de software, alojamiento en la nube, ciberseguridad, telecomunicaciones, consultoría, costes de personal, formación y más. Ideal para organizaciones que quieren un punto de partida ligero.
- **v2.0 (Detallado)**: Todo lo de v1.0 más subcuentas granulares adicionales (~30 cuentas). Añade desgloses como Software comprado vs. Desarrollado internamente, Equipos de red, SaaS vs. Licencias perpetuas, Comunicaciones móviles, Bonificaciones IT, Seguro IT y más. Ideal para organizaciones que necesitan un seguimiento de costes más fino.

Ambas versiones usan **números de cuenta reales del estándar contable oficial de cada país** e incluyen nombres nativos en el idioma local.

| Código plantilla | País | Estándar | Cuentas (v1 / v2) |
|------------------|------|----------|---------------------|
| **IFRS** | Global | Normas Internacionales de Información Financiera | 14 / 30 |
| **FR-PCG** | Francia | Plan Comptable General | 20 / 31 |
| **DE-SKR03** | Alemania | Standardkontenrahmen 03 | 20 / 32 |
| **GB-UKGAAP** | Reino Unido | UK GAAP | 20 / 31 |
| **ES-PGC** | España | Plan General de Contabilidad | 20 / 31 |
| **IT-PDC** | Italia | Piano dei Conti | 20 / 31 |
| **NL-RGS** | Países Bajos | Rekeningschema (RGS) | 20 / 31 |
| **BE-PCMN** | Bélgica | Plan Comptable Minimum Normalise | 20 / 31 |
| **CH-KMU** | Suiza | Kontenrahmen KMU | 20 / 31 |
| **US-USGAAP** | Estados Unidos | US GAAP | 20 / 32 |

**Elegir una versión**:

  - Comience con **v1.0** si desea un plan limpio y mínimo que cubra las categorías esenciales de costes IT. Siempre puede añadir cuentas más adelante.
  - Elija **v2.0** si su organización hace seguimiento del gasto IT a nivel granular (p. ej., distinguiendo suscripciones SaaS de licencias perpetuas, o separando salarios IT de bonificaciones).

### Consolidación IFRS integrada

Todas las plantillas -- independientemente del país -- mapean cada cuenta a una de **14 cuentas de consolidación IFRS estandarizadas**. Esto significa que los informes a nivel de grupo funcionan desde el principio, incluso entre diferentes estándares locales.

| # | Cuenta de consolidación | Qué cubre |
|---|-------------------------|-----------|
| 1000 | Activos tangibles (CAPEX) | Equipamiento IT físico -- servidores, estaciones de trabajo, equipos de red |
| 1100 | Activos intangibles (CAPEX) | Software capitalizado y costes de desarrollo |
| 1200 | Depreciación y amortización | Depreciación de hardware y software |
| 1300 | Deterioros y provisiones | Deterioros y reducciones de valor de activos |
| 2000 | Licencias de software (OPEX) | Licencias perpetuas, suscripciones SaaS, soporte de código abierto |
| 2100 | Servicios cloud y alojamiento | IaaS, PaaS, monitorización, herramientas de ciberseguridad |
| 2200 | Telecomunicaciones y red | Internet, móvil, WAN/LAN |
| 2300 | Mantenimiento y soporte | Contratos de mantenimiento de hardware y software |
| 2400 | Consultoría IT y servicios externos | Asesoría, integración de sistemas, contratistas |
| 2500 | Costes de personal IT | Salarios, bonificaciones, cargas sociales, pensiones |
| 2600 | Formación y certificación | Programas de formación, certificaciones, conferencias |
| 2700 | IT de puesto de trabajo (no capitalizado) | Dispositivos de usuario final por debajo del umbral de capitalización |
| 2800 | Viajes y movilidad (proyectos IT) | Viajes relacionados con proyectos |
| 2900 | Otros gastos operativos IT | Costes IT varios, ciberseguro |

**Ejemplo**: Su filial francesa carga **FR-PCG v1.0** y su filial alemana carga **DE-SKR03 v1.0**. Ambas usan diferentes números de cuenta locales y nombres nativos, pero cada cuenta se mapea a la misma estructura de consolidación IFRS. Los informes a nivel de grupo se agregan sin ningún trabajo manual de mapeo.

### CoA predeterminado global (aprovisionamiento)

Los nuevos espacios de trabajo se aprovisionan automáticamente con la plantilla **IFRS v1.0**. Esto crea un CoA con alcance `GLOBAL` que contiene las 14 cuentas de consolidación IFRS y lo establece como predeterminado global del espacio de trabajo, para que las empresas puedan usarlo inmediatamente sin ninguna configuración. Puede editar o eliminar las cuentas/CoA precargados más adelante según sea necesario (sujeto a las protecciones estándar).

Los CoA globales se muestran con metadatos de alcance en el modal de **Gestionar**, sin valor de país para las entradas `GLOBAL`. Solo los CoA `GLOBAL` pueden marcarse como predeterminado global, y solo los CoA `PAÍS` pueden establecerse como predeterminado por país.

## Gestionar Planes de cuentas

### El modal de Gestión

Haga clic en **Gestionar** en la barra de chips para abrir el modal de administración. El modal tiene dos paneles:

**Panel izquierdo** -- Lista de CoA:
- Muestra todos sus Planes de cuentas con sus códigos y nombres.
- Insignias de predeterminado: **★** para predeterminado de país, círculo más para predeterminado global.
- Haga clic en una fila para ver sus detalles.

**Panel derecho** -- Detalles del CoA:
- **Código** y **Nombre**
- **Alcance**: `GLOBAL` o `PAÍS`
- **País** (para CoA con alcance de país)
- **Predeterminado de país**: Sí/No
- **Predeterminado global**: Sí/No
- **Empresas vinculadas**: Número de empresas asignadas a este CoA
- **Cuentas**: Número de cuentas en este CoA

**Acciones** (en la barra de herramientas del modal):
- **Nuevo** (`accounts:manager`): Abre el diálogo de crear CoA.
- **Establecer predeterminado de país** (`accounts:manager`): Marcar el CoA con alcance de país seleccionado como predeterminado para su país. Deshabilitado para CoA globales.
- **Establecer predeterminado global** (`accounts:manager`): Marcar el CoA con alcance global seleccionado como predeterminado global. Deshabilitado para CoA de país.
- **Eliminar seleccionado** (`accounts:admin`): Eliminar el CoA seleccionado. La eliminación se bloquea si alguna empresa lo referencia o alguna partida OPEX/CAPEX usa sus cuentas.

## Gestionar cuentas

### Números de cuenta

Los números de cuenta se almacenan como texto pero típicamente contienen valores numéricos. Al editar cuentas:
  - Puede introducir números (p. ej., `6011`) o texto (p. ej., `6011-TRAVEL`)
  - El sistema convierte automáticamente las entradas numéricas a cadenas
  - Dentro de un CoA, los números de cuenta deben ser únicos (verificado tras el llenado)

### Nombres nativos para soporte multilingüe

Algunos países requieren que las cuentas se registren en el idioma local. Utilice el campo **Nombre nativo** para almacenar el nombre original mientras mantiene el nombre en inglés en el campo principal **Nombre de la cuenta**.

**Ejemplo**: Cuenta francesa
  - **Nombre de la cuenta**: `Travel expenses` (inglés, para informes)
  - **Nombre nativo**: `Frais de deplacement` (francés, para conformidad legal)

El nombre nativo está disponible como columna oculta en la cuadrícula de cuentas. Habilítelo desde el selector de columnas para ver ambos nombres lado a lado.

## Cuentas de consolidación (Informes a nivel de grupo)

Para organizaciones multi-país, el trabajo diario se realiza usando Planes de cuentas locales (PCG francés, UK GAAP, HGB alemán, etc.), pero los informes a nivel de grupo a menudo requieren consolidación a un estándar común como **IFRS** o **US GAAP**.

Las **cuentas de consolidación** resuelven esto mapeando cuentas locales a cuentas de consolidación estandarizadas.

### Cómo funciona

Cada cuenta puede tener tres campos de consolidación:
  - **Número de cuenta de consolidación**: El número de cuenta estandarizado (p. ej., cuenta IFRS `6200`)
  - **Nombre de cuenta de consolidación**: El nombre estandarizado (p. ej., `IT Services and Software`)
  - **Descripción de cuenta de consolidación**: Detalles opcionales sobre la categoría de consolidación

**Ejemplo de mapeo**:

| País | CoA local | Cuenta local | Nombre local | -> | Cuenta consolidación | Nombre consolidación |
|------|-----------|-------------|--------------|---|----------------------|---------------------|
| Francia | FR-PCG | 6061 | Frais postaux | -> | 6200 | IT Services and Software |
| Reino Unido | UK-GAAP | 5200 | Postage and courier | -> | 6200 | IT Services and Software |
| Alemania | DE-HGB | 4920 | Portokosten | -> | 6200 | IT Services and Software |

Las tres cuentas locales se mapean a la misma cuenta de consolidación IFRS `6200`, habilitando la agregación a nivel de grupo.

### Por qué es importante

**Operaciones diarias**: Los usuarios trabajan con sus cuentas locales familiares
  - Los usuarios franceses seleccionan la cuenta `6061 - Frais postaux`
  - Los usuarios del Reino Unido seleccionan la cuenta `5200 - Postage and courier`
  - Los usuarios alemanes seleccionan la cuenta `4920 - Portokosten`

**Informes de grupo**: El sistema puede agregar costes por cuenta de consolidación
  - Todos los costes de servicios IT entre países se agregan a `6200 - IT Services and Software`
  - La dirección ve una vista unificada independientemente de las diferencias contables locales
  - Los informes estatutarios por país siguen usando cuentas locales

### Configurar mapeos de consolidación

**Opción 1: Plantillas (recomendado)**
Todas las plantillas integradas incluyen mapeos de consolidación IFRS en cada cuenta. Cargue cualquier plantilla de país y las columnas de consolidación ya están rellenadas -- sin mapeo manual necesario. Consulte [Plantillas disponibles](#plantillas-disponibles) para la lista completa.

**Opción 2: Importación CSV**
Al importar cuentas, incluya los campos de consolidación en su CSV:

```
coa_code;account_number;account_name;consolidation_account_number;consolidation_account_name;consolidation_account_description
FR-PCG;6061;Frais postaux;6200;IT Services and Software;
UK-GAAP;5200;Postage and courier;6200;IT Services and Software;
DE-HGB;4920;Portokosten;6200;IT Services and Software;
```

**Opción 3: Entrada manual**
Edite cuentas individualmente y complete los campos de consolidación en el espacio de trabajo de la cuenta.

### Mejores prácticas

  - **Use un estándar común**: IFRS es típico para grupos europeos; US GAAP para empresas americanas. Todas las plantillas integradas ya se mapean a las mismas 14 cuentas de consolidación IFRS (consulte [Consolidación IFRS integrada](#consolidacion-ifrs-integrada))
  - **Mantenga un plan de consolidación**: Conserve un documento de referencia listando sus cuentas de consolidación y lo que representan. Si usa las plantillas integradas, las 14 cuentas IFRS sirven como esta referencia
  - **Mapee con la granularidad adecuada**: No consolide demasiado ampliamente (pierde información) ni demasiado estrechamente (demasiado complejo)
  - **Involucre a finanzas**: Los mapeos de cuentas de consolidación deben alinearse con los requisitos de informes financieros de su grupo
  - **Actualice sistemáticamente**: Cuando añada cuentas locales, mapéelas inmediatamente a cuentas de consolidación

### Informes con cuentas de consolidación

Al construir informes, puede elegir agrupar por:
  - **Cuentas locales**: Muestra detalle específico del país (para gestión local)
  - **Cuentas de consolidación**: Muestra categorías a nivel de grupo (para informes ejecutivos)

Esta doble vista le permite satisfacer tanto los requisitos de conformidad local como las necesidades de informes de grupo sin mantener datos duplicados.

## Cuentas legado (soporte de migración)

Las **cuentas legado** son cuentas sin un `coa_id` (creadas antes de que se introdujeran los Planes de cuentas).

**Cómo funcionan**:
  - Las empresas SIN CoA pueden usar cuentas legado
  - Las empresas CON CoA no pueden usar cuentas legado -- se filtran automáticamente
  - Las cuentas legado pueden migrarse vía CSV (`coa_code`) y flujos de trabajo de reasignación

**Ruta de migración**:
  1. Cree o cargue Planes de cuentas para sus empresas
  2. Asigne CoA a las empresas (en la pestaña Visión general de la empresa)
  3. Asigne `coa_id` a sus cuentas legado (vía importación CSV con `coa_code` o edición masiva)
  4. Actualice las partidas OPEX/CAPEX existentes que muestren advertencias de "cuenta obsoleta"

**Consejo**: No tiene que migrar todo a la vez. Las empresas sin CoA continúan trabajando con cuentas legado, permitiendo una adopción gradual.

## Advertencias de cuenta obsoleta

Al editar partidas OPEX o CAPEX, puede ver:

```
Cuenta obsoleta detectada. La cuenta seleccionada no pertenece al
Plan de cuentas de la empresa. Por favor actualice la cuenta.
```

**Por qué sucede esto**:
  - La cuenta de la partida pertenece al CoA "A"
  - La empresa de la partida pertenece al CoA "B"
  - Se detectó un desajuste

**Escenarios comunes**:
  - Migró una empresa a un nuevo CoA pero no ha actualizado las partidas de gasto antiguas
  - Una cuenta fue reasignada manualmente a un CoA diferente
  - Está viendo datos históricos de antes de la migración de CoA

**Cómo solucionarlo**: Edite la partida y seleccione una cuenta del Plan de cuentas actual de la empresa. La advertencia desaparecerá una vez que la cuenta coincida con el CoA de la empresa.

## Estado y ciclo de vida

Las cuentas utilizan la misma gestión de ciclo de vida que otros datos maestros:

  - **Activadas** por defecto
  - Establezca un **Fin de validez** para dejar de usar una cuenta a partir de una fecha específica. Déjelo en blanco para que la cuenta permanezca activa indefinidamente
  - Si cambia la cuenta a **Desactivado** sin fecha, el fin de validez se fija en hoy
  - Cuando pasa el fin de validez, el estado cambia a **Desactivado** por sí solo en el plazo de una hora
  - Después del fin de validez:
      - La cuenta ya no aparece en los desplegables de selección para nuevos elementos
      - Los datos históricos permanecen intactos; los elementos existentes conservan sus asignaciones de cuenta
      - Los informes de años cuando la cuenta estaba activa siguen incluyéndola
  - La cuadrícula de cuentas muestra por defecto solo cuentas **Habilitadas**. Use el selector **Mostrar: Todos / Activos / Desactivados** y elija **Todos** para incluir cuentas desactivadas.

## Eliminación del espacio de trabajo y CoA

Cuando un espacio de trabajo es eliminado por un administrador de la plataforma, todos los datos contables del espacio de trabajo se eliminan permanentemente como parte del proceso de purga:
- Planes de cuentas (`chart_of_accounts`)
- Cuentas (`accounts`)
- Vínculos de empresas a un CoA (`companies.coa_id`)

La eliminación es inmediata e irreversible. El registro del espacio de trabajo permanece por auditabilidad, y su slug se borra para reutilización.

**Consejo**: Prefiera deshabilitar en lugar de eliminar. La eliminación solo está permitida si ninguna partida OPEX/CAPEX referencia la cuenta.

## Importación/exportación CSV

### Planes de cuentas

Puede exportar una lista de sus CoA (con metadatos como código, nombre, país, estado de predeterminado) pero no importar CoA directamente vía CSV. Cree CoA a través de la interfaz o cárguelos desde plantillas.

### Cuentas (endpoint global)

El CSV global `/accounts` incluye una columna `coa_code` para identificar a qué CoA pertenece cada cuenta.

  - **Exportar**
      - **Plantilla**: solo encabezados (úselo para preparar importaciones)
      - **Datos**: todas las cuentas con sus códigos de CoA, números de cuenta, nombres, nombres nativos, descripciones, mapeos de consolidación y estado
  - **Importar**
      - Comience con **Verificación previa** (valida estructura, codificación, campos obligatorios, duplicados)
      - Si la verificación previa es correcta, **Cargar** aplica inserciones/actualizaciones
      - **Coincidencia**: por `(coa_code, account_number)` dentro de su espacio de trabajo
      - **Campos obligatorios**: `coa_code`, `account_number`, `account_name`
      - **Campos opcionales**: `native_name`, `description`, campos de consolidación, `status`
      - Los duplicados en el archivo (mismo coa_code + account_number) se deduplicar; gana la primera ocurrencia

**Esquema CSV** (separado por punto y coma `;`, UTF-8):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

### Cuentas (con alcance de CoA)

Desde la página de Planes de cuentas, **Importar CSV** y **Exportar CSV** se limitan automáticamente al CoA seleccionado actualmente.

  - **Exportar**: cuentas de este CoA (no se necesita columna `coa_code`)
  - **Importar**: las cuentas se insertan/actualizan en este CoA automáticamente

**Esquema CSV** (con alcance de CoA, separado por punto y coma `;`, UTF-8):
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

**Notas**:
  - Utilice codificación **UTF-8** y **puntos y coma** como separadores
  - El `coa_code` debe coincidir con un Plan de cuentas existente en su espacio de trabajo
  - Los números de cuenta deben ser únicos dentro de un CoA
  - Valores de estado: `enabled` o `disabled` (predeterminado: enabled)

## Consejos

  - **Comience con plantillas**: KANAP incluye plantillas para 9 países más IFRS. Cargue una en lugar de construir desde cero -- obtiene números de cuenta adecuados, nombres nativos y mapeos de consolidación IFRS desde el principio. Comience con v1.0 (Simple) si no está seguro; actualice a v2.0 (Detallado) si necesita más granularidad.
  - **Un predeterminado por país**: Establezca un CoA predeterminado para cada país para que las nuevas empresas se asignen automáticamente a la estructura de cuentas correcta.
  - **Nombres nativos para conformidad**: Utilice el campo Nombre nativo si la normativa local requiere cuentas en el idioma local. Habilite la columna **Nombre nativo** en la cuadrícula para ver ambos nombres de un vistazo.
  - **Migre gradualmente**: No tiene que convertir todo a la vez. Las empresas sin CoA continúan trabajando con cuentas legado.
  - **Corrija cuentas obsoletas**: Cuando vea advertencias, actualice la cuenta para que coincida con el CoA actual de la empresa. Esto mantiene sus datos limpios para informes.
  - **Deshabilite en lugar de eliminar**: Deshabilitar cuentas preserva el historial. Solo elimine cuentas que fueron creadas por error y nunca se usaron.
  - **Las importaciones CSV son aditivas**: Importar cuentas añade nuevas y actualiza las existentes (emparejadas por coa_code + account_number). No elimina cuentas que no están en el archivo.
  - **Las cuentas de consolidación son clave para grupos**: Si opera en múltiples países, configure los mapeos de consolidación desde el primer día. Esto hace que los informes a nivel de grupo no requieran esfuerzo y mantiene a los usuarios locales trabajando con cuentas familiares.
  - **IFRS como estándar de consolidación**: La mayoría de grupos europeos usan IFRS para consolidación. Todas las plantillas integradas ya se mapean a las mismas 14 cuentas de consolidación IFRS, por lo que los informes de grupo funcionan entre países sin configuración adicional.
  - **Enlace directo**: La URL preserva su CoA seleccionado, orden de clasificación, texto de búsqueda y filtros. Comparta o marque un enlace para volver exactamente a la misma vista.

## Escenarios comunes

### Escenario 1: Organización multi-país

Tiene filiales en Francia, Reino Unido y Alemania, cada una siguiendo estándares contables locales.

**Configuración**:
  1. Cargue tres plantillas: **FR-PCG v1.0**, **GB-UKGAAP v1.0**, **DE-SKR03 v1.0** (o v2.0 para más granularidad)
  2. Establezca cada una como predeterminada para su país
  3. Asigne empresas a sus CoA respectivos
  4. Las nuevas empresas obtienen automáticamente el CoA correcto; la selección de cuentas se filtra en consecuencia
  5. Los mapeos de consolidación ya están en su lugar -- los informes de grupo funcionan inmediatamente

### Escenario 2: Migrar de legado a CoA

Tiene 50 cuentas y 5 empresas, todo configurado antes de que existieran los Planes de cuentas.

**Pasos de migración**:
  1. Cree un CoA (p. ej., `US-GAAP`)
  2. Exporte sus cuentas a CSV
  3. Añada una columna `coa_code` (p. ej., `US-GAAP`) a todas las filas
  4. Importe el CSV actualizado (las cuentas ahora pertenecen al CoA)
  5. Asigne el CoA a sus empresas
  6. Edite cualquier partida OPEX/CAPEX que muestre advertencias de "cuenta obsoleta"

### Escenario 3: Cambiar una empresa a un nuevo CoA

Su filial del Reino Unido cambia de UK GAAP a IFRS.

**Pasos**:
  1. Cree un nuevo CoA: `UK-IFRS` (o cargue desde plantilla)
  2. En la pestaña Visión general de la empresa, cambie Plan de cuentas a `UK-IFRS`
  3. En adelante, los usuarios solo pueden seleccionar cuentas de `UK-IFRS`
  4. Las partidas OPEX/CAPEX existentes conservan sus cuentas antiguas pero muestran advertencias
  5. Actualice las partidas según sea necesario (o deje los datos históricos como están si los informes lo permiten)

### Escenario 4: Configurar consolidación de grupo (multi-país)

Su grupo tiene filiales en Francia, Reino Unido y Alemania. Cada país usa su estándar contable local, pero necesita informes IFRS consolidados.

**Configuración**:
  1. Cargue plantillas de país con consolidación IFRS integrada:
      - **FR-PCG v1.0** -- Plan Comptable General francés (20 cuentas)
      - **GB-UKGAAP v1.0** -- UK GAAP (20 cuentas)
      - **DE-SKR03 v1.0** -- Standardkontenrahmen 03 (20 cuentas)

  2. Cada cuenta en estas plantillas ya se mapea a una de las 14 cuentas de consolidación IFRS. Por ejemplo:
      - FR-PCG `205000` (Logiciels informatiques) -> IFRS `1100` (Intangible Assets)
      - GB-UKGAAP `510` (Capitalized Software) -> IFRS `1100` (Intangible Assets)
      - DE-SKR03 `27` (EDV-Software) -> IFRS `1100` (Intangible Assets)

  3. Establezca cada CoA como predeterminado para su país y asigne empresas

**Resultado**:
  - Los usuarios franceses trabajan con cuentas PCG francés y nombres nativos en sus tareas diarias
  - Los usuarios del Reino Unido trabajan con cuentas UK GAAP
  - Los usuarios alemanes trabajan con cuentas SKR03 y nombres nativos en alemán
  - Finanzas de grupo ejecuta informes por cuenta de consolidación para ver el gasto total en categorías IFRS
  - No se necesita trabajo manual de mapeo -- las plantillas lo gestionan todo
  - Tanto los informes estatutarios locales como los informes IFRS de grupo funcionan sin problemas desde los mismos datos

## Preguntas frecuentes

**P: ¿Puedo tener cuentas que pertenezcan a múltiples CoA?**
R: No. Cada cuenta pertenece a exactamente un CoA (o a ninguno para cuentas legado). Si necesita la misma estructura de cuentas en múltiples CoA, cargue la plantilla en cada uno o use exportación/importación CSV con diferentes valores de `coa_code`.

**P: ¿Qué pasa si elimino un Plan de cuentas?**
R: La eliminación se bloquea si alguna empresa lo referencia o alguna partida OPEX/CAPEX usa sus cuentas. Reasigne empresas y actualice partidas primero, luego puede eliminar el CoA. Eliminar un CoA también elimina todas las cuentas dentro de él que no estén referenciadas en otra parte.

**P: ¿Puedo cambiar números de cuenta?**
R: Sí, en el espacio de trabajo de la cuenta. Cambiar el número de cuenta actualiza todas las referencias en partidas OPEX/CAPEX automáticamente (el UUID de la cuenta permanece igual internamente).

**P: ¿Cómo veo qué empresas usan un CoA específico?**
R: Abra **Gestionar** en la página de Planes de cuentas, seleccione el CoA y verifique **Empresas vinculadas** en el panel de detalles. También puede filtrar la página de Empresas por CoA.

**P: ¿Qué pasa si mi país no tiene plantilla?**
R: KANAP incluye plantillas para 9 países (FR, DE, GB, ES, IT, NL, BE, CH, US) más IFRS como estándar global. Si su país no está cubierto, cree un CoA desde cero y añada cuentas manualmente o vía importación CSV. Aún puede usar los números de cuenta de consolidación IFRS (1000-2900) en sus mapeos de consolidación para mantenerse compatible con las plantillas integradas.

**P: ¿Cuál es la diferencia entre las plantillas v1.0 y v2.0?**
R: **v1.0 (Simple)** tiene ~20 cuentas enfocadas en IT que cubren categorías esenciales de costes. **v2.0 (Detallado)** añade ~10 subcuentas más granulares para un seguimiento más fino (p. ej., separando suscripciones SaaS de licencias perpetuas, o salarios IT de bonificaciones). Ambas versiones usan los mismos mapeos de consolidación. Comience con v1.0 y cambie a v2.0 si necesita más detalle.

**P: ¿Puedo editar cuentas que vinieron de una plantilla?**
R: Sí. Una vez que carga una plantilla, las cuentas se copian en su CoA y son completamente editables. Los cambios en la plantilla de la plataforma no afectan a su CoA a menos que lo recargue explícitamente (lo que sobrescribe sus cambios si elige el modo "sobrescribir").

**P: ¿Son obligatorios los mapeos de cuentas de consolidación?**
R: No, son opcionales. Si solo opera en un país o no necesita consolidación a nivel de grupo, puede dejar estos campos vacíos. Las cuentas de consolidación solo son necesarias para organizaciones multi-país que informan a nivel de grupo usando un estándar diferente al de su contabilidad local.

**P: ¿Pueden varias cuentas locales mapearse a la misma cuenta de consolidación?**
R: Sí, ese es precisamente el objetivo. Muchas cuentas locales de diferentes CoA pueden mapearse a la misma cuenta de consolidación. Así es como se agregan costes de diferentes países en una sola categoría consolidada.

**P: ¿Qué pasa si cambio un mapeo de consolidación?**
R: Las partidas OPEX/CAPEX existentes no almacenan datos de consolidación directamente -- referencian la cuenta, que tiene el mapeo de consolidación. Cuando cambia un mapeo, todas las partidas históricas y futuras que usen esa cuenta se reportarán bajo la nueva cuenta de consolidación. Actualice los mapeos con cuidado si necesita preservar categorías de informes históricos.
