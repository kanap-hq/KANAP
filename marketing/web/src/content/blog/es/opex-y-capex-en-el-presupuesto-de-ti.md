---
title: "OPEX y CAPEX: el presupuesto de TI, listo para la revisión con finanzas"
description: "Gasto operativo y de inversión en un solo lugar: TI construye su presupuesto con sencillez y llega preparada a la revisión con finanzas."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: opex-capex-it-budget
series:
  key: opex-budget
  part: 4
  title: "Construir el presupuesto de TI"
---

El presupuesto de TI tiene dos partes: gasto operativo y gasto de inversión. A menudo cada una vive en su propio archivo, con su propio calendario y la persona que lo mantiene. Después llega la revisión con finanzas y sus preguntas: ¿cuánto es operación, cuánto inversión, para qué sirve, cuánto cuesta realmente este programa?

Cada respuesta exige entonces una consolidación manual. KANAP es el lugar donde TI prepara su presupuesto, OPEX y CAPEX juntos, con sencillez. Y como cada línea se clasifica al introducirla, TI llega a la revisión con cifras limpias, coherentes y fáciles de justificar.

## OPEX o CAPEX, la regla en palabras sencillas

El **OPEX** mantiene en marcha el sistema de información durante el año: suscripciones, mantenimiento, servicios recurrentes. El **CAPEX** crea o mejora un activo que se usa durante varios años: servidores, puestos de trabajo, desarrollo activado. Lo que se activa sigue las reglas contables de la empresa, que finanzas fija con TI.

Una segunda pregunta se mezcla a menudo con la primera: ¿run o build? Run mantiene en funcionamiento los servicios existentes, build los crea o los modifica. Un proyecto build suele llevar los dos tipos de gasto: desarrollo activado en CAPEX, formación y gestión del cambio en OPEX. KANAP guarda ambas respuestas en cada línea, en dos campos separados, y aun así permite consolidarlas.

## Una lista, un espacio de trabajo

En KANAP, OPEX y CAPEX son un simple campo de la línea presupuestaria. Las líneas de ambos tipos comparten por año las mismas columnas de presupuesto (escenarios), las mismas asignaciones entre empresas y departamentos, los mismos vínculos con aplicaciones, proyectos, contratos y proveedores. El filtro de la columna **Tipo** aísla uno u otro con un clic.

![Las líneas presupuestarias de Fromage & Co: líneas OPEX y CAPEX juntas, con la columna Tipo](/screenshots/blog/opex-capex-list-2026-10-17.png)

El tipo OPEX o CAPEX determina algunos campos de la línea:

- **Cuentas**: cada cuenta del plan de cuentas sirve para OPEX, CAPEX o ambos. Una línea CAPEX solo ve las cuentas de inversión.
- **Dimensiones analíticas**: una dimensión o un valor puede reservarse a un tipo (véase más abajo).
- **Contracargo**: los informes de contracargo y de análisis ofrecen OPEX, CAPEX o ambos.
- **Congelaciones**: una columna de presupuesto se congela por año y por tipo. Un presupuesto de inversión aprobado puede bloquearse mientras el presupuesto operativo sigue en preparación.

## Las dimensiones, el idioma común de TI y finanzas

Las dimensiones analíticas clasifican las líneas para los informes, junto a la estructura contable (los detalles están en [Dimensiones analíticas: lo que la seguridad cuesta realmente a TI](/es/blog/dimensiones-analiticas-del-presupuesto-de-ti)). Cada dimensión responde a una pregunta. El conjunto adecuado depende de cada organización. Aquí va un ejemplo basado en buenas prácticas, para que cada cual lo adapte.

¡No hace falta partir de cero! Un nuevo espacio de trabajo KANAP empieza con cuatro dimensiones recomendadas y sus valores (Tipo de coste, Dominio TI, Motivo y Prioridad). Cada una puede después renombrarse, ampliarse y configurarse a su gusto.

**«¿Para qué sirve esta inversión?»** La dimensión **Motivo**: sustitución, capacidad, productividad, seguridad, conformidad, crecimiento. Reservada a las líneas CAPEX y marcada como obligatoria, garantiza que cada nueva inversión llegue clasificada, tanto si se crea en pantalla como si se carga desde un archivo, la prepara Plaid o llega por la API. Se acabó perseguir una columna olvidada.

**«¿Qué no podemos recortar?»** La dimensión **Prioridad**: obligatoria, alta, media, baja. Es lo que estructura las decisiones en el comité. En Fromage & Co, nuestra empresa de ejemplo, las inversiones obligatorias suman 1,13 M€ de 2,34 M€ en 2026: la migración a S/4HANA, la renovación del centro de datos y la segmentación de la red de las plantas.

**«¿Cuánto cuesta este programa, todo incluido?»** Una dimensión **Programa**, creada en segundos, usada por igual en OPEX y CAPEX, con un valor por programa. El programa S/4HANA de Fromage & Co reúne 984.000 € de mantenimiento, contratistas y soporte en gasto operativo y 757.000 € de inversión (integración, desarrollo activado, servidores HANA): 1,74 M€ en el año, en un único informe. Cuando el programa termina, el valor se desactiva: se queda en las líneas y en los informes pasados, y deja de ofrecerse.

**«¿Qué tipo de gasto es?»** **Tipo de coste** y **Dominio TI**, del modelo TBM (Technology Business Management), compartidos por ambos tipos. Un valor puede reservarse a un tipo: el personal interno, por ejemplo, solo para OPEX.

![El panel Propiedades de una línea CAPEX: cuenta de inversión, Motivo, Prioridad y Programa rellenados](/screenshots/blog/opex-capex-line-properties-2026-10-17.png)

El vínculo con la contabilidad pasa por las cuentas, definidas por tipo, y por las cuentas de consolidación del grupo. Las dimensiones siguen siendo una herramienta de lectura y análisis: no tocan ni las cuentas ni las asignaciones.

TI gana una clasificación que se hace al introducir las líneas, y finanzas gana reglas que se aplican solas. Una dimensión puede renombrarse, reordenarse o recibir una fecha de fin de validez sin perder el historial, y el registro de auditoría guarda los cambios.

## Informes: Todo, OPEX o CAPEX

Ocho informes se abren con tres pestañas, **Todo**, **OPEX** y **CAPEX**: top líneas, top aumento y disminución, comparación presupuestaria, comparación de columnas presupuestarias, cuentas de consolidación, dimensiones analíticas, plantilla por mes y coste por ETC.

Los filtros se combinan: centro de coste, run o build, y un valor por dimensión. El CAPEX 2026 agrupado por motivo, el coste de un programa en la pestaña **Todo**, solo las inversiones obligatorias de una filial: cada vista lleva unos pocos clics.

![El informe Dimensiones analíticas sobre el CAPEX 2026 de Fromage & Co, agrupado por Motivo](/screenshots/blog/opex-capex-report-purpose-2026-10-17.png)

En el ejemplo, la sustitución representa el 59 % de la inversión 2026, el crecimiento el 35 % y la seguridad el 5 %. Es el tipo de cifra que da una visibilidad real, más aún cuando se puede comparar de un año a otro. Y aquí está, a un clic.

La dirección de la página guarda el tipo y los filtros. El enlace enviado al controller financiero abre exactamente la misma vista, y la exportación PDF muestra el mismo contenido. Los informes de contracargo también ofrecen OPEX, CAPEX o ambos. El CAPEX cuenta allí por su importe del año.

Por último, todos estos datos pueden alimentar informes a medida construidos por su herramienta de IA favorita, conectada directamente a KANAP.

## Cuando un gasto cambia de tipo

Un servicio resulta ser activable, una inversión vuelve a ser gasto operativo. En la línea, **Cambiar el tipo…** hace el cambio de forma limpia:

- **Desde el primer año de la línea**, la propia línea cambia de tipo. Conserva su referencia, presupuestos, asignaciones y vínculos.
- **Desde un año posterior**, la línea termina el 31 de diciembre del año anterior y conserva su historial. Una nueva línea del otro tipo toma el relevo, con los vínculos a aplicaciones, contratos y proyectos. Las dos líneas siguen conectadas: «Sustituida por» en un lado, «Sucede a» en el otro.

![La ventana Cambiar el tipo de una línea presupuestaria: año de inicio, cuenta y motivo](/screenshots/blog/opex-capex-change-type-2026-10-17.png)

La ventana propone una cuenta adecuada para el nuevo tipo y pide las dimensiones obligatorias de ese tipo cuando las hay. El motivo del cambio va al registro de auditoría. Un presupuesto congelado queda intacto: el cambio se rechaza mientras una columna congelada tenga importes en los años afectados.

## Lo que KANAP no hace

KANAP no calcula amortizaciones ni lleva el registro de activos fijos: eso es tarea de la contabilidad y del ERP. KANAP prepara y sigue el presupuesto de TI, OPEX y CAPEX, clasificado como lo pide finanzas.

## Por dónde empezar

1. **Parta de las preguntas de finanzas**: las que vuelven en cada revisión presupuestaria. Cada una se convertirá en una dimensión o en un filtro de un informe existente.
2. **Ajuste las dimensiones recomendadas**: cambie el nombre de lo que lo necesite, añada las que le falten (un Programa, por ejemplo), reserve a CAPEX lo que solo concierne a la inversión y haga obligatorias las dimensiones esenciales.
3. **Repase las líneas existentes** para rellenar las dimensiones aún vacías. Bajo cada dimensión obligatoria, KANAP cuenta las líneas sin valor y abre su lista con un clic.
4. **Compruebe el resultado en los informes** antes de la revisión: lo que sigue «Sin asignar» muestra lo que queda por clasificar.

Para ver todo esto sobre un presupuesto ya clasificado, una prueba gratuita de 14 días de nuestra versión alojada da acceso a los datos de ejemplo del grupo ficticio Fromage & Co, cargados en un minuto. KANAP es totalmente de código abierto: también puede instalarse gratis en sus propios servidores.
