---
title: "Dimensiones analíticas: lo que la seguridad cuesta realmente a TI"
description: "El contracargo dice quién paga. Una dimensión analítica dice para qué es el gasto: seguridad, nube, licencias. Cómo usarla en el presupuesto de TI."
date: 2026-09-13
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: analytics-dimensions-for-your-it-budget
---

A la pregunta «¿quién paga esta licencia?», las herramientas de contracargo responden sin dudar. Pero a la pregunta «¿cuánto nos cuesta la ciberseguridad, sumando todos los proveedores?», a menudo no tenemos respuesta.

Las dimensiones analíticas aportan esa segunda lectura. Cada dimensión es una forma de clasificar las líneas, con sus propios valores: lo que paga el dinero, la parte de TI a la que sirve, por qué se gasta. Un nuevo espacio de trabajo empieza con cuatro, todas opcionales.

## La mecánica en KANAP

### Las dimensiones y sus valores

Vaya a **Datos maestros > Dimensiones analíticas**. Una barra en la parte superior enumera las dimensiones. Haga clic en una para ver sus valores. Un nuevo espacio de trabajo incluye cuatro dimensiones recomendadas, cada una con valores y una descripción de una frase:

- **Tipo de coste**, la dimensión por defecto: lo que paga el dinero (Hardware, Software, Personal externo, Servicios externos...).
- **Dominio TI**: la parte de TI a la que sirve el gasto (Cómputo, Red, Puesto de trabajo, Aplicación, Seguridad y conformidad...).
- **Motivo**: por qué se gasta el dinero (Sustitución, Capacidad, Productividad, Seguridad, Conformidad, Crecimiento).
- **Prioridad**: Obligatoria, Alta, Media o Baja.

![La página Dimensiones analíticas: la barra de dimensiones con Tipo de coste seleccionado y sus ocho valores con sus descripciones](/screenshots/blog/analytics-dimensions-2026-10-13.png)

Los tipos de coste y los dominios TI siguen el modelo TBM (Technology Business Management). Cambie el nombre, reordene o desactive lo que no encaje. Un espacio de trabajo creado antes los añade con **Dimensiones recomendadas**. **Nueva dimensión** crea una dimensión propia, y **Nuevo valor** añade un valor a la seleccionada.

De cinco a diez valores amplios por dimensión suelen bastar. A partir de veinte, la dimensión intenta responder a demasiadas preguntas: divídala en dos. La descripción es sobre todo para sus compañeros: «Contratistas y consultores facturados por su tiempo» se lee mejor que «Ext.»

### Clasificar una línea

En el panel **Propiedades** de una línea presupuestaria, cada dimensión tiene su propio campo, por ejemplo **Tipo de coste** o **Dominio TI**. Elija un valor o déjelo vacío para «Sin asignar». El valor se aplica a toda la línea, en todos los ejercicios fiscales.

![El panel Propiedades de una línea presupuestaria: Hardware en Tipo de coste, Cómputo en Dominio TI, Sustitución en Motivo y Obligatoria en Prioridad](/screenshots/blog/analytics-line-properties-2026-10-13.png)

Una línea tiene un valor por dimensión: **Software** en Tipo de coste y **Aplicación** en Dominio TI al mismo tiempo. Cada dimensión responde a una pregunta, y el informe las cruza.

Dos puntos a tener en cuenta:

- **Ningún impacto en las asignaciones**, ni en la contabilidad formal. La empresa pagadora, la cuenta y los criterios de asignación no cambian. Las dimensiones analíticas sirven solo para los informes.
- **Departamentos y dimensiones no juegan en la misma liga.** Los departamentos son unidades organizativas formales con criterios de asignación precisos. Las dimensiones analíticas son clasificaciones informales y opcionales, sin carga de asignación.

Para retirar un valor o una dimensión, desactívelo: las líneas conservan su valor y los informes pasados siguen siendo exactos. También se puede eliminar, tras una confirmación que cuenta las líneas que pierden su valor.

En la lista de líneas presupuestarias, cada dimensión tiene su propia columna opcional. Permite repasar de un vistazo todas las líneas de un valor: «¿Qué líneas son Personal externo?».

## El informe Presupuesto por dimensión analítica

El informe está en **Informes > Dimensiones analíticas**.

- **Tipo de línea**: todas las líneas, OPEX o CAPEX.
- **Dimensión**: la dimensión por la que agrupar, Tipo de coste para empezar.
- **Un solo año**: gráfico circular o de barras horizontales, a elegir.
- **Varios años**: un gráfico de líneas, una línea por valor.
- **Métrica**: cualquier columna de presupuesto visible (presupuesto, revisión, realizado, aterrizaje previsto).
- **Excluir valores**: para centrarse en un subconjunto.
- **Resultados**: tabla resumen, exportación CSV de la tabla, PNG del gráfico, PDF completo.

![El informe de 2026: 12,1 M EUR de presupuesto OPEX repartidos entre los valores de Tipo de coste](/screenshots/blog/analytics-report-2026-10-13.png)

En el ejercicio 2026, el personal externo se lleva por sí solo el 54 % del presupuesto OPEX. Le siguen el software con el 26 % y los servicios externos con el 11 %.

En la vista de varios años, el informe se convierte en una herramienta de tendencias. Una línea se dispara, otra se apaga, y la decisión se discute sobre hechos.

![El mismo informe de 2025 a 2026: una línea por valor de Tipo de coste](/screenshots/blog/analytics-report-range-2026-10-13.png)

«Sin asignar» es un estado válido. Los valores son opcionales, y una línea sin valor aparece simplemente en esa línea del informe.

<aside class="tip">
  <b>Consejo</b>
  <p>El informe se exporta en PDF y puede presentarse tal cual en una revisión presupuestaria. Junto con los informes de contracargo, tiene a mano todas las facetas de su presupuesto.</p>
</aside>

## Costes ocultos

El gráfico circular saca a la luz lo que las líneas del «top 10» esconden. El valor que ha crecido demasiado para ser honesto. Dos valores que describen casi lo mismo y que convendría fusionar. El motivo Capacidad que empieza en cero en 2025, rastro de una línea añadida por el camino. O RR. HH., en la dimensión Área de negocio, que pasa de 468.500 EUR a 574.570 EUR en un año (+23 %), mientras el presupuesto OPEX crece un 13 %.

Aquí es también donde se cruzan las dos lecturas. Seguridad y conformidad, en Dominio TI, representa el 8 % del presupuesto OPEX. El informe de contracargo dice qué filial lo soporta. El CIO tiene entonces una frase corta y verificable para la revisión presupuestaria: esto es lo que gastamos, para qué, y quién lo paga.

## ¿Y el CAPEX?

Las dimensiones se aplican por igual a las líneas OPEX y CAPEX, salvo que reserve una a un solo tipo. Un proyecto de inversión se lee así con el vocabulario del gasto recurrente, y los dos presupuestos siguen siendo comparables.

Esa es la ventaja de una nomenclatura común: la pregunta «¿cuánto cuesta la seguridad?» se formula igual para una licencia recurrente que para un proyecto de equipamiento.

## Por dónde empezar

1. Revise las cuatro dimensiones recomendadas y cambie el nombre de los valores que no necesite o desactívelos.
2. Clasifique primero las diez líneas de mayor peso. El informe empieza a ser útil en ese paso.
3. Deje el resto en «Sin asignar» y clasifique sobre la marcha.
4. Cruce el informe con los informes de contracargo: quién paga por un lado, para qué por el otro.
5. Vuelva a ejecutar el informe en cada revisión presupuestaria. Divida un valor demasiado amplio, fusione dos demasiado finos.

Las dimensiones analíticas complementan la asignación de los costes de TI (véase [Contracargo de costes de TI: quién paga qué y por qué](/es/blog/contracargo-de-costes-de-ti)) y le dan la visibilidad que necesita para preparar, analizar y defender su presupuesto.
