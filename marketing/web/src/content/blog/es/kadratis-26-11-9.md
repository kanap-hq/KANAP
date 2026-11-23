---
title: "Kadratis 26.11.9: las novedades desde 26.11.1"
description: "Desde 26.11.1 se han publicado ocho versiones, con novedades destacadas: las importaciones realizan una búsqueda avanzada de duplicados, las listas permiten la modificación en bloque (también con Kad), y una gestión más precisa de los derechos de acceso al presupuesto mejora la colaboración en el proceso presupuestario. Un recorrido por las novedades."
date: 2026-11-23
topic: release
features: [budget, ai]
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: kadratis-26-11-9
---

Este artículo repasa los principales cambios, hasta 26.11.9, publicada el 22 de noviembre:

- Una importación, desde la pantalla o a través de Kad, encuentra los registros que existen antes de crear otros nuevos.
- Un campo se modifica en toda una selección de líneas presupuestarias o de aplicaciones, desde la lista o pidiéndoselo a Kad.
- Los proveedores, las empresas, los contactos, los departamentos y los contratos tienen una referencia, como `SUP-12` o `CTR-5`.
- Los derechos de acceso se gestionan con más precisión.
- Los agentes de soporte encuentran el documento adecuado sea cual sea el idioma del ticket.

## Búsqueda de duplicados en las importaciones

![En Kad, la vista previa de la importación de un libro de presupuesto: los valores del archivo emparejados con valores existentes, cada uno con el botón Deshacer, y las líneas que se parecen a una línea existente.](/screenshots/blog/kad-import-matches-2026-11-22.png)

Las personas pecan a menudo de falta de rigor: «Dell» por «Dell Technologies», un proveedor sin su acento, un tipo de coste en otro idioma. En una importación de datos, cada diferencia se convierte entonces en un error que detectar y corregir, o en un registro duplicado.

**Emparejar antes de crear.** Todas las importaciones encuentran ahora un registro por su nombre sin tener en cuenta mayúsculas ni acentos. El archivo de presupuesto empareja así sus proveedores, sus empresas y sus valores de dimensión; en las dimensiones recomendadas, reconoce también un valor escrito en otro idioma, `Matériel` por `Hardware`. Kad va más allá: para un nombre escrito de otra forma, una traducción o una forma corta, propone el registro existente. Cada emparejamiento aparece en la verificación y puede anularse antes de la importación.

**Una línea ya introducida no se convierte en una segunda línea.** Una línea presupuestaria o una aplicación del archivo que se parece a un registro existente se descarta por defecto. Para cada una, usted elige crearla de todos modos o actualizar el registro al que se parece.

**Avisos sobre lo que se sale de lo normal.** La verificación del archivo de presupuesto señala, sin bloquear, un importe diez veces superior o inferior al de las líneas comparables, fechas fuera de los años de los importes y una moneda distinta de la de la empresa pagadora.

**Una sola regla para las celdas vacías.** En todas las importaciones, una celda vacía conserva el valor guardado, `-` lo borra, y una columna ausente del archivo no se toca. La verificación cuenta los valores que se borrarán. Un archivo puede llevar, por tanto, solo la referencia de los registros y las columnas que cambian, y un archivo exportado e importado tal cual no cambia nada.

**Un presupuesto importado por Kad en una sola tarjeta.** Usted adjunta el libro a la conversación diciendo «Importa estos datos», y Kad muestra la correspondencia de las columnas, los emparejamientos, las líneas parecidas y los proveedores que creará. No se escribe nada antes de su aprobación.

**Un rastro de cada importación.** El registro de auditoría anota todas las importaciones, hechas desde una pantalla o por Kad. La pestaña **Historial** de cada registro creado o modificado nombra a la persona (o a Kad).

Consulte las páginas [Archivos CSV y Excel](https://doc.kadratis.com/es/csv-files/) y [Cargar un presupuesto desde una hoja de cálculo](https://doc.kadratis.com/es/budget-file/) del manual.

## Modificar en bloque, desde la lista o a través de Kad

![Las dieciséis líneas presupuestarias de un proveedor marcadas en la lista, y la ventana Modificar la selección: el campo Responsable de TI, su nuevo valor y el recuento, 13 líneas que cambiarán y 3 que ya tienen ese valor.](/screenshots/blog/bulk-edit-budget-lines-2026-11-22.png)

Una reorganización, un responsable que cambia de equipo, un proveedor adquirido: estos cambios afectan a decenas de registros a la vez.

**Desde la lista.** En las líneas presupuestarias y las aplicaciones, marque registros o tome todo el filtro, y haga clic en **Modificar la selección**. Usted elige el campo y su nuevo valor. La ventana cuenta los registros que cambiarán, los que ya tienen ese valor y los que se rechazan, con el motivo, y después muestra el resultado.

- En las líneas presupuestarias: el centro de coste, la cuenta, la empresa pagadora, el proveedor, los responsables, un valor de dimensión, run o build. Los importes no se modifican de esta forma.
- En las aplicaciones: los responsables, la categoría, el ciclo de vida, la criticidad de negocio y la criticidad cibernética.

Este alcance se ampliará progresivamente.

![En Kad, la misma modificación pedida en una frase: la tarjeta muestra el filtro, el campo, su nuevo valor y el mismo recuento de líneas.](/screenshots/blog/kad-bulk-change-2026-11-22.png)

**Pidiéndoselo a Kad.** «Pon a Nadia Lemaire como responsable de TI de las líneas presupuestarias del proveedor Fromatech Consulting»: Kad prepara una sola tarjeta, que muestra los registros afectados, el nuevo valor y los mismos recuentos. Usted aprueba, y el historial de cada registro indica que la modificación la hizo Kad en su nombre. Cuando hay varias tarjetas pendientes, **Rechazar todas** se suma a **Aprobar todas**.

Consulte [Modificar líneas en bloque](https://doc.kadratis.com/es/budget-lines/#modificar-lineas-en-bloque) y [Modificar registros en bloque](https://doc.kadratis.com/es/ai-assistant/#changing-records-in-bulk) con Kad.

## Una referencia para cada registro

![La página del contrato SAP Maintenance & Support: su referencia, CTR-11, precede a su nombre en el encabezado.](/screenshots/blog/contract-reference-2026-11-22.png)

Los proyectos, las aplicaciones y las líneas presupuestarias ya tenían la suya (`PRJ-3`, `APP-7`, `BL-12`). Los proveedores, las empresas, los contactos, los departamentos y los contratos reciben ahora una también: `SUP-12`, `COMP-3`, `CTCT-8`, `DEPT-2`, `CTR-5`.

**Allí donde aparece el registro.** La referencia figura en la página del registro, en su lista (filtro, orden, exportación), en su dirección y en los enlaces que llevan a él. La búsqueda global, los selectores, la mención `@`, Kad y el servidor MCP encuentran un registro por su referencia.

**Una clave para las importaciones.** Una fila del archivo que lleva la referencia actualiza ese registro, aunque su nombre haya cambiado: renombrar un proveedor mediante una importación no crea un duplicado. La verificación señala cada registro que se renombrará.

Los colaboradores del portafolio, que llevaban el prefijo `CTR`, pasan a `MEM-n`. Las direcciones guardadas antes de esta versión siguen abriendo el colaborador correcto.

## Derechos más precisos

**Un centro de coste basta para modificar.** Para una persona cuyo acceso a los datos está limitado, un nodo en Edición sobre un centro de coste, o sobre un grupo por encima, permite modificar las líneas presupuestarias imputadas a ese centro y los contratos asignados a él, sea cual sea la empresa que paga. Crear o mover una línea sigue exigiendo la empresa del centro. Consulte la página [Acceso a los datos](https://doc.kadratis.com/es/data-access/) del manual.

**Solo se conceden los derechos que se tienen.** Una persona que administra los usuarios sin ser Administrador asigna solo los roles que tiene, y ve en solo lectura a las personas que tienen más derechos que ella. Un espacio de trabajo conserva siempre al menos un Administrador activo.

**Los vínculos siguen los derechos de lectura.** El historial de un proyecto, el diario de un incidente o el campo Aplicaciones de una tarea solo nombran los registros vinculados que la persona puede leer. Los demás se cuentan. Kad y el servidor MCP siguen la misma regla.

**Inicio de sesión con Microsoft.** Un primer inicio de sesión con Microsoft ya no vincula una cuenta existente solo por su dirección: su titular confirma el vínculo desde un correo, y la cuenta conserva su contraseña.

## Los agentes de soporte encuentran el documento adecuado

**En todos los idiomas.** Los agentes de soporte y Kad encuentran un documento de la base de conocimiento sea cual sea el idioma del ticket: español, inglés, francés o alemán. Un agente cita el pasaje que responde, esté donde esté en un documento largo, y redacta su respuesta a partir del texto de los documentos seleccionados. Solo lee los documentos publicados.

**Bibliotecas elegidas por agente.** Un agente busca y cita solo en las bibliotecas que un administrador le abre. Un agente nuevo empieza sin ninguna.

**Las notas internas siguen siendo internas.** Un agente de soporte usa o ignora las notas internas de un ticket, a su elección. Si las usa, orientan la elección de sus acciones y su nota al técnico. Sus respuestas al solicitante solo se basan en los mensajes públicos.

**Cerrar y resolver.** Con la actualización de estado en Automático, un agente también cierra y resuelve los tickets, después de enviar su respuesta al solicitante.

## Otras mejoras

- **Los primeros pasos siguen sus datos.** Con sus propios datos, una etapa se marca en cuanto el elemento existe en el espacio de trabajo. La indicación de una etapa aparece en una burbuja abajo a la izquierda de la ventana, y el recorrido se cambia en cualquier momento desde el mosaico. Durante la prueba, un administrador puede volver a empezar desde el ejemplo completo.
- **Creación de registros.** Un registro nuevo solo se guarda en el momento en que usted lo crea: salir de la página antes no escribe nada. **Crear** marca en rojo los campos obligatorios aún vacíos.
- **Contactos creados desde la lista.** Allí donde usted elige un contacto, la lista termina con **+ Nuevo contacto**; la de proveedores de un contrato o de una línea presupuestaria, con **+ Nuevo proveedor**.
- **Las listas vacías proponen crear.** Una lista vacía de ubicaciones, activos, empresas o contactos muestra un botón de creación en su centro.
- **Fin de soporte.** La lista de tecnologías muestra el próximo fin de soporte, estándar o extendido. En una aplicación, el fin de soporte de cada tecnología es el del informe, coloreado según su estado.
- **Columna de presupuesto por defecto.** La lista de líneas sigue un cambio de la columna por defecto, y la pestaña Presupuesto de una línea se abre en ella.
- **Introducción de datos.** Una línea presupuestaria nueva empieza el 1 de enero del año mostrado. Los números decimales siguen el idioma de la interfaz. Una fecha escrita sin separadores conserva su mes: `01012026` pasa a 01/01/2026.
- **Integraciones.** Cambiar la dirección de una integración (GLPI, PRTG, Netbox) o el servidor de un modelo de IA vuelve a pedir su token o su clave.

## Para las instalaciones on-premise

- **Una copia de seguridad cifrada cada noche.** Un script (`infra/backup/`) cifra la base de datos, los archivos y la configuración con `age`, y los deposita en un bucket S3 donde el servidor solo puede escribir y listar. La [guía de operaciones](https://doc.kadratis.com/es/on-premise/operations/#copia-de-seguridad-nocturna-cifrada-en-un-bucket-s3) explica la puesta en marcha, el control y la restauración.
- **Imágenes `kadratis-*`.** Desde 26.11.4, las imágenes publicadas se llaman `kadratis-api`, `kadratis-web` y `kadratis-api-tools`. El archivo compose de la versión las nombra explícitamente, y la actualización habitual las toma.
- **Las importaciones largas terminan.** El proxy del contenedor web espera 300 segundos las respuestas de la API: una importación o una sincronización larga ya no termina en una página 504.
- **Integraciones sin redirección.** Las llamadas a GLPI, PRTG, Netbox o al servidor de un modelo de IA ya no siguen una redirección a otra dirección, por ejemplo de `http://` a `https://`. Compruebe que las direcciones guardadas son las direcciones finales.

## Actualizar

En el servicio alojado no hay nada que hacer: ya está en 26.11.9.

Si aloja Kadratis y sigue la rama estable, pase directamente a 26.11.9. No se requiere ninguna acción, y las migraciones se ejecutan al arrancar. Lea antes la sección on-premise de las notas de las versiones [26.11.5](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.5), [26.11.7](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.7), [26.11.8](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.8) y [26.11.9](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.9). El procedimiento está en la [guía de operaciones](https://doc.kadratis.com/es/on-premise/operations/#procedimiento-de-actualizacion).

## Seguir las nuevas versiones

- **En GitHub**: siga el repositorio y elija «Releases» para recibir un aviso con cada versión.
- **En el blog**: suscríbase al [feed RSS](/es/blog/rss.xml).
- **En el sitio**: el [changelog](/es/changelog) lista todos los artículos de versión.

[Detalles técnicos y lista completa de cambios](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.9)
