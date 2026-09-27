# Configuración de monedas

La página de Configuración de monedas (**Datos maestros > Moneda**) es donde configura cómo se almacenan, muestran y convierten las monedas en su espacio de trabajo. Controla la moneda de reporte de todo el espacio de trabajo, las monedas predeterminadas para nuevos elementos y restricciones opcionales sobre qué monedas pueden utilizarse.

Para información sobre conceptos de moneda y mecánicas de conversión, consulte la guía de Gestión de monedas.

## El formulario de Configuración de monedas

### Moneda de reporte
La **moneda de todo el espacio de trabajo** utilizada para todos los informes, totales y visualizaciones de listas. Cuando cambia esta moneda:
  - Todas las columnas anuales de OPEX y CAPEX se convierten a la nueva moneda de reporte
  - Los totales en informes se recalculan usando la nueva base
  - **Sus datos almacenados no cambian** -- solo se ven afectadas la visualización y la conversión

**Ejemplo**: Si cambia de EUR a USD, los totales de su lista OPEX se mostrarán en USD, pero la moneda almacenada de cada elemento (EUR, GBP, etc.) permanece igual.

**Consejo**: Elija una moneda de reporte que coincida con el estándar de reporte financiero de su grupo (p. ej., EUR para sede europea, USD para grupos con sede en EE. UU.).

### Moneda OPEX predeterminada
La moneda que se **prerellena** cuando crea una nueva partida OPEX (gasto). Esto no restringe qué monedas puede seleccionar -- solo ahorra tiempo ofreciendo un valor predeterminado sensato.

**Ejemplo**: Si la mayoría de su gasto recurrente es en EUR, establézcala como EUR. Los usuarios aún pueden seleccionar manualmente GBP, USD o cualquier otra moneda permitida.

### Moneda CAPEX predeterminada
La moneda que se **prerellena** cuando crea una nueva partida CAPEX. Funciona igual que la Moneda OPEX predeterminada, pero para gastos de capital.

**Consejo**: Si su CAPEX se adquiere mayoritariamente en una moneda diferente al OPEX diario (p. ej., USD para compras de hardware), establezca un valor predeterminado diferente aquí.

### Monedas permitidas (opcional)
Una **lista separada por comas** de códigos ISO que restringe qué monedas pueden seleccionar los usuarios al crear o editar partidas OPEX y CAPEX.

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

Haga clic en **Guardar cambios** para aplicar sus actualizaciones. El sistema:
  1. Validará todos los códigos de moneda (deben ser códigos ISO de 3 letras)
  2. Actualizará la configuración de su espacio de trabajo
  3. Desencadenará automáticamente una actualización en segundo plano de las tasas FX para el año actual y cualquier año con datos presupuestarios
  4. Mostrará un mensaje de éxito

Haga clic en **Restablecer** para descartar cambios no guardados y volver a los últimos valores guardados.

**Importante**: Cambiar la moneda de reporte afecta inmediatamente cómo las listas e informes muestran los valores. Planifique este cambio durante una ventana de mantenimiento si necesita períodos de reporte consistentes.

## Forzar sincronización de tasas FX

El botón **Forzar sincronización de tasas FX** desencadena manualmente una actualización en segundo plano de los tipos de cambio para todos los ejercicios fiscales relevantes (año actual más cualquier año con datos OPEX o CAPEX).

**Cuándo usarlo**:
  - Después de añadir nuevas monedas permitidas
  - Cuando necesita tasas al contado actualizadas para el año en curso
  - Si sospecha que las tasas están desactualizadas o faltan
  - Antes de generar informes para las partes interesadas

**Qué sucede**:
  - El sistema pone en cola una tarea en segundo plano para obtener las tasas FX
  - Un mensaje de éxito muestra qué ejercicios fiscales se están actualizando
  - Las tasas se actualizan en unos segundos
  - La tabla de Instantáneas de tasas FX se actualiza automáticamente

**Actualización automática**: El sistema también actualiza las tasas automáticamente cada 30 días cuando un usuario inicia sesión (cubre A-1, A, A+1). La sincronización manual le da control cuando necesita actualizaciones inmediatas.

**Consejo**: Si añade una nueva moneda a Monedas permitidas, ejecute Forzar sincronización FX inmediatamente para rellenar las tasas antes de que los usuarios empiecen a crear elementos en esa moneda.

## Tabla de instantáneas de tasas FX

Debajo del formulario de configuración, la tabla **Últimas instantáneas de tasas FX** muestra los tipos de cambio más recientes capturados para cada ejercicio fiscal.

**Columnas**:
  - **Moneda**: El código ISO de 3 letras
  - **Columnas de ejercicio fiscal**: Una columna por año con datos (p. ej., 2023, 2024, 2025)
  - **Valores de tasa**: Tipo de cambio respecto a su moneda de reporte (precisión de 6 decimales)
  - **Etiqueta de fuente**: Muestra la fuente de datos para cada año:
      - **Promedio anual**: Promedio anual del Banco Mundial (años históricos)
      - **Promedio trimestral**: Promedio trimestral del Banco Mundial (si está disponible)
      - **Tasa al contado**: Tasa al contado actual de ExchangeRate-API (año actual)
      - **Estimación futura**: Tasa del año actual reutilizada para años futuros

**Ejemplo**:
Si su moneda de reporte es EUR:

| Moneda | 2024 (Prom. anual) | 2025 (Al contado) | 2026 (Est. futura) |
|--------|---------------------|--------------------|--------------------|
| USD    | 0,925820            | 0,931200           | 0,931200           |
| GBP    | 1,175300            | 1,182000           | 1,182000           |
| CHF    | 0,962100            | 0,965500           | 0,965500           |

**Cómo leer la tabla**:
  - Las tasas muestran cuántas unidades de su moneda de reporte equivalen a 1 unidad de la moneda listada
  - Si una tasa muestra `—`, no hay datos disponibles (se usa una conversión de respaldo de 1,00)
  - Las tasas se capturan en el momento de la sincronización y permanecen estables hasta la próxima actualización

**Consejo**: Si ve tasas faltantes (`—`), verifique que el código de moneda sea válido y de uso común. Considere limitar las Monedas permitidas para evitar códigos exóticos sin datos.

## Importación y exportación CSV

### Exportar
Las exportaciones OPEX y CAPEX incluyen datos del elemento y montos anuales en la **moneda propia de cada elemento**, no en la moneda de reporte. Esto preserva los datos originales para reimportación o análisis externo.

**Ejemplo de fila CSV** (OPEX):
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Importar
Al importar partidas OPEX o CAPEX, la columna `Currency` debe contener **códigos ISO estándar de 3 letras**.

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
  - **Moneda de reporte**: Afecta la visualización inmediatamente; los datos históricos permanecen intactos y se convierten usando las tasas que estaban activas cuando se introdujeron los datos
  - **Monedas predeterminadas**: Solo afectan nuevos elementos; los elementos existentes conservan sus monedas
  - **Monedas permitidas**: Los elementos existentes no se validan retroactivamente -- las restricciones solo se aplican a elementos nuevos o editados

## Mecánicas de conversión (referencia rápida)

### Años pasados
Se utilizan las tasas promedio anuales del Banco Mundial. Son estables y no cambian una vez publicadas.

### Año actual
Se utiliza la tasa al contado de ExchangeRate-API (con respaldo a la última tasa anual si no está disponible). Se actualiza cuando ejecuta Forzar sincronización FX o durante la actualización automática de 30 días.

### Años futuros
Se reutiliza la tasa del año actual como estimación futura. Esto proporciona orientación para la planificación presupuestaria pero debe revisarse a medida que esos años se acerquen.

**Respaldo**: Si no se encuentra tasa para una moneda, el sistema usa **1,00** hasta que los datos estén disponibles. Esto previene errores pero puede producir conversiones imprecisas -- ejecute Forzar sincronización FX para rellenar las tasas faltantes.

## Consejos

  - **Establezca la moneda de reporte una vez**: Cambiarla a mitad de año afecta todos los informes. Si debe cambiarla, hágalo a fin de año.
  - **Las monedas predeterminadas ahorran tiempo**: Establézcalas en las monedas que sus equipos usan con más frecuencia.
  - **Restrinja monedas intencionalmente**: Solo use Monedas permitidas si tiene una razón clara (p. ej., cobertura de datos FX, conformidad, estandarización).
  - **Ejecute Forzar sincronización FX proactivamente**: Después de añadir monedas, antes de generar informes o cuando las tasas parezcan desactualizadas.
  - **Verifique la tabla de instantáneas FX**: Utilícela para verificar que las tasas sean razonables y completas antes de finalizar informes.
  - **Use códigos ISO consistentes**: Siempre use códigos de 3 letras (EUR, USD, GBP) -- nunca símbolos (€, $, £) ni códigos numéricos.

## Escenarios comunes

### Escenario 1: Cambiar la moneda de reporte
Su grupo cambia de reporte basado en EUR a basado en USD.

**Pasos**:
  1. Vaya a **Datos maestros > Moneda**
  2. Cambie la Moneda de reporte de `EUR` a `USD`
  3. Haga clic en **Guardar cambios** (desencadena automáticamente la actualización FX)
  4. Verifique que la tabla de Instantáneas de tasas FX muestre USD como base (todas las tasas ahora deben ser relativas a USD)
  5. Compruebe las listas OPEX y CAPEX -- los totales y columnas anuales ahora se muestran en USD

**Resultado**: Todos los informes, paneles de control y listas muestran USD. Sus datos almacenados (la moneda propia de cada elemento) permanecen sin cambios.

### Escenario 2: Restringir monedas por conformidad
Su equipo financiero requiere que todo el gasto se registre solo en EUR, USD o GBP.

**Pasos**:
  1. Vaya a **Datos maestros > Moneda**
  2. Establezca Monedas permitidas como `EUR, USD, GBP`
  3. Haga clic en **Guardar cambios**
  4. Ejecute **Forzar sincronización FX** para asegurar que las tasas estén disponibles para las tres monedas

**Resultado**: Los usuarios solo pueden seleccionar EUR, USD o GBP al crear o editar elementos. Los intentos de importar otras monedas fallarán con un mensaje de error claro.

### Escenario 3: Añadir una nueva moneda a mitad de año
Su empresa inicia operaciones en Suiza y necesita registrar gasto en CHF.

**Pasos**:
  1. Vaya a **Datos maestros > Moneda**
  2. Añada `CHF` a Monedas permitidas (p. ej., `EUR, USD, GBP, CHF`)
  3. Haga clic en **Guardar cambios**
  4. Haga clic en **Forzar sincronización FX** para obtener las tasas CHF inmediatamente
  5. Verifique que CHF aparezca en la tabla de Instantáneas de tasas FX con tasas válidas

**Resultado**: Los usuarios ahora pueden seleccionar CHF para nuevos elementos. La tabla de tasas FX incluye CHF con tasas actuales e históricas para conversiones precisas.

### Escenario 4: Prepararse para ciclos presupuestarios anuales
Es diciembre y está preparando la planificación presupuestaria del próximo año.

**Pasos**:
  1. Vaya a **Datos maestros > Moneda**
  2. Haga clic en **Forzar sincronización FX** para actualizar las tasas del próximo año
  3. Verifique la tabla de Instantáneas de tasas FX para ver las estimaciones futuras del próximo año
  4. Tenga en cuenta que las tasas de años futuros son estimaciones futuras (reutilizando la tasa del año actual) -- revíselas a medida que el año se acerque

**Resultado**: Sus previsiones presupuestarias para el próximo año utilizan las tasas más recientes disponibles. Los equipos pueden planificar CAPEX y OPEX con suposiciones de moneda razonables.

## Preguntas frecuentes

**P: ¿Qué pasa si cambio la moneda de reporte a mitad de año?**
R: Todos los informes y listas se convierten inmediatamente a la nueva moneda. Los datos históricos permanecen intactos -- solo cambia la moneda de visualización. Planifique este cambio cuidadosamente para evitar confusión durante períodos de reporte activos.

**P: ¿Puedo establecer diferentes monedas de reporte para diferentes empresas?**
R: No. La moneda de reporte es de todo el espacio de trabajo. Todas las empresas, informes y totales usan la misma moneda de reporte. Los elementos individuales almacenan su propia moneda, pero las conversiones siempre apuntan a la moneda de reporte del espacio de trabajo.

**P: ¿Por qué no veo tasas para una moneda específica?**
R: La fuente de datos (Banco Mundial o ExchangeRate-API) puede no publicar esa moneda. Verifique que el código ISO sea correcto y de uso común. Si es necesario, limite las Monedas permitidas a códigos con cobertura de datos confiable.

**P: ¿Con qué frecuencia se actualizan automáticamente las tasas FX?**
R: Cada 30 días, cuando cualquier usuario inicia sesión, el sistema actualiza las tasas para A-1, A y A+1. También puede desencadenar una actualización manual en cualquier momento usando Forzar sincronización FX.

**P: ¿Los cambios de tasas FX afectan mis datos almacenados?**
R: No. Los tipos de cambio solo afectan la **conversión y visualización**. Cada partida OPEX y CAPEX almacena su propia moneda y montos, que nunca cambian cuando las tasas se actualizan. Solo los valores convertidos mostrados en informes y listas cambian.

**P: ¿Puedo importar tasas históricas manualmente?**
R: No. El sistema obtiene las tasas automáticamente de fuentes externas (Banco Mundial, ExchangeRate-API). Si necesita tasas personalizadas, contacte con soporte o considere usar una moneda donde pueda aceptar las tasas publicadas.

**P: ¿Qué pasa si necesito usar una moneda que no está en la lista de permitidas?**
R: Añádala a Monedas permitidas o deje la lista vacía (lo que permite todas las monedas). Recuerde ejecutar Forzar sincronización FX después de añadir nuevas monedas para rellenar las tasas.

**P: ¿Las estimaciones futuras para años futuros son precisas?**
R: Las estimaciones futuras reutilizan la tasa del año actual y deben tratarse como **supuestos de planificación**, no como pronósticos. Revíselas a medida que los años futuros se acerquen y las tasas estén disponibles de fuentes oficiales.
