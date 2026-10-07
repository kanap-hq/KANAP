# Datos de ejemplo

Use la página Datos de ejemplo para descubrir KANAP con un conjunto de datos listo para usar. Llena un espacio de trabajo vacío con Fromage & Co, una quesería ficticia, para que vea cómo funcionan juntos los presupuestos, las aplicaciones, los contratos y los proyectos antes de introducir los suyos. Cuando termine de explorar, una sola acción lo borra todo y devuelve el espacio de trabajo a su estado inicial.

## Dónde encontrarla

- Espacio de trabajo: **Administración** › **Datos de ejemplo**
- Ruta: `/admin/sample-data`
- Quién puede usarla: los usuarios con el rol **Administrador**. Un nivel de permiso de módulo, incluso `admin`, no da acceso.
- Disponible solo en espacios de trabajo en la nube. Las instalaciones en sus propios servidores no tienen esta página.

La página no está disponible en el host de la plataforma. Siempre actúa sobre el espacio de trabajo en el que ha iniciado sesión.

## Qué contiene el conjunto de ejemplo

El conjunto describe Fromage & Co, una quesería ficticia:

- **4 empresas** en Francia, los Países Bajos, Italia y Estados Unidos
- **18 usuarios ficticios**, que no pueden iniciar sesión y no reciben ningún correo electrónico
- **Aplicaciones y su panorama**: instancias, interfaces y conexiones
- **Contratos, el presupuesto del año en curso, proyectos y tareas**

Las fechas siguen el año en curso, de modo que el presupuesto siempre parece actualizado. La carga tarda menos de un minuto.

Los usuarios ficticios no tienen contraseña ni acceso. Sirven para que los responsables, las personas asignadas y los equipos de proyecto resulten realistas. KANAP no les envía ningún correo, y el borrado los elimina.

## Cargar los datos de ejemplo

Los datos de ejemplo solo se cargan en un espacio de trabajo vacío. Un espacio de trabajo se considera vacío cuando no contiene nada de lo siguiente:

- datos de negocio como aplicaciones, activos, contratos, líneas de presupuesto, proyectos, solicitudes o tareas
- datos maestros más allá de lo que un espacio de trabajo nuevo tiene al empezar: empresas adicionales, proveedores, contactos, departamentos, centros de coste o ubicaciones
- configuración que usted haya añadido: un plan de cuentas propio, categorías analíticas, clasificación del portafolio, calendarios laborales adicionales, integraciones o agentes de IA
- documentos fuera de la biblioteca de plantillas

Lo que un espacio de trabajo nuevo crea por usted (su primera empresa, el plan de cuentas predeterminado y el calendario de su país) no cuenta.

**Para cargar el conjunto**:

1. Abra **Administración** › **Datos de ejemplo**.
2. Haga clic en **Cargar datos de ejemplo**.
3. Lea el resumen del cuadro de diálogo y confirme con **Cargar datos de ejemplo**.

La página sigue la carga paso a paso (por ejemplo, «Paso 4 de 19: planes de cuentas») y el estado cambia a **Cargados** al terminar. La franja de estado muestra entonces cuándo se cargaron los datos y quién lo hizo. Todo lo que ve en KANAP se actualiza con los nuevos datos.

**Si la carga no es posible**, la página no muestra el botón **Cargar datos de ejemplo**. Una línea explica el motivo:

- el espacio de trabajo ya contiene datos
- la suscripción está congelada
- el periodo de prueba ha terminado

El banner de la página de inicio permanece entonces oculto. El borrado sigue siendo posible en un espacio de trabajo congelado (véase más abajo).

**Si la carga falla**, KANAP devuelve por sí mismo el espacio de trabajo a su estado inicial. El estado muestra **Error de carga** con la fecha, y la página indica el motivo. Haga clic en **Reintentar** para iniciar otra carga.

!!! warning "Espere a que termine la carga"
    Mientras se ejecuta una carga, todo lo que se cree en el espacio de trabajo se borra si la carga falla. Espere a que el estado muestre **Cargados** antes de empezar a trabajar de verdad.

## El banner de la página de inicio

Mientras el espacio de trabajo está vacío y nunca se han cargado datos de ejemplo, los administradores ven una línea en la parte superior de la página de inicio: «Descubra KANAP con datos de ejemplo.»

- **Cargar** abre el mismo cuadro de diálogo que la página.
- **Ocultar** elimina la línea de forma definitiva, para todos los administradores del espacio de trabajo. La página en **Administración** › **Datos de ejemplo** sigue disponible.
- Mientras se ejecuta una carga, la línea muestra el paso en curso.
- Si una carga falla, la línea indica el motivo y ofrece **Reintentar**.

La línea desaparece en cuanto el espacio de trabajo contiene datos. No vuelve tras un borrado. Para cargar el conjunto de nuevo, use **Administración** › **Datos de ejemplo**.

## Borrar todo y empezar de cero

Una vez cargados los datos de ejemplo, la página ofrece **Borrar todo y empezar de cero**. También se ofrece tras una carga fallida que no pudo restablecer el estado inicial. Funciona cuando la suscripción está congelada o el periodo de prueba ha caducado.

**Esta acción no se puede deshacer.** Todo el contenido del espacio de trabajo se borra, tanto si procede del conjunto de ejemplo como de su propio trabajo, y el espacio de trabajo vuelve a su estado inicial.

**Qué se borra**:

- todos los registros: aplicaciones, contratos, presupuesto, proyectos, solicitudes, tareas, documentos, datos maestros, etc.
- los archivos subidos y los adjuntos
- los usuarios de ejemplo

**Qué se conserva**:

- las cuentas de usuario reales y sus roles
- la suscripción
- el nombre, la dirección y el logotipo del espacio de trabajo
- la conexión con Microsoft
- la configuración de IA
- el registro de auditoría

**Qué vuelve a los valores predeterminados**: la configuración guardada en el espacio de trabajo, es decir, las monedas, las columnas presupuestarias y el catálogo de clasificación.

**Para borrar**:

1. Haga clic en **Borrar todo y empezar de cero**.
2. El cuadro de diálogo enumera lo que se conserva. Si ha creado elementos desde que se cargaron los datos de ejemplo, indica también cuántos (por ejemplo, «También se borrarán 12 elementos creados desde la carga de los datos de ejemplo»). Esos elementos se borran con el resto.
3. Escriba el nombre del espacio de trabajo, tal como aparece en el cuadro de diálogo, en el campo **Nombre del espacio de trabajo**. Las mayúsculas y los espacios alrededor del nombre no importan.
4. Haga clic en **Borrar todo**. El botón permanece desactivado hasta que el nombre coincide.

El borrado tarda unos segundos. El estado muestra **Borrando** y después **Sin cargar**. Durante esos segundos, KANAP rechaza los cambios de todos los usuarios del espacio de trabajo, y un error indica que se vuelva a intentar en un momento. La lectura sigue funcionando.

Si el borrado falla, la página muestra «No se pudo borrar el contenido del espacio de trabajo. No se ha modificado nada.» No se pierde nada y puede volver a intentarlo.

Cuando el espacio de trabajo se ha borrado, cada administrador recibe un correo electrónico que indica quién lo borró y cuándo. El registro de auditoría conserva constancia de la operación.

Tras el borrado, el espacio de trabajo queda como nuevo: puede volver a cargar los datos de ejemplo desde la página o empezar a introducir sus propios datos. El banner de la página de inicio no vuelve.

## Consejos

- **Explorar y luego limpiar**: cargue los datos de ejemplo para conocer el producto o preparar una demostración, y bórrelos antes de introducir datos reales. Si mezcla ambos, el borrado también elimina sus propias entradas.
- **Comprobar el número antes de borrar**: el número de elementos creados desde la carga indica si alguien ha empezado a trabajar de verdad en el espacio de trabajo.
- **Una persona a la vez**: en un espacio de trabajo solo puede ejecutarse una carga o un borrado a la vez. Si otro administrador ha iniciado uno, la página muestra su progreso.
- **Los usuarios reales están a salvo**: el borrado conserva todas las cuentas reales, así que nadie pierde el acceso al espacio de trabajo.
