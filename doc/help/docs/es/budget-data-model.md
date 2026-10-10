# Modelo de datos del presupuesto

Esta página describe cómo KANAP organiza los datos del presupuesto: los objetos, sus relaciones, los campos que identifican un registro y los archivos con los que cada objeto entra y sale. Está pensada para los controllers financieros y los administradores del presupuesto que preparan un paso desde hojas de cálculo u otra herramienta, y para el equipo técnico que conecta una herramienta de BI a una instalación on-premise.

Los archivos descritos aquí son el contrato en el que apoyarse. Sus columnas están documentadas en este manual y se comprueban al importar, y cuando cambia una estructura, la importación rechaza un archivo con la estructura antigua e indica el motivo. Las tablas de la base de datos que hay detrás son internas: cambian cuando KANAP evoluciona. Apoye el paso desde otra herramienta, y cualquier integración, en los archivos.

## Los objetos de un vistazo

| Objeto | Qué contiene | Dónde gestionarlo |
|---|---|---|
| **Partida OPEX** | Un coste recurrente, que se mantiene de un año a otro | **Gestión presupuestaria > OPEX** |
| **Partida CAPEX** | Una inversión, que se mantiene de un año a otro | **Gestión presupuestaria > CAPEX** |
| **Columnas presupuestarias** | Las cinco columnas de importes que cada partida tiene para cada año | **Gestión presupuestaria > Administración > Columnas presupuestarias** |
| **Líneas de Cantidad y precio** | Las líneas a partir de las que se puede calcular una columna | La pestaña **Presupuesto** de una partida |
| **Asignación** | Cómo se reparte el coste de un año de una partida entre empresas o departamentos | La pestaña **Asignaciones** de una partida |
| **Empresa** | Una entidad jurídica que paga, con sus indicadores anuales | **Datos maestros > Empresas** |
| **Departamento** | Una unidad de una empresa, con su plantilla anual | **Datos maestros > Departamentos** |
| **Plan de cuentas** y **cuenta** | Las cuentas en las que una empresa registra sus partidas | **Datos maestros > Planes de cuentas** |
| **Centro de coste** | Quién responde del gasto, en un árbol de grupos | **Datos maestros > Centros de coste** |
| **Proveedor** | A quién se paga | **Datos maestros > Proveedores** |
| **Dimensión analítica** y **valor** | Clasificaciones libres para los informes | **Datos maestros > Dimensiones analíticas** |
| **Calendario laboral** | Días laborables por mes y por año, para los precios por día | **Datos maestros > Calendarios laborales** |
| **Usuario** | Responsables de IT y de negocio, responsables del presupuesto | **Administración > Usuarios** |
| **Monedas** | Monedas permitidas, moneda de informes, tipos de cambio | **Gestión presupuestaria > Administración > Monedas** |

## Cómo se relacionan los objetos

| Objeto | Hace referencia a | Cuántos |
|---|---|---|
| Partida OPEX o CAPEX | Empresa pagadora | Una |
| | Cuenta, del plan de cuentas de la empresa pagadora | Una |
| | Moneda, entre las monedas permitidas | Una |
| | Centro de coste | Ninguno o uno. No se puede usar un grupo |
| | Proveedor | Ninguno o uno |
| | Valor de cada dimensión analítica activa | Ninguno o uno por dimensión. Uno en una línea nueva para una dimensión obligatoria |
| | Responsable de IT y responsable de negocio (usuarios) | Ninguno o uno cada uno |
| | Años presupuestarios | Uno por año |
| Año presupuestario de una partida | Columnas presupuestarias | Cinco, cada una con doce importes mensuales |
| | Líneas de Cantidad y precio | Hasta 50 por columna |
| | Asignación | Un método, con sus empresas o departamentos |
| Línea de Cantidad y precio con precio por día | Calendario laboral | Uno |
| Centro de coste | Empresa | Una |
| | Responsable del presupuesto (usuario) | Ninguno o uno |
| | Grupo padre | Ninguno o uno |
| Grupo de centros de coste | Grupo padre | Ninguno o uno. Un grupo no tiene empresa |
| Empresa | Plan de cuentas | Uno. Una empresa sin plan propio usa el plan predeterminado para otros países |
| | País y moneda base | Uno de cada |
| | Indicadores: plantilla, usuarios IT, facturación | Un conjunto por año |
| Departamento | Empresa | Una |
| Cuenta | Plan de cuentas | Uno |
| Valor analítico | Dimensión analítica | Una |

Una partida también se vincula a proyectos, solicitudes, aplicaciones, activos, contratos, contactos, tareas, sitios web y archivos adjuntos. Consulte [Vínculos con otros objetos](#vinculos-con-otros-objetos).

## Las partidas presupuestarias

### Partidas OPEX y CAPEX

Una partida vive varios años: una licencia de tres años es una partida con tres años presupuestarios. KANAP da un número a cada partida al crearla: `OPX-12` para OPEX, `CPX-3` para CAPEX. El número identifica la partida en el archivo de presupuesto.

| Campo | Columna del archivo de presupuesto | Obligatorio | Notas |
|---|---|---|---|
| Número | `item_number` | Lo asigna KANAP | Vacío en el archivo: crea una partida |
| Nombre del producto (OPEX), título (CAPEX) | `name` | Sí | |
| Descripción (OPEX) | `description` | No | |
| Tipo de activo fijo (CAPEX) | `ppe_type` | Sí | `hardware` o `software` |
| Tipo de inversión (CAPEX) | `investment_type` | Sí | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` u `other` |
| Prioridad (CAPEX) | `priority` | Sí | `mandatory`, `high`, `medium` o `low` |
| Empresa pagadora | `company_name` | Sí | Se toma del centro de coste cuando solo se indica el centro de coste |
| Proveedor | `supplier_name`, `supplier_erp_id` | No | |
| Cuenta | `account_number` | Sí | En el plan de cuentas de la empresa pagadora |
| Centro de coste | `cost_center_code` | No | Se rechaza un grupo |
| Run o build | `run_build` | No | `run` o `build` |
| Valores analíticos | `analytics:<code>` | Para una dimensión obligatoria | Una columna por dimensión activa usada para el tipo del archivo. Una dimensión obligatoria necesita un valor en una línea nueva |
| Responsable de IT, responsable de negocio | `owner_it_email`, `owner_business_email` | No | Usuarios activos |
| Proyecto | `project` | No | Un número de proyecto, por ejemplo `PRJ-3` |
| Moneda | `currency` | Sí | Código ISO de tres letras |
| Inicio de vigencia | `effective_start` | Sí | En un archivo, el 1 de enero del primer año con un importe en la fila, si no del año en curso |
| Fin de validez | `end_of_validity` | No | La única fecha de fin de una partida |
| Notas | `notes` | No | |

Una partida no tiene un estado propio que cargar. Está activa hasta su fin de validez y se desactiva en el plazo de una hora. El responsable del presupuesto que se muestra en una partida viene de su centro de coste y no se guarda en la partida.

### Años presupuestarios

Cada partida tiene un presupuesto por año. La pestaña **Presupuesto** muestra el año en curso, los dos años anteriores y los dos siguientes. Un archivo de presupuesto puede exportar hasta doce años a la vez.

Un año presupuestario contiene las cinco columnas presupuestarias con sus importes mensuales, las líneas de Cantidad y precio de cada columna y la asignación del año.

### Columnas presupuestarias

Cada partida tiene las mismas cinco columnas para cada año. Se definen una vez para toda la organización, tanto para OPEX como para CAPEX.

| Posición | Nombre estándar | Nombre en los archivos |
|---|---|---|
| 1 | Presupuesto | `budget` |
| 2 | Revisión | `revision` |
| 3 | Previsión (oculta por defecto) | `forecast` |
| 4 | Realizado | `actual` |
| 5 | Aterrizaje previsto | `landing` |

- Un administrador del presupuesto puede renombrar una columna (hasta 40 caracteres), ocultarla y elegir la columna por defecto. El nombre en los archivos no cambia, así que un archivo sigue funcionando después de un cambio de nombre. Consulte [Columnas presupuestarias](budget-operations.md#columnas-presupuestarias).
- Una columna oculta conserva sus importes y sigue aceptando importaciones.
- Las columnas se congelan por año, por columna y por ámbito (OPEX o CAPEX). Una columna congelada rechaza las modificaciones, las importaciones, las copias y los restablecimientos. Consulte [Congelar / Descongelar datos](budget-operations.md#congelar-descongelar-datos).

No hay una sexta columna. Para conservar varias rondas presupuestarias, use una columna por ronda, o copie una columna a otro año u otra columna con [Copiar columnas presupuestarias](budget-operations.md#copiar-columnas-presupuestarias).

### Importes mensuales

Cada columna de un año presupuestario contiene doce importes mensuales, con dos decimales, en la moneda de la partida. El total anual es la suma de los meses. Un archivo puede llevar el total anual o los doce meses de una columna: un total anual se reparte sobre el periodo de la columna, como en la pestaña **Presupuesto**.

Cada columna registra también su periodo dentro del año y el origen de sus importes: un reparto, una copia, una entrada a mano o sus líneas de Cantidad y precio. Los informes convierten los importes a la moneda de informes con los tipos de cambio del año. Consulte [Configuración de monedas](currencies.md).

### Líneas de Cantidad y precio

Una columna se puede calcular a partir de líneas, cada una una cantidad por un precio unitario. Cada línea tiene una descripción (hasta 200 caracteres), una cantidad (hasta 3 decimales), una unidad (**personas**, **días** o **piezas**), un precio unitario (hasta 4 decimales), una frecuencia, un periodo o una fecha, y un calendario laboral cuando el precio es por día. El ETC de la columna se deduce de las líneas. Consulte [Cantidad y precio](opex.md#cantidad-y-precio).

Estas líneas se introducen en la pestaña **Presupuesto**. Ningún archivo las contiene. Un archivo de presupuesto escribe los importes mensuales de una columna, y las líneas se quedan con ella como referencia.

### Asignaciones

Cada año presupuestario de una partida tiene un método de asignación:

| Método | Reparto según |
|---|---|
| Por defecto | El método por defecto de la organización para el año, definido en [Método de asignación por defecto](budget-operations.md#metodo-de-asignacion-por-defecto) |
| Plantilla, Usuarios IT, Facturación | Los indicadores de las empresas para el año |
| Manual por empresa | Un indicador, entre las empresas que usted elige |
| Manual por departamento | La plantilla de los departamentos que usted elige |
| Porcentajes manuales | Los porcentajes que usted escribe, que suman 100 % |

Las asignaciones alimentan los informes de contracargo. Ningún archivo las importa. [Copiar asignaciones](budget-operations.md#copiar-asignaciones) las traslada de un año al siguiente, y los informes de contracargo exportan sus tablas en CSV. Consulte [Informes](reports.md).

### Vínculos con otros objetos

| Vínculo | Dónde se crea | En un archivo |
|---|---|---|
| Proyectos | La pestaña **Relaciones** de la partida o del proyecto | El archivo de presupuesto lleva un proyecto por partida en `project`. Los vínculos de la pestaña **Relaciones** no están en el archivo. Las listas muestran ambos |
| Solicitudes | La pestaña **Relaciones** de la solicitud | No |
| Aplicaciones | La pestaña **Relaciones** de la partida o de la aplicación | No |
| Activos | La pestaña **Relaciones** del activo | No |
| Contratos | La pestaña **Relaciones** de la partida o del contrato | No |
| Contactos, sitios web, archivos adjuntos | La pestaña **Relaciones** de la partida | No |
| Tareas | La pestaña **Vista general** de la partida | No |

## Datos maestros

El archivo de presupuesto encuentra los datos maestros por identificadores de negocio. Cargue primero los datos maestros. El archivo de presupuesto crea los proveedores que faltan cuando **Crear los proveedores que faltan** está marcada, y los valores analíticos que faltan. No crea nada más.

| Objeto | Identificado en los archivos por | Obligatorio | En una partida presupuestaria |
|---|---|---|---|
| Empresa | `name` | Nombre, país, moneda base. La pantalla pide además una ciudad | `company_name` |
| Departamento | `company_name` y `name` | Empresa, nombre | Lo usan las asignaciones |
| Plan de cuentas | Su código (`coa_code` en el archivo de cuentas) | Código, nombre, ámbito | A través de la empresa pagadora |
| Cuenta | `account_number` dentro de su plan (`coa_code` en el archivo global) | Número, nombre | `account_number` |
| Centro de coste | `code`, sin distinguir mayúsculas y minúsculas | Código, nombre, tipo, y la empresa de un centro de coste | `cost_center_code` |
| Proveedor | `name` | Nombre | `supplier_erp_id`, luego `supplier_name` |
| Dimensión analítica | Su código | Código | La cabecera de columna `analytics:<code>` |
| Valor analítico | `axis_code` y `name` | Nombre | La celda de la columna de su dimensión |
| Calendario laboral | `code`, sin distinguir mayúsculas y minúsculas | Código, nombre | Lo usan las líneas de Cantidad y precio |
| Usuario | `email` | Correo | `owner_it_email`, `owner_business_email` |

Lo que importa cuando hace corresponder otra herramienta con KANAP:

- **Las empresas** llevan su plantilla, sus usuarios IT y su facturación por año. La facturación se expresa en millones de la moneda base de la empresa. Las asignaciones por plantilla, usuarios IT o facturación necesitan los indicadores del año.
- **Las cuentas** pertenecen a un plan de cuentas, y una empresa usa un plan. Un número de cuenta es un número entero, único dentro de su plan. La cuenta de una partida presupuestaria debe existir en el plan de su empresa pagadora, y cada cuenta indica si sirve para líneas OPEX, líneas CAPEX o ambas. Consulte [Planes de cuentas y gestión de cuentas](chart-of-accounts.md).
- **Los centros de coste** forman un árbol. Un grupo reúne centros de coste y otros grupos, y puede abarcar varias empresas. Un centro de coste pertenece a una empresa, no tiene hijos y es el único nodo que puede usar una partida. Su responsable del presupuesto aparece en cada partida que lleva. Consulte [Centros de coste](cost-centers.md).
- **Los proveedores** se hacen coincidir por nombre en su propio archivo. El archivo de presupuesto los busca primero por el ID de ERP y luego por el nombre: rellene el ID de ERP cuando su ERP tenga uno.
- **Las dimensiones analíticas** se crean en su página, cada una con un código. Una partida tiene como máximo un valor por dimensión. Consulte [Dimensiones analíticas](analytics.md).
- **Los calendarios laborales** son estándar (siguen los festivos de un país) o personalizados. Contienen los días laborables de cada mes, año por año. Consulte [Calendarios laborales](working-day-calendars.md).
- **Las monedas** son códigos ISO de tres letras. Las monedas permitidas, la moneda de informes y los tipos de cambio se configuran en pantalla y no tienen archivo.

## Formatos de intercambio

Cada archivo de la tabla se exporta y se importa desde la página que gestiona el objeto. Las importaciones se hacen en dos pasos: una comprobación que no escribe nada y después una carga. Salvo el archivo de contratos, comparten las reglas de codificación, separador, fechas e importes y el límite de tamaño descritos en [Archivos CSV](csv-files.md).

| Objeto | Exportación | Importación | Coincidencia por | Detalles |
|---|---|---|---|---|
| Partidas OPEX y sus importes | Sí | Sí | `item_number` | [Cargar un presupuesto desde una hoja de cálculo](budget-file.md) |
| Partidas CAPEX y sus importes | Sí | Sí | `item_number` | [Cargar un presupuesto desde una hoja de cálculo](budget-file.md) |
| Empresas y sus indicadores | Sí | Sí | `name` | [Empresas](companies.md) |
| Departamentos | Sí | Sí | `company_name` y `name` | [Departamentos](departments.md) |
| Cuentas | Sí | Sí | `account_number` dentro del plan | [Planes de cuentas y gestión de cuentas](chart-of-accounts.md) |
| Planes de cuentas | No | No | | Se crean en la página o desde una plantilla. Consulte [Planes de cuentas y gestión de cuentas](chart-of-accounts.md) |
| Centros de coste | Sí | Sí | `code` | [Centros de coste](cost-centers.md) |
| Proveedores | Sí | Sí | `name` | [Proveedores](suppliers.md) |
| Valores analíticos | Sí | Sí | `axis_code` y `name` | [Dimensiones analíticas](analytics.md) |
| Calendarios laborales | Sí | Sí | `code`, una fila por calendario y año | [Calendarios laborales](working-day-calendars.md) |
| Usuarios | Sí | Sí | `email` | [Archivo CSV de usuarios](admin.md#archivo-csv-de-usuarios) |
| Contratos | Sí | Sí | `name` y `supplier_name` | [Contratos](contracts.md). El archivo no lleva los vínculos con las partidas presupuestarias |
| Asignaciones | Desde los informes de contracargo | No | | [Informes](reports.md) |
| Líneas de Cantidad y precio, configuración de las columnas presupuestarias, congelaciones, monedas | No | No | | Se configuran en pantalla |

El archivo de presupuesto lee y escribe los importes de cualquier columna y año, como totales anuales o por meses, con los detalles de la partida en la misma fila. Es la vía de entrada para un presupuesto preparado en otro sitio y la vía de salida hacia una hoja de cálculo o una herramienta de BI. Cada lista presupuestaria exporta e importa su propio archivo: el archivo OPEX desde **Gestión presupuestaria > OPEX**, el archivo CAPEX desde **Gestión presupuestaria > CAPEX**.

### Llevar un presupuesto a KANAP

1. Haga corresponder cada objeto de su herramienta actual con las tablas anteriores, y sus identificadores con la columna **Coincidencia por**.
2. Cargue los datos maestros en el orden indicado en [Cargar un presupuesto completo](budget-file.md#cargar-un-presupuesto-completo).
3. Exporte el archivo OPEX y el archivo CAPEX para obtener la fila de cabecera de su organización, con una columna por dimensión analítica. Una lista sin partidas exporta solo la fila de cabecera.
4. Rellene una fila por partida, con `item_number` vacío, con una columna de importe por columna presupuestaria y año (`budget_2027`), o por mes (`budget_2027_03`).
5. Importe los archivos. La comprobación informa de los errores por línea del archivo, y no se escribe nada hasta que usted carga.

Un conjunto coherente de archivos de ejemplo, con una empresa ficticia y sus datos maestros, está en el [repositorio de KANAP](https://github.com/kanap-hq/KANAP/tree/main/doc/samples).

## Leer los datos directamente

En una instalación on-premise, la base de datos PostgreSQL es suya: KANAP funciona sobre la base que usted proporciona. Puede leerla, hacer copias de seguridad y conectarle herramientas.

Antes de hacerlo, tenga en cuenta tres puntos.

**La seguridad a nivel de fila filtra cada lectura.** KANAP se conecta con un rol de aplicación dedicado que no puede eludir la seguridad a nivel de fila. KANAP no arranca con un rol de superusuario ni con un rol que la eluda. Cada tabla que contiene sus datos solo muestra sus filas a una sesión que ha indicado el espacio de trabajo que lee. Una sesión que no lo ha indicado obtiene resultados vacíos, sin ningún error.

**Las tablas son internas.** Sus nombres, sus columnas y su almacenamiento cambian de una versión a otra, con las migraciones que se ejecutan en cada actualización. Los nombres de columna en la base son claves de almacenamiento y difieren de los nombres en pantalla y en los archivos. Una consulta escrita sobre las tablas de hoy puede devolver resultados erróneos o vacíos después de una actualización.

**Sus objetos pueden bloquear una actualización.** PostgreSQL se niega a modificar o eliminar una columna de la que depende una vista. Una vista creada sobre tablas de KANAP puede hacer fallar una actualización. Mantenga sus consultas en la herramienta de BI o en una base de informes separada.

Para una herramienta de BI, use primero las exportaciones. El archivo de presupuesto y los archivos de datos maestros llevan nombres e identificadores de negocio, documentados en este manual.

Cuando una herramienta tenga que leer la base, dele un rol propio de solo lectura. No reutilice nunca el rol de aplicación. Por ejemplo, como administrador de PostgreSQL, con `kanap` como rol de aplicación y como base:

```sql
-- The workspace of this installation
SELECT id FROM tenants;

CREATE ROLE kanap_bi LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE kanap TO kanap_bi;
GRANT USAGE ON SCHEMA public TO kanap_bi;
GRANT SELECT ON spend_items, companies, accounts TO kanap_bi;
ALTER ROLE kanap_bi IN DATABASE kanap SET app.current_tenant = '<id from the first query>';
```

Conceda `SELECT` solo sobre las tablas que necesitan sus informes. La base también contiene cuentas de usuario, datos de inicio de sesión y configuraciones que una herramienta de informes no necesita. Revise los permisos y las consultas después de cada actualización.
