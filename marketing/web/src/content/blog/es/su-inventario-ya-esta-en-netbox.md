---
title: "Su inventario de hardware ya existe, y está en Netbox"
description: "El equipo de infraestructura mantiene Netbox al día. KANAP lo lee, mantiene sus fichas de activos alineadas sin volver a teclear y añade lo que Netbox no sabe: aplicaciones, contratos, costes."
date: 2026-09-23
topic: mapping
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: netbox-inventory-single-source
---

Martes, 2:40 de la madrugada. La monitorización indica que PAR-ESX-04R ha dejado de responder. El ingeniero de guardia abre el archivo de activos y busca el servidor: ninguna fila con ese nombre. La máquina se renombró el mes pasado y el archivo sigue diciendo PAR-ESX-04.

Hacen falta veinte minutos y dos llamadas para averiguar qué aplicaciones corrían en ella, con qué contrato de mantenimiento y a qué número llamar en el fabricante.

El nombre correcto estaba registrado en algún sitio. El equipo de infraestructura lo cambió en Netbox el día del renombrado, igual que registra allí cada rack, cada dirección y cada número de serie.

![La ficha de Netbox del servidor PAR-ESX-01: sitio, rack, número de serie, dirección y plataforma](/screenshots/blog/netbox-device.png)

## El inventario y la capa de negocio

Netbox dice dónde está una máquina y cómo está cableada: sitio, rack, unidad, número de serie, dirección, plataforma. Lo hace muy bien, y esa información merece teclearse una sola vez.

La dirección de TI necesita otras respuestas. ¿Qué aplicaciones corren en este servidor? ¿Qué contrato lo cubre y hasta cuándo? ¿Cuánto cuesta y con cargo a qué presupuesto? ¿Qué incidente lo afectó el mes pasado? Esas preguntas quedan fuera del alcance de Netbox.

En KANAP, la ficha del activo reúne esas respuestas: aplicaciones alojadas, contratos, líneas OPEX y CAPEX, incidentes, tareas. La sincronización con Netbox le da una identidad fiable. Crea fichas de activos a partir de Netbox y las mantiene al día, y el inventario deja de teclearse dos veces.

## Cada campo tiene un solo dueño

Dos registros siempre acaban divergiendo cuando la misma información puede editarse en ambos lados. Por eso la regla es estricta: los campos que rellena Netbox los gobierna Netbox, y quedan bloqueados en KANAP. El resto de la ficha es suyo.

![Los campos de identidad de un activo vinculado: Netbox rellena los campos que aporta, los demás los completa usted](/screenshots/blog/netbox-managed-fields.png)

| Gestionado por Netbox | Sigue siendo suyo en KANAP |
|-------------------|----------------------|
| Nombre | Entorno |
| Nombre de host y dominio | Notas y descripción |
| Número de serie | Fechas, soporte y garantía |
| Fabricante y modelo | Contratos y costes |
| Rack y unidad de rack | Aplicaciones alojadas en el activo |
| Dirección IP principal | Conexiones y otras relaciones |
| Sistema operativo | Adjuntos, tareas, incidentes |
| Estado del ciclo de vida | Todo lo demás del activo |
| Ubicación y sububicación | |

El bloqueo solo cubre los campos que Netbox rellena para ese objeto. Un dispositivo sin plataforma en Netbox mantiene abierto el campo del sistema operativo. Usted lo completa en KANAP y su valor se queda: una sincronización solo escribe los valores que Netbox aporta.

KANAP lee Netbox con un token de API de solo lectura. El equipo de infraestructura conserva su herramienta tal como está.

Su registro de activos cubre también lo que Netbox no describe, como una instancia EC2 o una base de datos gestionada. Esos activos viven en KANAP junto a los demás, sin alerta.

## Elegir lo que entra

La pestaña **Correspondencias** fija el alcance, en tres tablas.

- **Roles.** Cada rol de Netbox recibe un tipo de activo de KANAP, o **No importar**. Los servidores entran, las PDU y los paneles de parcheo del mismo rack se quedan fuera. Todas las máquinas virtuales pasan por una sola fila.
- **Sitios.** Cada sitio de Netbox recibe una de sus ubicaciones. Sus Locations de Netbox de primer nivel se convierten automáticamente en sububicaciones.
- **Sistemas operativos.** Cada plataforma de Netbox se asocia a un sistema operativo de su catálogo: «Debian 12» en Netbox pasa a ser «Debian 12 (bookworm)» en KANAP.

Cada fila muestra cuántos objetos abarca, así que ve el alcance de una decisión antes de tomarla. KANAP rellena de antemano lo que reconoce, y sus elecciones se aplican una vez guardadas con **Guardar correspondencias**.

![La pestaña Correspondencias: cada rol de Netbox recibe un tipo de activo o No importar](/screenshots/blog/netbox-mappings.png)

## La primera sincronización, leída línea a línea

La primera ejecución contra una base ya llena es el momento delicado. Sus activos existen en KANAP, a veces con otros nombres. El riesgo es doble: duplicados cuando la correspondencia falla y, sobre todo, un vínculo erróneo, que dejaría a Netbox sobrescribir la ficha de otra máquina.

KANAP prueba cuatro cosas, en orden, y se detiene en la primera que encuentra algo: un vínculo existente, el número de serie, el nombre de host, el nombre. Cuando un paso encuentra varios activos, el objeto pasa a **Por decidir** con los candidatos.

Dos señales solo producen una sugerencia: un nombre que empieza igual y una dirección IP que ya tiene un activo. Las direcciones se reutilizan, se comparten entre miembros de un clúster o simplemente quedan obsoletas. El objeto espera entonces en **Por decidir** con el activo sugerido, y un clic lo confirma.

> Toda correspondencia dudosa pasa por usted.

**Sincronizar ahora** abre **Revisar antes de aplicar**. La vista previa lo ordena todo: creaciones, actualizaciones campo a campo, decisiones por tomar, objetos fuera de alcance, objetos desaparecidos de Netbox. Usted corrige allí mismo: vincular un objeto a un activo existente, crear uno nuevo o dejarlo fuera para siempre.

![La vista previa antes de aplicar: un servidor renombrado, un servidor en retirada, un número de serie sustituido y una decisión por tomar](/screenshots/blog/netbox-preview.png)

En un parque grande, la revisión avanza en lotes de 500. **Aplicar este lote** escribe exactamente lo que muestra la vista previa. El lote siguiente espera a que usted lo lea.

<aside class="tip">
  <b>Consejo</b>
  <p>Antes de la primera ejecución, rellene los números de serie en KANAP y declare sus sufijos DNS en Panorama IT > Configuración. El número de serie es la correspondencia más sólida que existe: resiste los renombrados en ambos lados.</p>
</aside>

## Después, el parque vive

La segunda sincronización le dice si puede confiar en la herramienta. Debería ser corta: solo muestra lo que ha cambiado.

- Una máquina renombrada en Netbox ocupa una línea, con el nombre antiguo y el nuevo. PAR-ESX-04, en la vista previa de arriba, es una de ellas.
- Una Location renombrada en Netbox aparece una vez, y todos los dispositivos que contiene la siguen.
- Un servidor en *Decommissioning* pasa a **Obsoleto**. Un estado *Offline* o *Failed* aparece como advertencia en el activo, y el ciclo de vida sigue Activo.
- Una máquina eliminada de Netbox se queda en KANAP con sus contratos y su historial. Pasa a **Ausentes de Netbox**, y usted decide si la marca como **Retirado**.
- Un campo gestionado que se edita a mano en KANAP vuelve a alinearse en la siguiente ejecución.

Cuando dos ejecuciones manuales seguidas salen limpias, la segunda sin nada pendiente de cambiar, active la **Sincronización automática**. Se ejecuta cada hora y aplica los cambios directamente. Empieza después de una primera sincronización manual aplicada sin errores y se pausa mientras haya un lote pendiente de lectura. Los casos dudosos se acumulan en **Por decidir** y esperan su decisión.

## De vuelta a la noche del martes

Con la sincronización en marcha, PAR-ESX-04R existe en KANAP con su nombre actual desde la ejecución que siguió al renombrado. El ingeniero de guardia lo encuentra al primer intento. Su ficha enumera las aplicaciones que corren en él, con su entorno. La pestaña **Soporte** da el contrato de mantenimiento, el nivel de soporte, la fecha de vencimiento y los contactos del fabricante con sus números de teléfono.

La búsqueda lleva un minuto, y el ingeniero de guardia puede centrarse en la avería.

## En la práctica

La sincronización funciona en la nube y on-premise. En la nube, KANAP tiene que poder llegar a su Netbox desde internet. Si su Netbox está en la red interna, la [edición on-premise](https://kanap.net/es/on-premise) se instala a su lado, en su propia infraestructura.

Netbox sigue siendo la referencia para el equipamiento, y KANAP aporta la capa de negocio que lo rodea. El resto del registro se describe en la página [Panorama IT](https://kanap.net/es/features/it-landscape).
