---
title: "El registro de incidentes"
description: "Un año después de una caída del servicio, el auditor o la aseguradora piden detalles. Cuándo empezó, quién decidió qué, quién hizo qué, si se notificó a los interlocutores adecuados. Un registro de incidentes debe poder responder a estas preguntas, y al mismo tiempo le prepara para NIS2."
date: 2026-10-26
topic: compliance
features: [it-landscape, incidents]
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: incident-register-facts-dates-evidence
---

En marzo, la facturación se detiene durante tres horas. Una primera restauración falla, la jornada termina tarde y luego la vida sigue.

En octubre, el auditor pide el expediente. ¿Cuándo empezó el incidente, cuándo se advirtió, quién se hizo cargo? Pero el ticket se cerró, los intercambios se perdieron en los buzones de correo y la persona que gestionó el incidente ha cambiado de puesto.

Así responde KANAP a esta necesidad.

## Lo que tiene cabida en el registro

El registro conserva los acontecimientos sobre los que volverán la dirección, los auditores o la aseguradora:

- las interrupciones que afectaron a usuarios, a clientes o a un proceso de negocio;
- los eventos de seguridad: intento de intrusión, software malicioso, fuga de datos, equipo perdido;
- las pérdidas de datos, las restauraciones fallidas, los huecos en las copias de seguridad;
- los fallos graves de un proveedor o de un servicio de alojamiento;
- todo lo que habrá que explicar más adelante, o comunicar a una autoridad.

El ticket del día a día se queda en la herramienta de ticketing: el registro de incidentes de KANAP no sustituye a un centro de servicios. Su número se anota en la referencia externa del incidente, para encontrar el rastro operativo. Un buen registro tiene unas pocas entradas al mes, y una caída que generó cuarenta tickets es un solo incidente.

Para empezar, bastan tres campos: un título, una gravedad y la hora de detección. El resto se completa sobre la marcha. Un registro llevado hasta ahora en una hoja de cálculo se importa con un archivo CSV.

## Una cronología sólida

![La pestaña Registro de un incidente crítico, con notas fechadas y cambios de estado y de gravedad.](/screenshots/incidents-journal-2026-10-26.png)

La pestaña Registro es la que convierte un formulario en un registro. Guarda todo lo que le sucede al incidente: las notas del equipo, cada cambio de estado y de gravedad, cada activo o aplicación vinculado o desvinculado, cada reapertura con su motivo. Nada de lo que contiene puede modificarse ni eliminarse, por nadie.

Las notas llevan la hora de los hechos. Una nota introducida el martes puede fecharse el sábado a las 23:40 y se coloca en ese punto de la cronología. Al lado, KANAP conserva la hora real en que se introdujo, que nadie puede cambiar: el antedatado sigue siendo honesto.

Dos fechas abren la cronología: el inicio del incidente y el momento en que se advirtió. La diferencia entre ambas suele ser la primera pregunta del auditor. Una vez resuelto el incidente, su duración aparece por sí sola.

El estado solo avanza: abierto, en curso, resuelto, cerrado. Volver atrás requiere un administrador del registro y un motivo, que también queda anotado en la pestaña Registro.

La numeración sigue siendo continua. Un duplicado se cancela con un motivo, e INC-13 nunca desaparece entre INC-12 e INC-14: un hueco en la numeración sería lo primero sobre lo que volvería un auditor. Un incidente que contiene datos de notificación no puede eliminarse.

## Vincular el incidente con lo que afectó

![La pestaña Relaciones de un incidente: sus activos, sus aplicaciones, sus tecnologías y las tecnologías sugeridas.](/screenshots/incidents-relations-2026-10-26.png)

Un incidente aislado en un registro tiene poco peso. En KANAP, se vincula al panorama IT: los servidores afectados, las aplicaciones de negocio con su criticidad, las tecnologías implicadas. KANAP sugiere las tecnologías de los servidores y las aplicaciones ya vinculados, con su origen, por ejemplo «tecnología del activo AST-12». Basta un clic para añadirlas.

El vínculo funciona en ambos sentidos. La ficha de un servidor, de una aplicación o de una tecnología enumera sus incidentes: quien abre un servidor ve su historial. Y una búsqueda por un nombre de host como PAR-ESX-01 encuentra todos los incidentes que lo afectaron.

Las acciones correctivas se convierten en tareas, con un responsable y una fecha límite, vinculadas al incidente. La revisión describe la intención; la tarea demuestra que el trabajo se ha hecho.

## La revisión del incidente, congelada al cerrar

![La vista general de un incidente, con su descripción y su revisión del incidente.](/screenshots/incidents-review-2026-10-26.png)

Cada incidente tiene dos textos. La descripción cabe en una o dos frases: lo que pasó, tal como se observó. La revisión del incidente es el informe completo, redactado en un documento de verdad, con títulos, tablas e imágenes pegadas.

Parte de una plantilla en cinco partes: descripción detallada, impacto, causa raíz, acciones correctivas, lecciones aprendidas. Para un incidente menor, basta la descripción; para un incidente grave, la revisión es el post mortem. La plantilla le pertenece y puede adaptarla a sus necesidades.

Cada guardado de la revisión crea una versión, conservada de forma definitiva. Al cerrar, el incidente queda bloqueado y la revisión congelada en la versión que indica la pestaña Registro. Es la que leerá el auditor. Termine, por tanto, la revisión antes de cerrar: después hará falta un administrador para reabrir el incidente.

## La vertiente regulatoria

Cuatro campos recogen la parte regulatoria del incidente:

- **Datos personales afectados**, que se marca en cuanto se han expuesto, alterado o perdido datos personales. Es el filtro de su delegado de protección de datos.
- **Requiere notificación a la autoridad**, cuando el hecho debe comunicarse a una autoridad de protección de datos, a una agencia de ciberseguridad o a un regulador sectorial.
- **Notificado el**, la fecha de presentación.
- **Partes informadas**: regulador, aseguradora, clientes afectados, seguridad del grupo.

El artículo 33 del RGPD obliga a documentar toda violación de datos personales, se haya notificado o no. El registro es la constancia de ello, y un incidente que contiene esta información no puede eliminarse. Los plazos y los umbrales de notificación dependen de su jurisdicción y de su sector: KANAP registra los hechos y las fechas, no decide si hay que notificar.

Un incidente de seguridad sensible puede restringirse. Entonces solo lo ven los administradores del registro, el declarante y el responsable; para los demás, no existe ni en la lista, ni en la búsqueda, ni en las respuestas de Plaid, ni en la exportación.

## Lo que recibe el auditor

![El registro filtrado por los incidentes de gravedad Crítica y Alta.](/screenshots/incidents-register-2026-10-26.png)

El registro se filtra por periodo, gravedad, categoría o indicador de conformidad. Las gravedades Crítica y Alta del último año dan la lista corta que piden la mayoría de los comités y las auditorías, y la exportación CSV la entrega tal cual.

Para un incidente concreto, la exportación PDF reúne una ficha completa: propiedades, descripción, revisión del incidente, registro del incidente en orden cronológico con las versiones de la revisión, activos, aplicaciones y tareas vinculados, campos de conformidad y adjuntos.

Plaid, el asistente integrado en KANAP, también responde: «¿Cuántos incidentes críticos este trimestre?», «Lista de los incidentes abiertos en PAR-ESX-01», «Resumen de INC-2». Lee el registro del incidente y la revisión, y por eso puede responder hasta la causa raíz.

## Por dónde empezar

1. **Importe el registro existente**, o recupere los incidentes graves del año.
2. **Mantenga una lista de categorías corta**: son ellas las que agruparán un año de incidentes.
3. **Registre pronto, complete sobre la marcha, cierre después de redactar la revisión.**
4. **Revise el registro cada trimestre**: las categorías que se repiten y los servidores que aparecen más de una vez quizá alimenten la próxima solicitud de presupuesto o el próximo proyecto.

Para verlo todo en acción, una prueba gratuita de 14 días de nuestra versión alojada da acceso a los datos de ejemplo del grupo ficticio Fromage & Co, registro de incidentes incluido, cargados en un minuto. KANAP es totalmente de código abierto: también puede instalarse gratis en sus propios servidores.
