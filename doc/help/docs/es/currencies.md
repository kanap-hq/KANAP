# Configuración de monedas

La página de Configuración de monedas (**Gestión presupuestaria > Administración > Monedas**) es donde configura cómo se almacenan, muestran y convierten las monedas en su espacio de trabajo. Controla la moneda de reporte de todo el espacio de trabajo, las monedas predeterminadas para nuevos elementos y restricciones opcionales sobre qué monedas pueden utilizarse.

Para información sobre conceptos de moneda y mecánicas de conversión, consulte la guía de Gestión de monedas.

## Quién puede verla y modificarla

Las monedas son un ajuste presupuestario. La página está junto a los demás ajustes presupuestarios, en la [Administración presupuestaria](budget-operations.md).

- **Abrir la página, cambiar los ajustes, lanzar la sincronización de tipos de cambio e introducir tipos manuales**: administración presupuestaria con nivel de administrador. La tarjeta se oculta a los demás usuarios.
- **Usar monedas en las líneas**: los usuarios de OPEX y CAPEX eligen entre las monedas permitidas en los formularios de sus líneas, sin abrir esta página.

El permiso **Configuración** del panorama IT no da acceso a las monedas. Solo cubre la configuración del panorama IT.

## El formulario de Configuración de monedas

### Moneda de reporte
La **moneda de todo el espacio de trabajo** utilizada para todos los informes, totales y visualizaciones de listas. Cuando cambia esta moneda:
  - Todas las columnas anuales de OPEX y CAPEX se convierten a la nueva moneda de reporte
  - Los totales en informes se recalculan usando la nueva base
  - **Sus datos almacenados no cambian**: solo se ven afectadas la visualización y la conversión

**Ejemplo**: Si cambia de EUR a USD, los totales de su lista OPEX se mostrarán en USD, pero la moneda almacenada de cada elemento (EUR, GBP, etc.) permanece igual.

**Consejo**: Elija una moneda de reporte que coincida con el estándar de reporte financiero de su grupo (p. ej., EUR para sede europea, USD para grupos con sede en EE. UU.).

### Moneda OPEX predeterminada
La moneda que se **prerellena** cuando crea una nueva línea OPEX (gasto). Esto no restringe qué monedas puede seleccionar: solo ahorra tiempo ofreciendo un valor predeterminado sensato.

**Ejemplo**: Si la mayoría de su gasto recurrente es en EUR, establézcala como EUR. Los usuarios aún pueden seleccionar manualmente GBP, USD o cualquier otra moneda permitida.

### Moneda CAPEX predeterminada
La moneda que se **prerellena** cuando crea una nueva línea CAPEX. Funciona igual que la Moneda OPEX predeterminada, pero para gastos de capital.

**Consejo**: Si su CAPEX se adquiere mayoritariamente en una moneda diferente al OPEX diario (p. ej., USD para compras de hardware), establezca un valor predeterminado diferente aquí.

### Monedas permitidas (opcional)
Una **lista separada por comas** de códigos ISO que restringe qué monedas pueden seleccionar los usuarios al crear o editar líneas OPEX y CAPEX.

  - **Vacío (predeterminado)**: Los usuarios pueden seleccionar cualquier código de moneda ISO de 3 letras válido
  - **Lista especificada** (p. ej., `EUR, USD, GBP`): Solo estas monedas aparecen en los desplegables
  - **La moneda de reporte siempre está permitida**: Incluso si no está listada, la moneda de reporte siempre está disponible
  - **Las monedas predeterminadas siempre están permitidas**: Las monedas predeterminadas OPEX y CAPEX siempre están disponibles

**¿Por qué usar esto?**
Limitar las monedas permitidas ayuda cuando:
  - Su fuente de datos FX no cubre monedas exóticas
  - Desea imponer estandarización entre equipos
  - Necesita prevenir errores por códigos mal escritos u obsoletos

**Consejo**: Deje esto vacío a menos que tenga una razón específica para restringir. Si lo hace, incluya todas las monedas que sus equipos utilizan activamente (p. ej., `EUR, USD, GBP, CHF, PLN`).

## Guardar cambios

Haga clic en **Guardar** para aplicar sus cambios. El sistema:
  1. Valida todos los códigos de moneda (códigos ISO de 3 letras)
  2. Actualiza los ajustes de su espacio de trabajo
  3. Actualiza los tipos del año en curso. Un cambio de moneda de reporte actualiza en su lugar todos los años en uso (consulte [Cambiar la moneda de reporte](#cambiar-la-moneda-de-reporte))
  4. Muestra un mensaje de confirmación

Haga clic en **Restablecer** para descartar los cambios no guardados y volver a los últimos valores guardados.

**Importante**: Cambiar la moneda de reporte afecta de inmediato a la visualización de todas las listas e informes. Planifique el cambio para un momento sin cierre de informes en curso.

### Cambiar la moneda de reporte

Cuando guarda una nueva moneda de reporte, primero se abre un diálogo de confirmación, por ejemplo **¿Cambiar la moneda de reporting a USD?**. Indica lo que provoca el cambio:

  - Cada importe se convierte a la nueva moneda al tipo de su año. Los tipos se recuperan para los años en uso.
  - Los tipos manuales introducidos para la moneda de reporte actual dejan de aplicarse. El diálogo los enumera por moneda, año y tipo. Vuelven a aplicarse si más adelante elige de nuevo la moneda actual.
  - Para cada año con versiones presupuestarias congeladas: estas versiones conservan los tipos de su congelación, convertidos a la nueva moneda al tipo del año (consulte [Años congelados](#anos-congelados)).
  - La nueva moneda se añadirá a las monedas permitidas, si la lista aún no la incluye.

Los tres últimos puntos solo aparecen cuando se aplican. Haga clic en **Cambiar la moneda** para guardar, o en **Cancelar** para conservar los ajustes actuales.

KANAP recupera entonces los tipos de la nueva moneda para cada año en uso: los años presupuestarios (congelados incluidos), los años con una facturación de empresa, los años que muestra la página de contratos, y el año natural en curso con el anterior y el siguiente. La página espera el resultado y lo muestra como en una [sincronización forzada](#forzar-sincronizacion-de-tipos-de-cambio).

## Forzar sincronización de tipos de cambio

El botón **Forzar sincronización de tipos de cambio** recupera los tipos de inmediato para el año natural anterior, el actual y el siguiente, para cada año del bloque de tipos faltantes y para cada año que ya tiene importes presupuestarios.

**Cuándo usarlo**:
  - Después de añadir nuevas monedas permitidas
  - Cuando necesita el tipo del día para el año en curso
  - Si sospecha que hay tipos desactualizados o faltantes
  - Antes de presentar informes a la dirección

**Qué ocurre**:
  - El botón permanece ocupado mientras KANAP recupera los tipos, 20 segundos como máximo
  - Un mensaje encima de la tabla indica después el resultado: el número de tipos recuperados, por ejemplo **12 tipos recuperados.**, seguido de los pares que siguen sin tipo, por ejemplo **Siguen faltando: BRL 2026.**, o de **Cada moneda en uso tiene un tipo.**
  - Cuando la recuperación no aporta ningún tipo nuevo y cada moneda en uso ya tiene un tipo, el mensaje dice **Los tipos de cambio están al día.** Cuando aún faltan pares, dice **No se ha recuperado ningún tipo nuevo.** y los nombra.
  - Si las fuentes no respondieron, el mensaje lo indica, y los tipos ya guardados se mantienen
  - Si la recuperación tarda más, el mensaje indica **La sincronización continúa en segundo plano.** La tabla y el bloque de tipos faltantes se actualizan cuando termina
  - Si ya hay una actualización en curso, KANAP le añade sus años, de modo que ninguna solicitud se pierde

**Actualización automática**: El sistema también actualiza los tipos automáticamente cada 30 días cuando un usuario inicia sesión (A-1, A, A+1). Cuando una lista, un informe o la página de contratos necesita un tipo que la captura de su año no tiene (una moneda usada desde entonces, o un año sin captura), el sistema recupera ese año en segundo plano en cuanto se lee, y la siguiente visualización usa el nuevo tipo. La sincronización forzada sirve para obtener el resultado de inmediato.

**Qué monedas se recuperan**: las monedas de las líneas presupuestarias, las empresas y los contratos, más la moneda de reporte, las predeterminadas y las permitidas.

**Los tipos ya conocidos se conservan**: cuando una fuente deja de devolver una moneda en una actualización posterior, el tipo guardado para ese año se mantiene.

**Años aún no publicados**: el Banco Mundial publica la media de un año unos meses después de su cierre (el año recién terminado, normalmente hacia mediados de año). Mientras tanto, un año pasado usa el año publicado más cercano, y la tabla marca ese tipo como **estimación**. El valor real lo sustituye en la primera actualización tras la publicación. El año en curso usa el tipo del día. Cuando no está disponible, usa el último año publicado, también marcado como estimación.

**Consejo**: Si añade una nueva moneda a las monedas permitidas, ejecute de inmediato **Forzar sincronización de tipos de cambio** para disponer de los tipos antes de que los usuarios creen líneas en esa moneda.

## Tabla de tipos de cambio

Debajo del formulario, la tabla **Últimas capturas de tipos de cambio** muestra los tipos más recientes capturados para cada ejercicio, en la moneda de reporte actual. La moneda de reporte aparece primero y después las demás monedas por orden alfabético. Cada fila es una moneda en uso: una moneda predeterminada, una moneda permitida, o la moneda de una línea presupuestaria, una empresa o un contrato. Una moneda con un tipo manual permanece en la tabla aunque ya no esté en uso. Tras un cambio de moneda de reporte, la anterior también aparece para los años de versiones congeladas, ya que su conversión pasa por ella. Los tipos guardados para una moneda de reporte anterior no se muestran.

**Columnas**:
  - **Moneda**: El código ISO de 3 letras
  - **Columnas de ejercicio**: Una columna por año con datos (p. ej., 2023, 2024, 2025)
  - **Valores**: Tipo de cambio hacia su moneda de reporte, en el formato numérico de su idioma, con 6 decimales como máximo y sin ceros sobrantes
  - **Fuente**: Muestra el origen de los datos de cada año:
      - **Media anual**: Media anual del Banco Mundial (años pasados)
      - **Media trimestral**: Media trimestral del Banco Mundial (si está disponible)
      - **Spot en tiempo real**: Tipo del día de ExchangeRate-API (año en curso)
      - **Estimación a futuro**: Tipo del año en curso reutilizado para los años futuros
  - **Marcas en las celdas**: un asterisco (*) tras un tipo introducido a mano, explicado por la nota **Tipo introducido manualmente** bajo la tabla (visible solo cuando la tabla contiene uno); **estimación** junto a un tipo tomado del año publicado más cercano (pase el cursor sobre la marca para ver el motivo)
  - **Tipo faltante**: un par sin tipo muestra `—` en el color de advertencia

**Ejemplo**:
Si su moneda de reporte es EUR:

| Moneda | 2024 (Media anual) | 2025 (Spot en tiempo real) | 2026 (Estimación a futuro) |
|--------|--------------------|----------------------------|----------------------------|
| EUR    | 1                  | 1                          | 1                          |
| CHF    | 0,9621             | 0,9655                     | 0,9655                     |
| GBP    | 1,1753             | 1,182                      | 1,182                      |
| USD    | 0,92582            | 0,9312                     | 0,9312                     |

**Cómo leer la tabla**:
  - Un tipo indica cuántas unidades de su moneda de reporte equivalen a 1 unidad de la moneda de la fila
  - Si un tipo muestra `—`, no hay datos. Los importes de las líneas presupuestarias en esa moneda quedan excluidos de los totales de ese año (consulte [Mecánicas de conversión](#mecanicas-de-conversion-referencia-rapida))
  - Los tipos se capturan en el momento de la sincronización y no cambian hasta la siguiente actualización

**Consejo**: Si ve tipos faltantes (`—`), compruebe que el código de moneda es válido y se publica habitualmente. Limitar las monedas permitidas evita códigos poco comunes sin datos. También puede introducir el tipo usted mismo (consulte [Tipos manuales](#tipos-manuales)).

### Tipos faltantes

Encima de la tabla, un bloque enumera cada moneda y año en uso sin tipo, bajo un título como **Faltan 2 tipos de cambio**. Cada fila explica que ninguna fuente publica todavía ese tipo, por lo que los importes en esa moneda quedan excluidos de los totales hasta que lo tenga. Cuando no falta nada, el bloque indica **Cada moneda en uso tiene un tipo.**

Un par se considera en uso cuando una línea presupuestaria, las cifras de una empresa o un contrato lo necesitan. Para un contrato, son los años que muestra la página de contratos (el año en curso, los dos siguientes y el anterior cuando el presupuesto tiene líneas para él) en los que el contrato está vigente. La página de contratos y este bloque señalan así los mismos años faltantes. Al abrir la página, KANAP también vuelve a consultar las fuentes para los años de la lista.

### Tipos manuales

Cuando ninguna fuente publica un tipo, o cuando su equipo financiero usa sus propios tipos, puede introducir un tipo para una moneda y un año.

  1. Haga clic en la celda de la moneda y el año en la tabla, o en **Introducir un tipo** junto a una fila del bloque de tipos faltantes. El enlace **Introducir un tipo** de un aviso en otra parte de KANAP también lleva aquí: abre el diálogo directamente cuando el aviso solo cita una moneda y un año, y si no resalta el bloque de tipos faltantes durante unos segundos.
  2. En el diálogo **Tipo de cambio manual**, escriba el tipo en su moneda de reporte para 1 unidad de la moneda elegida (por ejemplo **Tipo en EUR para 1 USD**), con el separador decimal de su idioma. Cuando el año anterior o el siguiente tiene un tipo automático, el campo lo muestra como referencia, por ejemplo **Tipo automático 2025: 0,9312**. Si no, sugiere el tipo medio del año publicado por su banco central o su tesorería.
  3. Haga clic en **Guardar**. La celda muestra entonces el tipo seguido de un asterisco (*).

El diálogo comprueba el valor antes de guardar: el tipo es obligatorio, debe ser un número mayor que 0, no puede superar 1.000.000.000 y no debe valer 0 redondeado a 6 decimales. El mensaje bajo el campo indica la regla incumplida.

Un tipo manual sustituye al tipo automático de ese año hasta que lo retire. Las actualizaciones posteriores no lo sobrescriben. Para volver al tipo automático, abra la celda y haga clic en **Retirar el tipo manual**: el tipo automático se recuperará de nuevo.

Cuando el año tiene versiones presupuestarias congeladas, un tipo manual introducido o retirado no les llega, y la página lo indica, por ejemplo **Las 2 versiones congeladas de 2026 conservan el tipo de su congelación.**

A tener en cuenta:
  - Solo los usuarios de la administración presupuestaria con nivel de administrador pueden introducir, cambiar o retirar un tipo manual.
  - Cada introducción, cambio y retirada queda registrada en el registro de auditoría.
  - Un año congelado conserva los tipos capturados al congelarlo, manuales y estimados incluidos (consulte [Años congelados](#anos-congelados)).
  - Un tipo manual se introduce respecto a la moneda de reporte actual. Tras un cambio de moneda de reporte, los tipos manuales introducidos para la anterior dejan de aplicarse. Vuelven a aplicarse si vuelve a esa moneda de reporte.
  - La moneda de reporte siempre tiene un tipo de 1 y no admite tipo manual.

## Importación y exportación CSV

### Exportar
Las exportaciones OPEX y CAPEX incluyen datos del elemento y montos anuales en la **moneda propia de cada elemento**, no en la moneda de reporte. Esto preserva los datos originales para reimportación o análisis externo.

**Ejemplo de fila CSV** (OPEX):
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Importar
Al importar líneas OPEX o CAPEX, la columna `Currency` debe contener **códigos ISO estándar de 3 letras**.

**Validación**:
  - Si las **Monedas permitidas** están configuradas, las importaciones que usen códigos no listados se rechazan
  - La respuesta de error incluye la lista `allowedCurrencies` para mayor claridad
  - La moneda de reporte y las monedas predeterminadas siempre se aceptan

**Ejemplo**:
Si Monedas permitidas = `EUR, USD, GBP` e importa un elemento con `Currency=CHF`, la importación falla con:
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Consejo**: Exporte una plantilla, verifique la lista de monedas permitidas y asegúrese de que su archivo de importación use solo esos códigos.

## Estado y datos históricos

Cuando cambia la configuración:
  - **Moneda de reporte**: Afecta la visualización inmediatamente; los importes guardados no cambian, y cada año se convierte a la nueva moneda con los tipos descritos en [Mecánicas de conversión](#mecanicas-de-conversion-referencia-rapida)
  - **Monedas predeterminadas**: Solo afectan nuevos elementos; los elementos existentes conservan sus monedas
  - **Monedas permitidas**: Los elementos existentes no se validan retroactivamente: las restricciones solo se aplican a elementos nuevos o editados

## Mecánicas de conversión (referencia rápida)

Los importes se guardan en su propia moneda y se convierten al mostrarse. Cada año usa los últimos tipos capturados para ese año, sea cual sea la fecha en que se introdujeron los importes. Cuando una sincronización captura nuevos tipos para un año, los importes de ese año se convierten con ellos a partir de entonces, salvo si el año está congelado (consulte [Años congelados](#anos-congelados)).

### Años pasados
Se usan las medias anuales del Banco Mundial. Son estables y no cambian una vez publicadas. Mientras el Banco Mundial no haya publicado un año, el año publicado más cercano ocupa su lugar, marcado como estimación.

### Año actual
Se usa el tipo del día de ExchangeRate-API (si no está disponible, el último tipo anual, marcado como estimación). Se actualiza cuando ejecuta **Forzar sincronización de tipos de cambio** o en la actualización automática cada 30 días.

### Años futuros
Se reutiliza el tipo del año en curso como estimación. Sirve de referencia para la planificación presupuestaria, pero conviene revisarlo a medida que se acercan esos años.

### Años congelados
Congelar la columna presupuestaria por defecto de un año fija los tipos de ese año para el tipo de línea congelado (OPEX o CAPEX): KANAP actualiza los tipos del año y conserva ese conjunto para todos los importes del año, aunque lleguen tipos más recientes. Si la moneda de reporte cambia después, estos importes conservan los tipos congelados y luego se convierten a la nueva moneda de reporte al tipo de la anterior en ese mismo año. Sin ese tipo, quedan excluidos de los totales y se señalan como cualquier tipo faltante: la moneda de reporte anterior aparece entonces para ese año en el bloque de tipos faltantes, y un tipo manual lo completa. Descongelar la columna por defecto los libera. Consulte [Congelar la columna por defecto fija los tipos de cambio](budget-operations.md#congelar-la-columna-por-defecto-fija-los-tipos-de-cambio).

**Tipo faltante**: Cuando un año no tiene tipo para una moneda en uso, los importes de las líneas presupuestarias en esa moneda quedan excluidos de todos los totales en la moneda de reporte de ese año. Esto afecta a la lista de líneas presupuestarias, a la vista general de la gestión presupuestaria, a los informes presupuestarios y de contracargo, a los contratos y a las pestañas Relaciones de las aplicaciones y las tecnologías. La pantalla lo indica donde importa:

- Un aviso de una línea indica lo que se excluye, por ejemplo «Se excluyen 3 líneas sin tipo de cambio: USD 2026.» Aparece bajo los totales de la lista de líneas presupuestarias, en los mosaicos de la vista general, en la parte superior de cada informe presupuestario y de contracargo, y bajo las cifras presupuestarias de contratos, aplicaciones y tecnologías. Los usuarios de la administración presupuestaria con nivel de administrador ven además **Introducir un tipo**, que abre esta página en el tipo faltante.
- En la propia línea, el importe aparece en su propia moneda con una pequeña marca naranja. Pase el cursor sobre la marca para leer, por ejemplo, «Sin tipo de cambio de USD para 2026: excluido de los totales.»

KANAP obtiene los tipos de ese año en segundo plano (como máximo una vez cada seis horas por año), de modo que la siguiente visualización usa el nuevo tipo en cuanto la fuente lo publica. Para detectar los tipos faltantes, consulte el bloque de tipos faltantes encima de la tabla de tipos de cambio y ejecute **Forzar sincronización de tipos de cambio** para obtenerlos de inmediato. Introducir un [tipo manual](#tipos-manuales) lo corrige al momento.

## Preguntar al asistente

[Plaid](ai-assistant.md#tool-calls) lee las monedas y los tipos de esta página para cualquier persona con derecho de lectura sobre el presupuesto. Pregunte, por ejemplo: «¿Cuál es el tipo del USD para 2026?»

## Consejos

  - **Fije la moneda de reporte una sola vez**: cambiarla a mitad de año afecta a todos los informes. Si debe cambiarla, hágalo al cierre del ejercicio.
  - **Las monedas predeterminadas ahorran tiempo**: elija las que sus equipos usan con más frecuencia.
  - **Restrinja las monedas a propósito**: use las monedas permitidas solo con un motivo claro (cobertura de tipos, conformidad, estandarización).
  - **Sincronice los tipos con antelación**: después de añadir monedas, antes de generar informes o cuando los tipos parezcan desactualizados.
  - **Revise la tabla de tipos de cambio**: compruebe que los tipos son razonables y completos antes de cerrar los informes.
  - **Use códigos ISO coherentes**: siempre códigos de 3 letras (EUR, USD, GBP), nunca símbolos (€, $, £) ni códigos numéricos.

## Escenarios comunes

### Escenario 1: Cambiar la moneda de reporte
Su grupo pasa de un reporte en EUR a un reporte en USD.

**Pasos**:
  1. Vaya a **Gestión presupuestaria > Administración > Monedas**
  2. Cambie la moneda de reporte de `EUR` a `USD`
  3. Haga clic en **Guardar**, lea el diálogo de confirmación (tipos manuales que dejan de aplicarse, versiones congeladas) y haga clic en **Cambiar la moneda**
  4. Lea el resultado de la recuperación de tipos. Para cada par que siga faltando, introduzca un tipo manual o ejecute más tarde **Forzar sincronización de tipos de cambio**
  5. Verifique que la tabla de tipos de cambio muestra ahora tipos en USD (cada tipo es relativo al USD)
  6. Compruebe las listas OPEX y CAPEX: los totales y las columnas anuales se muestran ahora en USD

**Resultado**: Todos los informes, paneles y listas muestran USD. Cada línea conserva su propia moneda.

### Escenario 2: Restringir monedas por conformidad
Su equipo financiero exige que todo el gasto se registre solo en EUR, USD o GBP.

**Pasos**:
  1. Vaya a **Gestión presupuestaria > Administración > Monedas**
  2. Establezca las monedas permitidas en `EUR, USD, GBP`
  3. Haga clic en **Guardar**
  4. Ejecute **Forzar sincronización de tipos de cambio** para disponer de los tipos de las tres monedas

**Resultado**: Los usuarios solo pueden seleccionar EUR, USD o GBP al crear o editar líneas. Un intento de importar otras monedas falla con un mensaje de error claro.

### Escenario 3: Añadir una nueva moneda a mitad de año
Su empresa inicia operaciones en Suiza y necesita registrar gasto en CHF.

**Pasos**:
  1. Vaya a **Gestión presupuestaria > Administración > Monedas**
  2. Añada `CHF` a las monedas permitidas (p. ej., `EUR, USD, GBP, CHF`)
  3. Haga clic en **Guardar**
  4. Haga clic en **Forzar sincronización de tipos de cambio** para obtener los tipos del CHF de inmediato
  5. Verifique que CHF aparece en la tabla de tipos de cambio con valores

**Resultado**: Los usuarios pueden seleccionar CHF en las nuevas líneas. La tabla de tipos de cambio incluye el CHF con sus tipos actuales e históricos.

### Escenario 4: Prepararse para el ciclo presupuestario anual
Es diciembre y prepara el presupuesto del próximo año.

**Pasos**:
  1. Vaya a **Gestión presupuestaria > Administración > Monedas**
  2. Haga clic en **Forzar sincronización de tipos de cambio** para actualizar los tipos del próximo año
  3. Consulte en la tabla de tipos de cambio las estimaciones del próximo año
  4. Tenga en cuenta que los tipos de los años futuros reutilizan el del año en curso: revíselos a medida que se acerque el año

**Resultado**: El presupuesto del próximo año usa los últimos tipos disponibles. Los equipos pueden planificar CAPEX y OPEX con supuestos de cambio razonables.

## Preguntas frecuentes

**P: ¿Qué ocurre si cambio la moneda de reporte a mitad de año?**
R: Todos los informes y listas pasan de inmediato a la nueva moneda. Los datos guardados no cambian: solo cambia la moneda de visualización. Las versiones presupuestarias congeladas conservan sus tipos congelados, convertidos al tipo de cada año, y los tipos manuales introducidos para la moneda anterior dejan de aplicarse hasta que vuelva a elegirla. Planifique este cambio con cuidado para no perturbar un periodo de informes.

**P: ¿Puedo definir monedas de reporte distintas para distintas empresas?**
R: No. La moneda de reporte vale para todo el espacio de trabajo. Todas las empresas, informes y totales usan la misma moneda de reporte. Cada línea guarda su propia moneda, pero las conversiones siempre se hacen hacia la moneda de reporte.

**P: ¿Por qué no veo tipos para una moneda concreta?**
R: Las fuentes (Banco Mundial o ExchangeRate-API) quizá no publiquen esa moneda. Compruebe que el código ISO es correcto y se publica habitualmente. Si hace falta, limite las monedas permitidas a códigos bien cubiertos, o introduzca un [tipo manual](#tipos-manuales).

**P: ¿Con qué frecuencia se actualizan automáticamente los tipos?**
R: Cada 30 días, cuando un usuario inicia sesión, el sistema actualiza los tipos de A-1, A y A+1. Un año al que le falta el tipo de una moneda en uso también se recupera en cuanto una lista, un informe o la página de contratos lo necesita, y al abrir esta página. También puede lanzar una actualización en cualquier momento con **Forzar sincronización de tipos de cambio**.

**P: ¿Los cambios de tipos afectan a mis datos guardados?**
R: No. Los tipos de cambio solo intervienen en la **conversión y la visualización**. Cada línea OPEX y CAPEX guarda su propia moneda e importes, que no cambian cuando se actualizan los tipos. Solo cambian los valores convertidos que muestran los informes y las listas.

**P: ¿Puedo importar tipos históricos?**
R: La importación de tipos desde un archivo no está disponible. Puede introducir un tipo manual para cada moneda y año en esta página (consulte [Tipos manuales](#tipos-manuales)). Un tipo manual sustituye al tipo automático hasta que lo retire.

**P: ¿Y si necesito una moneda que no está en la lista de permitidas?**
R: Añádala a las monedas permitidas o deje la lista vacía (lo que permite todas las monedas). Después ejecute **Forzar sincronización de tipos de cambio** para obtener sus tipos.

**P: ¿Son precisas las estimaciones de los años futuros?**
R: Reutilizan el tipo del año en curso y deben tratarse como **supuestos de planificación**, no como previsiones. Revíselas a medida que se acerquen esos años y las fuentes oficiales publiquen sus tipos.
