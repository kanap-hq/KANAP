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

- El chip seleccionado aparece relleno; los demás, con borde.
- Pase el cursor sobre un chip para ver el nombre del CoA, sus países, su número de cuentas y sus roles. Consulte [Roles de los planes](#roles-de-los-planes).

Si tiene el permiso `accounts:manager`, aparecen dos controles adicionales a la derecha:

- **Nuevo**: Abre el diálogo **Nuevo plan de cuentas**.
- **Gestionar planes**: Abre el cuadro [Gestionar planes](#el-cuadro-gestionar-planes).

Cuando no existe ningún CoA, la barra de chips le invita a crear su primer Plan de cuentas.

### Resumen del CoA

Debajo de la barra de chips, un resumen muestra el **código** y el **número de cuentas** del CoA seleccionado. Una segunda línea indica su **nombre**, sus **países** y sus **roles** con palabras, por ejemplo «Plan de cuentas francés · Francia · Plan predeterminado del país (Francia)».

### Línea de seguimiento de la consolidación

Cuando su espacio de trabajo tiene un [plan de consolidación](#el-plan-de-consolidacion), una tercera línea indica en qué medida el CoA seleccionado se asigna a él. No aparece en el propio plan de consolidación, porque sus cuentas son las cuentas del grupo.

En los ejemplos siguientes, `IFRS` representa el código de su plan de consolidación.

- **Todas las cuentas están asignadas al plan de consolidación IFRS.** Cada cuenta tiene una cuenta de consolidación que existe en el plan de consolidación.
- **N cuentas apuntan a una cuenta de consolidación que no existe en IFRS**: estas cuentas conservan un número que el plan de consolidación no contiene.
- **N cuentas no tienen cuenta de consolidación**: estas cuentas todavía no están asignadas.

Cada número es un enlace. Haga clic en él para filtrar la cuadrícula con esas cuentas. El filtro muestra cuentas de todos los estados, así que las cuentas desactivadas también se cuentan y se listan. Haga clic de nuevo en el número, o en **Mostrar todas las cuentas**, para volver a la lista normal. El filtro también se quita al elegir otro chip. Cuando abre una cuenta desde una lista filtrada, las flechas de cuenta anterior y siguiente del espacio de trabajo recorren la misma lista filtrada.

En la cuadrícula, un pequeño punto naranja junto a **N.º cuenta consol.** marca una cuenta cuyo número no está en el plan de consolidación. Pase el cursor sobre el punto para ver el nombre del plan de consolidación.

Sin plan de consolidación, la línea dice «No hay plan de consolidación.». Los gestores pueden hacer clic en **Elija uno en Gestionar planes** para abrir el cuadro.

### Cuadrícula de cuentas

La cuadrícula muestra cuentas solo del CoA seleccionado.

**Columnas predeterminadas**:
- **N.º de cuenta**: El número de la cuenta. Haga clic para abrir el espacio de trabajo de la cuenta.
- **Nombre**: El nombre de la cuenta. Haga clic para abrir el espacio de trabajo de la cuenta.
- **N.º cuenta consol.**: El número de la cuenta de consolidación.
- **Nombre consol.**: El nombre de la cuenta de consolidación.

**Columnas adicionales** (ocultas por defecto, habilite mediante el selector de columnas):
- **Nombre local**: El nombre de la cuenta en el idioma local.
- **Descripción**: Descripción de la cuenta.
- **Descripción consol.**: Descripción de la cuenta de consolidación.
- **Estado**: Si la cuenta está habilitada o deshabilitada.
- **Creado**: Marca de tiempo de la creación de la cuenta.

**Filtrado**:
- Búsqueda rápida: Busca en las columnas de texto visibles.
- Alcance de estado: el selector **Mostrar: Todos / Activos / Desactivados** sobre la cuadrícula. Por defecto **Activos**, mostrando solo cuentas activas. Elija **Todos** para incluir cuentas desactivadas.
- Filtros de columna: Use filtros en los encabezados de columna (p. ej., la columna **Estado** tiene un filtro de conjunto). Si hace clic en **Limpiar** en el filtro **Estado**, o desmarca ambos valores, la lista no muestra nada, sea cual sea la opción de **Mostrar**.

**Ordenación**: Predeterminada por **N.º de cuenta** ascendente.

**Acciones** (en el encabezado de la página):
- **Nueva cuenta** (`accounts:manager`): Abre un nuevo formulario de cuenta con el CoA seleccionado ya elegido.
- **Importar CSV** (`accounts:admin`): Importar cuentas al CoA seleccionado.
- **Exportar CSV** (`accounts:admin`): Exportar cuentas del CoA seleccionado.
- **Eliminar selección** (`accounts:admin`): Eliminar filas de cuentas seleccionadas. Seleccione filas usando la columna de casilla de verificación (visible para administradores).

Todas las celdas de fila son enlaces clicables al espacio de trabajo de la cuenta. Puede hacer clic derecho o Ctrl+clic para abrir en una nueva pestaña.

## El espacio de trabajo de la cuenta

Haga clic en cualquier fila de la cuadrícula de cuentas para abrir el espacio de trabajo de la cuenta.

### Disposición

- **Encabezado**: el número de cuenta es la referencia (puede copiarlo desde ahí) y el nombre de la cuenta es el título. Haga clic en el título para renombrar la cuenta. Las flechas **Cuenta anterior** y **Cuenta siguiente** recorren las cuentas de la lista de la que viene, en el mismo orden, con la misma búsqueda y los mismos filtros. El enlace de vuelta lleva a **Planes de cuentas** y conserva su selección.
- **Panel de propiedades** a la derecha: **Plan de cuentas**, **Número de cuenta** y **Ciclo de vida** (el interruptor de estado y la fecha de **Fin de validez**). El botón del panel permite contraerlo o volver a abrirlo. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida).
- **Columna principal**: **Nombre local (idioma local)**, **Descripción** y la sección **Consolidación**.

**Los cambios se guardan automáticamente.** Cada campo se guarda al salir de él y no hay botón Guardar. Si se rechaza un valor, aparece un mensaje bajo el campo. El **Número de cuenta** debe ser un número entero mayor que cero.

Necesita `accounts:manager` para editar. Los usuarios de solo lectura ven la misma página con los campos bloqueados.

### Cuenta de consolidación

La sección **Consolidación** contiene un único campo, **Cuenta de consolidación**. Es una lista de las cuentas de su [plan de consolidación](#el-plan-de-consolidacion), mostradas con su número y su nombre. Elija una para asignarle la cuenta, o elija **Ninguna** para quitar la asignación.

- Usted elige el número. El nombre y la descripción de la cuenta de consolidación provienen del plan de consolidación y aparecen bajo el campo. No puede escribirlos.
- Las cuentas desactivadas del plan de consolidación solo se ofrecen cuando la cuenta ya está asignada a una de ellas. Llevan la etiqueta **Desactivada**.
- Si el número guardado no existe en el plan de consolidación, sigue visible con un punto naranja y el mensaje «Este número no existe en el plan de consolidación IFRS. Elija una cuenta de IFRS.» Elija una cuenta válida para corregirlo.
- Sin plan de consolidación, el campo está bloqueado y muestra «No hay ningún plan de consolidación definido.», seguido del enlace **Elija uno en Planes de cuentas → Gestionar planes.**

### Crear una cuenta

**Nueva cuenta** en la lista abre un formulario breve con el plan que estaba consultando ya seleccionado. Rellene el plan, el número de cuenta y el nombre, además de los campos opcionales, y haga clic en **Crear cuenta**. Tras la creación, la cuenta se abre en el espacio de trabajo y se guarda automáticamente a partir de entonces.

## Configurar Planes de cuentas

### Crear un CoA

Haga clic en **Nuevo** en la barra de chips, o en **Nuevo plan** en el cuadro Gestionar planes. Puede crear un CoA de dos maneras:

1. **Un plan vacío**: añada las cuentas más tarde, una a una o con una importación CSV.
2. **Una plantilla**: cargue un conjunto de cuentas preconfigurado, mantenido por los administradores de la plataforma.

**Campos del diálogo de creación**:
- **Partir de**: **Un plan vacío** o **Una plantilla**.
- **Plantilla** (solo en modo plantilla): Elija una plantilla de la lista. Cada entrada muestra su nombre, sus países y su versión. Al elegir una plantilla se rellenan el nombre y el código, que puede cambiar.
- **Código** (obligatorio): Un identificador corto y estable, usado en archivos CSV y enlaces.
- **Nombre** (obligatorio): Un nombre descriptivo para el CoA.
- **Se usa para**: **Un país** o **Todos los países**. Una plantilla global siempre crea un plan para **Todos los países**.
- **País** (solo para un país): Elija un país de la lista.
- **Hacerlo plan predeterminado del país** (solo para un país): Marque la casilla para hacer de este CoA el plan predeterminado del país elegido.

En modo plantilla, haga clic en **Verificar plantilla** antes de crear para ver cuántas cuentas se añadirán y cuántas se actualizarán. Después haga clic en **Crear**.

Un plan nuevo no tiene ningún rol, salvo el predeterminado de país que marque aquí. Para darle otro rol, use [Gestionar planes](#el-cuadro-gestionar-planes).

### Cargar desde plantillas

Las plantillas son conjuntos de cuentas estándar gestionados por los administradores de la plataforma. Pueden ser:
  - Específicas de país (p. ej., PCG francés, UK GAAP)
  - Globales (disponibles para todos los países)

**Cómo funciona**:
  - Vaya a **Datos maestros > Planes de cuentas**
  - Haga clic en **Nuevo** en la barra de chips
  - En **Partir de**, elija **Una plantilla**
  - Seleccione una plantilla. Las plantillas globales muestran «Todos los países» y crean un plan para todos los países; las plantillas de país muestran su país
  - Haga clic en **Verificar plantilla** para ver cuántas cuentas se añadirán y cuántas se actualizarán
  - Haga clic en **Crear** para copiar las cuentas en su CoA

**Qué se copia**: Números de cuenta, nombres, nombres locales (idioma local), descripciones, mapeos de consolidación y estado. Las cuentas pasan a ser suyas para editar -- los cambios en la plantilla de la plataforma no afectan a su CoA a menos que la recargue explícitamente. Si su espacio de trabajo tiene un plan de consolidación, el nombre y la descripción de consolidación de cada cuenta se toman de ese plan (consulte [El plan de consolidación](#el-plan-de-consolidacion)).

**Consejo**: Después de cargar una plantilla, puede añadir cuentas específicas de la empresa, renombrar entradas o deshabilitar cuentas no utilizadas. Las plantillas proporcionan un punto de partida, no una estructura bloqueada.

### Plantillas disponibles

KANAP incluye **20 plantillas preconfiguradas** que cubren 10 estándares contables. Cada estándar viene en dos versiones:

- **v1.0 (Simple)**: Un conjunto enfocado de ~20 cuentas relevantes para IT -- licencias de software, alojamiento en la nube, ciberseguridad, telecomunicaciones, consultoría, costes de personal, formación y más. Ideal para organizaciones que quieren un punto de partida ligero.
- **v2.0 (Detallado)**: Todo lo de v1.0 más subcuentas granulares adicionales (~30 cuentas). Añade desgloses como Software comprado vs. Desarrollado internamente, Equipos de red, SaaS vs. Licencias perpetuas, Comunicaciones móviles, Bonificaciones IT, Seguro IT y más. Ideal para organizaciones que necesitan un seguimiento de costes más fino.

Ambas versiones usan **números de cuenta reales del estándar contable oficial de cada país** e incluyen nombres locales en el idioma local.

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

**Ejemplo**: Su filial francesa carga **FR-PCG v1.0** y su filial alemana carga **DE-SKR03 v1.0**. Ambas usan diferentes números de cuenta locales y nombres locales, pero cada cuenta se mapea a la misma estructura de consolidación IFRS. Los informes a nivel de grupo se agregan sin ningún trabajo manual de mapeo.

### Nuevos espacios de trabajo (aprovisionamiento)

Los nuevos espacios de trabajo se aprovisionan automáticamente con la plantilla **IFRS v1.0**. Esto crea un CoA para todos los países con las 14 cuentas de consolidación IFRS. Es a la vez el **Predeterminado para otros países** y el **Plan de consolidación**, de modo que las empresas y los informes de grupo funcionan de inmediato, sin configuración. Puede editar o eliminar las cuentas y el plan precargados más adelante (sujeto a las protecciones habituales).

## Roles de los planes

Un plan puede tener hasta tres roles. Son independientes y cada uno se muestra con palabras en la descripción emergente del chip, en el resumen y en **Gestionar planes**.

| Rol | Qué hace | Cuántos |
|-----|----------|---------|
| **Plan predeterminado del país ({country})** | Se propone al crear una empresa en ese país | Uno por país. Para planes de un solo país |
| **Predeterminado para otros países** | Se usa para las empresas de un país sin plan predeterminado. También se asigna a las empresas sin plan de cuentas | Uno por espacio de trabajo. Para planes de todos los países |
| **Plan de consolidación** | Las cuentas del grupo a las que se asigna cada cuenta local para el reporting consolidado | Uno por espacio de trabajo. Cualquier plan |

El punto de partida habitual es un plan IFRS que tiene a la vez **Predeterminado para otros países** y **Plan de consolidación**, más un plan local por país con **Plan predeterminado del país ({country})**. Puede separar los roles, por ejemplo un plan de grupo que es el plan de consolidación mientras otro plan para todos los países atiende al resto de países. Un plan también puede no tener ningún rol.

Cada rol tiene un único titular (uno por país en el caso del predeterminado de país). Dar un rol a otro plan se lo quita al titular anterior.

## Gestionar Planes de cuentas

### El cuadro Gestionar planes

Haga clic en **Gestionar planes** en la barra de chips para abrir el cuadro. Una tabla lista todos los planes:

- **Código** y **Nombre**
- **Países**: el país del plan, o «Todos los países»
- **Roles**: los roles del plan con palabras, o un guion si no tiene ninguno
- **Empresas**: el número de empresas asignadas al plan
- **Cuentas**: el número de cuentas del plan

Tres líneas breves bajo la tabla explican los roles. **Nuevo plan** (`accounts:manager`), abajo a la izquierda, abre el diálogo de creación.

Cada fila tiene un menú **⋯** que solo ofrece las acciones aplicables a ese plan. La etiqueta sigue el estado actual.

- **Hacer plan predeterminado del país** / **Dejar de ser plan predeterminado del país** (`accounts:manager`): para planes de un solo país.
- **Hacer predeterminado para otros países** / **Dejar de ser predeterminado para otros países** (`accounts:manager`): para planes de todos los países. Al hacerlo predeterminado, también se asigna a las empresas que no tienen plan de cuentas.
- **Hacer plan de consolidación** / **Dejar de ser plan de consolidación** (`accounts:manager`): para cualquier plan. Consulte [Cambiar el plan de consolidación](#cambiar-el-plan-de-consolidacion).
- **Eliminar** (`accounts:admin`): Elimina el plan junto con sus cuentas. Si el plan tiene cuentas, una confirmación indica cuántas se eliminan. Si es el plan de consolidación, la confirmación advierte de que el reporting de grupo ya no tendrá un plan de referencia. La eliminación se rechaza mientras haya empresas que usen el plan o partidas OPEX/CAPEX que usen sus cuentas, y el cuadro muestra el motivo.

Los roles cambian en cuanto elige una acción. La tabla se actualiza al instante.

## Gestionar cuentas

### Números de cuenta

Un número de cuenta es un número entero mayor que cero (por ejemplo, `6011`). Dentro de un CoA, cada número se usa una sola vez.

### Nombres locales para soporte multilingüe

Algunos países requieren que las cuentas se registren en el idioma local. Utilice el campo **Nombre local (idioma local)** para almacenar el nombre original mientras mantiene el nombre en inglés en el campo principal **Nombre de la cuenta**.

**Ejemplo**: Cuenta francesa
  - **Nombre de la cuenta**: `Travel expenses` (inglés, para informes)
  - **Nombre local (idioma local)**: `Frais de deplacement` (francés, para conformidad legal)

El nombre local está disponible como columna oculta en la cuadrícula de cuentas. Habilítelo desde el selector de columnas para ver ambos nombres lado a lado.

## Cuentas de consolidación (Informes a nivel de grupo)

En organizaciones multi-país, el trabajo diario se realiza con Planes de cuentas locales (PCG francés, UK GAAP, HGB alemán, etc.), pero el reporting de grupo a menudo requiere consolidar en un estándar común como **IFRS** o **US GAAP**.

Las **cuentas de consolidación** lo resuelven asignando las cuentas locales a las cuentas de un plan de referencia.

### El plan de consolidación

Su espacio de trabajo tiene como máximo un **Plan de consolidación**. Contiene las cuentas del grupo a las que se asigna cada cuenta local. Es independiente de los planes predeterminados: cualquier plan puede ser el plan de consolidación, incluido uno que también sea el predeterminado para otros países.

En cada cuenta local, usted elige una **Cuenta de consolidación** entre las cuentas del plan de consolidación. El número es el vínculo. El nombre y la descripción de la cuenta de consolidación provienen automáticamente del plan de consolidación, así que siempre coinciden con sus cuentas.

**Ejemplo de asignación**:

| País | CoA local | Cuenta local | Nombre local | -> | Cuenta de consolidación | Nombre de consolidación |
|------|-----------|--------------|--------------|----|-------------------------|-------------------------|
| Francia | FR-PCG | 6061 | Frais postaux | -> | 6200 | IT Services and Software |
| Reino Unido | UK-GAAP | 5200 | Postage and courier | -> | 6200 | IT Services and Software |
| Alemania | DE-HGB | 4920 | Portokosten | -> | 6200 | IT Services and Software |

Las tres cuentas locales se asignan a la misma cuenta de consolidación `6200`, lo que permite la agregación a nivel de grupo.

**Qué se mantiene sincronizado**:

  - Cuando renombra una cuenta del plan de consolidación, cambia su descripción o le da un número nuevo, todas las cuentas asignadas a ella la siguen. Su número, su nombre y su descripción se actualizan en todas partes, en un solo paso.
  - Cuando asigna una cuenta a un número que existe en el plan de consolidación, el nombre y la descripción de consolidación se rellenan por usted.

### Por qué es importante

**Operaciones diarias**: Los usuarios trabajan con sus cuentas locales familiares
  - Los usuarios franceses seleccionan la cuenta `6061 - Frais postaux`
  - Los usuarios británicos seleccionan la cuenta `5200 - Postage and courier`
  - Los usuarios alemanes seleccionan la cuenta `4920 - Portokosten`

**Reporting de grupo**: El sistema puede agrupar costes por cuenta de consolidación
  - Todos los costes de servicios de TI de todos los países se agregan en `6200 - IT Services and Software`
  - La dirección ve una vista unificada independientemente de las diferencias contables locales
  - El reporting estatutario por país sigue usando las cuentas locales

### Configurar mapeos de consolidación

**Opción 1: Plantillas (recomendado)**
Todas las plantillas integradas incluyen mapeos de consolidación IFRS en cada cuenta. Cargue cualquier plantilla de país y las columnas de consolidación ya están rellenadas. Un nuevo espacio de trabajo ya tiene el plan IFRS como plan de consolidación. Consulte [Plantillas disponibles](#plantillas-disponibles) para la lista completa.

**Opción 2: Importación CSV**
Al importar cuentas, incluya los campos de consolidación en su CSV:

```
coa_code;account_number;account_name;consolidation_account_number;consolidation_account_name;consolidation_account_description
FR-PCG;6061;Frais postaux;6200;IT Services and Software;
UK-GAAP;5200;Postage and courier;6200;IT Services and Software;
DE-HGB;4920;Portokosten;6200;IT Services and Software;
```

Solo importa el número de cuenta de consolidación cuando el plan de consolidación lo contiene: la importación sustituye las columnas de nombre y descripción por las del plan de consolidación. Cuando el número no está en el plan de consolidación, se conservan el nombre y la descripción del archivo, y la cuenta se marca como fuera del plan de consolidación. Un número vacío borra la asignación, el nombre y la descripción.

**Opción 3: Entrada manual**
Abra una cuenta y elija su **Cuenta de consolidación** en el espacio de trabajo de la cuenta.

### Cambiar el plan de consolidación

1. Abra **Gestionar planes** y el menú **⋯** del plan que quiere usar.
2. Haga clic en **Hacer plan de consolidación**.
3. Si el plan sustituye a otro plan de consolidación, o si algunas cuentas apuntan a números que no contiene, se abre una confirmación. Indica qué plan sustituye y da los recuentos: cuántas cuentas conservan su cuenta de consolidación, cuántas apuntan a un número que no existe en el plan nuevo y cuántas no tienen cuenta de consolidación.
4. Haga clic en **Hacer plan de consolidación** para confirmar.

**Qué ocurre con las asignaciones existentes**: KANAP nunca reasigna las cuentas por usted. Cada cuenta conserva su número de consolidación.

  - Las cuentas cuyo número existe en el plan nuevo lo conservan y toman el nombre y la descripción de ese plan.
  - Las cuentas cuyo número no existe en el plan nuevo conservan su número y quedan marcadas: la línea de seguimiento las cuenta, un punto las señala en la cuadrícula y el espacio de trabajo de la cuenta le pide elegir una cuenta válida. Fíltrelas desde la línea de seguimiento y reasígnelas una a una, o cargue un CSV.
  - Las cuentas sin número siguen sin asignar.

Si elige **Dejar de ser plan de consolidación**, el reporting de grupo ya no tiene un plan de referencia. Las asignaciones de las cuentas se conservan.

### Mejores prácticas

  - **Use un estándar común**: IFRS es típico para grupos europeos; US GAAP para empresas americanas. Todas las plantillas integradas ya se mapean a las mismas 14 cuentas de consolidación IFRS (consulte [Consolidación IFRS integrada](#consolidacion-ifrs-integrada))
  - **Mantenga un único plan de consolidación**: Es la lista de cuentas de reporting de su grupo. Si usa las plantillas integradas, las 14 cuentas IFRS sirven como referencia
  - **Asigne con la granularidad adecuada**: No consolide demasiado en general (se pierde detalle) ni demasiado fino (demasiado complejo)
  - **Involucre a finanzas**: Los mapeos de consolidación deben alinearse con los requisitos de reporting financiero de su grupo
  - **Actualice sistemáticamente**: Cuando añada cuentas locales, asígnelas de inmediato a cuentas de consolidación. La línea de seguimiento muestra lo que aún falta

### Informes con cuentas de consolidación

Al crear informes, puede agrupar por:
  - **Cuentas locales**: Muestra el detalle por país (para la gestión local)
  - **Cuentas de consolidación**: Muestra categorías a nivel de grupo (para informes ejecutivos)

Esta doble vista le permite satisfacer tanto los requisitos de conformidad local como las necesidades de reporting de grupo, sin mantener datos duplicados.

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

El CSV global `/accounts` incluye una columna `coa_code` para identificar a qué CoA pertenece cada cuenta. **Exportar CSV** e **Importar CSV** la usan cuando no hay ningún CoA seleccionado en la página.

  - **Exportar CSV**: todas las cuentas con sus códigos de CoA, números de cuenta, nombres, nombres locales, descripciones, mapeos de consolidación y estado
  - **Importar CSV**: **Descargar plantilla** en el diálogo da un archivo solo con los encabezados. Empiece por la **Verificación previa** para validar la estructura, la codificación, los campos obligatorios y los duplicados, y después **Cargar** para aplicar las inserciones y las actualizaciones
  - **Coincidencia**: por `(coa_code, account_number)` dentro de su espacio de trabajo
  - **Celdas obligatorias**: `coa_code`, `account_number`, `account_name`. Todas las filas de un archivo deben llevar el mismo `coa_code`
  - **Celdas opcionales**: `native_name`, `description`, campos de consolidación, `status`
  - Los duplicados en el archivo (mismo coa_code + account_number) se deduplican; gana la primera ocurrencia

**Esquema CSV** (la exportación escribe el separador del idioma de la pantalla; aquí se muestra con puntos y coma):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

### Cuentas (con alcance de CoA)

Desde la página de Planes de cuentas, **Importar CSV** y **Exportar CSV** se limitan automáticamente al CoA seleccionado actualmente.

  - **Exportar CSV**: cuentas de este CoA (no se necesita columna `coa_code`)
  - **Importar CSV**: las cuentas se insertan o se actualizan en este CoA automáticamente

**Esquema CSV** (con alcance de CoA; aquí se muestra con puntos y coma):
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

**Notas**:
  - Consulte [Archivos CSV](csv-files.md) para la codificación, el separador, los formatos de fecha y los dos pasos de importación
  - El `coa_code` debe coincidir con un Plan de cuentas existente en su espacio de trabajo
  - Los números de cuenta deben ser únicos dentro de un CoA
  - Valores de estado: `enabled` o `disabled` (predeterminado: enabled)
  - Columnas de consolidación: cuando `consolidation_account_number` existe en su plan de consolidación, su nombre y su descripción sustituyen las celdas `consolidation_account_name` y `consolidation_account_description`. Un número vacío borra las tres. Consulte [Configurar mapeos de consolidación](#configurar-mapeos-de-consolidacion)

## Consejos

  - **Comience con plantillas**: KANAP incluye plantillas para 9 países más IFRS. Cargue una en lugar de construir desde cero -- obtiene números de cuenta adecuados, nombres locales y mapeos de consolidación IFRS desde el principio. Comience con v1.0 (Simple) si no está seguro; actualice a v2.0 (Detallado) si necesita más granularidad.
  - **Un predeterminado por país**: Haga de un CoA el plan predeterminado de cada país, para que las nuevas empresas empiecen con la estructura de cuentas correcta.
  - **Nombres locales para conformidad**: Utilice el campo **Nombre local (idioma local)** si la normativa local requiere cuentas en el idioma local. Habilite la columna **Nombre local** en la cuadrícula para ver ambos nombres de un vistazo.
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
  2. Haga de cada una el plan predeterminado de su país (**Gestionar planes**, luego **Hacer plan predeterminado del país**)
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

  3. Haga de cada CoA el plan predeterminado de su país y asigne empresas

**Resultado**:
  - Los usuarios franceses trabajan con cuentas PCG francés y nombres locales en sus tareas diarias
  - Los usuarios del Reino Unido trabajan con cuentas UK GAAP
  - Los usuarios alemanes trabajan con cuentas SKR03 y nombres locales en alemán
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
R: Abra **Gestionar planes** en la página de Planes de cuentas y consulte la columna **Empresas** de la fila del CoA. También puede filtrar la página de Empresas por CoA.

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

**P: ¿Tiene que ser el plan de consolidación el predeterminado para otros países?**
R: No. Los dos roles son independientes. En la configuración habitual, un mismo plan IFRS tiene ambos, y puede dárselos a planes distintos en cualquier momento en **Gestionar planes**.

**P: ¿Qué pasa con las cuentas cuando renombro o renumero una cuenta del plan de consolidación?**
R: Todas las cuentas asignadas a ella la siguen. Su número, su nombre y su descripción de consolidación se actualizan juntos, así que las asignaciones siguen siendo válidas.

**P: ¿Por qué muestra la cuadrícula un punto junto a algunos números de consolidación?**
R: El punto marca una cuenta cuyo número de consolidación no existe en el plan de consolidación, normalmente tras cambiar el plan de consolidación. Abra la cuenta y elija una cuenta de consolidación válida, o use la línea de seguimiento para listarlas todas.
