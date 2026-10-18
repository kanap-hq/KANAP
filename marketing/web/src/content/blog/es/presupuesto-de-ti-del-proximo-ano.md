---
title: "Construir el presupuesto de TI del próximo año"
description: "El presupuesto del año siguiente a partir del aterrizaje previsto: copiar lo que no cambia, revisar la copia en la vista previa y retocar solo las líneas que importan."
date: 2026-08-30
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
updated: 2026-10-10
translationKey: opex-copy-budget-columns
series:
  key: opex-budget
  part: 2
  title: "Construir el presupuesto de TI"
---

La parte 1 fue una revisión selectiva: el aterrizaje 2026 refleja ya los principales movimientos y los grandes cambios de 2027 están registrados. Quedan todas las líneas en las que nada cambió. Buscarlas y volver a teclearlas una a una es el trabajo más ingrato de la temporada presupuestaria. En KANAP, es una herramienta y unos pocos clics.

## Las dos pasadas

En Gestión presupuestaria > Administración, abra «Copiar columnas presupuestarias». La pestaña Todas, la predeterminada, copia juntas las líneas OPEX y CAPEX. OPEX o CAPEX se limita a un tipo. La herramienta copia una columna de presupuesto en otra, de un año a otro, con un ajuste porcentual opcional.

Primera pasada: completar el aterrizaje 2026. Origen: Presupuesto 2026 (o Revisión, o Realizado, según su práctica; las copias se pueden encadenar, por ejemplo primero Realizado y luego Revisión). Destino: Aterrizaje previsto 2026. Las líneas revisadas en la parte 1 ya tienen un valor. La herramienta las omite y solo rellena las celdas vacías.

Segunda pasada: construir el presupuesto 2027. Origen: Aterrizaje previsto 2026. Destino: Presupuesto 2027, con un «Incremento porcentual» igual a la tasa que absorba sus subidas de precios. Sus entradas manuales de la parte 1 quedan intactas.

## Primero la vista previa

Su trabajo es valioso. Por eso **Copiar** sigue desactivado hasta que se haya ejecutado una vista previa. La vista previa enumera cada línea con su valor de origen, su valor actual de destino y el valor después de la copia. Las líneas ya rellenadas aparecen marcadas como «Omitida: el destino tiene importes»: no se modificarán. El interruptor «Sobrescribir datos existentes» cubre los casos deliberados. Déjelo desactivado salvo que lo quiera de verdad.

![La vista previa de una copia del aterrizaje previsto 2026 al presupuesto 2027, +3 %: valores de origen, valores tras la copia, una línea prorrateada y líneas no válidas en 2027.](/screenshots/blog/copy-budget-columns-2026-10-13.png)

Un banner resume la vista previa, y los totales bajo la tabla dan el origen, el destino actual y el total tras la copia. ¿Le sorprende una cifra? Todavía no se ha escrito nada. Ajuste, vuelva a lanzar la vista previa y copie.

La copia respeta también la validez de cada línea. Una línea que termina en junio de 2027 recibe solo seis meses y aparece como «Prorrateada» en la vista previa. Una línea no válida en 2027 queda fuera («No válida en 2027»).

## Líneas en cantidad × precio

En una línea calculada a partir de sus líneas de cantidad y precio (véase la parte 1), el porcentaje se aplica al precio unitario de cada línea, y el importe se deriva de ello. Las cantidades se mantienen, los periodos avanzan un año y cada mes se recalcula con los días laborables de 2027. Dos consultores a 650 € al día con +3 % pasan a ser dos consultores a 669,50 € al día en 2027, sobre un calendario que cuenta sus propios festivos.

Por eso el total puede diferir ligeramente de «origen + 3 %». Es intencionado: el año siguiente no tiene el mismo número de días laborables. Los ETC se recalculan de paso.

## Las asignaciones acompañan

Si practica el contracargo interno de TI, cada línea lleva su regla de asignación: plantilla, usuarios de TI, facturación o un reparto manual. Justo el tipo de cosa que se vuelve inmanejable en Excel. La misma copia las traslada: en **Qué copiar**, **Asignaciones** está marcado junto a **Importes** cuando los años son distintos. La segunda pasada lleva así las reglas a 2027 con las cifras, vista previa incluida. El «quién paga qué» sigue a las cifras sin volver a teclear nada.

## ¿Y el CAPEX?

Las columnas de presupuesto funcionan igual para las inversiones, y la copia también: misma herramienta, misma vista previa. En la pestaña Todas, las inversiones pasan al año siguiente junto con la operación en la misma ejecución. Un plan de inversiones se decide a menudo proyecto a proyecto, pero las inversiones recurrentes (renovación de hardware, actualización de los sistemas) se trasladan así en una sola pasada.

## Lo que viene

El presupuesto 2027 está completo: los cambios conocidos se introdujeron a mano y todo lo demás se trasladó con la inflación incluida. La parte 3 pasa a la presentación: los informes para la reunión de presupuesto, el contracargo por empresa y la congelación de las cifras aprobadas.
