---
title: "Contracargo de costes de TI: quién paga qué y por qué"
description: "Repartir los costes de TI entre empresas y departamentos con reglas claras y verificables, y convertirlas en informes de contracargo."
date: 2026-09-12
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
updated: 2026-10-10
translationKey: it-cost-chargeback-made-simple
---

«¿Cuánto nos cuesta la informática?» Pregunta fácil. «¿Cuánto le cuesta la informática al departamento X?» Mucho menos fácil. Y cuando la dirección pregunta quién debe cargar con la factura, la hoja de cálculo del CIO muestra pronto sus límites.

El contracargo de TI responde a esa pregunta. Cada coste de TI se reparte entre las entidades que se benefician de él, según una regla explícita y verificable. Esas entidades son empresas o departamentos, y la clave puede ser la plantilla, los usuarios IT, la facturación o un porcentaje introducido a mano. O combinaciones de esos criterios.

Los costes pueden incluso bajarse al nivel de usuario, para comparaciones reveladoras entre países, departamentos y empresas.

## Por qué hacer contracargo, incluso sin factura interna

Hacer contracargo no significa necesariamente emitir una factura. El primer objetivo es hacer visible el coste. Un CIO que puede mostrar que los costes de TI de una filial son dos o tres veces más altos que los de otra estará mejor preparado para justificar un cambio de estrategia.

Tres usos se repiten una y otra vez:

- **Responsabilidad**: cada entidad ve lo que cuestan sus decisiones.
- **Justificación**: un presupuesto defendido con cifras por entidad ofrece mucha más visibilidad que un único importe consolidado.
- **Arbitraje**: comparar el coste de TI por usuario entre empresas saca a la luz las diferencias.

## Definir las reglas de asignación

### La regla por defecto

Por defecto, KANAP usa la plantilla de las empresas definidas en los datos maestros: todos los costes se reparten entre todas las empresas según su plantilla.

Puede cambiar esta regla por defecto en Administración, Método de asignación por defecto. La regla que fije se aplica año a año a las líneas que todavía no se han personalizado (no pierde el trabajo ya hecho).

![El método de asignación por defecto para 2026: ejercicio fiscal, empresas y criterio, aquí todas las empresas activas por plantilla.](/screenshots/blog/chargeback-default-method-2026-10-13.png)

### Gestionar las reglas por línea

Cada línea presupuestaria lleva su propia regla de asignación, para cada año. Cuando el ajuste por defecto necesita afinarse, puede adaptarse en cada línea OPEX y CAPEX. Es lo que permite dirigir correctamente el coste de aplicaciones concretas (por ejemplo, un paquete contable cargado al departamento financiero).

La pestaña **Asignaciones** de una línea muestra el resultado en tiempo real. Aquí, el mantenimiento de SAP de 280.000 EUR se reparte por plantilla: 58,54 % para Fromage & Co SA, 19,51 % para Kaasmeester BV, y así hasta el 100 %.

![La pestaña Asignaciones de SAP S/4HANA Maintenance para 2026: método, criterio, porcentaje e importe para cada una de las cuatro empresas.](/screenshots/budget-allocations-2026-10-13.png)

Todas las bases de asignación están disponibles:

- **Plantilla** (por defecto): la base más habitual, alimentada por la plantilla anual de las empresas.
- **Usuarios IT**: para los costes que siguen el número de puestos equipados por empresa (útil en grupos donde muchos empleados no usan, o casi no usan, la informática).
- **Facturación**: cuando la contribución sigue el tamaño económico de la entidad.
- **Manual por empresa**: para asignar costes a una o varias empresas concretas (siempre por plantilla, número de usuarios IT o facturación).
- **Manual por departamento**: para asignar costes a uno o varios departamentos concretos, solo por plantilla.
- **Porcentajes manuales**: para una libertad de asignación total. Usted introduce los porcentajes, que deben sumar 100 %, o los reparte a partes iguales con un clic.

Para no tener que reconfigurarlo todo cada año, **Copiar columnas presupuestarias** traslada estas reglas de un ejercicio al siguiente junto con los importes, vista previa incluida. La asignación sigue así al presupuesto sin volver a teclear nada.

### No confundir con los centros de coste

Los centros de coste dicen a quién pertenece una línea y quién responde de ella: cada centro tiene su responsable presupuestario, y sus grupos permiten leer el presupuesto de toda una división. No influyen en el contracargo. Una licencia del centro de coste «Infraestructura» puede perfectamente repercutirse a todas las empresas por plantilla.

## Los informes de contracargo

Una vez establecidas las reglas, dos informes permiten explorar todas las facetas del contracargo.

### Contracargo global

El primero responde a «¿cómo se reparte el gasto de TI entre nuestras empresas?». Muestra el total consolidado, la parte de cada empresa, los importes pagados y consumidos y después los flujos entre empresas del grupo.

![Contracargo global del presupuesto OPEX 2026: total general, totales por empresa y el gráfico del reparto, con las pestañas Todo, OPEX y CAPEX.](/screenshots/blog/chargeback-global-2026-10-13.png)

Los KPI añaden dos métricas clave para cualquier presupuesto de TI:

- Costes de TI frente a facturación, para el grupo en su conjunto y por empresa. Puede decir entonces, con pruebas: en Fromage & Co SA, la informática cuesta el 3,94 % de la facturación anual.
- Costes de TI por persona y por usuario IT, en valor absoluto.

### Contracargo por empresa

Este informe baja un nivel y analiza el detalle de una sola empresa. Muestra los costes de TI por departamento, las líneas de contracargo (para responder a una filial: esto es exactamente lo que se le factura), el detalle de los flujos entrantes y salientes y un recordatorio de los KPI. Es el informe que se envía a las filiales con su factura anual.

![Contracargo por empresa de Fromage & Co SA, presupuesto OPEX 2026: KPI, totales por departamento y las líneas de contracargo.](/screenshots/blog/chargeback-company-2026-10-13.png)

Ambos informes son totalmente parametrizables (tipo de líneas, año, columna, empresa, secciones) y se exportan en CSV, PNG o PDF. También pueden presentarse directamente en una revisión presupuestaria.

<aside class="tip">
  <b>Consejo</b>
  <p>Los informes se expresan en la moneda de informes definida en los ajustes de monedas. Cada filial gestiona su presupuesto en su propia moneda, pero la consolidación unifica en una sola moneda, lo que facilita la lectura.</p>
</aside>

## Costes ocultos

Estos informes sacan a menudo a la luz líneas o situaciones que el gran «top 10» del presupuesto esconde. La herramienta de 15.000 EUR que usan tres personas y que dispara el coste por usuario de un departamento. La aplicación repercutida a una filial que ya paga un paquete equivalente. Las diferencias de coste por usuario entre empresas o departamentos.

Ahí suelen estar las verdaderas oportunidades de ahorro, y así es como el CIO puede ganar puntos ante la dirección general y la dirección financiera.

## ¿Y el CAPEX?

Las inversiones usan la misma pestaña Asignaciones y la misma mecánica. Un proyecto financiado para una sola filial se asigna a esa filial. El resto sigue el método elegido. Los dos informes de contracargo se abren en OPEX, el gasto que suele repercutirse año tras año, y pueden incluir las líneas CAPEX por su importe del año.

## Por dónde empezar

- Revise las métricas de las empresas para el año en curso: plantilla, usuarios IT, facturación. Son los datos maestros en los que se basa el contracargo.
- Fije el método por defecto que convenga a su entorno y trate después solo los casos especiales.
- Elija el nivel de detalle que quiere al revisar los casos especiales y manténgalo de principio a fin.
