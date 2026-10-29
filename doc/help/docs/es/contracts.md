# Contratos

Los contratos documentan sus acuerdos con proveedores: licencias de software, contratos de mantenimiento, suscripciones SaaS y contratos de servicio. KANAP fecha cada periodo de un contrato, le indica cuándo hay una decisión de renovación pendiente, compara lo que el contrato compromete con las líneas presupuestarias vinculadas y enumera las cláusulas que sus aplicaciones hacen necesarias.

## Primeros pasos

Vaya a **Gestión presupuestaria > Contratos** para ver la lista. Haga clic en **Nuevo** para crear un contrato (`contracts:member`).

La página se abre con un único formulario. Rellénelo y haga clic en **Crear**.

**Campos obligatorios**:

- **Nombre del contrato**: un nombre fácil de reconocer
- **Proveedor** y **Empresa contratante**: quién presta el servicio y cuál de sus empresas firmó
- **Inicio**: el primer día del contrato
- **Duración (meses)**: la duración de un periodo, al menos un mes
- **Moneda**: una de las monedas de su espacio de trabajo, la predeterminada para empezar

**Campos opcionales**:

- **Responsable**: la persona que gestiona el contrato. El responsable recibe las tareas de decisión de renovación, así que indíquelo
- **Renovación tácita**: **Sí** por defecto
- **Preaviso (meses)**: vacío significa sin preaviso
- **Importe anual**: el valor anual en la firma, con dos decimales como máximo. Vacío significa 0
- **Facturación**: **Anual** por defecto, o **Trimestral**, **Mensual**, **Otra**

Una vez creado el contrato, cada cambio se guarda solo. No hay botón **Guardar**.

---

## Periodos y vencimientos

KANAP calcula las fechas de un contrato a partir de cuatro campos: **Inicio**, **Duración (meses)**, **Preaviso (meses)** y **Renovación tácita**, más el **Fin de validez** cuando se indica. No se almacena nada: cambie un campo y todas las fechas se ajustan.

- **Periodos**: un contrato transcurre en periodos de la duración elegida, contados desde la fecha de inicio. Un contrato que empieza el 1 de julio de 2024 por 12 meses va del 1 de julio al 30 de junio cada año.
- **Fecha límite de rescisión**: el fin de un periodo menos el preaviso. Con 6 meses de preaviso, el contrato anterior puede rescindirse hasta el 30 de diciembre de cada año.
- **Renovación tácita**: con **Sí**, los periodos se suceden hasta que un fin de validez los detiene. Con **No**, el contrato se detiene tras su primer periodo. Si tiene un fin de validez, transcurre periodo tras periodo hasta ese día, de modo que un contrato cuya renovación se desactivó conserva los periodos que ya ha cumplido.
- **Fin de validez**: el día en que el contrato se detiene. Ningún periodo empieza después. Si cae dentro de un periodo, el contrato se detiene ese día.
- **Meses a fin de mes**: cuando el mismo día no existe en el mes de destino, se toma el último día de ese mes. El 31 de marzo menos un mes es el 28 de febrero (el 29 en un año bisiesto).

Todas las fechas son días naturales en UTC.

---

## Trabajar con la lista

Cada fila abre el contrato. Su búsqueda, sus filtros y su orden se conservan al volver, y **Anterior** / **Siguiente** en la ficha recorren el mismo conjunto.

**Columnas por defecto**:

- **Contrato**, **Proveedor**, **Empresa**
- **Próximo vencimiento**: la próxima fecha límite de rescisión de un contrato con renovación tácita, o el fin de cualquier otro contrato. La fecha va seguida de «dentro de n días». Un contrato vencido muestra en gris el día en que terminó
- **Situación**: vea más abajo
- **Importe anual**: el importe en la firma, seguido de su moneda
- **Comprometido**, **Presupuesto** y **Diferencia** del año presupuestario elegido. Vea [Columnas de presupuesto](#columnas-de-presupuesto)
- **Conformidad**: el resumen de la pestaña [Conformidad](#conformidad): «2 ausentes · 1 por verificar» en naranja, **Completo** o **Sin expectativas**
- **Líneas vinculadas**: el número de líneas presupuestarias vinculadas, OPEX y CAPEX juntas
- **Estado**: **Activado** o **Desactivado**, según el fin de validez

**Otras columnas** (selector de columnas): **Mon.**, **Cobertura del presupuesto**, **Inicio**, **Duración (m)**, **Renovación auto.**, **Preaviso (m)**, **Fin del periodo** (fin del periodo en curso), **Cancelar antes de** (próxima fecha límite de rescisión), **Facturación** y **Tarea** (la última tarea del contrato).

**Orden por defecto**: por **Próximo vencimiento**, el más cercano primero. Los contratos vencidos quedan abajo en ambos sentidos.

### Situación

Cada contrato tiene una situación, la primera que se aplica:

- **Por decidir** (naranja): hay una decisión pendiente. En un contrato con renovación tácita, su próxima fecha límite de rescisión cae dentro del plazo de decisión y su renovación no se ha confirmado para ese periodo. En un contrato sin renovación, su fin cae dentro del plazo y nadie ha confirmado que deba terminar. Vea [Decisiones de renovación](#decisiones-de-renovacion)
- **Termina sin renovación**: el contrato está en su último periodo y se detendrá al final
- **Renovado el** una fecha: la fecha límite de rescisión del periodo en curso ya pasó, así que el contrato continúa en el periodo siguiente, que empieza en esa fecha
- **En curso**: el contrato sigue y todavía no hay nada pendiente
- **Vencido**: el contrato ha terminado

### Filtros rápidos

Los enlaces sobre la tabla filtran la lista con un clic. Haga clic de nuevo para quitar el filtro.

- **Por decidir en n días (n)**: los contratos en situación **Por decidir**. El número de días es el plazo de decisión de su espacio de trabajo
- **Sin línea presupuestaria (n)** e **Infrapresupuestados (n)**: los contratos cuya cobertura presupuestaria del año elegido está en esa situación
- **Sin centro de coste**: los contratos sin **Centro de coste o grupo**. La columna **Centro de coste** (selector de columnas) muestra el campo

Un punto naranja señala un enlace cuyo contador no es cero.

### Columnas de presupuesto

Con acceso de lectura a las líneas presupuestarias (`budget:reader`), la derecha de la barra de herramientas muestra **Presupuesto** con un año y una columna de presupuesto (los nombres de columna de su espacio de trabajo). La elección es solo suya. Se comparte con la pestaña **Presupuesto** de cada contrato y se conserva para su próxima visita. Empieza en el año próximo y la columna predeterminada de su espacio de trabajo.

- **Comprometido** (año): lo que el contrato compromete para ese año, en su moneda de reporte. Vea [Compromiso](#compromiso-y-cobertura)
- **Presupuesto** (año): la suma de los importes de las líneas vinculadas en ese año y esa columna
- **Diferencia**: presupuesto menos compromiso. Un déficit se muestra en naranja. **Sin línea** significa que no hay nada presupuestado en una línea vinculada, y **Contrato vencido** que queda presupuesto en un contrato terminado
- **Cobertura del presupuesto** (oculta por defecto): una de las seis situaciones de cobertura

Un contrato en una moneda sin tipo de cambio para el año muestra «Sin tipo de cambio USD» en lugar de un importe.

Cuando una línea presupuestaria vinculada no tiene tipo de cambio para el año, el importe **Presupuesto** la excluye y muestra una pequeña marca naranja. **Diferencia** y **Cobertura del presupuesto** quedan vacías, porque la cobertura es desconocida. Un aviso de una línea bajo la lista indica las líneas excluidas, por ejemplo «Se excluye 1 línea sin tipo de cambio: USD 2026.» Vea [Tipos manuales](currencies.md#tipos-manuales). Sin el permiso de presupuesto, estas columnas, el selector y los dos filtros rápidos de presupuesto están ocultos.

### Fila de total

La fila fijada abajo dice **Total (n contratos)**. Suma los importes anuales de los contratos que muestra la lista, convertidos a su moneda de reporte con los últimos tipos del año, y las tres columnas de presupuesto. Una moneda sin tipo de cambio queda fuera de la suma y se nombra, por ejemplo «excluye 2 contratos en GBP sin tipo de cambio».

### Búsqueda, filtros y alcance

- **Búsqueda rápida**: nombre del contrato, proveedor y empresa
- **Filtros de columna**: en cada encabezado de columna. **Situación**, **Conformidad** y **Cobertura del presupuesto** ofrecen sus valores como casillas. El filtro **Estado** muestra la opción de **Mostrar** (**Todos**, **Activos** o **Desactivados**): cambiar uno cambia el otro
- **Mostrar: Todos / Activos / Desactivados**: el selector sobre la lista. La lista muestra por defecto los contratos activados. Elija **Todos** o **Desactivados** para encontrar los contratos cuyo fin de validez ya pasó

### Acciones

- **Nuevo**: crear un contrato (`contracts:member`)
- **Importar** y **Exportar**: vea [Importación y exportación CSV](#importacion-y-exportacion-csv) (`contracts:admin`)
- **Exportar el registro**: el registro de conformidad de los contratos que muestra la lista (`contracts:admin`). Vea [Conformidad](#conformidad)
- **Ajustes**: el plazo de decisión del espacio de trabajo (`contracts:admin`). Vea [Plazo de decisión](#plazo-de-decision)
- **Eliminar**: eliminar los contratos marcados (`contracts:admin`). Vea [Eliminar un contrato](#eliminar-un-contrato)

---

## La ficha del contrato

### Encabezado y propiedades

El encabezado muestra el nombre del contrato (haga clic para cambiarlo), **Anterior** / **Siguiente** con la posición en la lista, y una barra con **Proveedor**, **Empresa contratante**, **Responsable** y **Estado**. El responsable y el estado se cambian ahí mismo. El proveedor y la empresa abren el panel **Propiedades**.

El panel **Propiedades**, a la derecha, contiene todos los campos del contrato: las partes, **Inicio**, **Duración (meses)**, **Preaviso (meses)**, **Renovación tácita**, **Importe anual**, **Moneda**, **Facturación**, luego **Ciclo de vida** (**Estado** y **Fin de validez**), **Creado** y **Actualizado**. Ábralo o ciérrelo con su botón; KANAP recuerda su elección.

**Centro de coste o grupo** es opcional. Sitúa el contrato bajo un centro de coste o un grupo para el [acceso a los datos](data-access.md): las personas limitadas a ese nodo, o a un grupo superior, ven el contrato, igual que las limitadas a su empresa.

Cada cambio se guarda solo: listas y fechas al instante, valores escritos y notas tras una breve pausa, el nombre al salir del campo. «Guardando...» y después «Guardado» aparece en el encabezado. Dos personas que editan el mismo contrato no reciben aviso: prevalece el último cambio.

**Ciclo de vida**:

- Pasar a **Desactivado** fija el fin de validez en este momento: la desactivación es inmediata. Mientras haya una fecha futura, el interruptor muestra **Activo hasta el** y esa fecha. Volver a **Activado** quita el fin de validez
- **Fin de validez**: escriba una fecha (dd/mm/aaaa) o use el calendario. Déjelo en blanco para mantener el contrato activo
- **Renovación tácita** tiene sus propias reglas cuando el contrato ya se ha renovado o espera una decisión. Vea [Desactivar o reactivar la renovación tácita](#desactivar-o-reactivar-la-renovacion-tacita)

Necesita `contracts:member` para editar. Los lectores ven la misma página con todos los campos bloqueados.

**Compartir**, en el encabezado, envía por correo un enlace al contrato a colegas de su espacio de trabajo.

La ficha tiene cinco pestañas: **Vista general**, **Presupuesto**, **Conformidad**, **Relaciones** e **Historial** (los cambios del contrato, vea [Historial de los registros](record-history.md)). Las direcciones de las antiguas pestañas **Detalles** y **Tareas** abren la vista general.

### Vista general

**Vencimientos** resume la situación del contrato:

- Una frase sobre lo que viene: «Rescisión posible hasta el 30 dic. 2026 · dentro de 78 días», «Preaviso vencido, renovado hasta el 30 jun. 2027», «Termina el 31 mar. 2027 sin renovación» o «Vencido el 31 dic. 2025». Cuando hay una decisión pendiente sobre el fin de un contrato sin renovación, la frase añade «decisión pendiente» con un punto naranja
- Una línea de tiempo de los periodos: periodos pasados, el periodo en curso, hoy, la próxima fecha límite de rescisión y el plazo de decisión anterior a ella. El periodo siguiente aparece discontinuo mientras todavía puede rescindirse, y continuo una vez vencido el preaviso
- Una línea de datos: el periodo en curso con sus fechas, cuántas veces se ha renovado el contrato y desde cuándo, y el preaviso

Una vez confirmada una renovación, la frase dice «Renovación confirmada · próximo periodo del 1 jul. 2027 al 30 jun. 2028» y la línea de tiempo deja de mostrar esa fecha límite.

La ficha recalcula estas fechas mientras edita el inicio, la duración, el preaviso o la renovación.

**Decisión de renovación**: cuando hay una decisión pendiente, aparece un recuadro con borde naranja bajo los vencimientos. Vea [Decisiones de renovación](#decisiones-de-renovacion).

**Tareas**: las tareas abiertas del contrato, con su referencia, asignado, fecha de vencimiento y estado. **Mostrar las tareas terminadas (n)** añade las terminadas. **Nueva tarea** crea una tarea vinculada al contrato. Abra una tarea para cambiarla o eliminarla.

**Notas**: texto libre con formato Markdown. La barra de herramientas aparece al hacer clic en el editor.

### Presupuesto

La pestaña enumera las líneas presupuestarias vinculadas, OPEX y CAPEX juntas, con su referencia (`BL-12`), nombre, tipo y empresa. Use el selector bajo la tabla para vincular o quitar líneas.

Con acceso de lectura a las líneas presupuestarias (`budget:reader`), la pestaña muestra también cifras:

- Pestañas de año y un selector **Columna**, la misma elección que las columnas de presupuesto de la lista
- El importe de cada línea en ese año y esa columna, con una fila **Total (n líneas)**
- **Compromiso y cobertura**: una fila por año ofrecido, con el año elegido resaltado. Haga clic en una fila para elegir su año

Los años ofrecidos son el año en curso y los dos siguientes, más el año anterior cuando el presupuesto tiene líneas para él.

#### Compromiso y cobertura

**Comprometido por el contrato** es el importe anual en la firma repartido sobre los meses del año que cubre un periodo. Un mes cubierto en parte cuenta según sus días. Los años siguientes suponen que la renovación continúa hasta que se detenga, y no se compromete nada después del fin de validez o del fin del contrato. El importe en la firma vale para cada periodo. El compromiso se convierte a su moneda de reporte con los tipos del año.

Por ejemplo, un contrato de 350 000 al año que se renueva cada 1 de julio compromete 350 000 cada año. Si termina el 30 de junio de 2027, compromete 175 000 en 2027 y nada en 2028.

**Líneas vinculadas** suma los importes de las líneas vinculadas en ese año y esa columna. **Diferencia** es la resta entre ambos. La situación es la primera que se aplica:

- **Sin compromiso**: el contrato no compromete nada ese año y ninguna línea vinculada tiene importe
- **Presupuesto aún no iniciado**: ninguna línea presupuestaria de su espacio de trabajo tiene importe en ese año y esa columna
- **Sin línea presupuestaria**: ninguna línea vinculada tiene importe
- **Infrapresupuestado**: las líneas vinculadas suman menos que el compromiso
- **Presupuesto superior al contrato**: las líneas vinculadas suman más que el compromiso más un 10 %
- **Cubierto**: cualquier otro caso

Para una persona con el acceso a los datos limitado, la pestaña lista las líneas vinculadas que ve y después el número de las demás. La cobertura sigue contando todas las líneas vinculadas, para que el responsable del contrato vea la cobertura real. En la lista, cada fila muestra también esa cobertura completa, mientras que la fila de totales cuenta los contratos visibles y **Líneas vinculadas** cuenta las líneas visibles. Vea [Acceso a los datos](data-access.md#what-a-limited-person-sees).

Cuando una línea vinculada no tiene tipo de cambio para un año, su importe se muestra en su propia moneda con una pequeña marca naranja, y el total y **Líneas vinculadas** la excluyen. La situación de ese año indica **Desconocido: una línea vinculada no tiene tipo de cambio**. Un aviso de una línea bajo la tabla de cobertura indica las líneas excluidas, por ejemplo «Se excluye 1 línea sin tipo de cambio: USD 2026.» Vea [Tasa faltante](currencies.md#mecanicas-de-conversion-referencia-rapida) y [Tipos manuales](currencies.md#tipos-manuales).

### Conformidad

La pestaña enumera las cláusulas que se espera que contenga un contrato, según las aplicaciones que cubre, y le permite registrar si el contrato las contiene. Le ayuda a llevar un registro. No certifica la conformidad con ninguna normativa.

**Requisitos**: **Contrato de encargado del tratamiento RGPD (art. 28)**, **Ubicación de los datos**, **Cláusula de reversibilidad**, **Plan de salida**, **Derecho de auditoría y cláusulas de seguridad**.

**Por qué se espera un requisito**: el contrato cubre las aplicaciones vinculadas a él, y las aplicaciones con una instancia en un activo vinculado a él o cuyo contrato de soporte es. Una aplicación cuyo fin de validez ya pasó deja de contar.

- Una aplicación que contiene datos personales hace esperar el contrato de encargado del tratamiento y la ubicación de los datos
- Una criticidad de negocio o cibernética alta hace esperar la cláusula de reversibilidad, el plan de salida y el derecho de auditoría. Alta significa los dos niveles más severos de su catálogo (solo el más severo cuando el catálogo tiene menos de tres niveles)
- Una instancia alojada en la nube hace esperar la ubicación de los datos. La categoría del tipo de alojamiento en **Panorama IT > Configuración** decide qué cuenta como nube

La columna **Esperado porque** da el primer motivo, por ejemplo «SAP S/4HANA contiene datos personales», y luego «y n más». Pase el ratón por encima para leerlos todos. Un motivo que procede de un activo lo nombra si puede leer la infraestructura. Una aplicación que no puede leer (o, para un Colaborador de negocio, una en la que no participa) aparece como «Una aplicación que no puede ver»: el requisito sigue siendo esperado.

**Registro**: elija un estado para cada requisito: **Presente**, **Ausente** o **No aplica**. Se guarda al instante. Un requisito esperado sin estado indica **Por verificar**. Escriba una **Referencia** (por ejemplo «artículo 18.3»); se guarda al salir del campo o al pulsar Intro. Pase el ratón sobre una fila para ver cuándo y quién la actualizó por última vez.

**Mostrar los demás requisitos (n)** añade los requisitos que nada hace necesarios, para que también pueda registrarlos. Cuando no se espera nada, la pestaña lo dice en una línea.

La insignia de la pestaña cuenta los requisitos esperados registrados como ausentes. En la lista, la columna **Conformidad** indica:

- **n ausentes** (y «· n por verificar»), en naranja
- **n por verificar**
- **Completo**: cada requisito esperado está presente o no aplica
- **Sin expectativas**

Vincular o quitar una aplicación o un activo en **Relaciones** actualiza la pestaña al instante. Necesita `contracts:member` para registrar; los lectores ven la pestaña en solo lectura.

**Exportar el registro** (lista, `contracts:admin`) descarga un archivo CSV o Excel de los contratos que muestra la lista, con su búsqueda, sus filtros, su alcance y su orden: una línea por contrato y requisito, con si se espera, el motivo, el estado, la referencia y la última actualización. Los encabezados y las palabras siguen el idioma de su pantalla.

### Relaciones

La pestaña Relaciones muestra lo que cubre este contrato: sus aplicaciones, activos y tecnologías, cada uno en su propia tabla, y después sugerencias, los contactos, y los enlaces y archivos. Haga clic en una fila para abrir el registro. Las líneas presupuestarias se vinculan en la pestaña [Presupuesto](#presupuesto).

**Registros vinculados**, una tabla cada uno:

| Sección | Columnas |
|---|---|
| **Aplicaciones** | Referencia (`APP-3`), nombre, ciclo de vida, criticidad de negocio. Solo visible si puede leer las aplicaciones. Un Business Contributor ve las aplicaciones en las que participa |
| **Activos** | Referencia (`AST-12`), nombre, tipo, entorno, estado. Solo visible si puede leer la infraestructura |
| **Tecnologías** | Referencia (`TEC-5`), nombre, familia, editor. Solo visible si puede leer la infraestructura |

Una aplicación o un activo desactivado o retirado sigue en la lista con el nombre atenuado. Las aplicaciones y los activos alimentan la pestaña [Conformidad](#conformidad). Un activo cuyo contrato de soporte es este, indicado en la ficha del activo, no aparece aquí. Cuenta igualmente para la conformidad.

**Añadir y quitar vínculos** (`contracts:member`): **Añadir**, a la derecha de una sección, abre una búsqueda. Escriba un nombre o una referencia y elija un resultado: el vínculo se guarda al instante. La búsqueda ofrece las aplicaciones y los activos que usted puede ver. Las tecnologías retiradas no se ofrecen. Para quitar un vínculo, pase el cursor sobre la fila y haga clic en la cruz al final. Quitar un vínculo no elimina nada más. Vincular una aplicación requiere también poder leer las aplicaciones, y vincular un activo o una tecnología, poder leer la infraestructura. Un Business Contributor vincula y quita solo las aplicaciones en las que participa; las demás aplicaciones del contrato siguen vinculadas. Los lectores ven las tablas en solo lectura.

**Relacionados**: las aplicaciones y los activos del proveedor del contrato que aún no están vinculados, con el motivo «mismo proveedor». Un activo pertenece al proveedor por su proveedor de soporte. Haga clic en **Vincular** para añadir la sugerencia a su sección. Las sugerencias muestran:

- las aplicaciones en servicio, si puede leer las aplicaciones. Un Colaborador de negocio solo ve las aplicaciones en las que participa;
- los activos que no están retirados, si puede leer la infraestructura;
- 20 como máximo de cada tipo.

La sección no aparece cuando no hay nada que sugerir.

**Contactos**: personas de este contrato, cada una con un rol (Comercial, Técnico, Soporte u Otro). **Agregar los contactos del proveedor** copia los contactos del proveedor con un clic.

**Enlaces y archivos**: los enlaces web del contrato (el PDF firmado en línea, el portal del proveedor) y sus archivos, una fila cada uno con su nombre, el dominio del enlace o el tamaño del archivo, y la fecha en que se añadió. Haga clic en un enlace para abrirlo en una pestaña nueva, o en un archivo para descargarlo. Con `contracts:member`:

- **Añadir enlace** abre un diálogo para una URL y un nombre opcional; el enlace se guarda al instante. Para cambiar un enlace, pase el cursor sobre su fila y haga clic en el lápiz.
- **Adjuntar archivo** abre el selector de archivos. También puede soltar archivos sobre la sección.
- Para quitar un enlace o un archivo, pase el cursor sobre la fila y haga clic en la cruz. Eliminar un archivo pide una confirmación antes.

### Eliminar un contrato

**Eliminar** (icono de papelera), en la cabecera de la página del contrato o en la lista para los contratos marcados, elimina contratos (`contracts:admin`). Esta acción no se puede deshacer.

- Los vínculos se quitan y los elementos vinculados se conservan: las líneas presupuestarias, aplicaciones, activos (también aquellos de los que es el contrato de soporte) y contactos pierden su vínculo con el contrato
- Lo que pertenece al contrato se elimina con él: sus tareas (incluida la tarea de decisión de renovación), sitios web relevantes y adjuntos
- Un contrato con requisitos de conformidad registrados (un estado, incluido **No aplica**, o una referencia) no se puede eliminar: KANAP indica cuántos hay registrados y propone desactivarlo en su lugar. En la lista, la confirmación nombra los contratos que se conservan, con su número, antes de eliminar nada; los demás se eliminan
- Siempre aparece primero una confirmación. Cuenta lo que pierde su vínculo y lo que también se elimina, o indica que el contrato no está vinculado a nada

Para dejar de usar un contrato y conservar su historial, desactívelo en su lugar.

---

## Decisiones de renovación

KANAP pide al responsable que decida cada renovación antes de que ocurra, y registra la decisión.

### Plazo de decisión

Un contrato con renovación tácita espera una decisión cuando su próxima fecha límite de rescisión cae dentro del plazo de decisión. Un contrato sin renovación espera una cuando su fin cae dentro del plazo. El plazo es de 90 días por defecto. Los administradores de contratos lo cambian con **Ajustes** en la lista, de 0 a 365 días.

El plazo determina la situación **Por decidir**, el filtro rápido, el recuadro de decisión, la línea de tiempo y las tareas de decisión.

### La tarea de decisión

Cada día a las 07:30 UTC, KANAP crea una tarea para cada contrato que espera una decisión:

- **Decidir la renovación de** el contrato, con vencimiento en la fecha límite de rescisión, para un contrato con renovación tácita
- **Decidir si renovar o dejar terminar** el contrato, con vencimiento en su fin, para un contrato sin renovación

La tarea se asigna al responsable del contrato, con el correo de asignación habitual. Su texto está en el idioma del responsable, o en el idioma del espacio de trabajo cuando el responsable no ha elegido uno. Hay una tarea por contrato y periodo. Una tarea eliminada no se vuelve a crear para ese periodo. Un contrato sin responsable no recibe tarea hasta que se indique uno.

El recuadro de decisión y la tarea van a la par: una decisión tomada en el recuadro cierra la tarea, con la justificación como comentario.

### Decidir

El recuadro muestra la fecha límite, los días restantes, la tarea y su asignado, y lo que ocurre sin decisión («Sin decisión, el contrato se renovará por 12 meses el 1 jul. 2027.»). Escriba una **Justificación** opcional y elija:

- **Renovar**: la renovación queda confirmada para este periodo. La tarea se cierra, el contrato sale de **Por decidir** y vuelve al plazo en la fecha límite del periodo siguiente
- **Renegociar**: el recuadro indica **Renegociación en curso** y la tarea sigue abierta hasta la decisión final. El contrato sigue **Por decidir**
- **Rescindir**: el recuadro muestra la fecha de fin que debe confirmar. KANAP propone el primer fin que permite el preaviso («Preaviso de 6 meses: el primer fin posible es el 30 jun. 2027.»). Puede elegir otro día, a partir de hoy y del inicio del contrato. Un día anterior al propuesto muestra un aviso naranja: el proveedor tiene que aceptarlo. El recuadro enumera las consecuencias para ese día: el compromiso del año y del siguiente, las aplicaciones que pierden este contrato y los activos que pierden su contrato de soporte, cada uno si puede leer su módulo. **Confirmar la rescisión** desactiva la renovación tácita, fija el fin de validez en ese día y cierra la tarea. El contrato indica entonces **Termina sin renovación** y su compromiso se detiene ese día

En un contrato sin renovación, el recuadro dice «Fin prevista el 31 mar. 2027 · decisión pendiente» y ofrece dos acciones:

- **Renovar**: reactiva la renovación tácita y quita el fin de validez
- **Dejar terminar**: confirma el fin. No cambia nada más

Una vez decidido, el recuadro se reduce a una línea, por ejemplo «Renovación confirmada el 2 oct. 2026 por Sophie Laurent. El contrato se renueva el 1 jul. 2027.», con la tarea y la justificación. Tras una rescisión, recuerda enviar la carta de rescisión antes de la fecha límite y adjuntarla en **Relaciones**.

**Anular la decisión** devuelve el contrato y la tarea a su estado anterior: antes de la fecha límite de rescisión, o antes del fin en un contrato sin renovación.

Necesita `contracts:member` para decidir. Los lectores ven el recuadro sin sus acciones.

### Desactivar o reactivar la renovación tácita

**Renovación tácita**, en el panel **Propiedades**, sigue las mismas reglas.

**No** en un contrato ya renovado, o en uno que espera una decisión de renovación, abre **Desactivar la renovación tácita**. La ventana propone una fecha de fin como una rescisión (primer fin que permite el preaviso, cualquier día a partir de hoy, aviso naranja antes del día propuesto, consecuencias para el día elegido) y dice «El contrato terminará el 30 jun. 2027, salvo renovación.». En un contrato ya renovado, añade que sus periodos anteriores se conservan. **Desactivar la renovación** fija ese fin de validez y el campo indica **No**. **Cancelar** no cambia nada.

No se registra ninguna decisión. El contrato espera ahora una decisión sobre su fin: una tarea de decisión abierta pasa a ser «Decidir si renovar o dejar terminar» el contrato, con vencimiento en el nuevo fin y un comentario que explica el motivo. Sin tarea abierta, se crea una cuando el fin cae dentro del plazo.

En un contrato en su primer periodo sin decisión pendiente, **No** se aplica al instante: el contrato se detiene al final de su primer periodo.

**Sí** en un contrato sin renovación que tiene un fin de validez abre **Reactivar la renovación tácita**: «El contrato se renovará tácitamente y se retirará el fin del 31 mar. 2027.». **Reactivar la renovación** lo aplica, sea cual sea el origen de ese fin. Cuando había una decisión pendiente sobre el fin, esto cuenta como **Renovar** y puede anularse. Si no, la tarea abierta sobre el fin pasa a ser la tarea de decisión de renovación cuando esa decisión está pendiente, o se cierra. Sin fin de validez, **Sí** se aplica al instante.

---

## Importación y exportación CSV

La exportación escribe un archivo CSV o un libro de Excel (`.xlsx`): elija en **Formato** en el diálogo. La importación lee los dos. Consulte [Archivos CSV y Excel](csv-files.md).

Mantenga su lista de contratos sincronizada con otras herramientas mediante archivos CSV o libros de Excel (`contracts:admin`).

**Exportar**: descarga los contratos que muestra la lista (o, a petición en el diálogo, todos los contratos) con estas columnas: `name`, `company_name`, `supplier_name`, `start_date`, `duration_months`, `auto_renewal`, `notice_period_months`, `yearly_amount_at_signature`, `currency`, `billing_frequency`, `status`, `owner_email`, `notes`. Las fechas calculadas (fin del periodo, fechas límite, situación) no se exportan.

**Importar**:

- Utilice **Verificación previa** para comprobar el archivo antes de aplicarlo
- Una fila corresponde a un contrato por su nombre y su proveedor
- Admite creación y actualizaciones
- El archivo no tiene columna de fin de validez. En una actualización, un `status` vacío, o igual al estado actual del contrato, conserva su fin de validez. Un estado distinto se aplica: `enabled` borra el fin de validez, y `disabled` termina el contrato hoy, salvo que su fin de validez ya haya pasado
- Un contrato nuevo queda activado salvo que la fila indique `disabled`
- Una fila que pone `auto_renewal` a false en un contrato ya renovado y sin fin de validez se rechaza, verificación previa incluida: borraría los periodos que el contrato ha cumplido. Desactive la renovación desde la ficha del contrato, que fija el fin

**Notas**:

- Consulte [Archivos CSV y Excel](csv-files.md) para la codificación, el separador, los formatos de fecha e importe y los dos pasos de importación
- Las fechas se calculan a partir del inicio, la duración, el preaviso y la renovación; nunca se importan

---

## Consejos

- **Indique un responsable en cada contrato**: las tareas de decisión de renovación van al responsable. Un contrato sin responsable no recibe ninguna tarea.
- **Empiece la semana con Por decidir**: el filtro rápido enumera los contratos con decisión pendiente, y el recuadro de decisión de cada uno muestra lo que ocurre sin decisión.
- **Vincule pronto las líneas presupuestarias**: la **Diferencia** y el filtro **Infrapresupuestados** solo sirven si el contrato está vinculado a las líneas que lo pagan.
- **Registre el importe anual**: aunque la facturación sea mensual, el importe anual alimenta el compromiso y los totales.
- **Vincule aplicaciones y activos**: deciden qué cláusulas se espera que contenga el contrato.
- **Comparta un contrato**: use **Compartir** o copie la dirección de la página. Abre la misma pestaña y conserva el contexto de su lista.
