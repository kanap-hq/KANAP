# Procedimiento de alertas CaveGuard — Sensores de las cavas de queso

CaveGuard IoT supervisa la temperatura y la humedad de las cavas de maduración (París: 8 cavas, Parma: 3 salas). Las alertas aparecen en el **Cave Monitoring Dashboard** y se reenvían a Datadog.

## Niveles de gravedad de las alertas

| Color | Significado | Respuesta |
|---|---|---|
| **Verde** | Valores dentro del perfil de la familia de quesos | Nada que hacer |
| **Naranja** | Desviación fuera del perfil durante **menos de 6 horas** | Revisar en un plazo de 4 horas durante los turnos con personal; no hace falta llamar a la guardia |
| **Rojo** | Desviación durante más de 6 horas, o fuera de los límites de seguridad | Llamar de inmediato al **afinador de guardia** (turnos en la cabecera del panel) |

## Perfiles de referencia

- **Comté / quesos de pasta dura**: 8–12 °C, 85–92% HR. Una humedad de hasta el 92% es normal: una alerta naranja al 91% HR solo indica que el valor se ha alejado del perfil *configurado* y desaparecerá sola si la puerta de la cava se ha abierto hace poco.
- **Quesos de pasta blanda (Brie, Camembert)**: 10–12 °C, 90–95% HR. Son los más sensibles.
- **Quesos azules**: 9–11 °C, 92–95% HR.

## Gestión de una alerta naranja de humedad

1. Abra el Cave Monitoring Dashboard y revise la tendencia: un pico tras abrir una puerta se estabiliza en menos de una hora.
2. Si el valor vuelve hacia el perfil, **confirme** la alerta en el panel (botón arriba a la derecha de la tarjeta de alerta). No hace falta abrir un ticket.
3. Si sigue desviándose al cabo de 2 horas, cree un ticket para TI de Producción e indique el número de cava y el ID del sensor.

## Lo que de verdad es crítico

Las alertas rojas, cualquier alerta de **temperatura** en una cava de quesos de pasta blanda y un sensor que deja de enviar datos por completo (línea plana). Eso justifica despertar a alguien. Una cava de Comté algo húmeda no: el Comté ha visto cosas peores.
