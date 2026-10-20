---
title: "Gestionar las monedas en el presupuesto de TI"
description: "Cada uno introduce los importes en su moneda, KANAP los consolida en la del grupo: tipos de cambio automáticos, alineables con sus tipos presupuestarios, y totales siempre correctos."
date: 2026-10-20
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: managing-currencies-it-budget
series:
  key: opex-budget
  part: 7
  title: "Construir el presupuesto de TI"
---

Una filial estadounidense paga sus licencias en dólares. La sede firma una suscripción SaaS facturada en dólares y un soporte del fabricante en francos suizos. Y el presupuesto de TI del grupo se presenta en euros.

En una hoja de cálculo, eso significa una hoja de tipos en un rincón del libro, fórmulas de conversión copiadas línea tras línea y una pregunta que vuelve en cada presentación: ¿qué tipo hemos usado?

En KANAP, cada uno introduce el presupuesto en la moneda de su factura. Todo se consolida, de forma automática y limpia, en la moneda de referencia del grupo. Los tipos de cambio se gestionan solos y se alinean con los del control de gestión cuando usted lo desee.

## Todos los ajustes en una página

Todo ocurre en **Gestión presupuestaria › Administración › Monedas**.

- **La moneda de reporte**: aquella en la que consolida el grupo. Listas, totales e informes se muestran en esa moneda.
- **Las monedas predeterminadas**, una para OPEX y otra para CAPEX: se proponen al crear una línea, sin limitar la elección.
- **Las monedas permitidas**, si quiere restringir la lista. Déjela vacía salvo que tenga un motivo concreto: entonces se acepta cualquier código ISO válido.

La moneda de reporte se elige una vez. Puede cambiar más adelante: una ventana explica entonces lo que implica el cambio antes de aplicarlo, y los importes introducidos no se mueven.

![La página Monedas de Fromage & Co: moneda de reporte, monedas predeterminadas y monedas permitidas, y debajo la tabla de tipos por año con su fuente](/screenshots/blog/currency-settings-2026-10-20.png)

## Cada uno introduce los importes en su moneda

Quien prepara una línea presupuestaria la introduce en la moneda de la factura que recibirá. Sin conversión que hacer ni tipo que buscar: elige la moneda en el formulario, y nada más.

Esto vale para toda la gestión presupuestaria:

- **Las líneas presupuestarias**: cada una tiene su moneda. En Fromage & Co, nuestra empresa de ejemplo, la filial estadounidense presupuesta en dólares sus servicios gestionados de TI, su plataforma de comercio electrónico y sus contratistas, junto a las líneas en euros de la sede.
- **Los contratos**: un contrato firmado en moneda extranjera conserva su moneda. Una suscripción SaaS facturada en dólares a la sociedad francesa, un soporte facturado en francos suizos: el importe del contrato sigue siendo el de la firma, y su compromiso se compara con el presupuesto en la moneda de reporte.
- **Las sociedades**: cada una tiene su moneda base, y su facturación se introduce en millones de esa moneda, por ejemplo 35 M USD para Fromage & Co Inc.

Los importes se guardan tal como se introdujeron. Las exportaciones CSV conservan la moneda de cada línea: el archivo se reimporta o se analiza sin conversión que deshacer.

![Las líneas presupuestarias filtradas en Fromage & Co Inc.: cada línea introducida en dólares, importes y total mostrados en euros](/screenshots/blog/currency-us-lines-2026-10-20.png)

## Todo se consolida en la moneda del grupo

KANAP convierte al mostrar, cada año al tipo de ese año. Nadie tiene que escribir fórmulas ni mantener una columna de «contravalor».

- **La lista de líneas presupuestarias**: la columna Moneda conserva la moneda de cada línea, los importes y la fila de totales se muestran en la moneda de reporte, y los totales se recalculan con cada filtro.
- **La vista general y los diez informes presupuestarios** se muestran en la moneda de reporte.
- **Los contratos**: compromiso, presupuesto vinculado y desviación se comparan en la misma moneda.
- **La refacturación**: la facturación de cada sociedad se convierte antes de servir de clave de reparto. Un reparto entre Francia y Estados Unidos compara por fin euros con euros. Vea [el artículo sobre la refacturación](/es/blog/contracargo-de-costes-de-ti).

Y si el grupo cambia algún día de moneda de consolidación, basta con cambiar la moneda de reporte: todo se vuelve a convertir sin tocar una sola línea.

## Tipos actualizados automáticamente

Por defecto, no tiene nada que hacer. KANAP obtiene un tipo por moneda y por año para todas las monedas en uso, y los actualiza cada 30 días.

- **Años pasados**: las medias anuales del Banco Mundial. Hasta su publicación, el año publicado más cercano, marcado como estimación.
- **Año en curso**: el tipo del día.
- **Años futuros**: el tipo del año en curso, retomado como estimación para preparar el presupuesto.

La tabla de tipos, debajo de los ajustes, muestra cada tipo y su fuente. Antes de un comité, el botón **Forzar sincronización de tipos de cambio** los actualiza al momento e indica lo que ha obtenido.

## Sus tipos presupuestarios, si los tiene

Muchos grupos fijan sus propios tipos para el ejercicio: los tipos presupuestarios del control de gestión o de tesorería. El presupuesto de TI debe entonces hablar el mismo idioma que el resto del grupo.

**Introducir un tipo a mano.** En la tabla de tipos, un clic en una celda abre la ventana **Tipo de cambio manual**: introduce el tipo de su control de gestión para esa moneda y ese año. Sustituye al tipo automático hasta que usted lo retire, se marca con un asterisco en la tabla, y cada entrada queda registrada en el registro de auditoría.

**Congelar los tipos con el presupuesto.** Una vez aprobado el presupuesto, congelar su columna predeterminada congela también los tipos del año. Los importes siguen convertidos con el juego de tipos de la congelación, aunque lleguen tipos más recientes. Un presupuesto aprobado con un dólar a 0,92 € no cambia en junio porque el dólar se haya movido. Vea [el artículo sobre el reporting](/es/blog/presentar-el-presupuesto-de-ti).

![La ventana Tipo de cambio manual: el tipo en euros por un dólar, con el tipo automático del año vecino como referencia](/screenshots/blog/currency-manual-rate-2026-10-20.png)

## Errores y carencias a la vista

A veces falta un tipo: una moneda poco habitual, o un año pasado que las fuentes aún no han publicado. Una hoja de cálculo suele contar entonces el importe a 1, y 100 000 dólares se convierten en 100 000 euros sin que nadie lo vea.

KANAP nunca hace eso. El importe se excluye de los totales del año, y la pantalla lo dice: «Se excluyen 3 líneas sin tipo de cambio: USD 2026», bajo los totales de la lista, en la vista general, en la parte superior de los informes, en los contratos. En la propia línea, el importe se muestra entonces en su propia moneda, con una marca naranja.

KANAP busca el tipo en segundo plano, y la siguiente visualización lo usa en cuanto una fuente lo publica. Si ninguna lo publica, la página Monedas lista los tipos que faltan, y un tipo manual resuelve la cuestión al instante.

![La lista de líneas presupuestarias con una línea sin tipo de cambio: el aviso bajo los totales y la marca naranja en la línea](/screenshots/blog/currency-missing-rate-2026-10-20.png)

## Por dónde empezar

1. **Elija la moneda de reporte**: aquella en la que consolida el grupo.
2. **Dé su moneda a cada sociedad**, y después introduzca líneas y contratos en la moneda de su factura.
3. **Si su control de gestión tiene tipos presupuestarios**, introdúzcalos para el año que está preparando.
4. **Congele la columna de presupuesto** una vez aprobado el presupuesto: sus tipos quedan congelados con ella.

Para ver todo esto sobre un presupuesto ya introducido, una prueba gratuita de 14 días de nuestra versión alojada da acceso a los datos de ejemplo del grupo ficticio Fromage & Co, cargados en un minuto. KANAP es totalmente de código abierto: también puede instalarse gratis en sus propios servidores.
