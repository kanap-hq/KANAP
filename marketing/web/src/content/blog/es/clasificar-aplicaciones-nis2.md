---
title: "Clasificar sus aplicaciones: criticidad, datos, recuperación, la base para NIS2"
description: "Criticidad de negocio y cibernética, datos, plan de recuperación: clasificar cada aplicación es el trabajo previo a cualquier proyecto NIS2. Un método y una herramienta, sin hoja de cálculo."
date: 2026-10-10
topic: compliance
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: classifying-applications-nis2
---

La pregunta siempre llega, en un comité de dirección o de boca de un auditor: ¿cuáles de nuestras aplicaciones son críticas, qué datos contienen, en cuánto tiempo las recuperamos y en qué orden?

En muchos departamentos de TI la respuesta existe, a trozos. El análisis de impacto en el negocio está en la hoja de cálculo del año pasado, el plan de recuperación en un PDF, la lista de aplicaciones en otra herramienta y el resto en la cabeza de dos personas. NIS2 no crea estas preguntas. Las hace obligatorias para muchas empresas que hasta ahora podían prescindir de ellas.

## Lo que NIS2 espera de TI

La directiva NIS2 (artículo 21) exige a las entidades afectadas medidas de gestión de riesgos. Entre ellas: la continuidad de la actividad, con la gestión de copias de seguridad y la recuperación ante desastres; la seguridad de la cadena de suministro; la gestión de incidentes. Cada Estado miembro transpone la directiva a su derecho nacional, y las agencias nacionales publican sus propias guías. En Francia, la ANSSI detalla estos objetivos en un marco, ReCyF, todavía publicado como documento de trabajo en [MesServicesCyber](https://messervices.cyber.gouv.fr/nis2).

Sea cual sea el calendario de su país, hay algo que no cambiará: antes de cualquier análisis de riesgos, hay que saber qué se protege. Un inventario de aplicaciones, clasificado y al día. Es la parte más larga, y la que a nadie le gusta.

## Clasificar una aplicación en cuatro bloques

En KANAP, la pestaña **Conformidad** de cada aplicación sigue el orden de un análisis de impacto en el negocio.

![La pestaña Conformidad de SAP S/4HANA: criticidad, datos, continuidad y recuperación, con el intercambio con una aplicación prevista en una ola posterior](/screenshots/blog/compliance-tab-2026-10.png)

**Criticidad.** La criticidad de negocio se elige entre sus niveles, cada uno con su definición, normalmente la interrupción que el negocio puede tolerar. La criticidad cibernética se elige por separado: mide las consecuencias de un compromiso, no su probabilidad. Una herramienta de nóminas puede aguantar dos días de parada y aun así ser muy crítica si sus datos se filtran.

**Datos.** El nivel de confidencialidad, a partir de sus clases de datos; si contiene datos personales; la residencia de los datos, país por país.

**Continuidad y recuperación.** La ola de recuperación indica en qué orden vuelven los sistemas, no a qué velocidad. El RTO (objetivo de tiempo de recuperación) y el RPO (pérdida de datos aceptable) se introducen en minutos, horas o días, junto con la fecha de la última prueba de recuperación. Cuando el RTO alcanza el tiempo máximo de interrupción tolerable del nivel de negocio, KANAP lo señala.

**Revisión.** Una justificación escrita explica los niveles elegidos. Después, «Marcar como revisado» registra quién revisó la clasificación y cuándo.

Lo que se deja en blanco queda como «Sin definir». KANAP nunca elige un nivel por defecto en su lugar: una aplicación sin clasificar debe verse como tal.

## Su método, no el nuestro

Probablemente ya tiene niveles, en su política de seguridad o en su último análisis de impacto. Consérvelos. Los cuatro catálogos (criticidad de negocio, criticidad cibernética, confidencialidad de los datos, olas de recuperación) son configurables: nombres de los niveles, definición mostrada al elegir, tiempo máximo de interrupción tolerable de cada nivel de negocio, orden, traducciones.

![El editor de catálogos de clasificación: niveles, definiciones y tiempo máximo de interrupción tolerable](/screenshots/blog/compliance-catalog-2026-10.png)

Cambiar un catálogo nunca mueve una aplicación a otro nivel ni invalida una revisión. Un nivel que se abandona pasa a «ya no se propone»: sigue siendo legible en las aplicaciones que lo tienen, simplemente deja de ofrecerse.

## Una campaña de clasificación que se puede dirigir

Clasificar cuarenta o doscientas aplicaciones lleva semanas. El mosaico **Conformidad** del panel de control muestra en qué punto está la campaña: cuántas aplicaciones están revisadas, necesitan una revisión o quedan por completar. Debajo, tres puntos de atención: las aplicaciones más críticas sin prueba de recuperación en los últimos doce meses, las que no tienen ola de recuperación y las que contienen los datos más confidenciales con la criticidad cibernética más baja. Cada número abre la lista de aplicaciones correspondiente.

![El mosaico Conformidad: avance de la campaña y puntos de atención](/screenshots/blog/compliance-tile-2026-10b.png)

La revisión no es un sello anual. En cuanto una criticidad, una ola, un objetivo de recuperación o la residencia de los datos cambia después de la revisión, la aplicación vuelve a «Por revisar». La lista de aplicaciones muestra los mismos campos como columnas, con filtros, y se exporta en CSV para el auditor.

![La lista de aplicaciones ordenada por criticidad de negocio, con criticidad cibernética, ola, RTO, RPO y estado de revisión](/screenshots/blog/compliance-applications-2026-10b.png)

## Lo que un registro gobernado aporta frente a una hoja de cálculo

Una hoja de cálculo de análisis de impacto clasifica filas. En KANAP, la aplicación clasificada está además vinculada al resto del panorama IT, y ahí es donde la clasificación empieza a dar frutos.

- **Dependencias de recuperación.** Bajo la ola, KANAP enumera las interfaces que vinculan la aplicación con una aplicación prevista en una ola posterior. En la captura de arriba, SAP S/4HANA vuelve en V1 pero intercambia datos con Salesforce, previsto en V2. El plan de recuperación ve sus problemas de orden antes del día en que se necesita.
- **Criticidad de los flujos.** Interfaces y conexiones heredan el nivel más alto de las aplicaciones que vinculan.
- **Servidores.** Cada servidor muestra su sistema operativo y las fechas de fin de soporte.
- **Proveedores y contratos.** La cadena de suministro ya está ahí: cada aplicación lleva a su fabricante, sus contratos y sus plazos.
- **Documentación.** Los procedimientos de recuperación y los informes de prueba están en la base de conocimiento, vinculados a la aplicación.
- **Trazabilidad.** Cada cambio va al registro de auditoría.

Y Plaid, el agente IA integrado, responde sobre los mismos datos: «¿qué aplicaciones críticas llevan un año sin prueba de recuperación?», «¿en qué punto está la revisión de la clasificación?». También puede preparar cambios de clasificación, que usted aprueba. La revisión en sí sigue siendo una acción humana.

## Lo que KANAP no hace

KANAP no realiza el análisis de riesgos, no sustituye a un sistema de gestión de la seguridad de la información y no notifica incidentes a las autoridades. Aporta el inventario clasificado, vinculado y al día en el que se apoyan esos trabajos. Es la materia prima del análisis de riesgos, no el análisis en sí.

## Por dónde empezar

1. Lleve a los catálogos los niveles de su política de seguridad o de su último análisis de impacto.
2. Clasifique primero las aplicaciones más críticas para el negocio.
3. Rellene la ola, el RTO, el RPO y la fecha de la última prueba de recuperación.
4. Escriba la justificación y haga después la revisión.
5. Siga la campaña desde el mosaico Conformidad y trabaje los puntos de atención.
6. Vincule servidores, interfaces y contratos sobre la marcha.

Los datos de ejemplo de una prueba, el grupo ficticio Fromage & Co, incluyen una campaña de clasificación en curso: suficiente para ver todo esto antes de clasificar sus propias aplicaciones.
