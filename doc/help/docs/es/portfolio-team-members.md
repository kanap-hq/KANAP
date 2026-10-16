# Colaboradores

Colaboradores le permite definir competencias, asignaciones de equipo, disponibilidad para proyectos y valores predeterminados de clasificación para las personas que trabajan en proyectos del portafolio. Esta información ayuda con la planificación de recursos y asegura que tenga la experiencia adecuada para el trabajo futuro.

## Primeros pasos

Navegue a **Portafolio > Colaboradores** para ver los colaboradores configurados agrupados por equipo. Haga clic en **Agregar colaborador** para añadir a alguien de su lista de usuarios.

**Para añadir un colaborador**:
1. Haga clic en **Agregar colaborador**
2. Busque y seleccione un usuario del desplegable
3. Haga clic en **Añadir** para crear su perfil
4. Configure su equipo, disponibilidad, competencias y valores predeterminados en el espacio de trabajo

**Consejo**: Los colaboradores son diferentes de las cuentas de usuario. Añadir a alguien como colaborador no cambia su acceso de inicio de sesión -- solo le permite rastrear su pertenencia a equipo, competencias, disponibilidad y valores predeterminados de clasificación para la planificación de proyectos.

---

## Dónde encontrarlo

- Espacio de trabajo: **Portafolio**
- Ruta: **Portafolio > Colaboradores**
- Ruta de autoservicio: **Configuración > Perfil > Configuración de colaborador** (abre su propio perfil de colaborador)
- Permisos:
  - Ver: `portfolio_settings:reader`
  - Añadir o editar colaboradores: `portfolio_settings:member`
  - Eliminar colaboradores: `portfolio_settings:admin`
  - Editar su propio perfil: cualquier permiso de lectura a nivel de portafolio (p. ej., `tasks:reader`, `portfolio_projects:reader`, `portfolio_settings:reader`)

Si no ve Colaboradores en el menú, solicite a su administrador que le otorgue los permisos apropiados.

---

## Trabajar con la lista

Los colaboradores se muestran como tarjetas agrupadas por equipo.

**Cada tarjeta de colaborador muestra**:
- **Nombre** (o correo si no hay nombre establecido)
- **Número de competencias**: Cantidad de competencias configuradas (p. ej., "3 competencias")
- **Disponibilidad**: Días por mes disponibles para proyectos (p. ej., "5d/mes")
- **Esfuerzo medio en proyectos**: Tiempo medio mensual en proyectos de las entradas registradas en los últimos 6 meses, cuando hay datos disponibles

**Filtrado**:
- Use el desplegable **Filtrar por equipo** para mostrar solo colaboradores de un equipo específico
- Seleccione **Sin asignar** para ver colaboradores que no han sido asignados a un equipo todavía
- Seleccione **Todos los equipos** para ver a todos
- Use el desplegable **Filtrar por tipo de contrato** que está al lado para mostrar solo al personal interno, solo a los externos, y así sucesivamente. Ambos filtros se combinan y se aplican tanto a la lista como a la matriz de competencias. El organigrama dispone de sus propios controles, porque una línea jerárquica atraviesa los equipos.

**Grupos de equipo**:
- Cada equipo se muestra como una tarjeta plegable con un indicador de número de miembros
- Haga clic en el encabezado del equipo para expandir o contraer sus miembros
- Los equipos se ordenan alfabéticamente; **Sin asignar** siempre aparece último

Haga clic en cualquier tarjeta de colaborador para abrir su espacio de trabajo.

**Cambiar de vista**:
Encima del filtro por equipo, **Lista**, **Matriz de competencias** y **Organigrama** alternan entre tres lecturas de las mismas personas. El filtro por equipo se aplica a las dos primeras. La dirección cambia a `?view=matrix` o `?view=org`, de modo que un enlace puede guardarse en favoritos o compartirse, y la última vista utilizada se recuerda en su navegador.

---

## La matriz de competencias

La matriz de competencias responde a dos preguntas en una sola pantalla: qué sabe hacer cada persona y qué competencias no cubre nadie. Es una vista de solo lectura: los niveles se definen en la pestaña Competencias de cada colaborador.

**Leer la cuadrícula**:
- Las **filas** son las competencias de su catálogo, agrupadas por categoría. Las competencias desactivadas en la configuración del portafolio nunca aparecen, y las que nadie ha declarado están ocultas al principio
- Las **columnas** son los colaboradores, agrupados por equipo. Sus nombres se leen de abajo arriba; haga clic en uno para abrir su pestaña Competencias
- Las **celdas** contienen el nivel, de 1 a 4. Los niveles 3 y 4 (autónomo y experto) se muestran en color de texto pleno, los niveles 1 y 2 quedan atenuados, y una celda vacía significa que la competencia nunca se declaró para esa persona. Pase el cursor sobre una celda para leer el nombre del nivel
- La columna **Autónomo o experto** de la derecha cuenta, para cada competencia, cuántas de las personas en pantalla están en nivel 3 o 4. **El recuento se vuelve naranja cuando es cero**: nadie cubre actualmente esa competencia por su cuenta
- La línea **Competencias** de abajo resume a cada persona como «autónomo / declaradas», por ejemplo `2/5`

**Girar la cuadrícula**:
Los catálogos suelen ser más largos que los equipos, por eso los colaboradores ocupan las columnas de forma predeterminada y los nombres de las competencias se leen bien a lo largo de las filas. Use el control **Columnas** encima de la cuadrícula para poner las competencias en las columnas, lo que conviene a un catálogo corto o a un equipo grande. Todo cambia con él: los dos resúmenes cambian de lado, y un colaborador se abre entonces desde su fila en lugar de desde su encabezado de columna. La elección se recuerda en su navegador.

**Acotar la cuadrícula**:
- La cuadrícula empieza por las competencias que las personas realmente tienen. **Mostrar competencias sin uso** trae de vuelta el resto del catálogo, útil cuando prepara un plan de formación en lugar de leer lo que ya cubre
- Cada categoría de competencias tiene una píldora encima de la cuadrícula. Desactive una categoría para quitarla
- El filtro por equipo restringe las personas, y los recuentos de cobertura lo siguen: filtre por un equipo y leerá la cobertura de ese equipo
- Tanto las píldoras de categoría como el interruptor de competencias sin uso se recuerdan en su navegador

**Actuar sobre lo que ve**:
- Haga clic en un colaborador para abrir su pestaña **Competencias**, donde se pueden cambiar los niveles
- **Exportar**, junto a **Agregar colaborador** en la parte superior de la página, descarga lo que está en pantalla como archivo `.xlsx`, con la misma disposición, los niveles como números. Útil para revisiones de competencias y planes de formación

---

## El organigrama

El organigrama dibuja la línea jerárquica de sus colaboradores, construida a partir del **Responsable** definido en cada perfil. Todas las personas cuyo responsable no es colaborador se sitúan arriba, una al lado de la otra, de modo que se pueden leer varias ramas independientes a la vez.

**Leer una tarjeta**:
- Iniciales, nombre, puesto, tipo de contrato y número de competencias del perfil
- Haga clic en una tarjeta para abrir a ese colaborador
- Una tarjeta con personas por debajo lleva una pequeña flecha en su borde inferior. Haga clic para plegar esa rama y vuelva a hacer clic para desplegarla
- Pase el cursor sobre una tarjeta que haya subido en el organigrama para saber qué responsable se ha omitido, por ejemplo «Asignado a través de Claire Meunier»

**Quién aparece**:
- Solo se dibujan los colaboradores. Si el responsable de alguien no es colaborador, esa persona pasa a lo alto del organigrama en lugar de desaparecer
- Las cuentas desactivadas quedan fuera. **Incluir cuentas desactivadas** las recupera, lo que resulta útil mientras se traspasa una salida
- Cada tipo de contrato tiene una píldora encima del organigrama. Desactive una y esas personas salen del organigrama, **pero sus propios subordinados permanecen**: suben hasta el responsable visible más cercano. Ocultar a los externos mantiene así a su personal interno en un árbol legible en lugar de cortar ramas enteras

**Encuadrar el organigrama**:
- **Empezar por** reduce el organigrama a una persona y a todo lo que está por debajo de ella: así se produce el organigrama de un solo departamento
- **Niveles** limita hasta dónde baja el organigrama, por ejemplo los dos primeros niveles para una vista de dirección
- Los controles de zoom de la derecha escalan el dibujo; el organigrama se desplaza en ambas direcciones dentro de su marco
- Cada una de estas opciones queda escrita en la dirección, de modo que el organigrama de una rama puede enviarse como enlace exactamente con el encuadre que usted le dio

**Exportar e imprimir**:
- **Exportar a PNG**, junto a **Agregar colaborador** en la parte superior de la página, guarda el organigrama completo como imagen, siempre sobre fondo blanco sea cual sea el tema en el que lo esté consultando. La fecha de exportación figura en la esquina inferior izquierda. Las ramas plegadas siguen plegadas, y una tarjeta plegada lleva el número de personas ocultas debajo. El zoom en pantalla no cambia la imagen
- El comando de impresión de su navegador imprime el organigrama solo, en horizontal y sin la aplicación alrededor

---

## El espacio de trabajo del colaborador

Haga clic en una fila de colaborador para abrir su espacio de trabajo. El encabezado muestra la referencia del colaborador (`CTR-1`, `CTR-2`…, haga clic para copiarla), su nombre, su equipo, su disponibilidad y el número de competencias. La dirección de la página también usa esta referencia. Use las flechas junto al enlace de retorno (o las teclas de flecha izquierda y derecha) para pasar al colaborador anterior o siguiente en el orden de la lista. Pulse **Esc** para volver a la lista.

El espacio de trabajo tiene tres pestañas, **General**, **Competencias** y **Tiempo registrado**, además de un panel **Propiedades** a la derecha que reúne el puesto, el equipo, la disponibilidad y los valores predeterminados de clasificación. Abra o cierre el panel con la pestaña situada en su borde, o pulse **P**.

Cada cambio se guarda automáticamente. Una breve nota «Guardando… / Guardado» aparece junto a los metadatos del encabezado mientras se escribe un cambio.

### Panel Propiedades

**Puesto**
El puesto de la persona, el mismo que aparece en todos los lugares donde figura en KANAP -- el organigrama, su ficha de usuario, su perfil. No es una etiqueta propia de la cartera: cambiarlo aquí lo cambia en todas partes. Escríbalo y haga clic fuera para guardar.

Siempre puede definir el suyo. Definir el de otra persona requiere el nivel **Administrador** sobre los usuarios; sin ese permiso sigue viendo el valor, pero el campo es de solo lectura.

Cuando la cuenta proviene de Microsoft Entra, el campo es de solo lectura y muestra **Desde Microsoft Entra** debajo. Cámbielo en su directorio, no aquí: tanto la sincronización nocturna como el siguiente inicio de sesión recuperan el valor del directorio, de modo que lo que se escriba aquí se sobrescribiría.

**Equipo**
Asigne este colaborador a un equipo. Los equipos son grupos organizacionales configurados en Configuración del portafolio. Esta asignación determina cómo se agrupan los colaboradores en la página de Colaboradores. El equipo también puede cambiarse desde el elemento **Equipo** del encabezado. Este campo solo es visible al editar el perfil de otro colaborador (no el suyo propio).

**Responsable**
La persona a la que reporta este colaborador. Haga clic en el campo, busque por nombre y elija a cualquier persona de su organización: el responsable no tiene por qué ser colaborador. Use **Borrar** para quitar el vínculo. Un colaborador no puede ser su propio responsable, y no puede elegir a alguien que ya le reporta, directamente o a través de una cadena de responsables.

Cuando el responsable proviene de Microsoft Entra, el campo es de solo lectura y muestra **Desde Microsoft Entra** debajo. Cámbielo en su directorio, no aquí: la sincronización nocturna traslada el cambio. Un responsable que todavía no tiene cuenta de KANAP se omite hasta que la tenga, y mientras tanto el campo conserva su valor actual.

Una vez definido, el nombre del responsable también aparece en el encabezado del espacio de trabajo, y al hacer clic se abre su ficha de colaborador cuando tiene una. Este campo solo es visible al editar el perfil de otro colaborador (no el suyo propio).

**Tipo de contrato**
Cómo trabaja esta persona con usted. Cada colaborador empieza como **Interno**; cambie a **Externo**, **Aprendiz** u **Otro** cuando no sea el caso. La lista es suya y se adapta en **Portafolio > Configuración > Tipos de contrato**. El tipo de contrato nunca se importa desde Microsoft Entra. Este campo solo es visible al editar el perfil de otro colaborador (no el suyo propio).

**Disponibilidad para proyectos**
Use el deslizador para establecer cuántos días por mes esta persona puede trabajar en proyectos del portafolio. El rango es 0 -- 20 días, con incrementos de 0.5 días. El valor predeterminado es 5 días. El valor se guarda al soltar el deslizador.

**Valores predeterminados de clasificación**
Establezca los valores de clasificación que se rellenan automáticamente en nuevas tareas, solicitudes y proyectos cuando los campos de clasificación están aún vacíos. Esto ahorra tiempo para colaboradores que trabajan consistentemente en la misma área.

- **Origen**: La clasificación de origen predeterminada
- **Categoría**: La clasificación de categoría predeterminada
- **Flujo**: La clasificación de flujo predeterminada (solo disponible una vez seleccionada una **Categoría**; filtrada a flujos que pertenecen a esa categoría)
- **Empresa**: La empresa predeterminada

Cuando un colaborador crea una nueva tarea, solicitud o proyecto, estos valores predeterminados se usan para rellenar automáticamente los campos de clasificación. Cambiar la **Categoría** borra el **Flujo** si el flujo actual no pertenece a la categoría recién seleccionada.

**Consejo**: También puede acceder a sus propios predeterminados desde **Configuración > Perfil**, que abre su perfil de colaborador con el panel Propiedades visible.

### General

Vea estadísticas de tiempo y añada notas.

**Estadísticas de tiempo**
Resumen de solo lectura del tiempo registrado para este colaborador. Requiere `portfolio_settings:reader` para ver.

- **Esfuerzo medio mensual en proyectos (últimos 6 meses)**: Mostrado en días-persona (horas / 8)
- **Esfuerzo mensual (12 meses)**: Gráfico de líneas mostrando **Total**, **Proyecto** y **Otros** tiempos
  - **Proyecto** = tiempo de gastos generales del proyecto + tiempo registrado en tareas de proyecto
  - **Otros** = tiempo registrado en tareas fuera de proyecto
  - Los meses sin datos se muestran como vacíos en el gráfico

**Notas**
Campo de texto libre para cualquier información adicional sobre este colaborador -- certificaciones, preferencias, restricciones u otros detalles relevantes. Las notas se guardan poco después de que deje de escribir.

---

### Competencias

Rastree lo que este colaborador sabe y su nivel de dominio.

**Añadir competencias**:
1. Haga clic en **Añadir competencia** en el encabezado del espacio de trabajo (disponible desde cualquier pestaña)
2. Busque la competencia; la lista está agrupada por categoría
3. Elija su nivel en el mismo cuadro de diálogo (predeterminado: 2, "Puede ejecutar con apoyo")
4. Haga clic en **Añadir**: la competencia aparece en su sección con ese nivel ya definido, sin tener que buscarla en una lista larga para ajustarla

**Niveles de dominio**:
Cada competencia tiene una calificación de dominio de 1 a 4:

| Nivel | Etiqueta | Descripción |
|-------|----------|-------------|
| 1 | Básico / Teórico | Entiende conceptos pero no los ha aplicado |
| 2 | Puede ejecutar con apoyo | Puede hacer el trabajo con orientación |
| 3 | Autónomo | Puede trabajar de forma independiente |
| 4 | Experto | Expertise profundo, puede formar a otros |

Cada competencia muestra cuatro marcas de nivel seguidas del nombre del nivel actual. Haga clic en una marca para establecer el nivel, o enfoque las marcas y use las teclas de flecha. Pase el cursor sobre una marca para ver qué significa ese nivel.

**Eliminar competencias**:
Pase el cursor sobre una competencia y haga clic en la **×** que aparece al final de la fila para quitarla del perfil del colaborador.

**Categorías de competencias**:
Las competencias se agrupan bajo el encabezado de su categoría, con el número de competencias al lado. Use **Agrupar por** encima de la lista para cambiar a una agrupación por nivel, de experto hacia abajo: muestra de un vistazo lo que domina esta persona. La elección se recuerda. En una pantalla ancha, la lista se distribuye en dos columnas.

---

### Tiempo registrado

Vea y gestione todas las entradas de tiempo de este colaborador en un solo lugar. Esta pestaña solo es visible si tiene `portfolio_settings:reader` o superior.

La tabla consolida el tiempo registrado tanto de entradas de gastos generales del proyecto como de entradas de tiempo de tareas, dándole una imagen completa de cómo el colaborador invierte su tiempo.

**Columnas**:
- **Fecha**: Cuándo se registró el tiempo
- **Fuente**: Dónde se registró el tiempo -- ya sea un nombre de tarea o nombre de proyecto
- **Categoría**: Si la entrada se clasifica como **IT** o **Negocio**, mostrada como etiqueta con color
- **Tiempo**: Duración en horas o días (p. ej., "4h", "1d 2h")
- **Notas**: Cualquier nota adjunta a la entrada

**Editar entradas**:
Haga clic en el **icono de editar** junto a una entrada de tiempo para abrir el diálogo de edición. El diálogo depende del tipo de entrada:
- Las **entradas de tarea** abren el diálogo de registro de tiempo de tarea, donde puede ajustar las horas, fecha, categoría y notas
- Las **entradas de proyecto** abren el diálogo de registro de tiempo de proyecto, donde puede ajustar las horas, categoría, usuario y notas

**Eliminar entradas**:
Haga clic en el **icono de eliminar** junto a una entrada de tiempo para quitarla. Se le pedirá confirmación antes de eliminar la entrada. Eliminar una entrada también actualiza las estadísticas de tiempo del colaborador en la pestaña **General**.

**Permisos para acciones de entradas de tiempo**:
- Para ver la columna de **Acciones**, necesita al menos `tasks:member` o `portfolio_projects:contributor`
- Los usuarios no administradores solo pueden editar o eliminar entradas que crearon o a las que están asignados
- Los usuarios con `tasks:admin` pueden editar o eliminar cualquier entrada de tarea independiente
- Los usuarios con `portfolio_projects:admin` pueden editar o eliminar cualquier entrada de tarea de proyecto o entrada de gastos generales del proyecto

---

## Acciones

Desde el encabezado del espacio de trabajo:
- **Eliminar**: Eliminar esta configuración de colaborador (no afecta la cuenta de usuario). Solo disponible al editar el perfil de otro colaborador con `portfolio_settings:admin`.
- **Enlace de retorno**: Volver a la lista de colaboradores, o a **Configuración** si abrió su propio perfil

No hay botón Guardar: cada cambio se guarda automáticamente.

---

## Su propio perfil de colaborador

Todo usuario con al menos un permiso de lectura a nivel de portafolio puede acceder a su propio perfil de colaborador en **Portafolio > Colaboradores > yo** o desde **Configuración > Perfil > Configuración de colaborador**.

Al editar su propio perfil:
- Puede actualizar su **disponibilidad**, **competencias**, **notas** y **valores predeterminados de clasificación**
- No puede cambiar su propia **asignación de equipo** (solo un miembro de configuración del portafolio puede hacerlo)
- No puede eliminar su propio registro de colaborador

Si no tiene un registro de colaborador todavía, abrir la página de autoservicio crea uno automáticamente.

---

## Equipos

Los colaboradores pueden asignarse a equipos organizacionales para una mejor organización. Los equipos se configuran en **Portafolio > Configuración > Equipos**.

**Equipos predeterminados** (se pueden personalizar):
- Infraestructura
- Aplicaciones de negocio
- Aplicaciones de ingeniería
- Mesa de servicio
- Datos maestros
- Ciberseguridad

**Gestión de equipos**:
- Vaya a **Portafolio > Configuración** y haga clic en la pestaña **Equipos**
- Añadir, editar o deshabilitar equipos
- Use **Establecer valores predeterminados** para llenar con equipos estándar
- Un equipo con miembros o subequipos no se puede eliminar: muévalos primero a otro equipo, o desactive el equipo. Los equipos integrados no se pueden eliminar

---

## Tipos de contrato

Los tipos de contrato registran cómo trabaja cada persona con usted: un empleado, alguien de un proveedor, un aprendiz, y lo que su organización necesite. Se configuran en **Portafolio > Configuración > Tipos de contrato**. Cada colaborador empieza como Interno.

**Tipos predeterminados** (se pueden renombrar):
- Interno
- Externo
- Aprendiz
- Otro

**Gestionar los tipos de contrato**:
- Vaya a **Portafolio > Configuración** y abra la pestaña **Tipos de contrato**
- Agregue sus propios tipos, renómbrelos, o desactive uno para excluirlo de las nuevas asignaciones sin perder a los colaboradores que ya lo tienen
- Los cuatro tipos integrados pueden renombrarse pero no eliminarse
- Un tipo asignado al menos a un colaborador no puede eliminarse; la pestaña indica cuántos colaboradores usan cada uno

---

## Consejos

- **Asigne colaboradores a equipos**: Esto ayuda a organizar la página de Colaboradores y facilita encontrar personas específicas.
- **Establezca una disponibilidad realista**: Tenga en cuenta reuniones, trabajo operativo y vacaciones al establecer los días por mes. La mayoría de las personas tienen menos tiempo de proyecto del que esperaría.
- **Use el dominio con honestidad**: Un equipo lleno de "expertos" no es útil para la planificación. Sea realista sobre los niveles de competencia para tomar mejores decisiones de recursos.
- **Mantenga las competencias actualizadas**: Revise las competencias de los colaboradores periódicamente, especialmente después de formación o nueva experiencia en proyectos.
- **Configure sus valores predeterminados de clasificación temprano**: Si siempre trabaja en la misma categoría y flujo, configurar los predeterminados le ahorra seleccionarlos cada vez que crea una tarea o solicitud.
