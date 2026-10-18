---
title: "Presentar el presupuesto de TI para su aprobación"
description: "Los informes que hacen pasar un presupuesto de TI por el comité: cifras clave, tendencias, contracargo y, al final, la congelación de la versión aprobada."
date: 2026-08-31
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
updated: 2026-10-10
translationKey: opex-budget-reporting
series:
  key: opex-budget
  part: 3
  title: "Construir el presupuesto de TI"
---

El presupuesto está construido, falta que lo aprueben. KANAP facilita la presentación con informes configurables que muestran las distintas facetas del presupuesto de forma visual y práctica. Una vez aprobado el presupuesto, KANAP bloquea las columnas afectadas para que nada se mueva después.

## Informes listos para usar

La sección Informes ofrece diez informes preconfigurados, cada uno con una tabla resumen, un gráfico y exportaciones. Nada que construir: usted elige y ejecuta. ¿Una línea le extraña? En los informes de tipo top, el nombre de una línea la abre en una pestaña nueva. En los informes agrupados, el nombre de un grupo abre la lista de las líneas que contiene.

![La página Informes: los diez informes de presupuesto preconfigurados, de Contracargo global a Coste por ETC.](/screenshots/blog/reporting-landing-2026-10-13.png)

## ¿Dónde aterrizamos y qué sube?

«Comparación de columnas presupuestarias» pone uno al lado del otro Presupuesto 2026, Aterrizaje previsto 2026 y Presupuesto 2027. La diferencia entre presupuesto y aterrizaje mide la calidad de la previsión. La diferencia entre el aterrizaje y 2027, el esfuerzo que se pide para el año siguiente.

«Top aumento / disminución» nombra después las líneas que explican la diferencia. A menudo es la diapositiva más interesante de la presentación.

![El mismo informe un año antes: los 10 mayores aumentos OPEX entre el aterrizaje previsto 2025 y el presupuesto 2026.](/screenshots/blog/top-increase-2026-10-13.png)

Por último, «Top líneas» muestra de un vistazo las líneas más grandes de su presupuesto, que es donde suele decidirse.

Estos informes, y los demás que irá descubriendo, son totalmente configurables y producen rápidamente cifras y gráficos sólidos para respaldar su presentación del presupuesto.

## ¿Cuántas personas y a qué coste?

En el comité siempre sale la pregunta de los contratistas. Las líneas en cantidad × precio de la parte 1 la responden sin trabajo adicional.

«Plantilla por mes» muestra los ETC mes a mes, agrupados por centro de coste, proveedor, línea o dimensión analítica, con la media y el pico del año. «Coste por ETC» compara hasta cuatro columnas una al lado de otra, por ejemplo el aterrizaje 2026 y el presupuesto 2027, y pasa a la tarifa diaria con un clic. Si el equipo externo baja de 12 a 9 ETC mientras la tarifa diaria media sube un 6 %, la frase se lee directamente en la tabla.

![Coste OPEX por ETC por proveedor, con el presupuesto 2026 y el aterrizaje previsto 2026 uno al lado del otro.](/screenshots/blog/cost-per-fte-2026-10-13.png)

Los informes de presupuesto tienen además un selector «Medida»: Importe o ETC. Los mayores aumentos, las comparaciones presupuestarias y las comparaciones de columnas se leen entonces en personas.

## ¿Quién paga qué?

«Contracargo global» y «Contracargo por empresa» convierten las asignaciones de la parte 2 en totales por empresa y/o departamento, según las métricas elegidas (plantilla, facturación, etc.). Ambos informes se abren en OPEX y pueden incluir líneas CAPEX. ¿Alguna vez le han preguntado «¿cuánto nos cuesta la informática del departamento X?»? Esta vez la respuesta está lista: en valor absoluto, en porcentaje y por usuario.

Aunque su empresa no repercuta costes, estos informes son una mina de oro para detectar los costes ocultos de TI y para mostrar a la dirección el coste de soluciones de nicho que quedan invisibles en el top 10 del presupuesto.

## En la estructura de finanzas

Finanzas lee el presupuesto a través de su propio plan de cuentas. «Cuentas de consolidación» agrupa el presupuesto por cuenta del plan de consolidación, sea cual sea la empresa y su plan de cuentas local. Las cifras que usted presenta son las que los controllers encontrarán en sus propias tablas.

«Dimensiones analíticas» ofrece otra lectura: el reparto por naturaleza, por dominio o por cualquier otra dimensión que haya definido. Véase [Dimensiones analíticas: lo que la seguridad cuesta realmente a TI](/es/blog/dimensiones-analiticas-del-presupuesto-de-ti).

## OPEX y CAPEX, uno al lado del otro

La mayoría de los informes se abren en Todas las líneas, con las pestañas OPEX y CAPEX, y «Comparación presupuestaria» cubre todo el presupuesto o un tipo. La operación y las inversiones se presentan en la misma reunión, con las mismas herramientas y las mismas exportaciones.

## Exportar

Todos los informes se exportan: la tabla en CSV, el gráfico en PNG, la página completa en PDF. La presentación se arma sin capturas de pantalla, e incluso puede ajustar un informe en directo para responder a preguntas sobre la marcha.

Y para la pregunta que ningún informe había previsto, Plaid, el agente IA integrado, consulta los mismos datos en lenguaje natural: «total del presupuesto 2027 por proveedor», «ETC presupuestados por centro de coste». La respuesta nombra las líneas por su referencia (`BL-12`, `BL-3`), que usted encuentra en la lista al instante.

## La fase de revisión

Un presupuesto rara vez se aprueba a la primera. Para eso está la columna Revisión: introduzca allí las versiones de trabajo de las líneas recortadas (o, quién sabe, reforzadas) y después rellene las celdas vacías a partir del presupuesto, con la misma mecánica que en la parte 2.

En unos pocos clics construye una variante completa del presupuesto, que una vez aprobada se puede copiar (esta vez sobrescribiendo) en la columna Presupuesto.

## Cerrar

¿Presupuesto aprobado? En Administración, «Congelar / descongelar datos» bloquea columnas. Congele la columna Presupuesto 2027, OPEX y CAPEX. Las columnas congeladas pasan a ser de solo lectura en todas partes: introducción de datos, importaciones CSV, copias. Las cifras aprobadas en el comité ya no se moverán y se convierten en la referencia del siguiente ciclo. Congelar la columna por defecto congela también los tipos de cambio del año: los importes convertidos a la moneda de informes tampoco se moverán.

En tres partes hemos recorrido un ciclo presupuestario completo: un aterrizaje fiable, el presupuesto 2027, las cifras clave y la presentación, la revisión y el cierre.

Todo está listo para el siguiente ciclo.
