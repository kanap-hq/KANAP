---
title: "El aterrizaje previsto del presupuesto de TI, línea a línea"
description: "Afinar el aterrizaje previsto del presupuesto de TI del año en curso, línea a línea, para que sea una base sólida del presupuesto del año siguiente."
date: 2026-08-29
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
updated: 2026-10-10
translationKey: opex-expected-landing
series:
  key: opex-budget
  part: 1
  title: "Construir el presupuesto de TI"
---

Septiembre. Finanzas pide una primera versión del presupuesto 2027, y el Excel del año pasado sale del cajón: doscientas líneas, ocho pestañas, tres versiones que ya no coinciden. ¿Otra vez lo mismo?

Esta serie recorre la preparación de un presupuesto OPEX completo en KANAP. Parte 1: hacer fiable el aterrizaje del año en curso. Parte 2: trasladar las cifras a 2027. Parte 3: presentar, defender, cerrar. El principio se mantiene de principio a fin: usted solo toca lo que cambia y KANAP se ocupa del resto, presentación incluida.

¿Sus líneas siguen en Excel? «Importar CSV» las carga de una vez y la revisión empieza el mismo día. KANAP comprueba el archivo completo antes de escribir nada y después escribe solo las celdas que cambiaron. El ir y venir con la hoja de cálculo sigue abierto durante toda la revisión.

## El aterrizaje previsto, la columna que importa

Cada línea presupuestaria (`BL-12`, `BL-47`...) tiene cinco columnas de presupuesto por año: **Presupuesto**, **Revisión**, **Previsión**, **Realizado** y **Aterrizaje previsto**, para el año pasado, el año en curso y los dos siguientes. ¿Sus rondas presupuestarias tienen nombre propio, A0, A1 o «reprevisión de junio»? Cambie el nombre de las columnas, oculte las que no use y elija la columna por defecto: la que ordena las listas y la que los informes preseleccionan. En esta etapa se trata de saber dónde y cómo terminará el año en curso. Es el momento de anotar su mejor estimación de lo que cada línea habrá costado realmente a 31 de diciembre.

También es la base del presupuesto del año siguiente: un aterrizaje cuidado evita arrastrar a enero importes que ya cambiaron durante el año.

## Filtrar como en Excel

Nadie revisa doscientas líneas de una sola vez. La lista de líneas presupuestarias se maneja como una hoja de cálculo: un filtro rápido arriba y filtros con casillas en cada columna. Tipo, Empresa pagadora, Cuenta, Centro de coste, Asignación, Moneda, Responsable IT, Responsable de negocio, dimensiones analíticas: marque algunas casillas, la lista se reduce y la fila de totales se recalcula sobre la selección.

![La lista de líneas presupuestarias filtrada por dos cuentas de software. La fila Total sigue la selección: 21 líneas.](/screenshots/blog/budget-lines-filters-2026-10-13.png)

La revisión se reparte entonces de forma natural: los servicios una mañana, las licencias al día siguiente y después las líneas de una filial. Los filtros se guardan en la URL. Abra una línea, vuelva, y la selección sigue en su sitio.

¿Tiene prisa? Ordene por importe y repase las 20 líneas más grandes, que suelen concentrar la mayor parte del presupuesto.

## Recorrer la selección, línea a línea

Abra la primera línea de la selección, pestaña **Presupuesto**. Las flechas de anterior y siguiente indican «3 de 21» y siguen su lista filtrada, en su orden. Avanza línea a línea y corrige el aterrizaje solo donde la realidad se ha desviado: un contrato renegociado, un proyecto retrasado, un consumo de nube por encima de lo previsto.

![La pestaña Presupuesto de una línea presupuestaria: una tarjeta por columna, el editor de importe y el resultado mensual, con «3 de 21» para recorrer la selección.](/screenshots/blog/budget-tab-2026-10-13.png)

Para las líneas que merecen algo más que un importe anual, elija la tarjeta de la columna e indique cómo se construye: **Importe** (año completo, un periodo o en una fecha, lineal o 4-4-5), **Cantidad y precio** o **Por mes**.

Una columna vacía puede **Partir de** otra, ajustada con un porcentaje. ¿Ha cambiado de opinión? **Volver a los valores de apertura** restaura las columnas editadas.

> Las líneas en las que nada se ha movido se quedan vacías. La parte 2 las rellena todas a la vez.

## Servicios por tiempo y materiales: cantidad × precio

Para contratistas, una cuota mensual fija o licencias por unidad, un importe anual dice poco. En la pestaña Presupuesto, «Cantidad y precio» descompone el importe en líneas: una cantidad, una unidad (personas, días o unidades), un precio unitario y un periodo.

![Una línea de contratista construida con cantidad × precio: 2 personas a tiempo completo a 470 € al día durante 218 días laborables, 2 ETC en el año.](/screenshots/blog/budget-quantity-price-2026-10-13.png)

Dos consultores a 650 € al día, a tiempo completo de marzo a diciembre: KANAP calcula cada mes a partir de los días laborables del calendario del país de la empresa pagadora, sin los festivos. Si la misión termina en octubre o la tarifa diaria se renegoció, cambie la fecha o el precio y el aterrizaje se recalcula. Se acabó rehacer la multiplicación a mano.

Los calendarios están en Datos maestros > Calendarios laborales. El calendario estándar de un país se crea junto con la empresa. Un calendario propio cubre una planta que cierra tres semanas en agosto.

De paso, cada línea en personas o días declara sus ETC (equivalentes a tiempo completo). La parte 3 los usa para responder a «¿cuántas personas y a qué coste?».

## Ya que está: anote lo que ya sabe de 2027

La pestaña del año 2027 está justo al lado. Aproveche la revisión para introducir los cambios ya decididos: una ampliación de alcance, una renegociación, una rescisión... Para los vencimientos de contratos no hace falta tirar de memoria: cada línea muestra su contrato, y cada contrato lleva su plazo de cancelación. Los plazos de 2027 se leen en la lista de contratos.

Use también las notas: una línea breve («+10 % en el T3, renegociación en curso») y dentro de seis meses se lo agradecerá.

Estos importes introducidos a mano están a salvo: la copia automática de la parte 2 solo rellena celdas vacías.

## Consejo práctico: primero las monedas

KANAP gestiona presupuestos en varias monedas, pero configúrelas antes. En Gestión presupuestaria → Administración → **Monedas**, defina la moneda de informes, las monedas por defecto de OPEX y CAPEX y la lista de monedas permitidas. Los tipos de cambio se sincronizan automáticamente por ejercicio fiscal y se congelan cuando usted congela la columna de presupuesto por defecto. Cada línea conserva su moneda. Los totales y los informes convierten a la moneda de informes.

![Los ajustes de monedas: moneda de informes, monedas por defecto, monedas permitidas y los tipos de cambio de 2025 a 2027.](/screenshots/budget-currency-2026-10-13.png)

## ¿Y el CAPEX?

Todo lo anterior se aplica a las inversiones: las líneas CAPEX están en la misma lista, con las mismas columnas, filtros y navegación. Marque CAPEX en el filtro Tipo o revise ambos a la vez. La parte 3 muestra los dos presupuestos uno al lado del otro.

## Lo que viene

Al terminar esta revisión, el aterrizaje 2026 es fiable en las líneas que se han movido y los grandes cambios de 2027 ya están anotados. En la parte 2 rellenamos todo lo demás en tres clics.
