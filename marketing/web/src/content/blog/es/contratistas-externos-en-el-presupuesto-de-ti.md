---
title: "ETC y tarifas diarias: los contratistas externos en el presupuesto de TI"
description: "Presupueste un servicio como lo compra, en personas, días y precios: KANAP deduce los ETC, el coste por ETC y la tarifa diaria, listos para el comité."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: it-contractors-fte-daily-rate
series:
  key: opex-budget
  part: 5
  title: "Construir el presupuesto de TI"
---

En temporada de presupuestos la pregunta siempre aparece: ¿cuántos contratistas paga TI, a qué coste y qué cambia el año que viene? A menudo la respuesta está en una hoja de cálculo, a veces solo en los contratos firmados o en un seguimiento paralelo que lleva compras. Y nunca cuadra del todo con el presupuesto.

En KANAP basta con una sola entrada. Usted presupuesta un servicio como lo compra: personas o días, un precio, un periodo. KANAP deduce el importe de cada mes, los ETC, el coste por ETC y la tarifa diaria.

## ETC, coste por ETC, tarifa diaria

- **ETC** (equivalentes a tiempo completo) indica cuántas personas paga el presupuesto. Un consultor a tiempo completo todo el año cuenta como 1 ETC. De febrero a octubre, cuenta como 0,75 en el año.
- **El coste por ETC** es el coste anual medio de una persona a tiempo completo.
- **La tarifa diaria media** es el coste de los servicios con precio por día dividido entre los días comprados.

KANAP ofrece dos lecturas de los ETC. La **media anual** alimenta los informes y las comparaciones de un año a otro. Los **ETC en el periodo** indican cuántas personas trabajan durante la misión: nuestro consultor de febrero a octubre cuenta como 1.

Este artículo trata de los recursos externos: refuerzo de personal, asistencia técnica, bolsas de días. Es ahí donde el presupuesto de TI se construye en personas y días, y donde se concentran las preguntas del comité.

## La introducción de datos: cada línea se lee como una frase

En la pestaña Presupuesto de una línea presupuestaria, cada columna (Presupuesto, Aterrizaje previsto, Revisión…) puede construirse con **Cantidad y precio**. Una línea se lee como una frase: una cantidad, una unidad (personas, días o unidades), un precio, una frecuencia, un periodo y un calendario. Los importes de cada mes son la suma de las líneas. Algunos casos habituales:

**Refuerzo a tiempo completo.** Dos desarrolladores SAP a 480 € al día, a tiempo completo todo el año. Cada mes cuenta sus días laborables: con un calendario de 218 días, la línea cuesta 209.280 € y cuenta como 2 ETC.

**Tiempo parcial.** Un jefe de proyecto 5 días al mes a 1.200 € al día, de febrero a julio: 6.000 € al mes. KANAP relaciona esos 5 días con los días laborables de cada mes, algo más de un cuarto de jornada completa durante la misión, y la mitad de eso en el año.

**Una bolsa de días.** 30 días de experto comprados para el mismo periodo, a 1.200 € al día: 36.000 €, repartidos entre los meses del periodo y convertidos en ETC de la misma forma.

**Altas y bajas.** Cada línea tiene su propio periodo. En Fromage & Co, nuestra empresa de ejemplo, el arquitecto de integración a 950 € al día estaba previsto para febrero en el presupuesto. Llega en abril: usted mueve la fecha de inicio en el aterrizaje previsto y KANAP recalcula el importe y los ETC del año, 0,92 en el presupuesto y 0,75 en el aterrizaje.

El resultado aparece mientras escribe: el importe de cada mes y los ETC bajo las líneas. En el ejemplo de abajo, los dos desarrolladores, el jefe de proyecto y la bolsa de días suman 281.280 € y 2,28 ETC, y la tarjeta de la columna lo resume: «Cantidad y precio · 3 líneas · 2,28 ETC». **Usar también para otras columnas** lleva las mismas líneas al aterrizaje o a la revisión, que entonces solo hay que ajustar.

![La pestaña Cantidad y precio de una línea presupuestaria: refuerzo a tiempo completo, un rol a tiempo parcial en días al mes y una bolsa de días, con los ETC bajo las líneas](/screenshots/blog/fte-quantity-price-2026-10-18.png)

## Calendarios: exactos al día

Un servicio con precio por día cuesta el número de días realmente pagados. El calendario laboral dice cuántos, mes a mes.

El calendario estándar de un país se crea con la empresa: días de semana, menos los festivos. No hay nada que introducir. Una nueva línea toma el calendario del país de la empresa pagadora.

Un calendario propio cubre los casos especiales. Fromage & Co tiene dos. **218 working days** sigue el ritmo de un consultor con contrato por días, con las vacaciones repartidas a lo largo del año. **No leave** cuenta cada día laborable, para un servicio facturado por día realmente trabajado. Y, por supuesto, puede crear sus propios calendarios, colocar en ellos las vacaciones, etc.

![Los calendarios laborales de Fromage & Co: los calendarios estándar de cuatro países y dos calendarios propios](/screenshots/blog/fte-calendars-2026-10-18.png)

## El presupuesto en ETC, en la lista

La lista de líneas presupuestarias muestra una columna de ETC por cada columna de presupuesto y cada año, justo después de los importes. Se ordena y se filtra como las demás. El pie de la columna da el total y señala las líneas sin ETC: «3,50 · 12 desconocidas».

La columna **ETC declarados** aísla las líneas de servicios con un clic. Ve entonces, una al lado de otra, lo que cuesta cada servicio y cuántas personas paga, en el presupuesto y en el aterrizaje.

Para el año siguiente, la copia de las columnas de presupuesto hace el trabajo: las cantidades se mantienen, los precios suben el porcentaje elegido, los periodos avanzan un año y cada mes se recalcula con los días laborables del nuevo año. Los ETC acompañan (los detalles están en [Construir el presupuesto de TI del próximo año](/es/blog/presupuesto-de-ti-del-proximo-ano)).

![Las líneas presupuestarias de Fromage & Co, filtradas por las líneas con ETC, con las columnas de ETC del presupuesto y del aterrizaje 2026](/screenshots/blog/fte-budget-lines-2026-10-18.png)

## Informes: cuántas personas y a qué coste

Todo lo anterior alimenta directamente los informes. Nada que preparar.

**Plantilla por mes** muestra los ETC mes a mes, agrupados por centro de coste, proveedor, línea o dimensión analítica. La tabla da la media del año y el pico. Se lee la subida de carga de un proyecto, el mes en que el equipo externo es más grande y el peso de cada proveedor.

![El informe Plantilla por mes sobre el presupuesto 2026 de Fromage & Co, agrupado por proveedor](/screenshots/blog/fte-staffing-by-month-2026-10-18.png)

En Fromage & Co, el equipo externo tiene una media de 46 ETC en el presupuesto 2026, con un pico de 48 en mayo y junio.

**Coste por ETC** pone hasta cuatro columnas una al lado de otra, por ejemplo el presupuesto y el aterrizaje previsto, o el aterrizaje de este año y el presupuesto del siguiente. Para cada grupo: los ETC, el coste y el coste por ETC. **Mostrar > Tarifa diaria** pasa a la tarifa diaria media con un clic, ponderada por los días comprados. Un proveedor cuya tarifa diaria sube, un equipo que crece mientras el coste por ETC se mantiene: se ve al instante.

![El informe Coste por ETC de Fromage & Co, presupuesto y aterrizaje previsto 2026 uno al lado del otro, por proveedor](/screenshots/blog/fte-cost-per-fte-2026-10-18.png)

El presupuesto 2026 de Fromage & Co paga así 46,17 ETC de contratistas por 6,68 M€, es decir 144.670 € por ETC, y 145.197 € en el aterrizaje. Las diferencias entre proveedores saltan a la vista: 100.716 € por ETC para el equipo nearshore de Lisboa, cerca de 180.000 € para los expertos en infraestructura de Alpine Data Experts.

Los demás informes de presupuesto tienen un selector **Medida**: Importe o ETC. Los mayores aumentos, la comparación presupuestaria o las dimensiones analíticas se leen entonces en personas. El filtro **Líneas con ETC** compara además los importes presupuestados y realizados solo de las líneas de servicios.

Las pestañas **Todo**, **OPEX** y **CAPEX** y los filtros por dimensión también se aplican aquí: el coste por ETC del desarrollo activado, o el de un programa (véase [OPEX y CAPEX: el presupuesto de TI, listo para la revisión con finanzas](/es/blog/opex-y-capex-en-el-presupuesto-de-ti)).

Cada cifra se puede justificar. El nombre de un grupo abre la lista de sus líneas. Un aviso señala cuando el importe de una columna ya no sigue a sus líneas de cantidad y precio. El enlace de la página conserva todos los ajustes, y la tabla se exporta en CSV, el gráfico en PNG y la página en PDF.

## ¿Y los equipos internos?

Hoy, KANAP sigue los ETC externos. Una versión futura incorporará por separado el tiempo de los recursos internos, para leer personal interno y contratistas uno al lado del otro.

Mientras tanto, el tiempo interno ya puede valorarse de forma sencilla: una línea por perfil, con su tarifa diaria, en la línea presupuestaria del proyecto o servicio afectado. Un coste medio por perfil basta para dirigir y evita exponer los salarios individuales a cualquier lector del presupuesto.

## Lo que KANAP no hace

KANAP no es ni un sistema de información de recursos humanos ni una herramienta de nóminas, y no registra el tiempo dedicado. Los ETC de KANAP son los que el presupuesto planifica y paga, línea a línea.

## Por dónde empezar

1. **Revise los calendarios**: los calendarios estándar de sus países ya están ahí. Añada un calendario propio cuando un contrato de servicios cuente los días de otra forma.
2. **Empiece por los servicios más grandes**: refuerzo de personal y asistencia técnica, donde lo que está en juego es más visible. Una línea por perfil, con su cantidad, tarifa diaria y periodo.
3. **Lleve las líneas al aterrizaje** con Usar también para otras columnas, y ajuste las fechas de alta y baja a lo largo del año.
4. **Lea Plantilla por mes y después Coste por ETC**, y exporte la tabla en CSV para Excel, la página en PDF o solo los gráficos para preparar su presentación.

Para ver todo esto sobre un presupuesto ya introducido, una prueba gratuita de 14 días de nuestra versión alojada da acceso a los datos de ejemplo del grupo ficticio Fromage & Co, cargados en un minuto. KANAP es totalmente de código abierto: también puede instalarse gratis en sus propios servidores.
