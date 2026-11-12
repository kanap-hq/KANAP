---
title: Terminales Zebra TC52 del almacén de Zaragoza
summary: Sincronizar el inventario de los terminales TC52, cargar baterías y resolver el error de sincronización.
status: published
lang: es
---
La plataforma logística de Zaragoza utiliza terminales portátiles **Zebra TC52** con la aplicación **StockScan** para la preparación de pedidos y el inventario de quesos curados.

## Inicio de turno

1. Retire un terminal cargado del armario de carga (luz verde).
2. Inicie sesión en StockScan con su número de empleado.
3. Pulse **Sincronizar** antes del primer pedido: el terminal descarga las órdenes de preparación del día.

## El terminal no sincroniza

- Compruebe que el terminal está conectado a la red Wi-Fi **FROM-LOG** (no a FromageGuest).
- Si StockScan muestra **«Sincronización pendiente»** durante más de 10 minutos, cierre la aplicación desde la lista de aplicaciones recientes y vuelva a abrirla.
- Si persiste, deje el terminal en el armario de carga y tome otro: el terminal se sincroniza solo al conectarse a la base.

## Baterías

Las baterías duran un turno completo. Una batería que no aguanta 4 horas se cambia en la oficina del almacén; no se piden baterías al proveedor directamente.

## Inventario de fin de mes

El inventario se cuenta con el modo **Recuento** de StockScan. Los recuentos se envían a SAP en la sincronización siguiente; las diferencias superiores al 2 % las valida el jefe de almacén.
