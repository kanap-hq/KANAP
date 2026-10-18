---
title: "Un informe para cada pregunta del departamento de TI"
description: "El CIO, la jefa de proyecto, el responsable de equipo y el ingeniero tienen cada uno sus propias preguntas. Los informes de portafolio de KANAP las responden con un clic."
date: 2026-09-23
topic: portfolio
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: portfolio-reports-for-every-role
---

Lunes, 9 de la mañana, la reunión semanal del departamento de TI. El CIO pasó la tarde del domingo fusionando tres archivos para saber en qué punto están los proyectos. La jefa de proyecto llega con un plan que actualizó en el tren. El responsable del equipo de sistemas dice que su equipo está «desbordado», sin una cifra que lo demuestre. El ingeniero de redes explica que esta semana hizo sobre todo trabajo de run, y nadie sabe cuánto.

Todos tienen una pregunta real. Cada uno la responde con sus propias herramientas, y la reunión pasa media hora conciliando cifras.

Todas las respuestas ya existen en KANAP. Cada solicitud, proyecto y tarea deja allí un rastro: su creación, sus cambios de estado, su cierre, el tiempo registrado en ella. Los informes de portafolio leen ese historial y se lo muestran a cada persona desde el ángulo que le interesa.

![La página de informes de portafolio: la franja de los últimos 30 días, los elementos que requieren atención, la franja Por clasificar y las tarjetas de informes](/screenshots/blog/portfolio-hub.png)

## El CIO: ¿qué se ha movido y qué está bloqueado?

El CIO necesita una visión de conjunto en un minuto. La franja de la parte superior de la página de informes se la da en tres líneas: tareas, solicitudes, proyectos. Cada línea se lee igual: *14 creadas · 9 cerradas · 52 abiertas (+5)*, en los últimos 7, 30 o 90 días. La última cifra es la variación del stock: creaciones y reaperturas, menos cierres.

Justo debajo, la línea **Requiere atención** aparece cuando hay una decisión pendiente: tareas vencidas, tareas sin responsable asignado, proyectos en curso o en pruebas sin actividad desde hace 30 días. Un proyecto cuenta como activo en cuanto algo se mueve en él o en sus tareas: un cambio, una nota en el diario, tiempo registrado. Los que quedan en esa lista están realmente parados, y un clic los muestra con la fecha de su última actividad.

Las demás cifras abren la lista filtrada exactamente por los elementos contados. Las creaciones y los cierres abren el **Balance del periodo** sobre los mismos días.

Para el comité de dirección, el **Balance del periodo** cuenta la semana o el mes en el orden del portafolio: solicitudes, luego proyectos, luego tareas, cada una en tres listas (creadas, modificadas, cerradas). Un proyecto nuevo muestra de dónde viene, por ejemplo la solicitud a partir de la cual se convirtió. El balance se filtra por origen, categoría, proyecto o equipo. Se exporta en CSV o XLSX y se imprime limpiamente en PDF, como todos los informes.

<aside class="tip">
  <b>Consejo</b>
  <p>La franja <b>Por clasificar</b> cuenta el trabajo abierto sin origen, sin categoría o sin tipo. Un clic abre la lista por completar. Unos datos bien clasificados dan informes fiables.</p>
</aside>

## La jefa de proyecto: ¿qué viene y qué ha cambiado?

La jefa de proyecto mira hacia delante. El informe **Próximamente** reúne lo que vence pronto: finales de proyecto previstos en los próximos 30 días, inicios previstos, tareas que vencen en los próximos 14 días, entregas pedidas por el negocio. Las tareas ya vencidas y los finales previstos ya superados se cuentan aparte, con un enlace a ellos.

Filtrado por su proyecto, el mismo informe se convierte en su hoja de ruta para las dos próximas semanas.

![El informe Próximamente: cuatro finales de proyecto previstos en los próximos 30 días, siete ya superados, dos inicios previstos](/screenshots/blog/portfolio-upcoming.png)

Para la reunión con su patrocinador, abre el **Balance del periodo** filtrado por su proyecto. La columna **Cambios** resume lo que ha cambiado en cada elemento, en palabras sencillas: `En curso → En pruebas`, y después los campos modificados. Los elementos cerrados llevan dos fechas, **Creado el** y **Cerrado el**, así que la duración real de cada tarea se lee de un vistazo.

## El responsable de equipo: ¿quién necesita ayuda?

«Mi equipo está desbordado» se convierte en un hecho con cifras. El informe **Puntos de atención por colaborador** enumera, equipo por equipo, las tareas abiertas de cada persona, las vencidas y las que no se han movido en 14 días. Cada cifra abre la lista de tareas correspondiente, y la reunión de equipo empieza por ellas.

![Puntos de atención por colaborador: tareas abiertas, vencidas y sin movimiento en 14 días, equipo por equipo](/screenshots/blog/portfolio-attention.png)

El **Mapa de calor de capacidad** compara la carga de proyecto restante con la capacidad de cada persona, en meses de trabajo: verde hasta un mes, luego amarillo, naranja, rojo y morado más allá de un año. El **Trabajo sin asignar** tiene su propio total. El responsable de equipo llega a la reunión de arbitraje con meses de trabajo, y la discusión gira en torno a las prioridades.

Por último, **Flujo y antigüedad** muestra si la cartera pendiente crece: tareas creadas y cerradas semana a semana, solicitudes y proyectos mes a mes. También da la antigüedad del trabajo abierto, los elementos atascados en el mismo estado (más de 30 días para una tarea, más de tres meses para una solicitud o un proyecto) y la mediana del tiempo hasta el cierre.

## El ingeniero: hacer visible el trabajo diario

El ingeniero dedica buena parte de la semana a actualizaciones, incidentes y solicitudes de acceso. Ese trabajo importa, y rara vez aparece en un portafolio de proyectos.

El informe **Tiempo registrado** lo saca a la luz. Reparte los días registrados, mes a mes, entre proyectos y otros trabajos, equipo por equipo. En el ejemplo de abajo, el equipo de Infraestructura dedica el 60 % de sus días a trabajo de run. Cuando la dirección de TI ve esa cifra, la conversación sobre prioridades cambia.

![Tiempo registrado por el equipo de Infraestructura en seis meses: 40 % de días de proyecto, 60 % de otros trabajos](/screenshots/blog/portfolio-time-logged.png)

Estos informes existen para repartir la carga. Los equipos conservan el orden que eligió la dirección de TI, las personas aparecen por orden alfabético y el informe muestra días, nunca el contenido de las entradas de tiempo. Una tarea cerrada se atribuye a la persona que la tenía asignada al cerrarse. **Actividad por persona** muestra después, equipo por equipo, las tareas que cada persona creó, hizo avanzar y terminó en el periodo, con los días que registró.

## De vuelta al lunes por la mañana

La semana siguiente, la reunión empieza en la pantalla de la sala. El CIO abre la página de informes: la franja superior da el estado del portafolio y la línea **Requiere atención** marca el orden del día. La jefa de proyecto muestra **Próximamente** sobre su proyecto. El responsable del equipo de sistemas muestra su informe de puntos de atención y su mapa de calor de capacidad. El ingeniero muestra la parte del trabajo de run en el tiempo de su equipo.

Todos leen las mismas cifras, a partir de las mismas tareas. La reunión dura veinte minutos y termina con decisiones.

## En la práctica

Los informes están en **Portafolio > Informes**. Requieren acceso de lectura a los informes de portafolio y funcionan en la nube y on-premise. Leen los datos que ya tiene: las tareas, proyectos, solicitudes y tiempos que sus equipos ya registran.

El resto del portafolio se describe en la página [Portafolio](https://kanap.net/es/features/portfolio).
